import { db } from "@porkploy/db/client";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { ac, admin, member, owner } from "./permissions";

if (!Bun.env.BETTER_AUTH_SECRET) {
  throw new Error("BETTER_AUTH_SECRET is required");
}

type BetterAuthOptions = Parameters<typeof betterAuth>[0];
type BetterAuthPlugin = NonNullable<BetterAuthOptions["plugins"]>[number];

/**
 * Base auth config shared between dashboard and control plane.
 * Framework-specific plugins (tanstackStartCookies, elysia, etc.)
 * are added in each app's own auth.ts — not here.
 */
export function baseAuth(plugins: BetterAuthPlugin[] = []) {
  return betterAuth({
    baseURL: Bun.env.BETTER_AUTH_URL ?? "http://localhost:3000",

    database: drizzleAdapter(db, {
      provider: "pg",
    }),

    emailAndPassword: {
      enabled: true,
    },

    plugins: [
      ...plugins,
      organization({
        ac,
        roles: {
          admin,
          member,
          owner,
        },

        schema: {
          member: {
            additionalFields: {
              updated_at: {
                fieldName: "updatedAt",
                onUpdate: () => new Date(),
                type: "date",
              },
            },
            modelName: "workspace_members",
          },
          organization: {
            additionalFields: {
              // GitHub App installation for this workspace
              github_installation_id: {
                fieldName: "githubInstallationId",
                required: false,
                type: "string",
              },
              github_org_or_user: {
                fieldName: "githubOrgOrUser",
                required: false,
                type: "string",
              },
              infisical_client_id: {
                fieldName: "infisicalClientId",
                required: false,
                type: "string",
              },
              // encrypted — never store plaintext
              infisical_client_secret_encrypted: {
                fieldName: "infisicalClientSecretEncrypted",
                required: false,
                type: "string",
              },
              // Infisical org/project for this workspace's secrets
              infisical_org_id: {
                fieldName: "infisicalOrgId",
                required: false,
                type: "string",
              },
              updated_at: {
                fieldName: "updatedAt",
                onUpdate: () => new Date(),
                type: "date",
              },
            },
            modelName: "workspaces",
          },
        },
      }),
    ],

    secret: Bun.env.BETTER_AUTH_SECRET,

    session: {
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5,
      },
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },

    socialProviders: {
      github: {
        clientId: Bun.env.GITHUB_CLIENT_ID ?? "",
        clientSecret: Bun.env.GITHUB_CLIENT_SECRET ?? "",
      },
    },

    user: {
      additionalFields: {
        github_id: {
          fieldName: "githubId",
          required: false,
          type: "string",
          unique: true,
        },
      },
      modelName: "users",
    },
  });
}

export type Auth = ReturnType<typeof baseAuth>;
export type Session = Auth["$Infer"]["Session"];
export type User = Auth["$Infer"]["Session"]["user"];
