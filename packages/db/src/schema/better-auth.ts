import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  createdAt: timestamp("created_at").defaultNow().notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  githubId: text("github_id").unique(),
  id: text("id").primaryKey(),
  image: text("image"),
  name: text("name").notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    activeOrganizationId: text("active_organization_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    id: text("id").primaryKey(),
    ipAddress: text("ip_address"),
    token: text("token").notNull().unique(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)]
);

export const account = pgTable(
  "account",
  {
    accessToken: text("access_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    accountId: text("account_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    id: text("id").primaryKey(),
    idToken: text("id_token"),
    password: text("password"),
    providerId: text("provider_id").notNull(),
    refreshToken: text("refresh_token"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("account_userId_idx").on(table.userId)]
);

export const verification = pgTable(
  "verification",
  {
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    value: text("value").notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
);

export const workspaces = pgTable("workspaces", {
  createdAt: timestamp("created_at").notNull(),
  githubInstallationId: text("github_installation_id"),
  githubOrgOrUser: text("github_org_or_user"),
  id: text("id").primaryKey(),
  infisicalClientId: text("infisical_client_id"),
  infisicalClientSecretEncrypted: text("infisical_client_secret_encrypted"),
  infisicalOrgId: text("infisical_org_id"),
  logo: text("logo"),
  metadata: text("metadata"),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  updatedAt: timestamp("updated_at")
    .$onUpdate(() => new Date())
    .notNull(),
});

export const workspace_members = pgTable(
  "workspace_members",
  {
    createdAt: timestamp("created_at").notNull(),
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("workspace_members_organizationId_idx").on(table.organizationId),
    index("workspace_members_userId_idx").on(table.userId),
  ]
);

export const invitation = pgTable(
  "invitation",
  {
    createdAt: timestamp("created_at").defaultNow().notNull(),
    email: text("email").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    id: text("id").primaryKey(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    role: text("role"),
    status: text("status").default("pending").notNull(),
  },
  (table) => [
    index("invitation_organizationId_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ]
);

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(account),
  invitations: many(invitation),
  sessions: many(session),
  workspace_memberss: many(workspace_members),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  users: one(users, {
    fields: [session.userId],
    references: [users.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  users: one(users, {
    fields: [account.userId],
    references: [users.id],
  }),
}));

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  invitations: many(invitation),
  workspace_memberss: many(workspace_members),
}));

export const workspace_membersRelations = relations(
  workspace_members,
  ({ one }) => ({
    users: one(users, {
      fields: [workspace_members.userId],
      references: [users.id],
    }),
    workspaces: one(workspaces, {
      fields: [workspace_members.organizationId],
      references: [workspaces.id],
    }),
  })
);

export const invitationRelations = relations(invitation, ({ one }) => ({
  users: one(users, {
    fields: [invitation.inviterId],
    references: [users.id],
  }),
  workspaces: one(workspaces, {
    fields: [invitation.organizationId],
    references: [workspaces.id],
  }),
}));
