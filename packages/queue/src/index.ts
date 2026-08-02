/** biome-ignore-all lint/style/noIncrementDecrement: allow increment/decrement operators in this file */
import type { BuildJob } from "@porkploy/types";
import { Context, Data, Effect, Layer, Queue } from "effect";

// ─── Errors ───────────────────────────────────────────────────────────────────

export class QueueError extends Data.TaggedError("QueueError")<{
  message: string;
}> {}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_CONCURRENT_BUILDS = 2;

// ─── Service interface ────────────────────────────────────────────────────────

export interface BuildQueue {
  /** Current queue depth (excluding running) */
  depth: () => Effect.Effect<number, never>;
  /** Enqueue a build job — returns immediately, build runs when slot available */
  enqueue: (job: BuildJob) => Effect.Effect<void, QueueError>;

  /** How many builds are currently running */
  running: () => Effect.Effect<number, never>;
}

// ─── Service tag ─────────────────────────────────────────────────────────────

export class BuildQueueService extends Context.Tag("BuildQueue")<
  BuildQueueService,
  BuildQueue
>() {}

// ─── Live implementation ──────────────────────────────────────────────────────
// The queue itself is in-process. Build jobs are persisted to Postgres (builds table)
// before enqueuing, so restarts don't lose work — on boot the control plane
// re-enqueues any builds stuck in "queued" or "running" status.

export const BuildQueueLive = (
  runBuild: (job: BuildJob) => Effect.Effect<void, unknown>
) =>
  Layer.scoped(
    BuildQueueService,
    Effect.gen(function* () {
      const semaphore = yield* Effect.makeSemaphore(MAX_CONCURRENT_BUILDS);
      const queue = yield* Queue.unbounded<BuildJob>();

      // Track running count separately for status reporting
      let runningCount = 0;

      // Background fiber — drains queue respecting concurrency cap
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.gen(function* () {
            const job = yield* Queue.take(queue);
            yield* semaphore.withPermits(1)(
              Effect.gen(function* () {
                runningCount++;
                yield* Effect.catchAll(runBuild(job), (e) =>
                  Effect.logError(`Build ${job.buildId} failed: ${String(e)}`)
                );
                runningCount--;
              })
            );
          })
        )
      );

      return {
        depth: () => Queue.size(queue),
        enqueue: (job) =>
          Effect.catchAll(Queue.offer(queue, job), (e) =>
            Effect.fail(new QueueError({ message: String(e) }))
          ),

        running: () => Effect.succeed(runningCount),
      };
    })
  );
