## 2024-05-01 - Missing Accessible Names on Inputs and Icon-Only Buttons
**Learning:** Several input elements and icon-only buttons relied solely on placeholder text or title attributes, missing proper accessible names for screen readers.
**Action:** Added explicit aria-labels derived from placeholders or semantic meaning to improve accessibility.
## 2024-05-18 - Header Link Addition
**Learning:** Adding new functional items to the header while respecting the flexbox layout.
**Action:** Used an inline SVG with a simple hover styling `.header-github-link` to place a GitHub logo inline inside the flex layout instead of using absolute positioning, staying consistent with the application design.
## 2026-05-04 - [Added missing aria-labels to custom Tree Component]
**Learning:** Custom tree implementations often lack accessible names for structural components (like chevron expand/collapse buttons) and checkboxes that control multiple nested items or individual items.
**Action:** When working on tree components, always ensure that fold/unfold buttons have `aria-expanded` and `aria-label`s and checkboxes have descriptive `aria-label`s to explain their context (e.g. "Toggle all endpoints in folder").
