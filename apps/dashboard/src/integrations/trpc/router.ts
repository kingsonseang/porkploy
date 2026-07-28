// Single source of truth for the AppRouter type lives in @porkploy/trpc.
// The dashboard imports it here for use in the tRPC client — no server code runs in the dashboard.
export type { AppRouter as TRPCRouter } from "@porkploy/trpc";
