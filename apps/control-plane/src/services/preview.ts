import { createId } from "@paralleldrive/cuid2";
import { db } from "@porkploy/db/client";
import { environments, services } from "@porkploy/db/schema";
import { GitHub } from "@porkploy/github";
import { Infisical } from "@porkploy/infisical";
import { Nomad } from "@porkploy/nomad";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { triggerDeploy } from "./deploy";

export interface CreatePreviewOptions {
  branch: string;
  commitMessage?: string;
  commitSha: string;
  installationId: number;
  prNumber: number;
  prTitle: string;
  serviceId: string;
}

export const createPreviewEnv = (opts: CreatePreviewOptions) =>
  Effect.gen(function* () {
    const infisical = yield* Infisical;
    const github = yield* GitHub;

    const service = yield* Effect.promise(() =>
      db.query.services.findFirst({
        where: eq(services.id, opts.serviceId),
        with: { project: true },
      })
    );
    if (!service) {
      return yield* Effect.fail(new Error("Service not found"));
    }

    // Create or reuse environment row for this PR
    const envName = `pr-${opts.prNumber}`;
    let env = yield* Effect.promise(() =>
      db.query.environments.findFirst({
        where: and(
          eq(environments.projectId, service.projectId),
          eq(environments.name, envName)
        ),
      })
    );

    if (!env) {
      [env] = yield* Effect.promise(() =>
        db
          .insert(environments)
          .values({
            branch: opts.branch,
            id: createId(),
            name: envName,
            prNumber: opts.prNumber,
            projectId: service.projectId,
            type: "preview",
          })
          .returning()
      );
    }

    if (!env) {
      return yield* Effect.fail(new Error("Failed to create environment"));
    }

    // Seed preview secrets in Infisical (copy from production, skip PROD_ prefix)
    if (service.project.infisicalProjectId) {
      yield* infisical.seedPreviewSecrets({
        projectId: service.project.infisicalProjectId,
        sourcePath: service.infisicalPath ?? "/",
        targetEnvironment: "preview",
        targetPath: `preview/pr-${opts.prNumber}${service.infisicalPath ?? "/"}`,
      });
    }

    // Trigger build + deploy
    const { buildId } = yield* triggerDeploy({
      branch: opts.branch,
      commitMessage: opts.commitMessage,
      commitSha: opts.commitSha,
      environmentId: env.id,
      installationId: opts.installationId,
      serviceId: opts.serviceId,
    });

    const previewUrl = `https://pr-${opts.prNumber}-${service.name}.preview.yourdomain.com`;

    // Post PR comment with preview URL
    if (service.repoOwner && service.repoName) {
      yield* github.createPRComment({
        body: [
          "### 🚀 Preview deployment",
          "| | |",
          "|---|---|",
          `| **Preview URL** | ${previewUrl} |`,
          `| **Branch** | \`${opts.branch}\` |`,
          `| **Commit** | \`${opts.commitSha.slice(0, 7)}\` |`,
          `| **Build** | \`${buildId}\` |`,
        ].join("\n"),
        installationId: opts.installationId,
        owner: service.repoOwner,
        prNumber: opts.prNumber,
        repo: service.repoName,
      });
    }

    return { buildId, environmentId: env.id, previewUrl };
  });

export interface TeardownPreviewOptions {
  installationId: number;
  prNumber: number;
  serviceId: string;
}

export const teardownPreviewEnv = (opts: TeardownPreviewOptions) =>
  Effect.gen(function* () {
    const nomad = yield* Nomad;

    const service = yield* Effect.promise(() =>
      db.query.services.findFirst({
        where: eq(services.id, opts.serviceId),
      })
    );
    if (!service) {
      return yield* Effect.fail(new Error("Service not found"));
    }

    const nomadJobId = `${service.name}-pr-${opts.prNumber}`;

    // Stop Nomad job (purge = true to free resources immediately)
    yield* Effect.catchAll(
      nomad.stopJob(nomadJobId, true),
      () => Effect.void // job may already be gone, that's fine
    );

    // Mark environment inactive
    yield* Effect.promise(() =>
      db
        .update(environments)
        .set({ isActive: false })
        .where(
          and(
            eq(environments.projectId, service.projectId),
            eq(environments.name, `pr-${opts.prNumber}`)
          )
        )
    );

    // TODO: drop Postgres preview schema if applicable
    // TODO: clean up Infisical preview folder via API
  });
