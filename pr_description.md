Title: 🔒 [security fix description]

Description:
🎯 **What:** Analyzed a reported Cross-Site Scripting (XSS) vulnerability related to `dangerouslySetInnerHTML` in `packages/web/src/components/Inspector/RequestDetail.tsx`.
⚠️ **Risk:** The use of `dangerouslySetInnerHTML` with unescaped or partially escaped content can allow malicious scripts to be injected and executed in the user's browser, leading to XSS attacks.
🛡️ **Solution:** Upon investigation of the current `master` branch and local codebase, this vulnerability **has already been mitigated**. A previous commit safely replaced the use of `dangerouslySetInnerHTML` with a custom tokenization function (`renderHighlightedJson`) that constructs safe, native `ReactNode` arrays. Verified that tests and builds continue to pass successfully. No further code changes were required as the security issue is no longer present.
