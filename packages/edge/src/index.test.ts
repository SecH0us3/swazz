import { describe, it, expect, vi, beforeAll } from "vitest";
import { env as rawEnv } from "cloudflare:test";
import { Env } from "./env";
import app from "./index";
import { cleanupScheduledDeletions } from "./utils/cleanup";

const originalFetch = app.fetch;
// @ts-ignore
app.fetch = async (req: Request, env?: any, ctx?: any) => {
  if (req.headers.has("X-Test-No-Csrf")) {
    const headers = new Headers(req.headers);
    headers.delete("X-Test-No-Csrf");
    const newReq = new Request(req.url, {
      method: req.method,
      headers,
      body: req.body,
      // @ts-ignore
      duplex: 'half'
    });
    return originalFetch(newReq, env, ctx);
  }

  const isStateChanging = ["POST", "PUT", "DELETE", "PATCH"].includes(req.method);
  const hasAuth = req.headers.has("Authorization") || req.headers.has("X-Upload-Token");
  const hasCsrf = req.headers.has("X-CSRF-Token");

  if (isStateChanging && !hasAuth && !hasCsrf) {
    const infoRes = await originalFetch(new Request("http://localhost/api/info"), env, ctx);
    const csrfToken = infoRes.headers.get("X-CSRF-Token");
    if (csrfToken) {
      const headers = new Headers(req.headers);
      headers.set("X-CSRF-Token", csrfToken);
      headers.set("Cookie", `csrf_token=${csrfToken}`);
      const newReq = new Request(req.url, {
        method: req.method,
        headers,
        body: req.body,
        // @ts-ignore
        duplex: 'half'
      });
      return originalFetch(newReq, env, ctx);
    }
  }

  return originalFetch(req, env, ctx);
};

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

