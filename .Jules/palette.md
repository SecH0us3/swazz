## 2024-05-01 - Missing Accessible Names on Inputs and Icon-Only Buttons
**Learning:** Several input elements and icon-only buttons relied solely on placeholder text or title attributes, missing proper accessible names for screen readers.
**Action:** Added explicit aria-labels derived from placeholders or semantic meaning to improve accessibility.
## 2024-05-18 - Header Link Addition
**Learning:** Adding new functional items to the header while respecting the flexbox layout.
**Action:** Used an inline SVG with a simple hover styling `.header-github-link` to place a GitHub logo inline inside the flex layout instead of using absolute positioning, staying consistent with the application design.
## 2024-05-18 - Adding Keyboard Focus Styles
**Learning:** Many interactive components (buttons, toggles, checkboxes) in custom UI frameworks often lack visible focus states, making the application inaccessible for keyboard navigation users. Relying purely on mouse interaction leaves out a subset of users.
**Action:** By adding a global `:focus-visible` outline mapped to our `--accent-light` variable for elements like `.btn`, `.header-mobile-toggle`, `.kv-delete`, `.kv-add`, `.tree-chevron`, and `.checkbox`, we ensure that any keyboard tabbing highlights the currently focused element consistently, without adding unnecessary visual outlines for mouse clickers.
