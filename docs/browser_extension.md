---
title: Browser Extension
---

# Browser Extension 🧩

The **Swazz Traffic Capturer** is a Chrome (MV3) extension that records real API traffic while you
use your application, turns it into endpoints, and either syncs them straight into a Swazz project
or exports them as a standard `.har` file.

The extension lives in `packages/extension/`. For local development, load that folder unpacked — it then defaults to the local dashboard `http://localhost:5173`. The ready-made zip downloaded from the dashboard (Settings → Traffic Capture) is built for production and defaults to `https://swazz.secmy.app`. Either way the URL can be changed in the popup's Swazz URL field, and a value already saved in the extension is kept on update.

## Install

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select `packages/extension/`.
3. Pin the Swazz icon to the toolbar. The badge shows how many endpoints are captured, and turns
   red while recording.

## Record traffic

1. Open the extension popup (or Side Panel).
2. Under **Connection & Scope Settings**, set **Target Domains** — a comma-separated list of hosts
   you are allowed to test (e.g. `localhost:8080, api.dev`). Click the suggested active-tab host or
   the one-click **Track this site** button to add the active domain and start recording immediately.
   > Scope is the trust boundary: nothing outside these domains is ever recorded. With an empty
   > scope, recording captures nothing and the popup warns you. Traffic to your configured Swazz
   > Dashboard origin is automatically ignored so dashboard polling never pollutes captured endpoints.
3. Flip **Traffic Recording** on and use your application normally. `fetch`, `XMLHttpRequest`,
   `sendBeacon`, full-page HTML form `POST` submissions (via `chrome.webRequest` with redirect hop
   correlation, including `302` chains), and top-level navigations are all captured. Form-urlencoded
   bodies emit standard HAR 1.2 `postData.params` alongside `postData.text`.
4. Captured endpoints are **host-scoped** and grouped by method and normalized path (numeric IDs,
   UUIDs and ULIDs collapse to `{id}`, `{uuid}`, `{ulid}` so `/users/1` and `/users/2` are one
   endpoint), each with the response statuses seen and a coverage hint telling you when an endpoint
   needs more input variations to fuzz well.

### Page Crawler

**🕷 Crawl Tab** walks links and inspects forms on the active tab automatically, so you can populate
endpoints without clicking through the app by hand. Recording must be on. File inputs are fed a
mock PNG instead of opening a native file dialog, form submit buttons are skipped during button-click
discovery, repeat crawls cleanly reset element markers, and closing the crawled tab resets `crawlState`
automatically. If a tab was opened before an extension reload, the popup automatically injects the
content script via `chrome.scripting.executeScript`.

## Get the traffic into Swazz

There are two paths, and they are interchangeable:

### Sync directly

With a token and project selected, **🚀 Sync to Swazz Dashboard** parses the captured traffic and
merges the endpoints (or replaces existing project endpoints when **Replace existing project endpoints**
is checked) into that project's configuration, updating `base_url` and optionally carrying over your
active session cookies. Open dashboard tabs live-reload the updated configuration automatically. The
token is auto-synced when you have the dashboard open in a tab — you rarely need to paste it.

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

### Building the zip

`packages/web` builds `public/swazz-extension.zip` automatically via `packages/extension/build-zip.mjs` — `npm run dev` uses `--mode dev` (localhost), `npm run build` uses `--mode prod`.

In prod mode the default URL is `https://swazz.secmy.app`, overridable at build time with `SWAZZ_EXTENSION_URL`; the value must be a bare origin accepted by the extension's own dashboard-origin check (`isAuthOriginAllowed` in `scope.js`, i.e. `https://swazz.secmy.app` or its subdomains, or `http://localhost:5173`), otherwise the production build fails. Only manifest, icons, HTML, CSS and non-test JS files are packaged.

```bash
node packages/extension/build-zip.mjs --mode prod --out /tmp/swazz-extension.zip
```

## Privacy and safety notes

- Traffic is stored locally in the extension's own storage and is only sent to the Swazz URL you
  configured, when you press Sync.
- The auth token is only accepted from the Swazz dashboard's own origin.
- Only record against systems you are authorized to test.