const testEnv = { ...env, JWT_SECRET: 'test-secret', TURNSTILE_SITE_KEY: null, TURNSTILE_SECRET: null };

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
    expect(body).toEqual({ auth_enabled: true, limit_anonymous: true, version: "1.0.0", turnstile_site_key: null });
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
      body: JSON.stringify({ username: "newuser", password: "Password123!" })
    });
    
    const res = await app.fetch(req, testEnv);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe("ok");
    expect(typeof body.id).toBe("string");
  });

  it("rejects registrations with invalid username formats", async () => {
    // 1. Too short
    const resShort = await app.fetch(new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "ab", password: "Password123!" })
    }), testEnv);
    expect(resShort.status).toBe(400);
    expect((await resShort.json() as any).error).toContain("Username must be 3-20 characters long");

    // 2. Too long
    const resLong = await app.fetch(new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "a".repeat(21), password: "Password123!" })
    }), testEnv);
    expect(resLong.status).toBe(400);
    expect((await resLong.json() as any).error).toContain("Username must be 3-20 characters long");

    // 3. Invalid characters
    const resChars = await app.fetch(new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "user@name", password: "Password123!" })
    }), testEnv);
    expect(resChars.status).toBe(400);
    expect((await resChars.json() as any).error).toContain("Username must be 3-20 characters long");

    // 4. Non-string username
    const resNonString = await app.fetch(new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: 123, password: "Password123!" })
    }), testEnv);
    expect(resNonString.status).toBe(400);
    expect((await resNonString.json() as any).error).toContain("Missing username or password");
  });

  it("prevents registering the same username twice due to registry lock", async () => {
    const req = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "newuser", password: "Password123!" })
    });
    
    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe("Username already exists");
  });

  it("prevents registering the same username with different casing or surrounding whitespace due to normalization in registry lock", async () => {
    // 1. Try different casing
    const reqCase = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "NewUser", password: "Password123!" })
    });
    const resCase = await app.fetch(reqCase, testEnv);
    expect(resCase.status).toBe(400);
    const bodyCase = await resCase.json() as any;
    expect(bodyCase.error).toBe("Username already exists");

    // 2. Try leading/trailing whitespace
    const reqSpace = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "  newuser  ", password: "Password123!" })
    });
    const resSpace = await app.fetch(reqSpace, testEnv);
    expect(resSpace.status).toBe(400);
    const bodySpace = await resSpace.json() as any;
    expect(bodySpace.error).toBe("Username already exists");
  });

  it("prevents registering a username even after user deletion", async () => {
    const username = "deleteme";
    
    // 1. Register user
    const regReq = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "Password123!" })
    });
    const regRes = await app.fetch(regReq, testEnv);
    expect(regRes.status).toBe(200);
    const regBody = await regRes.json() as any;
    
    // 2. Perform deletion in DB (simulate purge)
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(regBody.id).run();
    
    // 3. Confirm user is deleted from users table
    const deletedUser = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(regBody.id).first();
    expect(deletedUser).toBeNull();
    
    // 4. Try to register with same username again - should be blocked by username_registry
    const regReq2 = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "Password123!" })
    });
    const regRes2 = await app.fetch(regReq2, testEnv);
    expect(regRes2.status).toBe(400);
    const body2 = await regRes2.json() as any;
    expect(body2.error).toBe("Username already exists");
  });

  it("can login with registered user", async () => {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "newuser", password: "Password123!" })
    });
    
    const res = await app.fetch(req, testEnv);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe("ok");
    expect(typeof body.token).toBe("string");
  });

  it("can login as guest, fetch profile with guest flag, and triggers cleanup", async () => {
    // Helper to solve PoW in tests
    const solvePoWTest = async (challenge: string, difficulty: number): Promise<number> => {
      const prefix = '0'.repeat(difficulty);
      let nonce = 0;
      while (true) {
        const encoder = new TextEncoder();
        const dataBytes = encoder.encode(challenge + nonce);
        const hashBuffer = await crypto.subtle.digest('SHA-256', dataBytes);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        if (hashHex.startsWith(prefix)) {
          return nonce;
        }
        nonce++;
      }
    };

    // 1. Get challenge via step1
    const step1Req = new Request("http://localhost/api/auth/guest/step1", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    const step1Res = await app.fetch(step1Req, testEnv);
    expect(step1Res.status).toBe(200);
    const step1Body = await step1Res.json() as any;
    expect(step1Body.status).toBe("ok");
    expect(typeof step1Body.token).toBe("string");

    // 2. Solve challenge
    const nonce = await solvePoWTest(step1Body.challenge, step1Body.difficulty);

    // 3. Login as guest
    const guestReq = new Request("http://localhost/api/auth/guest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: step1Body.token,
        nonce
      })
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
      body: JSON.stringify({ username: "newuser", password: "Password123!" })
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
      body: JSON.stringify({ username: "deluser", password: "Password123!" })
    });
    const regRes = await app.fetch(regReq, testEnv);
    expect(regRes.status).toBe(200);
    const regBody = await regRes.json() as any;
    const userId = regBody.id;

    // 2. Log in
    const loginReq = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "deluser", password: "Password123!" })
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
    const username = "u" + Date.now().toString().slice(-6) + "_" + Math.floor(Math.random() * 1000);
    const regReq = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "Password123!" })
    });
    const regRes = await app.fetch(regReq, testEnv);
    expect(regRes.status).toBe(200);

    const loginReq1 = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "Password123!" })
    });
    const loginRes1 = await app.fetch(loginReq1, testEnv);
    const { token } = await loginRes1.json() as any;

    const setupReq = new Request("http://localhost/api/auth/2fa/setup", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ password: "Password123!" })
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
      body: JSON.stringify({ username, password: "Password123!" })
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
      body: JSON.stringify({ code: "000000", password: "Password123!" })
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
      body: JSON.stringify({ code: validCode, password: "Password123!" })
    });
    const verifyRes2 = await app.fetch(verifyReq2, testEnv);
    expect(verifyRes2.status).toBe(200);

    const loginReq3 = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "Password123!" })
    });
    const loginRes3 = await app.fetch(loginReq3, testEnv);
    expect(loginRes3.status).toBe(200);
    const loginBody3 = await loginRes3.json() as any;
    expect(loginBody3.status).toBe("2fa_required");

    const loginReq4 = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "Password123!", two_factor_code: "111111" })
    });
    const loginRes4 = await app.fetch(loginReq4, testEnv);
    expect(loginRes4.status).toBe(401);

    const freshCode = await generateTOTP(setupBody.secret);
    const loginReq5 = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "Password123!", two_factor_code: freshCode })
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
      body: JSON.stringify({ code: "000000", password: "Password123!" })
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
      body: JSON.stringify({ code: disableCode, password: "Password123!" })
    });
    const disableRes2 = await app.fetch(disableReq2, testEnv);
    expect(disableRes2.status).toBe(200);

    const loginReq6 = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "Password123!" })
    });
    const loginRes6 = await app.fetch(loginReq6, testEnv);
    expect(loginRes6.status).toBe(200);
    const loginBody6 = await loginRes6.json() as any;
    expect(loginBody6.status).toBe("ok");
  });
});

