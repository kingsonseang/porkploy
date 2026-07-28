import { createId } from "@paralleldrive/cuid2";
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// biome-ignore lint/performance/noBarrelFile: Auth + workspace tables owned by Better Auth — import, don't redefine
export {
  account,
  invitation,
  session,
  users,
  verification,
  workspace_members,
  workspaces,
} from "./better-auth";

import { users, workspaces } from "./better-auth";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => createId());

const timestamps = {
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date()),
};

// ─── Enums ───────────────────────────────────────────────────────────────────

export const deploymentStatusEnum = pgEnum("deployment_status", [
  "queued",
  "building",
  "deploying",
  "success",
  "failed",
  "cancelled",
  "rolled_back",
]);

export const buildStatusEnum = pgEnum("build_status", [
  "queued",
  "running",
  "success",
  "failed",
  "cancelled",
]);

export const serviceTypeEnum = pgEnum("service_type", [
  "web",
  "worker",
  "cron",
  "database",
]);

export const dbProviderEnum = pgEnum("db_provider", ["postgres", "mongo"]);

export const environmentTypeEnum = pgEnum("environment_type", [
  "production",
  "preview",
  "staging",
]);

export const backupProviderEnum = pgEnum("backup_provider", [
  "neon",
  "mongo_atlas",
]);

// ─── Projects ─────────────────────────────────────────────────────────────────

export const projects = pgTable(
  "projects",
  {
    id: id(),
    infisicalProjectId: text("infisical_project_id"),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("project_slug_unique").on(t.workspaceId, t.slug)]
);

// ─── Services ─────────────────────────────────────────────────────────────────

export const services = pgTable("services", {
  buildCommand: text("build_command"),
  cpuMhz: integer("cpu_mhz").default(256),
  cronSchedule: text("cron_schedule"),
  dockerfilePath: text("dockerfile_path"),
  id: id(),
  infisicalPath: text("infisical_path"),
  instanceCount: integer("instance_count").default(1),
  memoryMb: integer("memory_mb").default(256),
  name: text("name").notNull(),
  nomadJobId: text("nomad_job_id"),
  port: integer("port").default(3000),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  repoBranch: text("repo_branch").default("main"),
  repoInstallationId: text("repo_installation_id"),
  repoName: text("repo_name"),
  repoOwner: text("repo_owner"),
  startCommand: text("start_command"),
  type: serviceTypeEnum("type").notNull().default("web"),
  ...timestamps,
});

// ─── Environments ─────────────────────────────────────────────────────────────

export const environments = pgTable(
  "environments",
  {
    branch: text("branch"),
    id: id(),
    isActive: boolean("is_active").notNull().default(true),
    name: text("name").notNull(),
    prNumber: integer("pr_number"),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    type: environmentTypeEnum("type").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("env_name_unique").on(t.projectId, t.name)]
);

// ─── Domains ──────────────────────────────────────────────────────────────────

export const domains = pgTable("domains", {
  environmentId: text("environment_id")
    .notNull()
    .references(() => environments.id, { onDelete: "cascade" }),
  hostname: text("hostname").notNull().unique(),
  id: id(),
  isCustom: boolean("is_custom").notNull().default(false),
  isVerified: boolean("is_verified").notNull().default(false),
  serviceId: text("service_id")
    .notNull()
    .references(() => services.id, { onDelete: "cascade" }),
  verificationToken: text("verification_token"),
  ...timestamps,
});

// ─── Builds ───────────────────────────────────────────────────────────────────

