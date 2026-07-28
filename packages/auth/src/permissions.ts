import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

// ─── Statements ───────────────────────────────────────────────────────────────
// Extends Better Auth's default org statements with platform-specific resources.

export const statements = {
  ...defaultStatements,
  backup: ["create", "read", "update", "delete", "restore"],
  domain: ["create", "read", "update", "delete"],
  environment: ["create", "read", "update", "delete"],
  node: ["create", "read", "update", "delete"],
  // Platform resources
  project: ["create", "read", "update", "delete"],
  service: ["create", "read", "update", "delete", "deploy", "rollback"],
} as const;

export const ac = createAccessControl(statements);

// ─── Roles ────────────────────────────────────────────────────────────────────

/**
 * Member — can view and deploy, cannot create/delete resources
 */
export const member = ac.newRole({
  ...memberAc.statements,
  backup: ["read"],
  domain: ["read"],
  environment: ["read"],
  node: ["read"],
  project: ["read"],
  service: ["read", "deploy", "rollback"],
});

/**
 * Admin — full resource management, cannot manage nodes or billing
 */
export const admin = ac.newRole({
  ...adminAc.statements,
  backup: ["create", "read", "update", "delete", "restore"],
  domain: ["create", "read", "update", "delete"],
  environment: ["create", "read", "update", "delete"],
  node: ["read"],
  project: ["create", "read", "update", "delete"],
  service: ["create", "read", "update", "delete", "deploy", "rollback"],
});

/**
 * Owner — everything, including node management
 */
export const owner = ac.newRole({
  ...ownerAc.statements,
  backup: ["create", "read", "update", "delete", "restore"],
  domain: ["create", "read", "update", "delete"],
  environment: ["create", "read", "update", "delete"],
  node: ["create", "read", "update", "delete"],
  project: ["create", "read", "update", "delete"],
  service: ["create", "read", "update", "delete", "deploy", "rollback"],
});
