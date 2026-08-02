import { createId } from "@paralleldrive/cuid2";
import { db } from "@porkploy/db/client";
import {
  builds,
  deployments,
  environments,
  services,
} from "@porkploy/db/schema";
import { GitHub } from "@porkploy/github";
import { Nomad } from "@porkploy/nomad";
import { BuildQueueService } from "@porkploy/queue";
import type { BuildJob } from "@porkploy/types";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

const GHCR_REGISTRY = "ghcr.io";
const GHCR_ORG = Bun.env.GHCR_ORG ?? "porkploy";

// ─── Main deploy trigger ──────────────────────────────────────────────────────

export interface TriggerDeployOptions {
  branch: string;
  commitMessage?: string | undefined;
  commitSha: string;
  environmentId: string;
  installationId: number;
  serviceId: string;
}

export const triggerDeploy = (opts: TriggerDeployOptions) =>
  Effect.gen(function* () {
    const queue = yield* BuildQueueService;
    const github = yield* GitHub;

    const service = yield* Effect.promise(() =>
      db.query.services.findFirst({
        where: eq(services.id, opts.serviceId),
      })
    );
    if (!service) {
      return yield* Effect.fail(new Error("Service not found"));
    }

    const imageTag = `${GHCR_REGISTRY}/${GHCR_ORG}/${service.repoName}:${opts.commitSha}`;

    console.log("inserting build with", {
      branch: opts.branch,
      commitSha: opts.commitSha,
      environmentId: opts.environmentId,
      serviceId: opts.serviceId,
    });

    // Create build row
    const [build] = yield* Effect.promise(() =>
      db
        .insert(builds)
        .values({
          branch: opts.branch,
          commitMessage: opts.commitMessage,
          commitSha: opts.commitSha,
          environmentId: opts.environmentId,
          id: createId(),
          imageTag,
          serviceId: opts.serviceId,
          status: "queued",
        })
        .returning()
    );

    console.log("build inserted", build?.id);

    if (!build) {
      return yield* Effect.fail(new Error("Failed to create build"));
    }

    // Update GitHub commit status
    if (service.repoOwner && service.repoName) {
      try {
        yield* github.createCommitStatus({
          context: "porkploy/deploy",
          description: "Build queued",
          installationId: opts.installationId,
          owner: service.repoOwner,
          repo: service.repoName,
          sha: opts.commitSha,
          state: "pending",
        });
      } catch (e) {
        console.error("commit status error", e);
        // Don't fail the whole deploy for this
      }
    }

    const job: BuildJob = {
      branch: opts.branch,
      buildId: build.id,
      commitSha: opts.commitSha,
      dockerfilePath: service.dockerfilePath ?? undefined,
      environmentId: opts.environmentId,
      imageTag,
      repoCloneUrl: `https://github.com/${service.repoOwner}/${service.repoName}.git`,
      serviceId: opts.serviceId,
    };

    yield* queue.enqueue(job);

    return { buildId: build.id, imageTag };
  });

// ─── Run build (called by queue worker) ──────────────────────────────────────

