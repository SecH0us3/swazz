import { describe, it, expect, vi, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import app, { RunnerCoordinator } from "./index";

describe("Swazz Worker (Hono)", () => {
  it("responds with health check at /", async () => {
    const req = new Request("http://localhost/");
    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ service: "swazz-edge", status: "ok" });
  });

  it("auth_enabled is false by default in info endpoint", async () => {
    const req = new Request("http://localhost/api/info");
    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ auth_enabled: false, version: "1.0.0" });
  });
});

describe("D1 Database Migrations & API", () => {
  it("can insert and retrieve a user (verifying users table exists)", async () => {
    // Insert directly into DB to check schema
    await env.DB.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)')
      .bind('test-user-id', 'test@example.com', 'hash123')
      .run();

    const result = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind('test-user-id').first();
    expect(result?.email).toBe('test@example.com');
  });

  it("can register a new user via API", async () => {
    const req = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "newuser@example.com", password: "password123" })
    });
    
    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.id).toBe("string");
  });

  it("can login with registered user", async () => {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "newuser@example.com", password: "password123" })
    });
    
    const res = await app.fetch(req, env);
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
        body: JSON.stringify({ email: "newuser@example.com", password: "wrong" })
      });
      const res = await app.fetch(req, env);
      expect(res.status).toBe(401); // Invalid credentials
    }

    // 6th attempt should hit rate limit (429)
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "newuser@example.com", password: "password123" })
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain("locked");
  });
});