describe("Anonymous Limits", () => {
  let userToken: string;
  const testEnv = { ...env, AUTH_ENABLED: 'false', JWT_SECRET: 'test-secret', TURNSTILE_SITE_KEY: null, TURNSTILE_SECRET: null };

  beforeAll(async () => {
    // Register and login to get a valid token
    const regReq = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "limituser", password: "Password123!" })
    });
    await app.fetch(regReq, testEnv);

    const loginReq = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "limituser", password: "Password123!" })
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
      body: JSON.stringify({ username: "projuser", password: "Password123!" })
    });
    await app.fetch(regReq, testEnv);

    const loginReq = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "projuser", password: "Password123!" })
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

  describe("POST /api/runners/:connectionId/restart", () => {
    it("returns 401 for unauthorized user", async () => {
      const req = new Request("http://localhost/api/runners/conn1/restart", {
        method: "POST"
      });
      const res = await app.fetch(req, testEnv);
      expect(res.status).toBe(401);
    });

    it("returns 500 when database query fails during restart", async () => {
      const originalPrepare = testEnv.DB.prepare;
      testEnv.DB.prepare = () => {
        throw new Error("DB Query Error");
      };

      try {
        const req = new Request("http://localhost/api/runners/some-conn-id/restart", {
          method: "POST",
          headers: { "Authorization": `Bearer ${userToken}` }
        });
        const res = await app.fetch(req, testEnv);
        expect(res.status).toBe(500);
        const body = await res.json() as { error: string };
        expect(body.error).toBe("Internal Server Error");
      } finally {
        testEnv.DB.prepare = originalPrepare;
      }
    });

    it("returns 403 when trying to restart shared runner or owned runner without public_key", async () => {
      const id = env.COORDINATOR_DO.idFromName('global-coordinator');
      const stub = env.COORDINATOR_DO.get(id);

      // Connect shared runner
      const connectSharedReq = new Request("http://localhost/connect-runner?name=SharedRunnerRestart", {
        headers: { "Upgrade": "websocket" }
      });
      const connectSharedRes = await stub.fetch(connectSharedReq);
      const sharedWs = connectSharedRes.webSocket!;
      sharedWs.accept();

      // Get connectionId
      const listReq = new Request("http://localhost/api/runners", {
        headers: { "Authorization": `Bearer ${userToken}` }
      });
      const listRes = await app.fetch(listReq, testEnv);
      const listBody = await listRes.json() as { runners: any[] };
      const sharedRunner = listBody.runners.find(r => r.name === 'SharedRunnerRestart');
      expect(sharedRunner).toBeDefined();
      expect(sharedRunner.connectionId).toBeDefined();

      // Attempt restart (user has no public key in database by default, and runner is shared anyway)
      const restartReq = new Request(`http://localhost/api/runners/${sharedRunner.connectionId}/restart`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${userToken}` }
      });
      const restartRes = await app.fetch(restartReq, testEnv);
      expect(restartRes.status).toBe(403);
    });

    it("successfully restarts owned private runner and fails for non-owned", async () => {
      const id = env.COORDINATOR_DO.idFromName('global-coordinator');
      const stub = env.COORDINATOR_DO.get(id);

      // Fetch dynamic user ID for projuser
      const projUser = await env.DB.prepare("SELECT id FROM users WHERE username = ?")
        .bind("projuser")
        .first<{ id: string }>();
      const projUserId = projUser.id;

      // 1. Register a public key for our test user
      const keyPair = await crypto.subtle.generateKey(
        { name: "Ed25519" },
        true,
        ["sign", "verify"]
      );
      const rawPubKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
      const pubKeyHex = Array.from(new Uint8Array(rawPubKey))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      await env.DB.prepare("UPDATE users SET public_key = ? WHERE id = ?")
        .bind(pubKeyHex, projUserId)
        .run();

      // 2. Connect private runner for this user
      const connectPrivateReq = new Request(`http://localhost/connect-runner?name=PrivateRunnerRestart&public_key=${pubKeyHex}&user_id=${projUserId}`, {
        headers: { "Upgrade": "websocket" }
      });
      const connectPrivateRes = await stub.fetch(connectPrivateReq);
      const privateWs = connectPrivateRes.webSocket!;
      privateWs.accept();

      // Authenticate runner
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
            }
          } catch (err) { reject(err); }
        });
      });

      // 3. Get connectionId
      const listReq = new Request("http://localhost/api/runners", {
        headers: { "Authorization": `Bearer ${userToken}` }
      });
      const listRes = await app.fetch(listReq, testEnv);
      const listBody = await listRes.json() as { runners: any[] };
      const privateRunner = listBody.runners.find(r => r.name === 'PrivateRunnerRestart');
      expect(privateRunner).toBeDefined();

      // 4. Try to restart from another user (no matching public key / unauthorized token)
      // First register and login another user
      const registerReq = new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "otheruserrestart", password: "Password123!" })
      });
      const registerRes = await app.fetch(registerReq, testEnv);
      expect(registerRes.status).toBe(200);

      const loginReq = new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "otheruserrestart", password: "Password123!" })
      });
      const loginRes = await app.fetch(loginReq, testEnv);
      expect(loginRes.status).toBe(200);
      const loginBody = await loginRes.json() as { token: string };
      const otherToken = loginBody.token;

      const restartOtherReq = new Request(`http://localhost/api/runners/${privateRunner.connectionId}/restart`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${otherToken}` }
      });
      const restartOtherRes = await app.fetch(restartOtherReq, testEnv);
      expect(restartOtherRes.status).toBe(403); // Since otheruserrestart has no public key/doesn't own it

      // 5. Restart with correct owner
      let restartMessageReceived = false;
      privateWs.addEventListener("message", (evt) => {
        try {
          const msg = JSON.parse(evt.data as string);
          if (msg.type === "agent_restart") {
            restartMessageReceived = true;
          }
        } catch {}
      });

      const restartOwnerReq = new Request(`http://localhost/api/runners/${privateRunner.connectionId}/restart`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${userToken}` }
      });
      const restartOwnerRes = await app.fetch(restartOwnerReq, testEnv);
      expect(restartOwnerRes.status).toBe(200);
      const restartBody = await restartOwnerRes.json() as { status: string };
      expect(restartBody.status).toBe("restarted");

      // Verify WebSocket message received by the agent client
      expect(restartMessageReceived).toBe(true);
    });
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

