## 2024-05-01 - Missing Accessible Names on Inputs and Icon-Only Buttons
**Learning:** Several input elements and icon-only buttons relied solely on placeholder text or title attributes, missing proper accessible names for screen readers.
**Action:** Added explicit aria-labels derived from placeholders or semantic meaning to improve accessibility.
## 2024-05-18 - Header Link Addition
**Learning:** Adding new functional items to the header while respecting the flexbox layout.
**Action:** Used an inline SVG with a simple hover styling `.header-github-link` to place a GitHub logo inline inside the flex layout instead of using absolute positioning, staying consistent with the application design.
## 2024-05-19 - Keyboard Accessibility Focus Styles
**Learning:** Interactive elements like buttons were lacking visible focus states when navigating via keyboard, making it difficult for keyboard-only users to track their position on the screen.
**Action:** Added global focus-visible outline styles for all buttons in index.css to ensure WCAG compliant focus indicators without impacting mouse users.
## 2024-05-18 - Adding Keyboard Focus Styles
**Learning:** Many interactive components (buttons, toggles, checkboxes) in custom UI frameworks often lack visible focus states, making the application inaccessible for keyboard navigation users. Relying purely on mouse interaction leaves out a subset of users.
**Action:** By adding a global `:focus-visible` outline mapped to our `--accent-light` variable for elements like `.btn`, `.header-mobile-toggle`, `.kv-delete`, `.kv-add`, `.tree-chevron`, and `.checkbox`, we ensure that any keyboard tabbing highlights the currently focused element consistently, without adding unnecessary visual outlines for mouse clickers.

## 2023-10-27 - Input Filter Clear Buttons
**Learning:** Filter inputs that lack clear buttons cause friction because users must manually backspace to clear the filter, which is tedious, especially on smaller screens or during keyboard navigation.
**Action:** Always wrap text filter inputs with a relatively positioned container and conditionally render a clear search button inside when the input has value. Don't forget to dynamically adjust `paddingRight` on the input so text doesn't flow underneath the clear button.
## 2026-05-04 - [Added missing aria-labels to custom Tree Component]
**Learning:** Custom tree implementations often lack accessible names for structural components (like chevron expand/collapse buttons) and checkboxes that control multiple nested items or individual items.
**Action:** When working on tree components, always ensure that fold/unfold buttons have `aria-expanded` and `aria-label`s and checkboxes have descriptive `aria-label`s to explain their context (e.g. "Toggle all endpoints in folder").
## 2026-05-13 - [Edge cases testing for React Hooks]
**Learning:** It is important to test edge cases where a state manipulation hook is called with invalid parameters, e.g. dismissing a non-existent toast id, to ensure the state isn't incorrectly modified or an exception isn't thrown.
**Action:** Added an edge-case test for the `useToast` hook to verify dismissing a non-existent toast behaves gracefully and does not throw errors or mutate the state.
## 2026-05-13 - [Track payload size]
**Learning:** To render and calculate data on both backend and frontend, update the models on both boundaries (Go structs, TS interfaces), calculate it exactly when processing it on the backend, explicitly pass it back, parse and format it inside the display logic (React component or util helper), and update CSS formatting (e.g., CSS Grid columns).
**Action:** Add payloadSize (int/number) to both `packages/container/internal/swagger/types.go` `FuzzResult` and `packages/web/src/types.ts`, compute size when creating payload buffer on backend, and inject into Virtualized list using format bytes helper.

## 2026-05-13 - Add layout floating buttons
**Learning:** For layout sidebars, passing inline styles is necessary when dynamically hiding them on desktop depending on state, while avoiding conflict with mobile CSS breakpoints. Also, `indexeddb-mock` should only be used when explicitly requested.
**Action:** Created floating buttons positioned at the bottom corners by changing `.header-mobile-toggle` CSS.
## 2026-05-14 - Support Responsive Sidebars on Desktop/Tablet
**Learning:** When making previously mobile-only elements responsive, pay close attention to CSS media queries and states. A hidden state toggled on a desktop resolution might inadvertently keep elements hidden if the window is resized down to a mobile breakpoint if not wrapped in proper media query guards.
**Action:** Add media queries wrapping specific desktop utility classes like `.hidden-desktop`.
## 2024-05-14 - Inline Patching Strategy
**Learning:** `patch` can be very temperamental with formatting (whitespace, indenting, missing context) inside React component files causing hunk failures.
**Action:** Use an inline node script like `node -e "const code = fs.readFileSync(...); const newCode = code.replace(...); fs.writeFileSync(..., newCode)"` when making targeted multi-line replacements if `patch` fails.
