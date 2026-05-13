🎯 **What:** Removed an unused `React` import from `packages/web/src/components/MainWorkspace.tsx`.
💡 **Why:** The `React` import is unnecessary for JSX in modern React codebases (React 17+ with the new JSX transform). Removing unused imports reduces clutter, silences linter warnings, and improves maintainability.
✅ **Verification:** Ran `npm run build --workspace=packages/web` and `npx vitest run --environment jsdom` to confirm the code compiles perfectly and tests still pass.
✨ **Result:** A cleaner component file without unneeded dependencies.
