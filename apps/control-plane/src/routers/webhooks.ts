import { db } from "@porkploy/db/client";
import { services } from "@porkploy/db/schema";
import { GitHub } from "@porkploy/github";
import type { GitHubPRPayload, GitHubPushPayload } from "@porkploy/types";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import type { Context as ElysiaContext } from "elysia";
import { runtime } from "../lib/context";
import { triggerDeploy } from "../services/deploy";
import { createPreviewEnv, teardownPreviewEnv } from "../services/preview";

async function findServiceByRepo(repoFullName: string) {
  const [owner, _name] = repoFullName.split("/");
  return await db.query.services.findFirst({
    where: eq(services.repoOwner, owner ?? ""),
    with: { project: { with: { environments: true } } },
  });
}

export async function webhookHandler({ request, set }: ElysiaContext) {
  const event = request.headers.get("x-github-event");
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  const rawBody = await request.text();

  // Verify signature
  await runtime
    .runPromise(
      Effect.gen(function* () {
        const github = yield* GitHub;
        yield* github.verifyWebhookSignature(rawBody, signature);
      })
    )
    .catch(() => {
      set.status = 401;
      return { error: "Invalid signature" };
    });

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

  if (event === "push") {
    const payload = JSON.parse(rawBody) as GitHubPushPayload;
    const branch = payload.ref.replace("refs/heads/", "");

    const service = await findServiceByRepo(payload.repository.full_name);
    if (!service || service.repoBranch !== branch) {
      set.status = 200;
      return { ok: true, skipped: true };
    }

    const prodEnv = service.project.environments.find(
      (e) => e.type === "production"
    );
    if (!prodEnv) {
      set.status = 200;
      return { ok: true, skipped: "no production environment" };
    }

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
