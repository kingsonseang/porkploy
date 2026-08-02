import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "#/lib/auth-client";

export const Route = createFileRoute("/demo/better-auth")({
	component: BetterAuthDemo,
});

function BetterAuthDemo() {
	const { data: session, isPending } = authClient.useSession();
	const [isSignUp, setIsSignUp] = useState(false);
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [name, setName] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	if (isPending) {
		return (
			<main className="demo-page demo-center">
				<div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-200 border-t-neutral-900 dark:border-neutral-800 dark:border-t-neutral-100" />
			</main>
		);
	}

	if (session?.user) {
		return (
			<main className="demo-page demo-center">
				<section className="demo-panel w-full max-w-md space-y-6">
					<div className="space-y-1.5">
						<p className="island-kicker mb-2">Better Auth</p>
						<h1 className="demo-title">Welcome back</h1>
						<p className="demo-muted text-sm">
							You're signed in as {session.user.email}
						</p>
					</div>

					<div className="flex items-center gap-3">
						{session.user.image ? (
							<img src={session.user.image} alt="" className="h-10 w-10" />
						) : (
							<div className="h-10 w-10 bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center">
								<span className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
									{session.user.name?.charAt(0).toUpperCase() || "U"}
								</span>
							</div>
						)}
						<div className="flex-1 min-w-0">
							<p className="text-sm font-medium truncate">
								{session.user.name}
							</p>
							<p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
								{session.user.email}
							</p>
						</div>
					</div>

					<button
						type="button"
						onClick={() => {
							void authClient.signOut();
						}}
						className="demo-button demo-button-secondary w-full"
					>
						Sign out
					</button>

					<p className="demo-muted text-center text-xs">
						Built with{" "}
						<a
							href="https://better-auth.com"
							target="_blank"
							rel="noopener noreferrer"
							className="font-medium"
						>
							BETTER-AUTH
						</a>
						.
					</p>
				</section>
			</main>
		);
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		setLoading(true);

		try {
			if (isSignUp) {
				const result = await authClient.signUp.email({
					email,
					password,
					name,
				});
				if (result.error) {
					setError(result.error.message || "Sign up failed");
				}
			} else {
				const result = await authClient.signIn.email({
					email,
					password,
				});
				if (result.error) {
					setError(result.error.message || "Sign in failed");
				}
			}
		} catch (_err) {
			setError("An unexpected error occurred");
		} finally {
			setLoading(false);
		}
	};

	return (
		<main className="demo-page demo-center">
			<section className="demo-panel w-full max-w-md">
				<p className="island-kicker mb-2">Better Auth</p>
				<h1 className="demo-title">
					{isSignUp ? "Create an account" : "Sign in"}
				</h1>
				<p className="demo-muted mt-2 mb-6 text-sm">
					{isSignUp
						? "Enter your information to create an account"
						: "Enter your email below to login to your account"}
				</p>

				<form onSubmit={handleSubmit} className="grid gap-4">
					{isSignUp && (
						<div className="grid gap-2">
							<label
								htmlFor="name"
								className="text-sm font-medium leading-none"
							>
								Name
							</label>
							<input
								id="name"
								type="text"
								value={name}
								onChange={(e) => setName(e.target.value)}
								className="demo-input"
								required
							/>
						</div>
					)}

					<div className="grid gap-2">
						<label htmlFor="email" className="text-sm font-medium leading-none">
							Email
						</label>
						<input
							id="email"
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							className="demo-input"
							required
						/>
					</div>

					<div className="grid gap-2">
						<label
							htmlFor="password"
							className="text-sm font-medium leading-none"
						>
							Password
						</label>
						<input
							id="password"
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							className="demo-input"
							required
							minLength={8}
						/>
					</div>

					{error && (
						<div className="demo-alert demo-alert-danger">
							<p className="text-sm text-red-600">{error}</p>
						</div>
					)}

					<button
						type="submit"
						disabled={loading}
						className="demo-button w-full"
					>
						{loading ? (
							<span className="flex items-center justify-center gap-2">
								<span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-400 border-t-white dark:border-neutral-600 dark:border-t-neutral-900" />
								<span>Please wait</span>
							</span>
						) : isSignUp ? (
							"Create account"
						) : (
							"Sign in"
						)}
					</button>
					<button
						type="button"
						onClick={() => {
							setLoading(true);
							authClient.signIn.social({ provider: "github" });
						}}
						className="demo-button w-full"
					>
						{loading ? (
							<span className="flex items-center justify-center gap-2">
								<span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-400 border-t-white dark:border-neutral-600 dark:border-t-neutral-900" />
								<span>Please wait</span>
							</span>
						) : (
							<span className="flex items-center justify-center gap-2">
								<svg viewBox="0 0 1024 1024" fill="none" className="size-5">
									<title>Github</title>
									<path
										fillRule="evenodd"
										clipRule="evenodd"
										d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z"
										transform="scale(64)"
										fill="#ffff"
									/>
								</svg>
								<span className="whitespace-nowrap">Github</span>
							</span>
						)}
					</button>
				</form>

				<div className="mt-4 text-center">
					<button
						type="button"
						onClick={() => {
							setIsSignUp(!isSignUp);
							setError("");
						}}
						className="demo-muted text-sm transition-colors hover:text-(--sea-ink)"
					>
						{isSignUp
							? "Already have an account? Sign in"
							: "Don't have an account? Sign up"}
					</button>
				</div>

				<p className="demo-muted mt-6 text-center text-xs">
					Built with{" "}
					<a
						href="https://better-auth.com"
						target="_blank"
						rel="noopener noreferrer"
						className="font-medium"
					>
						BETTER-AUTH
					</a>
					.
				</p>
			</section>
		</main>
	);
}
