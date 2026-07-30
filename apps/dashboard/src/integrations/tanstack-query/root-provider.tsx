import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchStreamLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { ReactNode } from "react";
import superjson from "superjson";
import { TRPCProvider } from "#/integrations/trpc/react";
import type { TRPCRouter } from "#/integrations/trpc/router";

function getUrl() {
	if (typeof window !== "undefined") {
		return `${import.meta.env.VITE_CONTROL_PLANE_URL ?? "http://localhost:3001"}/trpc`;
	}
	// SSR — server-side fetch goes direct
	return `http://localhost:${Bun.env.PORT ?? 3001}/trpc`;
}

export const trpcClient = createTRPCClient<TRPCRouter>({
	links: [
		httpBatchStreamLink({
			// Send Better Auth session cookie
			fetch: (url, opts) => fetch(url, { ...opts, credentials: "include" }),
			transformer: superjson,
			url: getUrl(),
		}),
	],
});
export function getContext() {
	const queryClient = new QueryClient({
		defaultOptions: {
			dehydrate: { serializeData: superjson.serialize },
			hydrate: { deserializeData: superjson.deserialize },
		},
	});

	const serverHelpers = createTRPCOptionsProxy({
		client: trpcClient,
		queryClient,
	});
	const context = {
		queryClient,
		trpc: serverHelpers,
	};

	return context;
}

export default function TanstackQueryProvider({
	children,
	context,
}: {
	children: ReactNode;
	context: ReturnType<typeof getContext>;
}) {
	const { queryClient } = context;

	return (
		<TRPCProvider queryClient={queryClient} trpcClient={trpcClient}>
			{children}
		</TRPCProvider>
	);
}
