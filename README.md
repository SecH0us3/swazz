# ⚡️ swazz — Smart API Fuzzer

**swazz** is a modern, fast, and visual API Fuzzing tool. It automatically discovers your API surface by parsing Swagger/OpenAPI specifications and then blasts those endpoints with various unexpected, edge-case, and malicious inputs to identify breaking points, unhandled exceptions (5xx), and logic flaws.

![Dashboard Preview](docs/heatmap-preview.png) *(UI features a real-time Endpoints × Status Heatmap and Request Inspector)*

---

## 🚀 Quick Start

1. **Install dependencies** (the project uses npm workspaces):
   ```bash
   npm install
   ```

2. **Start the development server**:
   ```bash
   npm run dev --workspace=packages/web
   ```

3. **Open the Dashboard**:
   Go to `http://localhost:5173` in your browser.

4. **Run your first Fuzz Test**:
   - In the sidebar, enter one or more **Swagger URLs** (e.g., `https://petstore.swagger.io/v2/swagger.json`).
   - Add any required **Auth Headers** (e.g., `Authorization: Bearer <token>`).
   - Select your desired **Fuzz Profiles** (Random, Boundary, Malicious).
   - Press **Start** and watch the heatmap light up!

## 🚀 Cloudflare Deployment

You can deploy the application to Cloudflare (Pages + Workers) using `wrangler`. The application consists of a React frontend and a Cloudflare Worker proxy.

1. **Login to Cloudflare**:
   ```bash
   npx wrangler login
   ```

2. **Deploy the Frontend (Cloudflare Pages)**:
   ```bash
   npm run deploy:web
   ```

3. **Deploy the Proxy (Cloudflare Worker)**:
   ```bash
   npm run deploy:worker
   ```

4. **Link Custom Domain**:
   In the Cloudflare Dashboard, go to **Workers & Pages** -> **`swazz-web`** -> **Custom Domains**, and add your domain (e.g., `swazz.secmy.app`). The worker will automatically intercept `/proxy*` requests on this domain.

---

## 🧠 How it Works (General Architecture)

This is a monorepo containing two main packages: `@swazz/web` (Dashboard) and `@swazz/core` (Engine).

```mermaid
flowchart TD
    %% Styling
    classDef default fill:#1e1e28,stroke:#4a4a5a,stroke-width:1px,color:#f0f0f4
    classDef core fill:#13131a,stroke:#6366f1,stroke-width:2px,color:#f0f0f4
    classDef target fill:#1e1e28,stroke:#f43f5e,stroke-width:2px,color:#f0f0f4

    subgraph Dashboard ["@swazz/web (React + Vite)"]
        UI["User Interface"]
        Setup["Setup Panel\nURLs, Headers, Profiles"]
        Heatmap["Endpoint × Status Heatmap"]
        Inspector["Request Inspector\nwith XSS-safe view"]
        
        UI --> Setup
        UI --> Heatmap
        UI --> Inspector
    end

    subgraph Core ["@swazz/core (Engine)"]
        direction TB
        Parser["Swagger / OpenAPI Parser"]
        Profiles["Fuzz Profiles\nRANDOM, BOUNDARY, MALICIOUS"]
        Runner["Parallel Fuzz Runner"]
        
        Parser --> Runner
        Profiles --> Runner
    end

    subgraph Target ["Target APIs"]
        API1[Target Service 1]
        API2[Target Service N]
    end

    %% Flow
    Setup -->|1. Provide Swagger URLs| Parser
    Setup -->|2. Select Attack Vectors| Profiles
    Runner -->|3. Execute Fuzzed HTTP Requests| Target
    Target -->|4. Responses (2xx, 4xx, 5xx)| Runner
    Runner -->|5. Real-time Stats & Payload Data| Heatmap
    Runner -.->|Raw Results| Inspector

    %% Apply specific styles
    class Parser,Profiles,Runner core;
    class API1,API2 target;
```

## 🛠️ Tech Stack
- **Frontend:** React, TypeScript, Vite, Vanilla CSS (CSS Variables for theming)
- **Engine:** TypeScript, native `fetch`
- **Monorepo Management:** npm workspaces
