/** biome-ignore-all lint/performance/useTopLevelRegex: ignore regex rules for this file */
// Bun supports PKCS#1 RSA keys natively via node:crypto
import { createHmac, createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { Context, Data, Effect, Layer } from "effect";

// ─── Errors ───────────────────────────────────────────────────────────────────

export class GitHubError extends Data.TaggedError("GitHubError")<{
  message: string;
  status?: number;
}> {}

export class GitHubWebhookError extends Data.TaggedError("GitHubWebhookError")<{
  message: string;
}> {}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GitHubRepo {
  cloneUrl: string;
  defaultBranch: string;
  fullName: string;
  id: number;
  name: string;
  private: boolean;
}

export interface GitHubInstallation {
  account: { login: string; type: "User" | "Organization" };
  id: number;
}

// ─── Service interface ────────────────────────────────────────────────────────

export interface GitHubClient {
  /** Update a commit status (building / success / failure) */
  createCommitStatus: (opts: {
    installationId: number;
    owner: string;
    repo: string;
    sha: string;
    state: "pending" | "success" | "failure" | "error";
    description: string;
    context: string;
    targetUrl?: string;
  }) => Effect.Effect<void, GitHubError>;

  /** Post a comment on a PR (e.g. preview URL) */
  createPRComment: (opts: {
    installationId: number;
    owner: string;
    repo: string;
    prNumber: number;
    body: string;
  }) => Effect.Effect<void, GitHubError>;

  /** Exchange installation ID for a short-lived token (1hr) */
  getInstallationToken: (
    installationId: number
  ) => Effect.Effect<string, GitHubError>;

  /** List repos accessible to an installation */
  listInstallationRepos: (
    installationId: number
  ) => Effect.Effect<GitHubRepo[], GitHubError>;
  /** Verify incoming webhook signature */
  verifyWebhookSignature: (
    payload: string,
    signature: string
  ) => Effect.Effect<void, GitHubWebhookError>;
}

// ─── Service tag ─────────────────────────────────────────────────────────────

export class GitHub extends Context.Tag("GitHub")<GitHub, GitHubClient>() {}

// ─── JWT generator for GitHub App auth ───────────────────────────────────────

// biome-ignore lint/suspicious/useAwait: ignore async/await
async function generateAppJwt(
  appId: string,
  privateKey: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" })
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      exp: now + 600,
      iat: now - 60,
      iss: appId,
    })
  ).toString("base64url");

  const unsigned = `${header}.${payload}`;

  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  sign.end();

  const signature = sign.sign(privateKey).toString("base64url");
  return `${unsigned}.${signature}`;
}

// ─── Live implementation ──────────────────────────────────────────────────────

export const GitHubLive = Layer.effect(
  GitHub,
  Effect.gen(function* () {
    const appId = Bun.env.GITHUB_APP_ID ?? "";
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY_PATH
      ? readFileSync(process.env.GITHUB_APP_PRIVATE_KEY_PATH, "utf-8")
      : (process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n") ?? "");
    const webhookSecret = Bun.env.GITHUB_WEBHOOK_SECRET ?? "";

    const request = <T>(
      method: string,
      path: string,
      token: string,
      body?: unknown
    ): Effect.Effect<T, GitHubError> =>
      Effect.tryPromise({
        catch: (e) =>
          e instanceof GitHubError
            ? e
            : new GitHubError({ message: String(e) }),
        try: async () => {
          const res = await fetch(`https://api.github.com${path}`, {
            body: body ? JSON.stringify(body) : undefined,
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
            method,
          });
          if (!res.ok) {
            throw new GitHubError({
              message: await res.text(),
              status: res.status,
            });
          }
          if (res.status === 204) {
            return undefined as T;
          }
          return res.json() as Promise<T>;
        },
      });

    const withInstallationToken = <T>(
      installationId: number,
      fn: (token: string) => Effect.Effect<T, GitHubError>
    ): Effect.Effect<T, GitHubError> =>
      Effect.gen(function* () {
        const jwt = yield* Effect.tryPromise({
          catch: (e) => new GitHubError({ message: String(e) }),
          try: () => generateAppJwt(appId, privateKey),
        });
        const tokenRes = yield* request<{ token: string }>(
          "POST",
          `/app/installations/${installationId}/access_tokens`,
          jwt
        );
        return yield* fn(tokenRes.token);
      });

    return {
      createCommitStatus: ({
        installationId,
        owner,
        repo,
        sha,
        state,
        description,
        context,
        targetUrl,
      }) =>
        withInstallationToken(installationId, (token) =>
          Effect.gen(function* () {
            yield* request<unknown>(
              "POST",
              `/repos/${owner}/${repo}/statuses/${sha}`,
              token,
              { context, description, state, target_url: targetUrl }
            );
          })
        ),

      createPRComment: ({ installationId, owner, repo, prNumber, body }) =>
        withInstallationToken(installationId, (token) =>
          Effect.gen(function* () {
            yield* request<unknown>(
              "POST",
              `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
              token,
              { body }
            );
          })
        ),

      getInstallationToken: (installationId) =>
        withInstallationToken(installationId, (token) => Effect.succeed(token)),

      listInstallationRepos: (installationId) =>
        withInstallationToken(installationId, (token) =>
          Effect.gen(function* () {
            const res = yield* request<{
              repositories: Array<{
                id: number;
                name: string;
                full_name: string;
                clone_url: string;
                default_branch: string;
                private: boolean;
              }>;
            }>("GET", "/installation/repositories?per_page=100", token);
            return res.repositories.map((r) => ({
              cloneUrl: r.clone_url,
              defaultBranch: r.default_branch,
              fullName: r.full_name,
              id: r.id,
              name: r.name,
              private: r.private,
            }));
          })
        ),
      verifyWebhookSignature: (payload, signature) =>
        Effect.gen(function* () {
          const expected = `sha256=${createHmac("sha256", webhookSecret)
            .update(payload)
            .digest("hex")}`;
          if (expected !== signature) {
            return yield* Effect.fail(
              new GitHubWebhookError({ message: "Invalid webhook signature" })
            );
          }
        }),
    };
  })
);
