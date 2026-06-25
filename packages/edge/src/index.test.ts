import { describe, it, expect, vi, beforeAll } from "vitest";
import { env as rawEnv } from "cloudflare:test";
import { Env } from "./env";
import app from "./index";
import { cleanupScheduledDeletions } from "./utils/cleanup";

const env = rawEnv as unknown as Env;

export function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inInlineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = sql[i + 1];

    if (inInlineComment) {
      if (char === "\n") {
        inInlineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        inBlockComment = false;
        i++; // skip '/'
      }
      continue;
    }

    if (inSingleQuote) {
      current += char;
      if (char === "'" && nextChar === "'") {
        current += "'";
        i++;
      } else if (char === "\\") {
        if (nextChar !== undefined) {
          current += nextChar;
          i++;
        }
      } else if (char === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      current += char;
      if (char === "\\") {
        if (nextChar !== undefined) {
          current += nextChar;
          i++;
        }
      } else if (char === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    // Check for comments start
    if (char === "-" && nextChar === "-") {
      inInlineComment = true;
      i++;
      continue;
    }

    if (char === "/" && nextChar === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    // Check for string start
    if (char === "'") {
      inSingleQuote = true;
      current += char;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      current += char;
      continue;
    }

    // Semicolon separator
    if (char === ";") {
      const stmt = current.trim();
      if (stmt.length > 0) {
        statements.push(stmt);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const stmt = current.trim();
  if (stmt.length > 0) {
    statements.push(stmt);
  }

  return statements;
}

beforeAll(async () => {
  // Use Vite's import.meta.glob to bundle SQL migrations as raw strings
  const migrationFiles = (import.meta as any).glob("../migrations/*.sql", {
    eager: true,
    query: "?raw",
    import: "default",
  }) as Record<string, string>;

  // Sort by filename to ensure migrations run in correct order
  const sortedPaths = Object.keys(migrationFiles).sort();

  for (const path of sortedPaths) {
    const sql = migrationFiles[path];
    const statements = splitSql(sql);

    for (const statement of statements) {
      try {
        await env.DB.prepare(statement).run();
      } catch (err: any) {
        // Tolerate idempotent ALTER TABLE ADD COLUMN statements: in test environments
        // the column may already exist in the base CREATE TABLE definition while the
        // ALTER TABLE migration is also present for the production upgrade path.
        const msg = String(err?.message ?? err);
        if (msg.includes('duplicate column name')) continue;
        throw err;
      }
    }
  }
});

const testEnv = { ...env, JWT_SECRET: 'test-secret' };

describe("Swazz Worker (Hono)", () => {
  it("responds with health check at /", async () => {
    const req = new Request("http://localhost/");
    const res = await app.fetch(req, testEnv);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toEqual({ service: "swazz-edge", status: "ok" });
  });

  it("auth_enabled is true by default in info endpoint", async () => {
    const req = new Request("http://localhost/api/info");
    const res = await app.fetch(req, testEnv);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
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
    const body = await res.json() as any;
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
    const body = await res.json() as any;
    expect(body.status).toBe("ok");
    expect(typeof body.token).toBe("string");
  });

  it("can login as guest, fetch profile with guest flag, and triggers cleanup", async () => {
    // 1. Login as guest
    const guestReq = new Request("http://localhost/api/auth/guest", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    const guestRes = await app.fetch(guestReq, testEnv);
    expect(guestRes.status).toBe(200);
    const guestBody = await guestRes.json() as any;
    expect(guestBody.status).toBe("ok");
    expect(typeof guestBody.token).toBe("string");
    expect(guestBody.username).toMatch(/^g_/);
    expect(typeof guestBody.expires_at).toBe("string");

    // 2. Fetch profile and verify is_guest is true
    const meReq = new Request("http://localhost/api/auth/me", {
      headers: { "Authorization": `Bearer ${guestBody.token}` }
    });
    const meRes = await app.fetch(meReq, testEnv);
    expect(meRes.status).toBe(200);
    const meBody = await meRes.json() as any;
    expect(meBody.username).toBe(guestBody.username);
    expect(meBody.is_guest).toBe(true);

    // 3. Verify guest user is stored in DB
    const dbUser = await env.DB.prepare('SELECT is_guest, expires_at FROM users WHERE username = ?')
      .bind(guestBody.username)
      .first<{ is_guest: number; expires_at: string }>();
    expect(dbUser?.is_guest).toBe(1);
    expect(dbUser?.expires_at).toBeDefined();

    // 4. Test cleanup utility: manually expire the guest user in the DB and run cleanup
    await env.DB.prepare("UPDATE users SET expires_at = datetime('now', '-5 minutes') WHERE username = ?")
      .bind(guestBody.username)
      .run();

    const { cleanupExpiredGuests } = await import("./utils/cleanup");
    await cleanupExpiredGuests(env.DB);

    // Verify guest user and their projects/scans are deleted
    const dbUserAfter = await env.DB.prepare('SELECT is_guest FROM users WHERE username = ?')
      .bind(guestBody.username)
      .first();
    expect(dbUserAfter).toBeNull();
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
    const body = await res.json() as any;
    expect(body.error).toContain("locked");
  });

  it("can delete user account and associated data (Right to be Forgotten)", async () => {
    // 1. Register a new user
    const regReq = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "deluser", password: "password123" })
    });
    const regRes = await app.fetch(regReq, testEnv);
    expect(regRes.status).toBe(200);
    const regBody = await regRes.json() as any;
    const userId = regBody.id;

    // 2. Log in
    const loginReq = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "deluser", password: "password123" })
    });
    const loginRes = await app.fetch(loginReq, testEnv);
    expect(loginRes.status).toBe(200);
    const loginBody = await loginRes.json() as any;
    const token = loginBody.token;

    // 3. Create a project
    const projReq = new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ name: "User Delete Project", description: "To be deleted" })
    });
    const projRes = await app.fetch(projReq, testEnv);
    expect(projRes.status).toBe(200);
    const projBody = await projRes.json() as any;
    const projectId = projBody.id;

    // Verify project member entry is created
    const members = await env.DB.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?')
      .bind(projectId, userId)
      .first<{ role: string }>();
    expect(members?.role).toBe('owner');

    // 4. Create a scan with a report URL for the project
    const reportUrl = 'reports/test-scan-report.enc';
    const scanId = 'scan-to-be-deleted';
    await env.DB.prepare('INSERT INTO scans (id, project_id, target_url, profile, status, user_id, report_url) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(scanId, projectId, 'http://test.com', 'default', 'pending', userId, reportUrl)
      .run();

    // Write a mock report file to storage
    await env.STORAGE.put(reportUrl, "encrypted fuzzer report contents");

    // 5. Create a runner
    const runnerId = 'runner-to-be-deleted';
    await env.DB.prepare('INSERT INTO runners (id, user_id, name, secret_hash, status) VALUES (?, ?, ?, ?, ?)')
      .bind(runnerId, userId, 'Del Runner', 'hash123', 'offline')
      .run();

    // 5b. Connect an active WebSocket runner associated with the user via Durable Object
    const doId = env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = env.COORDINATOR_DO.get(doId);
    const connectReq = new Request(`http://localhost/connect-runner?name=UserRunner&user_id=${userId}`, {
      headers: { "Upgrade": "websocket" }
    });
    const connectRes = await stub.fetch(connectReq);
    expect(connectRes.status).toBe(101);
    const runnerWs = connectRes.webSocket!;
    runnerWs.accept();

    // Setup listener to track connection close
    const closePromise = new Promise<number>((resolve) => {
      runnerWs.addEventListener("close", (evt) => {
        resolve(evt.code);
      });
    });

    // Verify entries and R2 object exist before deletion
    const userPre = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
    const projPre = await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(projectId).first();
    const scanPre = await env.DB.prepare('SELECT id FROM scans WHERE id = ?').bind(scanId).first();
    const runnerPre = await env.DB.prepare('SELECT id FROM runners WHERE id = ?').bind(runnerId).first();
    const storagePre = await env.STORAGE.get(reportUrl);

    expect(userPre).toBeDefined();
    expect(projPre).toBeDefined();
    expect(scanPre).toBeDefined();
    expect(runnerPre).toBeDefined();
    expect(storagePre).not.toBeNull();

    // 6. Schedule account deletion
    const delReq = new Request("http://localhost/api/users/me", {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` }
    });
    const delRes = await app.fetch(delReq, testEnv);
    expect(delRes.status).toBe(200);
    const delBody = await delRes.json() as any;
    expect(delBody.status).toBe('deletion_scheduled');
    expect(delBody.eta_days).toBe(7);

    // Verify that the active runner's WebSocket is closed immediately with GDPR status 1008
    const closeCode = await Promise.race([
      closePromise,
      new Promise<number>((_, reject) => setTimeout(() => reject(new Error("WebSocket did not close")), 2000))
    ]);
    expect(closeCode).toBe(1008);

    // Verify the user profile has delete_requested_at set
    const userScheduled = await env.DB.prepare('SELECT delete_requested_at FROM users WHERE id = ?').bind(userId).first<{ delete_requested_at: string }>();
    expect(userScheduled?.delete_requested_at).not.toBeNull();

    // Verify that active scans are marked as failed
    const scanScheduled = await env.DB.prepare('SELECT status, completed_at FROM scans WHERE id = ?').bind(scanId).first<{ status: string; completed_at: string }>();
    expect(scanScheduled?.status).toBe('failed');
    expect(scanScheduled?.completed_at).not.toBeNull();

    // Verify that other API requests (e.g. GET /api/projects) return 403 Forbidden
    const projReqForbidden = new Request("http://localhost/api/projects", {
      method: "GET",
      headers: { "Authorization": `Bearer ${token}` }
    });
    const projResForbidden = await app.fetch(projReqForbidden, testEnv);
    expect(projResForbidden.status).toBe(403);
    const projForbiddenBody = await projResForbidden.json() as any;
    expect(projForbiddenBody.error).toContain("Forbidden");

    // Verify that runner connection for the deleted user returns 403 Forbidden
    const userRow = await env.DB.prepare('SELECT api_key FROM users WHERE id = ?').bind(userId).first<{ api_key: string | null }>();
    let apiKey = userRow?.api_key;
    if (!apiKey) {
      apiKey = 'swazz_live_test_api_key_123';
      await env.DB.prepare('UPDATE users SET api_key = ? WHERE id = ?').bind(apiKey, userId).run();
    }
    const runnerReqDeleted = new Request(`http://localhost/api/runners/connect`, {
      headers: {
        "Upgrade": "websocket",
        "Authorization": `Bearer ${apiKey}`
      }
    });
    const runnerResDeleted = await app.fetch(runnerReqDeleted, testEnv);
    expect(runnerResDeleted.status).toBe(403);

    // 7. Cancel deletion
    const cancelReq = new Request("http://localhost/api/users/me/cancel-deletion", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` }
    });
    const cancelRes = await app.fetch(cancelReq, testEnv);
    expect(cancelRes.status).toBe(200);
    const cancelBody = await cancelRes.json() as any;
    expect(cancelBody.status).toBe('deletion_cancelled');

    // Verify delete_requested_at is cleared
    const userCancelled = await env.DB.prepare('SELECT delete_requested_at FROM users WHERE id = ?').bind(userId).first<{ delete_requested_at: string | null }>();
    expect(userCancelled?.delete_requested_at).toBeNull();

    // 8. Schedule account deletion again
    const delReq2 = new Request("http://localhost/api/users/me", {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` }
    });
    const delRes2 = await app.fetch(delReq2, testEnv);
    expect(delRes2.status).toBe(200);

    // 9. Age the deletion timestamp to expired (e.g. -8 days)
    await env.DB.prepare("UPDATE users SET delete_requested_at = datetime('now', '-8 days') WHERE id = ?").bind(userId).run();

    // 10. Execute the scheduled deletion cleanup
    await cleanupScheduledDeletions(env);

    // 11. Verify all entries and storage object are deleted
    const userPost = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
    const projPost = await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(projectId).first();
    const memberPost = await env.DB.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').bind(projectId, userId).first();
    const scanPost = await env.DB.prepare('SELECT id FROM scans WHERE id = ?').bind(scanId).first();
    const runnerPost = await env.DB.prepare('SELECT id FROM runners WHERE id = ?').bind(runnerId).first();
    const storagePost = await env.STORAGE.get(reportUrl);

    expect(userPost).toBeNull();
    expect(projPost).toBeNull();
    expect(memberPost).toBeNull();
    expect(scanPost).toBeNull();
    expect(runnerPost).toBeNull();
    expect(storagePost).toBeNull();
  });

  it("can set up, verify, require, and disable 2FA", async () => {
    const username = "user_2fa_" + Date.now();
    const regReq = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "password123" })
    });
    const regRes = await app.fetch(regReq, testEnv);
    expect(regRes.status).toBe(200);

    const loginReq1 = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "password123" })
    });
    const loginRes1 = await app.fetch(loginReq1, testEnv);
    const { token } = await loginRes1.json() as any;

    const setupReq = new Request("http://localhost/api/auth/2fa/setup", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ password: "password123" })
    });
    const setupRes = await app.fetch(setupReq, testEnv);
    expect(setupRes.status).toBe(200);
    const setupBody = await setupRes.json() as any;
    expect(setupBody.status).toBe("ok");
    expect(typeof setupBody.secret).toBe("string");
    expect(setupBody.otpauth_url).toContain("otpauth://totp");

    const loginReq2 = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "password123" })
    });
    const loginRes2 = await app.fetch(loginReq2, testEnv);
    expect(loginRes2.status).toBe(200);
    const loginBody2 = await loginRes2.json() as any;
    expect(loginBody2.status).toBe("ok");

    const verifyReq1 = new Request("http://localhost/api/auth/2fa/verify", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ code: "000000", password: "password123" })
    });
    const verifyRes1 = await app.fetch(verifyReq1, testEnv);
    expect(verifyRes1.status).toBe(401);

    const { generateTOTP } = await import("./utils/totp");
    const validCode = await generateTOTP(setupBody.secret);
    
    const verifyReq2 = new Request("http://localhost/api/auth/2fa/verify", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ code: validCode, password: "password123" })
    });
    const verifyRes2 = await app.fetch(verifyReq2, testEnv);
    expect(verifyRes2.status).toBe(200);

    const loginReq3 = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "password123" })
    });
    const loginRes3 = await app.fetch(loginReq3, testEnv);
    expect(loginRes3.status).toBe(200);
    const loginBody3 = await loginRes3.json() as any;
    expect(loginBody3.status).toBe("2fa_required");

    const loginReq4 = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "password123", two_factor_code: "111111" })
    });
    const loginRes4 = await app.fetch(loginReq4, testEnv);
    expect(loginRes4.status).toBe(401);

    const freshCode = await generateTOTP(setupBody.secret);
    const loginReq5 = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "password123", two_factor_code: freshCode })
    });
    const loginRes5 = await app.fetch(loginReq5, testEnv);
    expect(loginRes5.status).toBe(200);
    const loginBody5 = await loginRes5.json() as any;
    expect(loginBody5.status).toBe("ok");
    expect(typeof loginBody5.token).toBe("string");

    const disableReq1 = new Request("http://localhost/api/auth/2fa/disable", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ code: "000000", password: "password123" })
    });
    const disableRes1 = await app.fetch(disableReq1, testEnv);
    expect(disableRes1.status).toBe(401);

    const disableCode = await generateTOTP(setupBody.secret);
    const disableReq2 = new Request("http://localhost/api/auth/2fa/disable", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ code: disableCode, password: "password123" })
    });
    const disableRes2 = await app.fetch(disableReq2, testEnv);
    expect(disableRes2.status).toBe(200);

    const loginReq6 = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "password123" })
    });
    const loginRes6 = await app.fetch(loginReq6, testEnv);
    expect(loginRes6.status).toBe(200);
    const loginBody6 = await loginRes6.json() as any;
    expect(loginBody6.status).toBe("ok");
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

  it("GET /api/runners returns active runners list with correct mode and properties", async () => {
    const id = env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = env.COORDINATOR_DO.get(id);

    // 1. Connect a shared runner (no public_key)
    const connectSharedReq = new Request("http://localhost/connect-runner?name=SharedRunner1", {
      headers: { "Upgrade": "websocket" }
    });
    const connectSharedRes = await stub.fetch(connectSharedReq);
    expect(connectSharedRes.status).toBe(101);
    const sharedWs = connectSharedRes.webSocket!;
    sharedWs.accept();

    // 2. Connect a private runner (with public_key)
    const keyPair = await crypto.subtle.generateKey(
      { name: "Ed25519" },
      true,
      ["sign", "verify"]
    );
    const rawPubKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const pubKeyHex = Array.from(new Uint8Array(rawPubKey))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const connectPrivateReq = new Request(`http://localhost/connect-runner?name=PrivateRunner1&public_key=${pubKeyHex}`, {
      headers: { "Upgrade": "websocket" }
    });
    const connectPrivateRes = await stub.fetch(connectPrivateReq);
    expect(connectPrivateRes.status).toBe(101);
    const privateWs = connectPrivateRes.webSocket!;
    privateWs.accept();

    // Challenge-response auth logic for private runner
    await new Promise<void>((resolve, reject) => {
      privateWs.addEventListener("message", async (evt) => {
        try {
          const msg = JSON.parse(evt.data as string);
          if (msg.type === "challenge") {
            const nonce = msg.nonce;
            const nonceBuffer = new TextEncoder().encode(nonce);
            const signatureBuffer = await crypto.subtle.sign(
              "Ed25519",
              keyPair.privateKey,
              nonceBuffer
            );
            const signatureHex = Array.from(new Uint8Array(signatureBuffer))
              .map(b => b.toString(16).padStart(2, '0'))
              .join('');
            privateWs.send(JSON.stringify({
              type: "challenge_response",
              signature: signatureHex
            }));
          } else if (msg.type === "auth_ok") {
            resolve();
          } else if (msg.type === "auth_failed") {
            reject(new Error(msg.error));
          }
        } catch (err) {
          reject(err);
        }
      });
    });

    // 3. Query the endpoint
    const req = new Request("http://localhost/api/runners", {
      headers: { "Authorization": `Bearer ${userToken}` }
    });
    const res = await app.fetch(req, testEnv);

    expect(res.status).toBe(200);
    const body = await res.json() as { runners: any[] };
    expect(Array.isArray(body.runners)).toBe(true);

    const sharedRunner = body.runners.find(r => r.name === 'SharedRunner1');
    expect(sharedRunner).toBeDefined();
    expect(sharedRunner.isShared).toBe(true);
    expect(sharedRunner.publicKey).toBeNull();

    const privateRunner = body.runners.find(r => r.name === 'PrivateRunner1');
    expect(privateRunner).toBeDefined();
    expect(privateRunner.isShared).toBe(false);
    expect(privateRunner.publicKey).toBe(pubKeyHex);
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

describe("splitSql helper", () => {
  it("splits simple statements by semicolon", () => {
    const sql = "SELECT * FROM users; SELECT * FROM projects;";
    expect(splitSql(sql)).toEqual([
      "SELECT * FROM users",
      "SELECT * FROM projects"
    ]);
  });

  it("handles semicolons inside single-quoted strings", () => {
    const sql = "INSERT INTO users (name) VALUES ('hello; world'); SELECT 1;";
    expect(splitSql(sql)).toEqual([
      "INSERT INTO users (name) VALUES ('hello; world')",
      "SELECT 1"
    ]);
  });

  it("handles single-quoted string escapes", () => {
    const sql = "INSERT INTO users (name) VALUES ('it''s a test; yes'); SELECT 1;";
    expect(splitSql(sql)).toEqual([
      "INSERT INTO users (name) VALUES ('it''s a test; yes')",
      "SELECT 1"
    ]);
  });

  it("handles inline and block comments with semicolons", () => {
    const sql = `
      -- this is a comment; with a semicolon
      SELECT 1;
      /* block comment; with semicolon */
      SELECT 2;
    `;
    expect(splitSql(sql)).toEqual([
      "SELECT 1",
      "SELECT 2"
    ]);
  });
});
