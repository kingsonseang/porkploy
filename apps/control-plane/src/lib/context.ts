import { db } from "@porkploy/db/client";
import { GitHubLive } from "@porkploy/github";
import { InfisicalLive } from "@porkploy/infisical";
import { NomadLive } from "@porkploy/nomad";
import { BuildQueueLive } from "@porkploy/queue";
import type { TRPCContext } from "@porkploy/trpc";
import type { BuildJob } from "@porkploy/types";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { Effect, Layer, ManagedRuntime } from "effect";
import { auth } from "./auth";

// Services layer — no queue yet (queue needs runtime reference)
const ServicesLayer = Layer.mergeAll(NomadLive, InfisicalLive, GitHubLive);

// Temporary runtime just for running builds inside the queue
const servicesRuntime = ManagedRuntime.make(ServicesLayer);

// Lazy import to avoid circular — runBuild uses Nomad+GitHub from services runtime
const buildRunner = async (job: BuildJob) => {
  const { runBuild } = await import("../services/deploy");
  await servicesRuntime.runPromise(runBuild(job));
};

const buildRunnerEffect = (job: BuildJob): Effect.Effect<void, unknown> =>
  Effect.promise(() => buildRunner(job));

const AppLayer = Layer.mergeAll(
  ServicesLayer,
  BuildQueueLive(buildRunnerEffect)
);

export const runtime = ManagedRuntime.make(AppLayer);

export async function createContext(
  opts: FetchCreateContextFnOptions
): Promise<TRPCContext> {
  const betterAuthSession = await auth.api.getSession({
    headers: opts.req.headers,
  });
  const organization = await auth.api.getFullOrganization({
    headers: opts.req.headers,
  });

  const session: TRPCContext["session"] = betterAuthSession
    ? {
        userId: betterAuthSession.user.id,
        workspaceId: organization?.id,
      }
    : null;

  return {
    db,
    runtime: runtime as never,
    session,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
