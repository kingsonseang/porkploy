import { db } from "@porkploy/db/client";
import { services } from "@porkploy/db/schema";
import { GitHub } from "@porkploy/github";
import type { GitHubPRPayload, GitHubPushPayload } from "@porkploy/types";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import type { Context as ElysiaContext } from "elysia";
import { runtime } from "../lib/context";
import { triggerDeploy } from "../services/deploy";
import { createPreviewEnv, teardownPreviewEnv } from "../services/preview";

async function findServiceByRepo(repoFullName: string) {
  const [owner, name] = repoFullName.split("/");
  return await db.query.services.findFirst({
    where: and(
      eq(services.repoOwner, owner ?? ""),
      eq(services.repoName, name ?? "")
    ),
    with: { project: { with: { environments: true } } },
  });
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: allow console logs to check function status
export async function webhookHandler({ request, set }: ElysiaContext) {
  const event = request.headers.get("x-github-event");
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  const rawBody = await request.text();

  console.log("github webhook event --- start", {
    body: rawBody,
    event,
    signature,
  });

  const verified = await runtime
    .runPromise(
      Effect.gen(function* () {
        const github = yield* GitHub;
        yield* github.verifyWebhookSignature(rawBody, signature);
      })
    )
    .then(() => true)
    .catch(() => false);

  if (!verified) {
    set.status = 401;
    return { error: "Invalid signature" };
  }

  console.log("verified", verified);

  // Ping is just a health check from GitHub — always 200
  if (event === "ping") {
    set.status = 200;
    return { ok: true, pong: true };
  }

  const installationId = (() => {
    try {
      return (JSON.parse(rawBody) as { installation?: { id: number } })
        .installation?.id;
    } catch {
      return null;
    }
  })();

  if (!installationId) {
    set.status = 400;
    return { error: "Missing installation ID — is the GitHub App installed?" };
  }

  console.log("installationId", installationId);

  if (event === "push") {
    const payload = JSON.parse(rawBody) as GitHubPushPayload;
    const branch = payload.ref.replace("refs/heads/", "");
    console.log("push event", { branch, repo: payload.repository.full_name });

    const service = await findServiceByRepo(payload.repository.full_name);
    console.log("service found", service?.id ?? "none");

    if (!service || service.repoBranch !== branch) {
      set.status = 200;
      return { ok: true, skipped: true };
    }

    const prodEnv = service.project.environments.find(
      (e) => e.type === "production"
    );
    console.log("prodEnv found", prodEnv?.id ?? "none");

    if (!prodEnv) {
      set.status = 200;
      return { ok: true, skipped: "no production environment" };
    }

    console.log("triggering deploy...");
    try {
      await runtime.runPromise(
        triggerDeploy({
          branch,
          commitMessage: payload.head_commit?.message,
          commitSha: payload.after,
          environmentId: prodEnv.id,
          installationId,
          serviceId: service.id,
        })
      );
      console.log("deploy triggered");
    } catch (error) {
      console.error("deploy failed", error);
    }
  }

  if (event === "pull_request") {
    const payload = JSON.parse(rawBody) as GitHubPRPayload;
    const { action, number: prNumber, pull_request: pr } = payload;

    const service = await findServiceByRepo(payload.repository.full_name);
    if (!service) {
      set.status = 200;
      return { ok: true, skipped: true };
    }

    if (action === "opened" || action === "synchronize") {
      await runtime.runPromise(
        createPreviewEnv({
          branch: pr.head.ref,
          commitMessage: pr.title,
          commitSha: pr.head.sha,
          installationId,
          prNumber,
          prTitle: pr.title,
          serviceId: service.id,
        })
      );
    }

    if (action === "closed") {
      await runtime.runPromise(
        teardownPreviewEnv({
          installationId,
          prNumber,
          serviceId: service.id,
        })
      );
    }
  }

  set.status = 200;
  return { ok: true };
}