describe("CSRF Protection", () => {
  it("safe requests (GET) return the X-CSRF-Token header and set csrf_token cookie", async () => {
    const req = new Request("http://localhost/api/info");
    const res = await originalFetch(req, testEnv);
    expect(res.status).toBe(200);
    const csrfTokenHeader = res.headers.get("X-CSRF-Token");
    expect(csrfTokenHeader).toBeDefined();
    expect(csrfTokenHeader).not.toBeNull();
    expect(csrfTokenHeader!.length).toBeGreaterThan(0);

    const setCookieHeader = res.headers.get("Set-Cookie");
    expect(setCookieHeader).toContain("csrf_token=");
  });

  it("state-changing requests without X-CSRF-Token header are rejected with 403", async () => {
    const req = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Test-No-Csrf": "true"
      },
      body: JSON.stringify({ username: "csrfuser", password: "Password123!" })
    });
    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error).toBe("Invalid or missing CSRF token");
  });

  it("state-changing requests with invalid X-CSRF-Token header are rejected with 403", async () => {
    const req = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": "invalid-token",
        "Cookie": "csrf_token=valid-token",
        "X-Test-No-Csrf": "true"
      },
      body: JSON.stringify({ username: "csrfuser", password: "Password123!" })
    });
    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error).toBe("Invalid or missing CSRF token");
  });

  it("requests with Authorization: Bearer <token> bypass CSRF verification", async () => {
    const req = new Request("http://localhost/api/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer invalid_or_dummy_token",
        "X-Test-No-Csrf": "true"
      },
      body: JSON.stringify({ name: "Bypass Project", description: "Bypassed" })
    });
    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(401);
  });
});

