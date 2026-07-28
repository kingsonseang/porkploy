import type { NomadJobOptions } from "@porkploy/types";
import { Context, Data, Effect, Layer } from "effect";

// ─── Errors ───────────────────────────────────────────────────────────────────

export class NomadError extends Data.TaggedError("NomadError")<{
  message: string;
  status?: number;
}> {}

// ─── Traefik tag builder ──────────────────────────────────────────────────────

export function buildTraefikTags(hostname: string, jobId: string): string[] {
  return [
    "traefik.enable=true",
    `traefik.http.routers.${jobId}.rule=Host(\`${hostname}\`)`,
    `traefik.http.routers.${jobId}.entrypoints=web,websecure`,
    `traefik.http.routers.${jobId}.tls=true`,
    `traefik.http.routers.${jobId}.tls.certresolver=letsencrypt`,
  ];
}

// ─── Nomad job spec builder ───────────────────────────────────────────────────

function buildJobSpec(opts: NomadJobOptions): unknown {
  const tags = opts.traefikHostname
    ? buildTraefikTags(opts.traefikHostname, opts.jobId)
    : ["traefik.enable=false"];

  const infisicalArgs = opts.infisicalProjectId
    ? [
        "infisical",
        "run",
        "--projectId",
        opts.infisicalProjectId,
        "--env",
        opts.infisicalEnvironment ?? "production",
        "--path",
        opts.infisicalPath ?? "/",
        "--",
      ]
    : [];

  return {
    Job: {
      Datacenters: ["dc1"],
      ID: opts.jobId,
      Name: opts.jobId,
      Type: opts.cronSchedule ? "batch" : "service",
      ...(opts.cronSchedule
        ? {
            Periodic: {
              ProhibitOverlap: true,
              Spec: opts.cronSchedule,
              SpecType: "cron",
            },
          }
        : {}),
      TaskGroups: [
        {
          Count: opts.count,
          Name: opts.jobId,
          Networks: [{ DynamicPorts: [{ Label: "http", To: opts.port }] }],
          Services: [
            {
              Checks: opts.traefikHostname
                ? [
                    {
                      Interval: 10_000_000_000, // nanoseconds
                      Path: "/",
                      Timeout: 2_000_000_000,
                      Type: "http",
                    },
                  ]
                : [],
              Name: opts.jobId,
              PortLabel: "http",
              Provider: "nomad",
              Tags: tags,
            },
          ],
          Tasks: [
            {
              Config: {
                args:
                  infisicalArgs.length > 1 ? infisicalArgs.slice(1) : undefined,
                command:
                  infisicalArgs.length > 0 ? infisicalArgs[0] : undefined,
                image: opts.image,
                ports: ["http"],
              },
              Driver: "docker",
              Env: opts.envVars ?? {},
              Name: opts.jobId,
              Resources: {
                CPU: opts.cpuMhz,
                MemoryMB: opts.memoryMb,
              },
            },
          ],
        },
      ],
    },
  };
}

// ─── Service interface ────────────────────────────────────────────────────────

export interface NomadClient {
  deployJob: (opts: NomadJobOptions) => Effect.Effect<string, NomadError>;
  getDeploymentStatus: (
    deploymentId: string
  ) => Effect.Effect<NomadDeployment, NomadError>;
  getJobStatus: (jobId: string) => Effect.Effect<NomadJobStatus, NomadError>;
  listJobs: () => Effect.Effect<NomadJobSummary[], NomadError>;
  stopJob: (jobId: string, purge?: boolean) => Effect.Effect<void, NomadError>;
}

export interface NomadJobStatus {
  deploymentId?: string | undefined; // need to pass undefined since T? isnt inferring as optional
  id: string;
  status: "running" | "dead" | "pending";
}

export interface NomadJobSummary {
  id: string;
  name: string;
  status: string;
}

export interface NomadDeployment {
  description: string;
  id: string;
  status: "running" | "successful" | "failed" | "cancelled";
}

// ─── Service tag + implementation ─────────────────────────────────────────────

export class Nomad extends Context.Tag("Nomad")<Nomad, NomadClient>() {}

export const NomadLive = Layer.effect(
  Nomad,
  Effect.gen(function* () {
    const addr = process.env.NOMAD_ADDR ?? "http://127.0.0.1:4646";
    const token = process.env.NOMAD_TOKEN;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(token ? { "X-Nomad-Token": token } : {}),
    };

    const request = <T>(
      method: string,
      path: string,
      body?: unknown
    ): Effect.Effect<T, NomadError> =>
      Effect.tryPromise({
        catch: (e) =>
          e instanceof NomadError ? e : new NomadError({ message: String(e) }),
        try: async () => {
          const res = await fetch(`${addr}/v1${path}`, {
            body: body ? JSON.stringify(body) : undefined,
            headers,
            method,
          });
          if (!res.ok) {
            const text = await res.text();
            throw new NomadError({ message: text, status: res.status });
          }
          return res.json() as Promise<T>;
        },
      });

    return {
      deployJob: (opts) =>
        Effect.gen(function* () {
          const spec = buildJobSpec(opts);
          const result = yield* request<{ EvalID: string }>(
            "PUT",
            "/jobs",
            spec
          );
          return result.EvalID;
        }),

      getDeploymentStatus: (deploymentId) =>
        Effect.gen(function* () {
          const d = yield* request<{
            ID: string;
            Status: string;
            StatusDescription: string;
          }>("GET", `/deployment/${deploymentId}`);
          return {
            description: d.StatusDescription,
            id: d.ID,
            status: d.Status as NomadDeployment["status"],
          };
        }),

      getJobStatus: (jobId) =>
        Effect.gen(function* () {
          const job = yield* request<{
            ID: string;
            Status: string;
            LatestDeployment?: { ID: string };
          }>("GET", `/job/${jobId}`);
          return {
            deploymentId: job.LatestDeployment?.ID,
            id: job.ID,
            status: job.Status as NomadJobStatus["status"],
          };
        }),

      listJobs: () =>
        Effect.gen(function* () {
          const jobs = yield* request<
            Array<{ ID: string; Name: string; Status: string }>
          >("GET", "/jobs");
          return jobs.map((j) => ({
            id: j.ID,
            name: j.Name,
            status: j.Status,
          }));
        }),

      stopJob: (jobId, purge = false) =>
        request<void>("DELETE", `/job/${jobId}${purge ? "?purge=true" : ""}`),
    };
  })
);
