---
title: Browser Extension
---

# Browser Extension 🧩

The **Swazz Traffic Capturer** is a Chrome (MV3) extension that records real API traffic while you
use your application, turns it into endpoints, and either syncs them straight into a Swazz project
or exports them as a standard `.har` file.

It lives in `packages/extension/` and has no build step — load it unpacked.

## Install

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select `packages/extension/`.
3. Pin the Swazz icon to the toolbar. The badge shows how many endpoints are captured, and turns
   red while recording.

## Record traffic

1. Open the extension popup.
2. Under **Connection & Scope Settings**, set **Target Domains** — a comma-separated list of hosts
   you are allowed to test (e.g. `localhost:8080, api.dev`). Click the suggested active-tab host to
   add it in one click.
   > Scope is the trust boundary: nothing outside these domains is ever recorded. With an empty
   > scope, recording captures nothing and the popup warns you.
3. Flip **Traffic Recording** on and use your application normally. `fetch`, `XMLHttpRequest`,
   `sendBeacon`, form submissions and top-level navigations are all captured.
4. Captured endpoints appear grouped by method and normalized path (numeric IDs, UUIDs and ULIDs
   collapse to `{id}`, `{uuid}`, `{ulid}` so `/users/1` and `/users/2` are one endpoint), each with
   the response statuses seen and a coverage hint telling you when an endpoint needs more input
   variations to fuzz well.

### Page Crawler

**🕷 Crawl Tab** walks links and submits forms on the active tab automatically, so you can populate
endpoints without clicking through the app by hand. Recording must be on. File inputs are fed a
mock PNG instead of opening a native file dialog.

## Get the traffic into Swazz

There are two paths, and they are interchangeable:

### Sync directly

With a token and project selected, **🚀 Sync to Swazz Dashboard** parses the captured traffic and
merges the endpoints into that project's configuration, optionally carrying over your active session
cookies. The token is auto-synced when you have the dashboard open in a tab — you rarely need to
paste it.

### Export a HAR

**⬇ HAR** downloads the capture as a standard HTTP Archive file. No token or project required, so it
works fully offline and on machines that cannot reach your Swazz instance.

Upload the file anywhere Swazz accepts a spec:

- the sidebar **Upload Spec / HAR File** button,
- **Project Settings → API Specifications**,
- or a config `swagger_urls` entry pointing at the file:

```json
{
  "swagger_urls": ["./recordings/session.har"]
}
```

The file is a normal HAR, so DevTools, Postman and other tooling read it too.

**📂 Import HAR** loads a HAR back into the popup — useful to restore a capture after a browser
restart, or to review a recording a teammate sent you. Imports merge into the current capture rather
than replacing it.

## Privacy and safety notes

- Traffic is stored locally in the extension's own storage and is only sent to the Swazz URL you
  configured, when you press Sync.
- The auth token is only accepted from the Swazz dashboard's own origin.
- Only record against systems you are authorized to test.
