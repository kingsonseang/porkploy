import { ac, admin, member, owner } from "@porkploy/auth/permissions";
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	plugins: [
		organizationClient({
			ac,
			roles: {
				admin,
				member,
				owner,
			},
		}),
	],
});
