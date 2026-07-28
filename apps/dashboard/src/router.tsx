import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import type { ReactNode } from "react";
import TanstackQueryProvider, {
	getContext,
} from "./integrations/tanstack-query/root-provider";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const context = getContext();

	const router = createTanStackRouter({
		context,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
		routeTree,
		scrollRestoration: true,

		Wrap: (props: { children: ReactNode }) => (
			<TanstackQueryProvider context={context}>
				{props.children}
			</TanstackQueryProvider>
		),
	});

	setupRouterSsrQueryIntegration({ queryClient: context.queryClient, router });

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
