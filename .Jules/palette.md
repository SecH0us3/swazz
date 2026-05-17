## 2025-05-22 - [Config Import/Export Verification]
**Learning:** Verified that `useConfig` hook correctly handles JSON import/export and maintains state in localStorage. Discovered that `_swagger_urls` was being used as an ad-hoc property on `SwazzConfig` without being defined in the interface, leading to many `as any` casts.
**Action:** Updated `SwazzConfig` interface to include `_swagger_urls` and removed unnecessary type casts across the web package. Verified the UI buttons (Import/Export) in the ConfigSidebar are functional and correctly update the application state.
