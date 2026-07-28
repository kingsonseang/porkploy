import type { UserConfig } from "@commitlint/types";

const config: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "header-max-length": [2, "always", 100],
    "scope-enum": [
      2,
      "always",
      [
        // packages
        "db",
        "types",
        "nomad",
        "buildkit",
        "infisical",
        "github",
        "queue",
        // apps
        "control-plane",
        "dashboard",
        // cross-cutting
        "ci",
        "deps",
        "config",
        "infra",
        "docs",
      ],
    ],
    "subject-full-stop": [2, "never", "."],
    "subject-max-length": [2, "always", 100],
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore",
        "revert",
      ],
    ],
  },
};

export default config;
