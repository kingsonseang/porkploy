import { baseAuth } from "@porkploy/auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";

export const auth = baseAuth([tanstackStartCookies()]);
