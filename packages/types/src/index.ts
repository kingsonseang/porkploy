// ─── Deploy / Build status ────────────────────────────────────────────────────

export type BuildStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled";
export type DeploymentStatus =
  | "queued"
  | "building"
  | "deploying"
  | "success"
  | "failed"
  | "cancelled"
  | "rolled_back";

export type ServiceType = "web" | "worker" | "cron" | "database";
export type EnvironmentType = "production" | "preview" | "staging";
export type WorkspaceRole = "owner" | "admin" | "member";
export type DbProvider = "postgres" | "mongo";

// ─── GitHub webhook payloads (subset we actually use) ─────────────────────────

export interface GitHubPushPayload {
  after: string; // commit SHA
  head_commit?: {
    id: string;
    message: string;
  };
  installation?: { id: number };
  ref: string; // "refs/heads/main"
  repository: {
    id: number;
    full_name: string; // "org/repo"
    clone_url: string;
  };
}

export interface GitHubPRPayload {
  action: "opened" | "closed" | "reopened" | "synchronize";
  installation?: { id: number };
  number: number;
  pull_request: {
    head: { sha: string; ref: string };
    base: { ref: string };
    merged: boolean;
    title: string;
  };
  repository: {
    id: number;
    full_name: string;
    clone_url: string;
  };
}

// ─── Nomad ────────────────────────────────────────────────────────────────────

export interface NomadJobOptions {
  count: number;
  cpuMhz: number;
  cronSchedule?: string | undefined;
  envVars?: Record<string, string>;
  image: string;
  infisicalEnvironment?: string | undefined;
  infisicalPath?: string | undefined;
  infisicalProjectId?: string | undefined;
  jobId: string;
  memoryMb: number;
  port: number;
  traefikHostname?: string | undefined;
}

// ─── Build queue ──────────────────────────────────────────────────────────────

export interface BuildJob {
  branch: string;
  buildId: string;
  commitSha: string;
  dockerfilePath?: string | undefined; // if present, skip nixpacks
  environmentId: string;
  imageTag: string; // target: ghcr.io/org/app:sha
  repoCloneUrl: string;
  serviceId: string;
}

// ─── API response wrappers ───────────────────────────────────────────────────

export interface ApiSuccess<T> {
  data: T;
  success: true;
}

export interface ApiError {
  code?: string;
  error: string;
  success: false;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
