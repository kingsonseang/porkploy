// BuildKit gRPC client (Effect service)
// gRPC codegen from BuildKit .proto files goes here
// For now: shells out to buildctl CLI as a bridge until gRPC client is wired

import type { BuildJob } from "@porkploy/types";
import { Context, Data, Effect, Layer } from "effect";

export class BuildKitError extends Data.TaggedError("BuildKitError")<{
  message: string;
  exitCode?: number;
}> {}

export interface BuildKitClient {
  build: (job: BuildJob) => Effect.Effect<void, BuildKitError>;
}

export class BuildKit extends Context.Tag("BuildKit")<
  BuildKit,
  BuildKitClient
>() {}

export const BuildKitLive = Layer.succeed(BuildKit, {
  build: (job) =>
    Effect.tryPromise({
      catch: (e) =>
        e instanceof BuildKitError
          ? e
          : new BuildKitError({ message: String(e) }),
      try: async () => {
        const args = job.dockerfilePath
          ? [
              "build",
              "--dockerfile",
              job.dockerfilePath,
              "--tag",
              job.imageTag,
              ".",
            ]
          : ["nixpacks", "build", ".", "--name", job.imageTag];

        const proc = Bun.spawn(args, {
          cwd: `/tmp/builds/${job.buildId}`,
          stderr: "pipe",
          stdout: "pipe",
        });

        const exitCode = await proc.exited;
        if (exitCode !== 0) {
          throw new BuildKitError({
            exitCode,
            message: await new Response(proc.stderr).text(),
          });
        }
      },
    }),
});
