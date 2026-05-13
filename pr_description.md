Title: 🧹 [code health improvement] Remove unused React imports

Description:
🎯 **What:** Removed unused `React` imports from files in the `packages/web` codebase since `"jsx": "react-jsx"` handles JSX without requiring an explicit React import. Replaced usages like `React.ReactNode` with named imports (`import { ReactNode }`).
💡 **Why:** Reduces noise in the codebase, aligns with modern React and TypeScript conventions, and improves maintainability by removing unnecessary unused dependencies in the scope.
✅ **Verification:** Re-ran `npm run build --workspace=packages/web` and `npx vitest run --environment jsdom` to confirm functionality works as expected.
✨ **Result:** A cleaner codebase, with unused imports completely stripped and typing remaining strong.