export const builds = pgTable(
  "builds",
  {
    branch: text("branch").notNull(),
    commitMessage: text("commit_message"),
    commitSha: text("commit_sha").notNull(),
    environmentId: text("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    errorMessage: text("error_message"),
    finishedAt: timestamp("finished_at"),
    id: id(),
    imageTag: text("image_tag"),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at"),
    status: buildStatusEnum("status").notNull().default("queued"),
    ...timestamps,
  },
  (t) => [index("builds_service_id_idx").on(t.serviceId)]
);

// ─── Deployments ──────────────────────────────────────────────────────────────

export const deployments = pgTable(
  "deployments",
  {
    buildId: text("build_id").references(() => builds.id),
    environmentId: text("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    finishedAt: timestamp("finished_at"),
    id: id(),
    imageTag: text("image_tag").notNull(),
    nomadDeploymentId: text("nomad_deployment_id"),
    nomadEvalId: text("nomad_eval_id"),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at"),
    status: deploymentStatusEnum("status").notNull().default("queued"),
    triggeredBy: text("triggered_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index("deployments_service_id_idx").on(t.serviceId),
    index("deployments_environment_id_idx").on(t.environmentId),
  ]
);

// ─── Database Instances ───────────────────────────────────────────────────────

export const databaseInstances = pgTable("database_instances", {
  dataPath: text("data_path"),
  id: id(),
  infisicalPath: text("infisical_path").notNull(),
  mode: text("mode", { enum: ["shared", "dedicated"] })
    .notNull()
    .default("shared"),
  nomadJobId: text("nomad_job_id"),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  provider: dbProviderEnum("provider").notNull(),
  serviceId: text("service_id")
    .notNull()
    .references(() => services.id, { onDelete: "cascade" }),
  ...timestamps,
});

// ─── Backup Configs ───────────────────────────────────────────────────────────

export const backupConfigs = pgTable("backup_configs", {
  id: id(),
  infisicalPath: text("infisical_path").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at"),
  lastRunStatus: text("last_run_status", { enum: ["success", "failed"] }),
  nomadJobId: text("nomad_job_id"),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  provider: backupProviderEnum("provider").notNull(),
  schedule: text("schedule").notNull().default("0 3 * * *"),
  ...timestamps,
});

// ─── Nodes ────────────────────────────────────────────────────────────────────

export const nodes = pgTable("nodes", {
  id: id(),
  ip: text("ip"),
  isActive: boolean("is_active").notNull().default(true),
  lastSeenAt: timestamp("last_seen_at"),
  name: text("name").notNull(),
  nomadNodeId: text("nomad_node_id").unique(),
  role: text("role", {
    enum: ["control-plane", "build", "ingress", "app"],
  })
    .notNull()
    .default("app"),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  ...timestamps,
});

// ─── Audit Log ────────────────────────────────────────────────────────────────

export const auditLogs = pgTable(
  "audit_logs",
  {
    action: text("action").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    id: id(),
    metadata: jsonb("metadata"),
    resourceId: text("resource_id").notNull(),
    resourceType: text("resource_type").notNull(),
    userId: text("user_id").references(() => users.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("audit_logs_workspace_id_idx").on(t.workspaceId),
    index("audit_logs_resource_idx").on(t.resourceType, t.resourceId),
  ]
);

// ─── Relations ────────────────────────────────────────────────────────────────

export const projectRelations = relations(projects, ({ one, many }) => ({
  backupConfigs: many(backupConfigs),
  databaseInstances: many(databaseInstances),
  environments: many(environments),
  services: many(services),
  workspace: one(workspaces, {
    fields: [projects.workspaceId],
    references: [workspaces.id],
  }),
}));

export const serviceRelations = relations(services, ({ one, many }) => ({
  builds: many(builds),
  deployments: many(deployments),
  domains: many(domains),
  project: one(projects, {
    fields: [services.projectId],
    references: [projects.id],
  }),
}));

export const environmentRelations = relations(
  environments,
  ({ one, many }) => ({
    builds: many(builds),
    deployments: many(deployments),
    domains: many(domains),
    project: one(projects, {
      fields: [environments.projectId],
      references: [projects.id],
    }),
  })
);

export const buildRelations = relations(builds, ({ one, many }) => ({
  deployments: many(deployments),
  environment: one(environments, {
    fields: [builds.environmentId],
    references: [environments.id],
  }),
  service: one(services, {
    fields: [builds.serviceId],
    references: [services.id],
  }),
}));

export const deploymentRelations = relations(deployments, ({ one }) => ({
  build: one(builds, {
    fields: [deployments.buildId],
    references: [builds.id],
  }),
  environment: one(environments, {
    fields: [deployments.environmentId],
    references: [environments.id],
  }),
  service: one(services, {
    fields: [deployments.serviceId],
    references: [services.id],
  }),
  triggeredByUser: one(users, {
    fields: [deployments.triggeredBy],
    references: [users.id],
  }),
}));

export const nodeRelations = relations(nodes, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [nodes.workspaceId],
    references: [workspaces.id],
  }),
}));

export const auditLogRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
  workspace: one(workspaces, {
    fields: [auditLogs.workspaceId],
    references: [workspaces.id],
  }),
}));
