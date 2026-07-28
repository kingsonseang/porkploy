import type { db } from "@porkploy/db/client";
import { initTRPC, TRPCError } from "@trpc/server";
import type { ManagedRuntime } from "effect";
import superjson from "superjson";

// ─── Context ──────────────────────────────────────────────────────────────────
// Defined here so both the control plane (which creates it) and any type
// consumer (dashboard) share the same shape.

export interface Session {
  userId: string;
  workspaceId?: string | undefined;
}

export interface TRPCContext {
  db: typeof db;
  runtime: ManagedRuntime.ManagedRuntime<never, never>;
  session: Session | null;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const createTRPCRouter = t.router;
// biome-ignore lint/style/useDestructuring: access createCallerFactory directly
export const createCallerFactory = t.createCallerFactory;

// ─── Procedures ───────────────────────────────────────────────────────────────

export const publicProcedure = t.procedure;

// Reusable auth middleware
const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});

export const protectedProcedure = t.procedure.use(isAuthed);

// ─── Routers ──────────────────────────────────────────────────────────────────
// Sub-routers are defined inline here so the AppRouter type is fully resolved
// in one place. The control plane imports these and wires them to Elysia.
// The dashboard imports only the AppRouter type for its tRPC client.

import { createId } from "@paralleldrive/cuid2";
import {
  deployments,
  environments,
  projects,
  services,
  workspace_members as workspaceMembers,
  workspaces,
} from "@porkploy/db/schema";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

// ── Workspace ─────────────────────────────────────────────────────────────────

const workspaceRouter = createTRPCRouter({
  create: protectedProcedure
    .input(z.object({ name: z.string().min(1), slug: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [workspace] = await ctx.db
        .insert(workspaces)
        .values({
          createdAt: new Date(),
          id: createId(),
          name: input.name,
          slug: input.slug,
        })
        .returning();
      if (!workspace) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      }
      await ctx.db.insert(workspaceMembers).values({
        createdAt: new Date(),
        id: createId(),
        organizationId: workspace.id,
        role: "owner",
        userId: ctx.session.userId,
      });
      return workspace;
    }),

  getBySlug: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) =>
      ctx.db.query.workspaces.findFirst({
        where: eq(workspaces.slug, input.slug),
        with: { members: true, projects: true },
      })
    ),
  list: protectedProcedure.query(async ({ ctx }) =>
    ctx.db.query.workspace_members.findMany({
      where: eq(workspaceMembers.userId, ctx.session.userId),
      with: { workspace: true },
    })
  ),
});

// ── Project ───────────────────────────────────────────────────────────────────

const projectRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        slug: z.string().min(1),
        workspaceId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [project] = await ctx.db
        .insert(projects)
        .values({ id: createId(), ...input })
        .returning();
      if (!project) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      }
      await ctx.db.insert(environments).values({
        branch: "main",
        id: createId(),
        name: "production",
        projectId: project.id,
        type: "production",
      });
      return project;
    }),

  getById: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) =>
      ctx.db.query.projects.findFirst({
        where: eq(projects.id, input.projectId),
        with: { environments: true, services: true },
      })
    ),
  list: protectedProcedure
    .input(z.object({ workspaceSlug: z.string() }))
    .query(async ({ ctx, input }) =>
      ctx.db.query.projects.findMany({
        where: eq(projects.slug, input.workspaceSlug),
        with: { services: true },
      })
    ),
});

// ── Service ───────────────────────────────────────────────────────────────────

const serviceUpdateSchema = z.object({
  buildCommand: z.string().optional(),
  cpuMhz: z.number().optional(),
  dockerfilePath: z.string().optional(),
  instanceCount: z.number().min(1).optional(),
  memoryMb: z.number().optional(),
  port: z.number().optional(),
  repoBranch: z.string().optional(),
  startCommand: z.string().optional(),
});

const serviceRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        projectId: z.string(),
        repoBranch: z.string().default("main"),
        repoName: z.string().optional(),
        repoOwner: z.string().optional(),
        type: z.enum(["web", "worker", "cron", "database"]).default("web"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const nomadJobId = input.name.toLowerCase().replace(/\s+/g, "-");
      const [service] = await ctx.db
        .insert(services)
        .values({
          id: createId(),
          ...input,
          infisicalPath: `/${nomadJobId}`,
          nomadJobId,
        })
        .returning();
      if (!service) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      }
      return service;
    }),

  delete: protectedProcedure
    .input(z.object({ serviceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // TODO: stop Nomad job before deleting
      await ctx.db.delete(services).where(eq(services.id, input.serviceId));
      return { ok: true };
    }),

  getById: protectedProcedure
    .input(z.object({ serviceId: z.string() }))
    .query(async ({ ctx, input }) =>
      ctx.db.query.services.findFirst({
        where: eq(services.id, input.serviceId),
        with: { domains: true },
      })
    ),
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) =>
      ctx.db.query.services.findMany({
        where: eq(services.projectId, input.projectId),
      })
    ),

  update: protectedProcedure
    .input(z.object({ data: serviceUpdateSchema, serviceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(services)
        .set(input.data)
        .where(eq(services.id, input.serviceId))
        .returning();
      return updated;
    }),
});

// ── Deployment ────────────────────────────────────────────────────────────────

const deploymentRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(20), serviceId: z.string() }))
    .query(async ({ ctx, input }) =>
      ctx.db.query.deployments.findMany({
        limit: input.limit,
        orderBy: [desc(deployments.createdAt)],
        where: eq(deployments.serviceId, input.serviceId),
        with: { build: true },
      })
    ),

  rollback: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const target = await ctx.db.query.deployments.findFirst({
        where: eq(deployments.id, input.deploymentId),
      });
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      // TODO: wire Nomad redeploy via ctx.runtime
      return { imageTag: target.imageTag, ok: true };
    }),
});

// ─── AppRouter ────────────────────────────────────────────────────────────────

export const appRouter = createTRPCRouter({
  deployment: deploymentRouter,
  project: projectRouter,
  service: serviceRouter,
  workspace: workspaceRouter,
});

export type AppRouter = typeof appRouter;
