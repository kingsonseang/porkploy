import { Context, Data, Effect, Layer } from "effect";

const INFISICAL_API = "https://app.infisical.com/api";

// ─── Errors ───────────────────────────────────────────────────────────────────

export class InfisicalError extends Data.TaggedError("InfisicalError")<{
  message: string;
  status?: number;
}> {}

// ─── Service interface ────────────────────────────────────────────────────────

export interface InfisicalClient {
  /** Create a folder/path within a project environment (per service) */
  createFolder: (opts: {
    projectId: string;
    environment: string;
    path: string;
  }) => Effect.Effect<void, InfisicalError>;

  /** Create a machine identity for a workspace (one per workspace) */
  createMachineIdentity: (
    name: string,
    orgId: string
  ) => Effect.Effect<
    {
      clientId: string;
      clientSecret: string;
    },
    InfisicalError
  >;
  /** Create an Infisical project for a new Spark project */
  createProject: (
    name: string,
    orgId: string
  ) => Effect.Effect<{ projectId: string }, InfisicalError>;

  /** Get a short-lived access token using machine identity credentials */
  getMachineToken: (
    clientId: string,
    clientSecret: string
  ) => Effect.Effect<string, InfisicalError>;

  /** Seed preview env folder by copying from production */
  seedPreviewSecrets: (opts: {
    projectId: string;
    sourcePath: string;
    targetEnvironment: string;
    targetPath: string;
  }) => Effect.Effect<void, InfisicalError>;
}

// ─── Service tag ─────────────────────────────────────────────────────────────

export class Infisical extends Context.Tag("Infisical")<
  Infisical,
  InfisicalClient
>() {}

// ─── Live implementation ──────────────────────────────────────────────────────

export const InfisicalLive = Layer.effect(
  Infisical,
  Effect.gen(function* () {
    // Platform-level machine identity (for managing workspace projects)
    const platformClientId = process.env.INFISICAL_CLIENT_ID;
    const platformClientSecret = process.env.INFISICAL_CLIENT_SECRET;

    const getToken = (clientId: string, clientSecret: string) =>
      Effect.tryPromise({
        catch: (e) =>
          e instanceof InfisicalError
            ? e
            : new InfisicalError({ message: String(e) }),
        try: async () => {
          const res = await fetch(
            `${INFISICAL_API}/v1/auth/universal-auth/login`,
            {
              body: JSON.stringify({ clientId, clientSecret }),
              headers: { "Content-Type": "application/json" },
              method: "POST",
            }
          );
          if (!res.ok) {
            throw new InfisicalError({
              message: await res.text(),
              status: res.status,
            });
          }
          const data = (await res.json()) as { accessToken: string };
          return data.accessToken;
        },
      });

    const request = <T>(
      method: string,
      path: string,
      token: string,
      body?: unknown
    ): Effect.Effect<T, InfisicalError> =>
      Effect.tryPromise({
        catch: (e) =>
          e instanceof InfisicalError
            ? e
            : new InfisicalError({ message: String(e) }),
        try: async () => {
          const res = await fetch(`${INFISICAL_API}${path}`, {
            body: body ? JSON.stringify(body) : undefined,
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            method,
          });
          if (!res.ok) {
            throw new InfisicalError({
              message: await res.text(),
              status: res.status,
            });
          }
          return res.json() as Promise<T>;
        },
      });

    const withPlatformToken = <T>(
      fn: (token: string) => Effect.Effect<T, InfisicalError>
    ): Effect.Effect<T, InfisicalError> =>
      Effect.gen(function* () {
        if (!(platformClientId && platformClientSecret)) {
          return yield* Effect.fail(
            new InfisicalError({
              message: "Platform Infisical credentials not configured",
            })
          );
        }
        const token = yield* getToken(platformClientId, platformClientSecret);
        return yield* fn(token);
      });

    return {
      createFolder: ({ projectId, environment, path }) =>
        withPlatformToken((token) =>
          Effect.gen(function* () {
            yield* request<unknown>("POST", "/v1/folders", token, {
              environment,
              name: path.split("/").pop(),
              path,
              workspaceId: projectId,
            });
          })
        ),

      createMachineIdentity: (name, orgId) =>
        withPlatformToken((token) =>
          Effect.gen(function* () {
            const identity = yield* request<{ identity: { id: string } }>(
              "POST",
              "/v1/identities",
              token,
              { name, organizationId: orgId, role: "member" }
            );
            const creds = yield* request<{
              clientSecret: { clientSecretData: string };
              clientId: string;
            }>(
              "POST",
              `/v1/auth/universal-auth/identities/${identity.identity.id}`,
              token,
              {}
            );
            return {
              clientId: creds.clientId,
              clientSecret: creds.clientSecret.clientSecretData,
            };
          })
        ),

      createProject: (name, orgId) =>
        withPlatformToken((token) =>
          Effect.gen(function* () {
            const res = yield* request<{ project: { id: string } }>(
              "POST",
              "/v1/workspace",
              token,
              { organizationId: orgId, projectName: name }
            );
            return { projectId: res.project.id };
          })
        ),
      getMachineToken: getToken,

      seedPreviewSecrets: ({
        projectId,
        sourcePath,
        targetEnvironment,
        targetPath,
      }) =>
        withPlatformToken((token) =>
          Effect.gen(function* () {
            // Fetch secrets from production path
            const secrets = yield* request<{
              secrets: Array<{ secretKey: string; secretValue: string }>;
            }>(
              "GET",
              `/v3/secrets/raw?workspaceId=${projectId}&environment=production&secretPath=${sourcePath}`,
              token
            );
            // Write each to preview path (skip anything marked prod-only by convention: prefix PROD_)
            for (const secret of secrets.secrets) {
              if (secret.secretKey.startsWith("PROD_")) {
                continue;
              }
              yield* request<unknown>(
                "POST",
                `/v3/secrets/raw/${secret.secretKey}`,
                token,
                {
                  environment: targetEnvironment,
                  secretPath: targetPath,
                  secretValue: secret.secretValue,
                  workspaceId: projectId,
                }
              );
            }
          })
        ),
    };
  })
);
