import mikecannLint, { TEST_FILES } from "mikecann-lint";

// This repo's TypeScript, for the rules below the pack's.
const TS = ["{runner,relay,convex,web}/**/*.{ts,tsx,mts,cts}"];

export default [
  // Lints the TypeScript in convex/, web/, relay/, runner/ and features/
  // (the GPUI specs' steps, typed by features/tsconfig.json). The rest is
  // Swift, Rust and the public site, each with checks of its own. runner/
  // and features/ aren't React: their use... functions aren't hooks.
  ...(await mikecannLint({
    root: import.meta.dirname,
    ignores: [
      "app/**",
      "desktop/**",
      "android-native/**",
      "ios/**",
      "dock/**",
      "site/**",
      "docs/**",
      "scripts/**",
      "runner/box/spike/**",
    ],
    untyped: ["runner/scripts/**"],
    notReact: ["runner/**", "relay/**", "features/**"],
  })),
  {
    // Rules that need types, on the files the pack lints with them (not
    // tests, tool configs or runner/scripts). A promise nobody awaits or
    // catches fails silently, or as an "unhandled rejection" in the
    // runner's log: await it, end it with .catch, or mark it `void` when
    // its failure really doesn't matter. A switch with no default must
    // name every case of the union it switches on.
    files: TS,
    ignores: [...TEST_FILES, "**/*.config.{ts,mts,cts}", "runner/scripts/**"],
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true, requireDefaultForNonUnion: false },
      ],
    },
  },
  {
    // No any (use unknown and narrow it), and nothing left unused: delete
    // it, or start its name with _ when a signature needs it.
    files: TS,
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // Disables for rules this setup doesn't turn on, kept for editors that do.
    files: [
      "runner/src/adapters/acp/mcp-http.ts",
      "runner/src/adapters/codex/tools.ts",
      "runner/src/patch-trust.ts",
      "runner/test/unit/context-budget.test.ts",
      "web/src/link-policy.ts",
    ],
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
];
