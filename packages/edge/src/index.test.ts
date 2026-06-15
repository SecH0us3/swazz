import { describe, it, expect, vi, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import app from "./index";

beforeAll(async () => {
  // Use Vite's import.meta.glob to bundle SQL migrations as raw strings
  const migrationFiles = import.meta.glob("../migrations/*.sql", {
    eager: true,
    query: "?raw",
    import: "default",
  }) as Record<string, string>;

  // Sort by filename to ensure migrations run in correct order
  const sortedPaths = Object.keys(migrationFiles).sort();

  for (const path of sortedPaths) {
    const sql = migrationFiles[path];
    // Split by semicolon and run statements, ignoring comments and empty lines
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));
    for (const statement of statements) {
      await env.DB.prepare(statement).run();
    }
  }
});

const testEnv = { ...env, JWT_SECRET: 'test-secret' };

describe("Swazz Worker (Hono)", () => {
  it("responds with health check at /", async () => {
    const req = new Request("http://localhost/");
    const res = await app.fetch(req, testEnv);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ service: "swazz-edge", status: "ok" });
  });

  it("auth_enabled is true by default in info endpoint", async () => {
    const req = new Request("http://localhost/api/info");
    const res = await app.fetch(req, testEnv);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ auth_enabled: true, limit_anonymous: true, version: "1.0.0" });
  });
});

describe("D1 Database Migrations & API", () => {
  it("can insert and retrieve a user (verifying users table exists)", async () => {
    // Insert directly into DB to check schema
    await env.DB.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
      .bind('test-user-id', 'testuser', 'hash123')
      .run();

    const result = await env.DB.prepare('SELECT username FROM users WHERE id = ?').bind('test-user-id').first();
    expect(result?.username).toBe('testuser');
  });

  it("can register a new user via API", async () => {
    const req = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "newuser", password: "password123" })
    });
    
    const res = await app.fetch(req, testEnv);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.id).toBe("string");
  });

  it("can login with registered user", async () => {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "newuser", password: "password123" })
    });
    
    const res = await app.fetch(req, testEnv);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.token).toBe("string");
  });

  it("blocks login after 5 failed attempts (rate limiting)", async () => {
    // Attempt 5 bad logins
    for (let i = 0; i < 5; i++) {
      const req = new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "newuser", password: "wrong" })
      });
      const res = await app.fetch(req, testEnv);

      expect(res.status).toBe(401); // Invalid credentials
    }

    // 6th attempt should hit rate limit (429)
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "newuser", password: "password123" })
    });
    const res = await app.fetch(req, testEnv);

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain("locked");
  });
});

describe("Anonymous Limits", () => {
  let userToken: string;
  const testEnv = { ...env, AUTH_ENABLED: 'false', JWT_SECRET: 'test-secret' };

  beforeAll(async () => {
    // Register and login to get a valid token
    const regReq = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "limituser", password: "password123" })
    });
    await app.fetch(regReq, testEnv);

    const loginReq = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "limituser", password: "password123" })
    });
    const loginRes = await app.fetch(loginReq, testEnv);
    const body = await loginRes.json() as { token: string };
    userToken = body.token;

    // Prep swagger_cache and R2 for parse testing
    await env.DB.prepare('INSERT OR REPLACE INTO swagger_cache (url, base_path, endpoints_hash, endpoints_r2_key, raw_spec_r2_key) VALUES (?, ?, ?, ?, ?)')
      .bind('http://example.com/swagger.json', '/api', 'hash123', 'specs/parsed/test.json', 'specs/raw/test.json')
      .run();
    await env.STORAGE.put('specs/parsed/test.json', JSON.stringify([{ path: '/users', method: 'GET' }]));
  });

  it("limits anonymous browser user to 1 parse request, while allowing CLI and logged-in users", async () => {
    // 1. First parse request from anonymous browser - should succeed (status 200)
    const req1 = new Request("http://localhost/api/parse", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "CF-Connecting-IP": "8.8.8.8"
      },
      body: JSON.stringify({ url: "http://example.com/swagger.json" })
    });
    const res1 = await app.fetch(req1, testEnv);
    expect(res1.status).toBe(200);

    // 2. Second parse request from same anonymous browser IP - should be blocked (status 403)
    const req2 = new Request("http://localhost/api/parse", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "CF-Connecting-IP": "8.8.8.8"
      },
      body: JSON.stringify({ url: "http://example.com/swagger.json" })
    });
    const res2 = await app.fetch(req2, testEnv);
    expect(res2.status).toBe(403);
    const body2 = await res2.json() as any;
    expect(body2.error).toContain("Anonymous limit reached");

    // 3. Parse request from CLI client (no browser headers) - should bypass limits and succeed (status 200)
    const reqCLI = new Request("http://localhost/api/parse", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "curl/7.64.1",
        "CF-Connecting-IP": "8.8.8.8"
      },
      body: JSON.stringify({ url: "http://example.com/swagger.json" })
    });
    const resCLI = await app.fetch(reqCLI, testEnv);
    expect(resCLI.status).toBe(200);

    // 4. Parse request from logged-in browser user (with Authorization header) - should bypass limits and succeed (status 200)
    const reqAuth = new Request("http://localhost/api/parse", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "CF-Connecting-IP": "8.8.8.8",
        "Authorization": `Bearer ${userToken}`
      },
      body: JSON.stringify({ url: "http://example.com/swagger.json" })
    });
    const resAuth = await app.fetch(reqAuth, testEnv);
    expect(resAuth.status).toBe(200);
  });

  it("limits anonymous browser user to 50 endpoints per scan run, while CLI and logged-in users bypass this limit", async () => {
    // 1. Anonymous browser request with >50 endpoints - should be blocked (status 403)
    const largeConfig = {
      endpoints: new Array(51).fill("/api/item")
    };
    const reqAnonLarge = new Request("http://localhost/api/runs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "CF-Connecting-IP": "9.9.9.9"
      },
      body: JSON.stringify({ config: largeConfig })
    });
    const resAnonLarge = await app.fetch(reqAnonLarge, testEnv);
    expect(resAnonLarge.status).toBe(403);
    const bodyAnonLarge = await resAnonLarge.json() as any;
    expect(bodyAnonLarge.error).toContain("Anonymous limit reached");

    // 2. Anonymous browser request with <=50 endpoints - should bypass limits check, proceed to dispatch, and fail with 500/503 (no runners)
    const smallConfig = {
      endpoints: new Array(50).fill("/api/item")
    };
    const reqAnonSmall = new Request("http://localhost/api/runs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "CF-Connecting-IP": "9.9.9.9"
      },
      body: JSON.stringify({ config: smallConfig })
    });
    const resAnonSmall = await app.fetch(reqAnonSmall, testEnv);
    expect([500, 503]).toContain(resAnonSmall.status);

    // 3. CLI client with >50 endpoints - should bypass limits check and fail with 500/503 (no runners)
    const reqCLILarge = new Request("http://localhost/api/runs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Go-http-client/1.1",
        "CF-Connecting-IP": "9.9.9.9"
      },
      body: JSON.stringify({ config: largeConfig })
    });
    const resCLILarge = await app.fetch(reqCLILarge, testEnv);
    expect([500, 503]).toContain(resCLILarge.status);

    // 4. Logged-in user with >50 endpoints - should bypass limits check and fail with 500/503 (no runners)
    const reqAuthLarge = new Request("http://localhost/api/runs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "CF-Connecting-IP": "9.9.9.9",
        "Authorization": `Bearer ${userToken}`
      },
      body: JSON.stringify({ config: largeConfig })
    });
    const resAuthLarge = await app.fetch(reqAuthLarge, testEnv);
    expect([500, 503]).toContain(resAuthLarge.status);
  });
});