describe("Auth Security Features (PoW, Magic Links, Passwords)", () => {
  it("enforces password length on registration", async () => {
    // 1. Too short (11 chars)
    const regReqTooShort = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "weakuser1", password: "Password123" })
    });
    const resTooShort = await app.fetch(regReqTooShort, testEnv);
    expect(resTooShort.status).toBe(400);
    const bodyTooShort = await resTooShort.json() as any;
    expect(bodyTooShort.error).toContain("Password must be at least 12 characters long");

    // 2. Valid length (12 chars)
    const regReqStrong = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "stronguser", password: "Password123!" })
    });
    const resStrong = await app.fetch(regReqStrong, testEnv);
    expect(resStrong.status).toBe(200);
  });

  it("completes the full Proof of Work login flow (step1 + step2)", async () => {
    // Register unique user
    const username = "powuser";
    const regReq = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "Password123!" })
    });
    await app.fetch(regReq, testEnv);

    // 1. Get challenge (step 1)
    const step1Req = new Request("http://localhost/api/auth/login/step1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username })
    });
    const step1Res = await app.fetch(step1Req, testEnv);
    expect(step1Res.status).toBe(200);
    const step1Body = await step1Res.json() as { token: string; challenge: string; difficulty: number };
    expect(step1Body.token).toBeDefined();
    expect(step1Body.challenge).toBeDefined();

    // 2. Solve Proof of Work
    let nonce = 0;
    let hashHex = '';
    const targetPrefix = '0'.repeat(step1Body.difficulty);
    while (true) {
      const text = step1Body.challenge + nonce;
      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      if (hashHex.startsWith(targetPrefix)) {
        break;
      }
      nonce++;
    }

    // 3. Authenticate (step 2)
    const step2Req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: step1Body.token,
        password: "Password123!",
        nonce: nonce
      })
    });
    const step2Res = await app.fetch(step2Req, testEnv);
    expect(step2Res.status).toBe(200);
    const step2Body = await step2Res.json() as { status: string; token: string };
    expect(step2Body.status).toBe("ok");
    expect(step2Body.token).toBeDefined();
  });

  describe("GET / Content Negotiation", () => {
    it("returns markdown when Accept is text/markdown", async () => {
      const req = new Request("http://localhost/", {
        method: "GET",
        headers: { "Accept": "text/markdown" }
      });
      const res = await app.fetch(req, testEnv);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/markdown");
      const bodyText = await res.text();
      expect(bodyText).toContain("# Swazz: Smart API Fuzzer ⚡️");
    });

    it("returns HTML when Accept is text/html", async () => {
      const req = new Request("http://localhost/", {
        method: "GET",
        headers: { "Accept": "text/html" }
      });
      const res = await app.fetch(req, testEnv);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      const bodyText = await res.text();
      expect(bodyText).toContain("<!DOCTYPE html>");
      expect(bodyText).toContain("swazz — Smart API Fuzzer");
    });

    it("returns JSON by default or when Accept is application/json", async () => {
      const req = new Request("http://localhost/", {
        method: "GET",
        headers: { "Accept": "application/json" }
      });
      const res = await app.fetch(req, testEnv);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/json");
      const bodyJson = await res.json() as { service: string; status: string };
      expect(bodyJson.service).toBe("swazz-edge");
      expect(bodyJson.status).toBe("ok");
    });
  });
});