export const runBuild = (job: BuildJob) =>
  Effect.gen(function* () {
    const _nomad = yield* Nomad;
    const _github = yield* GitHub;

    // Mark build as running
    yield* Effect.promise(() =>
      db
        .update(builds)
        .set({ startedAt: new Date(), status: "running" })
        .where(eq(builds.id, job.buildId))
    );

    // Clone repo
    const cloneDir = `/tmp/builds/${job.buildId}`;
    const cloneProc = Bun.spawn(
      [
        "git",
        "clone",
        "--depth=1",
        "--branch",
        job.branch,
        job.repoCloneUrl,
        cloneDir,
      ],
      { stderr: "pipe", stdout: "pipe" }
    );
    const cloneExit = yield* Effect.promise(() => cloneProc.exited);
    if (cloneExit !== 0) {
      yield* Effect.promise(() =>
        db
          .update(builds)
          .set({
            errorMessage: "Clone failed",
            finishedAt: new Date(),
            status: "failed",
          })
          .where(eq(builds.id, job.buildId))
      );
      return yield* Effect.fail(new Error("Clone failed"));
    }

    // Build image — Dockerfile takes precedence over Nixpacks
    const buildArgs = job.dockerfilePath
      ? [
          "buildctl",
          "build",
          "--frontend=dockerfile.v0",
          "--opt",
          `filename=${job.dockerfilePath}`,
          "--local",
          `context=${cloneDir}`,
          "--local",
          `dockerfile=${cloneDir}`,
          "--output",
          `type=image,name=${job.imageTag},push=true`,
          "--export-cache",
          `type=registry,ref=${GHCR_REGISTRY}/${GHCR_ORG}/cache:${job.serviceId}`,
          "--import-cache",
          `type=registry,ref=${GHCR_REGISTRY}/${GHCR_ORG}/cache:${job.serviceId}`,
        ]
      : [
          "nixpacks",
          "build",
          cloneDir,
          "--name",
          job.imageTag,
          "--no-error-without-start",
        ];

    const buildProc = Bun.spawn(buildArgs, {
      env: {
        ...Bun.env,
        BUILDKIT_HOST: Bun.env.BUILDKIT_ADDR ?? "tcp://127.0.0.1:8372",
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    const buildExit = yield* Effect.promise(() => buildProc.exited);

    if (buildExit !== 0) {
      const errMsg = yield* Effect.promise(() =>
        new Response(buildProc.stderr).text()
      );
      yield* Effect.promise(() =>
        db
          .update(builds)
          .set({
            errorMessage: errMsg,
            finishedAt: new Date(),
            status: "failed",
          })
          .where(eq(builds.id, job.buildId))
      );
      return yield* Effect.fail(new Error(`Build failed: ${errMsg}`));
    }

    yield* Effect.promise(() =>
      db
        .update(builds)
        .set({ finishedAt: new Date(), status: "success" })
        .where(eq(builds.id, job.buildId))
    );

    // Deploy via Nomad
    yield* deployImage({
      buildId: job.buildId,
      environmentId: job.environmentId,
      imageTag: job.imageTag,
      serviceId: job.serviceId,
    });

    // Cleanup clone dir
    Bun.spawn(["rm", "-rf", cloneDir]);
  });

// ─── Deploy image to Nomad ────────────────────────────────────────────────────

export interface DeployImageOptions {
  buildId: string;
  environmentId: string;
  imageTag: string;
  serviceId: string;
  triggeredBy?: string;
}

export const deployImage = (opts: DeployImageOptions) =>
  Effect.gen(function* () {
    const nomad = yield* Nomad;

    const service = yield* Effect.promise(() =>
      db.query.services.findFirst({
        where: eq(services.id, opts.serviceId),
        with: { project: true },
      })
    );

    if (!service) {
      return yield* Effect.fail(new Error("Service not found"));
    }

    const env = yield* Effect.promise(() =>
      db.query.environments.findFirst({
        where: eq(environments.id, opts.environmentId),
      })
    );

    if (!env) {
      return yield* Effect.fail(new Error("Environment not found"));
    }

    // Nomad job ID is deterministic: projectSlug-serviceName[-pr-N]
    const nomadJobId = env.prNumber
      ? `${service.name}-pr-${env.prNumber}`
      : service.name;

    // Create deployment row
    const [deployment] = yield* Effect.promise(() =>
      db
        .insert(deployments)
        .values({
          buildId: opts.buildId,
          environmentId: opts.environmentId,
          id: createId(),
          imageTag: opts.imageTag,
          serviceId: opts.serviceId,
          startedAt: new Date(),
          status: "deploying",
          triggeredBy: opts.triggeredBy,
        })
        .returning()
    );

    if (!deployment) {
      return yield* Effect.fail(new Error("Failed to create deployment"));
    }

    // Generate hostname
    const hostname = env.prNumber
      ? `pr-${env.prNumber}-${service.name}.preview.yourdomain.com` // TODO: make domain configurable
      : `${service.name}.yourdomain.com`;

    const evalId = yield* nomad.deployJob({
      count: service.instanceCount ?? 1,
      cpuMhz: service.cpuMhz ?? 256,
      image: opts.imageTag,
      infisicalEnvironment: env.type === "preview" ? "preview" : "production",
      infisicalPath: `${service.infisicalPath ?? "/"}`,
      infisicalProjectId: service.project.infisicalProjectId ?? undefined,
      jobId: nomadJobId,
      memoryMb: service.memoryMb ?? 256,
      port: service.port ?? 3000,
      traefikHostname: hostname,
    });

    yield* Effect.promise(() =>
      db
        .update(deployments)
        .set({ nomadEvalId: evalId })
        .where(eq(deployments.id, deployment.id))
    );

    return { deploymentId: deployment.id, evalId, nomadJobId };
  });