describe("Projects & Runners API", () => {
  let userToken: string;
  let projectId: string;

  beforeAll(async () => {
    // Register/login to get token
    const regReq = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "projuser", password: "password123" })
    });
    await app.fetch(regReq, testEnv);

    const loginReq = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "projuser", password: "password123" })
    });
    const loginRes = await app.fetch(loginReq, testEnv);
    const body = await loginRes.json() as { token: string };
    userToken = body.token;

    // Create a project
    const createReq = new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userToken}`
      },
      body: JSON.stringify({ name: "Original Name", description: "Original Description" })
    });
    const createRes = await app.fetch(createReq, testEnv);
    expect(createRes.status).toBe(200);
    const createBody = await createRes.json() as { id: string };
    projectId = createBody.id;
  });

  it("GET /api/projects returns the created project", async () => {
    const req = new Request("http://localhost/api/projects", {
      headers: { "Authorization": `Bearer ${userToken}` }
    });
    const res = await app.fetch(req, testEnv);

    expect(res.status).toBe(200);
    const body = await res.json() as { projects: any[] };
    const p = body.projects.find(x => x.id === projectId);
    expect(p).toBeDefined();
    expect(p.name).toBe("Original Name");
    expect(p.description).toBe("Original Description");
  });

  it("PATCH /api/projects/:id updates project name and description", async () => {
    const req = new Request(`http://localhost/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userToken}`
      },
      body: JSON.stringify({ name: "Updated Name", description: "Updated Description" })
    });
    const res = await app.fetch(req, testEnv);

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe("updated");

    // Verify change in DB
    const checkReq = new Request("http://localhost/api/projects", {
      headers: { "Authorization": `Bearer ${userToken}` }
    });
    const checkRes = await app.fetch(checkReq, testEnv);
    const checkBody = await checkRes.json() as { projects: any[] };
    const p = checkBody.projects.find(x => x.id === projectId);
    expect(p.name).toBe("Updated Name");
    expect(p.description).toBe("Updated Description");
  });

  it("GET /api/runners returns active runners list", async () => {
    const req = new Request("http://localhost/api/runners", {
      headers: { "Authorization": `Bearer ${userToken}` }
    });
    const res = await app.fetch(req, testEnv);

    expect(res.status).toBe(200);
    const body = await res.json() as { runners: any[] };
    expect(Array.isArray(body.runners)).toBe(true);
  });

  it("DELETE /api/projects/:id removes the project", async () => {
    const req = new Request(`http://localhost/api/projects/${projectId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${userToken}` }
    });
    const res = await app.fetch(req, testEnv);

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe("deleted");

    // Verify it is gone
    const checkReq = new Request("http://localhost/api/projects", {
      headers: { "Authorization": `Bearer ${userToken}` }
    });
    const checkRes = await app.fetch(checkReq, testEnv);
    const checkBody = await checkRes.json() as { projects: any[] };
    const p = checkBody.projects.find(x => x.id === projectId);
    expect(p).toBeUndefined();
  });
});
