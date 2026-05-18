---
layout: default
title: Installation
---

# Installation Guide 🛠

Swazz is built using **Go** for the backend engine and **Node.js (TypeScript/React)** for the frontend web dashboard. To get started, you'll need both environments configured.

## Prerequisites

Before installing, ensure you have the following installed on your system:
- **Go** (version 1.21 or later)
- **Node.js** (version 18 or later)
- **npm** (Node Package Manager)

## Getting Started

1. **Clone the Repository**

   Clone the Swazz repository from GitHub to your local machine:
   ```bash
   git clone https://github.com/your-org/swazz.git
   cd swazz
   ```

2. **Install Frontend Dependencies**

   Navigate to the root directory and install all npm dependencies (for the web dashboard):
   ```bash
   npm install
   ```

3. **Build the Web Dashboard (Optional)**

   If you plan to run the production version or deploy it, build the frontend first:
   ```bash
   npm run build
   ```
   This will bundle the React frontend located in `packages/web`.

## Running the Application

### Development Mode

To start both the Go backend and the Vite frontend concurrently in development mode, simply run:
```bash
npm run dev
```

### CLI Mode (Backend Only)

If you just want to run the core Go engine from the command line without the web interface:

1. Navigate to the backend directory:
   ```bash
   cd packages/container
   ```
2. Start the fuzzer with a config file:
   ```bash
   go run main.go start --config /path/to/config.json
   ```

### Server Mode (Backend API Only)

To spin up just the API backend for the web dashboard:
```bash
cd packages/container
go run main.go serve
```

[← Back to Home](./index.html) | [Next: Usage & Configuration →](./usage.html)
