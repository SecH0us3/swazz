// @ts-nocheck
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { env as rawEnv } from "cloudflare:test";
import { Env } from "./env";
import app from "./index";
import { cleanupScheduledDeletions } from "./utils/cleanup";
import { splitSql } from "./splitSql";
import { ulid } from "ulidx";
import { sign } from "hono/jwt";

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
const testCtx = {} as any;
const appFetchWrapper = async (req: any, e?: any, ctx?: any) => {
  return app.fetch(req, e as any, (ctx || testCtx) as any);
};



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
        const msg = String(err?.message ?? err);
        if (msg.includes('duplicate column name') || msg.includes('SQL code did not contain a statement')) continue;
        throw err;
      }
    }
  }
});

const testEnv = { 
  ...env, 
  JWT_SECRET: 'test-secret', 
  ADMIN_SECRET: 'admin-secret', 
  TURNSTILE_SITE_KEY: undefined, 
  TURNSTILE_SECRET: undefined,
  GITHUB_CLIENT_ID: undefined,
  GITHUB_CLIENT_SECRET: undefined
} as unknown as Env;

describe("Swazz Worker (Hono)", () => {
  it("responds with health check at /", async () => {
    const req = new Request("http://localhost/");
    const res = await appFetchWrapper(req as any, testEnv);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toEqual({ service: "swazz-edge", status: "ok" });
  });

  it("auth_enabled is true by default in info endpoint", async () => {
    const req = new Request("http://localhost/api/info");
    const res = await appFetchWrapper(req as any, testEnv);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toEqual({ auth_enabled: true, limit_anonymous: true, github_auth_enabled: false, version: "1.0.0", turnstile_site_key: null });
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
    
    const res = await appFetchWrapper(req as any, testEnv);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe("ok");
    expect(typeof body.id).toBe("string");
  });

  it("rejects registrations with invalid username formats", async () => {
    // 1. Too short
    const resShort = await appFetchWrapper(new Request("http://localhost/api/auth/register" as any, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "ab", password: "Password123!" })
    }), testEnv);
    expect(resShort.status).toBe(400);
    expect((await resShort.json() as any).error).toContain("Username must be 3-20 characters long");

    // 2. Too long
    const resLong = await appFetchWrapper(new Request("http://localhost/api/auth/register" as any, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "a".repeat(21), password: "Password123!" })
    }), testEnv);
    expect(resLong.status).toBe(400);
    expect((await resLong.json() as any).error).toContain("Username must be 3-20 characters long");

    // 3. Invalid characters
    const resChars = await appFetchWrapper(new Request("http://localhost/api/auth/register" as any, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "user@name", password: "Password123!" })
    }), testEnv);
    expect(resChars.status).toBe(400);
    expect((await resChars.json() as any).error).toContain("Username must be 3-20 characters long");

    // 4. Non-string username
    const resNonString = await appFetchWrapper(new Request("http://localhost/api/auth/register" as any, {
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
    
    const res = await appFetchWrapper(req as any, testEnv);
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
    const resCase = await appFetchWrapper(reqCase as any, testEnv);
    expect(resCase.status).toBe(400);
    const bodyCase = await resCase.json() as any;
    expect(bodyCase.error).toBe("Username already exists");

    // 2. Try leading/trailing whitespace
    const reqSpace = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "  newuser  ", password: "Password123!" })
    });
    const resSpace = await appFetchWrapper(reqSpace as any, testEnv);
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
    const regRes = await appFetchWrapper(regReq as any, testEnv);
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
    const regRes2 = await appFetchWrapper(regReq2 as any, testEnv);
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
    
    const res = await appFetchWrapper(req as any, testEnv);

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
    const step1Res = await appFetchWrapper(step1Req as any, testEnv);
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
    const guestRes = await appFetchWrapper(guestReq as any, testEnv);
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
    const meRes = await appFetchWrapper(meReq as any, testEnv);
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
      const res = await appFetchWrapper(req as any, testEnv);

      expect(res.status).toBe(401); // Invalid credentials
    }

    // 6th attempt should hit rate limit (429)
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "newuser", password: "Password123!" })
    });
    const res = await appFetchWrapper(req as any, testEnv);

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
    const regRes = await appFetchWrapper(regReq as any, testEnv);
    expect(regRes.status).toBe(200);
    const regBody = await regRes.json() as any;
    const userId = regBody.id;

    // 2. Log in
    const loginReq = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "deluser", password: "Password123!" })
    });
    const loginRes = await appFetchWrapper(loginReq as any, testEnv);
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
    const projRes = await appFetchWrapper(projReq as any, testEnv);
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
    const connectRes = await stub.fetch(connectReq as any);
    expect(connectRes.status).toBe(101);
    const runnerWs = connectRes.webSocket!;
    runnerWs.accept();

    // Setup listener to track connection close
    const closePromise = new Promise<number>((resolve) => {
      runnerWs.addEventListener("close" as any, (evt) => {
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
    const delRes = await appFetchWrapper(delReq as any, testEnv);
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
    const projResForbidden = await appFetchWrapper(projReqForbidden as any, testEnv);
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
    const runnerResDeleted = await appFetchWrapper(runnerReqDeleted as any, testEnv);
    expect(runnerResDeleted.status).toBe(403);

    // 7. Cancel deletion
    const cancelReq = new Request("http://localhost/api/users/me/cancel-deletion", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` }
    });
    const cancelRes = await appFetchWrapper(cancelReq as any, testEnv);
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
    const delRes2 = await appFetchWrapper(delReq2 as any, testEnv);
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
    const regRes = await appFetchWrapper(regReq as any, testEnv);
    expect(regRes.status).toBe(200);

    const loginReq1 = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "Password123!" })
    });
    const loginRes1 = await appFetchWrapper(loginReq1 as any, testEnv);
    const { token } = await loginRes1.json() as any;

    const setupReq = new Request("http://localhost/api/auth/2fa/setup", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ password: "Password123!" })
    });
    const setupRes = await appFetchWrapper(setupReq as any, testEnv);
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
    const loginRes2 = await appFetchWrapper(loginReq2 as any, testEnv);
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
    const verifyRes1 = await appFetchWrapper(verifyReq1 as any, testEnv);
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
    const verifyRes2 = await appFetchWrapper(verifyReq2 as any, testEnv);
    expect(verifyRes2.status).toBe(200);

    const loginReq3 = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "Password123!" })
    });
    const loginRes3 = await appFetchWrapper(loginReq3 as any, testEnv);
    expect(loginRes3.status).toBe(200);
    const loginBody3 = await loginRes3.json() as any;
    expect(loginBody3.status).toBe("2fa_required");

    const loginReq4 = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "Password123!", two_factor_code: "111111" })
    });
    const loginRes4 = await appFetchWrapper(loginReq4 as any, testEnv);
    expect(loginRes4.status).toBe(401);

    const freshCode = await generateTOTP(setupBody.secret);
    const loginReq5 = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "Password123!", two_factor_code: freshCode })
    });
    const loginRes5 = await appFetchWrapper(loginReq5 as any, testEnv);
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
    const disableRes1 = await appFetchWrapper(disableReq1 as any, testEnv);
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
    const disableRes2 = await appFetchWrapper(disableReq2 as any, testEnv);
    expect(disableRes2.status).toBe(200);

    const loginReq6 = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "Password123!" })
    });
    const loginRes6 = await appFetchWrapper(loginReq6 as any, testEnv);
    expect(loginRes6.status).toBe(200);
    const loginBody6 = await loginRes6.json() as any;
    expect(loginBody6.status).toBe("ok");
  });

  it("can generate registration and authentication options for passkeys", async () => {
    const username = "pku" + Date.now().toString().slice(-6) + Math.floor(Math.random() * 100);
    const regReq = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "Password123!" })
    });
    const regRes = await appFetchWrapper(regReq as any, testEnv);
    expect(regRes.status).toBe(200);
    const regBody = await regRes.json() as any;
    const token = regBody.token;

    // 1. Generate Registration Options
    const genRegReq = new Request("http://localhost/api/auth/passkeys/register/generate-options", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` }
    });
    const genRegRes = await appFetchWrapper(genRegReq as any, testEnv);
    expect(genRegRes.status).toBe(200);
    const genRegBody = await genRegRes.json() as any;
    expect(genRegBody.rp.name).toBe("Swazz");
    expect(typeof genRegBody.challenge).toBe("string");

    // 2. Verify Registration Response (invalid body)
    const verRegReq = new Request("http://localhost/api/auth/passkeys/register/verify", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}` 
      },
      body: JSON.stringify({ id: "invalid", rawId: "invalid", response: { clientDataJSON: "invalid", attestationObject: "invalid" }, type: "public-key" })
    });
    const verRegRes = await appFetchWrapper(verRegReq as any, testEnv);
    expect(verRegRes.status).toBe(400); // Should fail validation

    // 3. Generate Login Options
    const genLogReq = new Request("http://localhost/api/auth/passkeys/login/generate-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username })
    });
    const genLogRes = await appFetchWrapper(genLogReq as any, testEnv);
    expect(genLogRes.status).toBe(404); // Fails because no passkeys registered yet for this user

    // 4. Verify Login Response (invalid)
    const verLogReq = new Request("http://localhost/api/auth/passkeys/login/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "invalid" })
    });
    const verLogRes = await appFetchWrapper(verLogReq as any, testEnv);
    expect(verLogRes.status).toBe(404); // Credential not found
  });
});

describe("Anonymous Limits", () => {
  let userToken: string;
  const testEnv = { ...env, /* as unknown as Env */ AUTH_ENABLED: 'false', JWT_SECRET: 'test-secret', TURNSTILE_SITE_KEY: undefined, TURNSTILE_SECRET: undefined };

  beforeAll(async () => {
    // Register and login to get a valid token
    const regReq = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "limituser", password: "Password123!" })
    });
    await appFetchWrapper(regReq as any, testEnv);

    const loginReq = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "limituser", password: "Password123!" })
    });
    const loginRes = await appFetchWrapper(loginReq as any, testEnv);
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
    const res1 = await appFetchWrapper(req1 as any, testEnv);
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
    const res2 = await appFetchWrapper(req2 as any, testEnv);
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
    const resCLI = await appFetchWrapper(reqCLI as any, testEnv);
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
    const resAuth = await appFetchWrapper(reqAuth as any, testEnv);
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
    const resAnonLarge = await appFetchWrapper(reqAnonLarge as any, testEnv);
    expect(resAnonLarge.status).toBe(403);
    const bodyAnonLarge = await resAnonLarge.json() as any;
    expect(bodyAnonLarge.error).toContain("Anonymous limit reached");

    // 2. Anonymous browser request with <=50 endpoints - should bypass limits check, proceed to dispatch, and return 201 queued
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
    const resAnonSmall = await appFetchWrapper(reqAnonSmall as any, testEnv);
    expect(resAnonSmall.status).toBe(201);
    const bodyAnonSmall = await resAnonSmall.json() as any;
    expect(bodyAnonSmall.status).toBe("queued");

    // 3. CLI client with >50 endpoints - should bypass limits check and return 201 queued
    const reqCLILarge = new Request("http://localhost/api/runs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Go-http-client/1.1",
        "CF-Connecting-IP": "9.9.9.9"
      },
      body: JSON.stringify({ config: largeConfig })
    });
    const resCLILarge = await appFetchWrapper(reqCLILarge as any, testEnv);
    expect(resCLILarge.status).toBe(201);
    const bodyCLILarge = await resCLILarge.json() as any;
    expect(bodyCLILarge.status).toBe("queued");

    // 4. Logged-in user with >50 endpoints - should bypass limits check and return 201 queued
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
    const resAuthLarge = await appFetchWrapper(reqAuthLarge as any, testEnv);
    expect(resAuthLarge.status).toBe(201);
    const bodyAuthLarge = await resAuthLarge.json() as any;
    expect(bodyAuthLarge.status).toBe("queued");
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
    await appFetchWrapper(regReq as any, testEnv);

    const loginReq = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "projuser", password: "Password123!" })
    });
    const loginRes = await appFetchWrapper(loginReq as any, testEnv);
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
    const createRes = await appFetchWrapper(createReq as any, testEnv);
    expect(createRes.status).toBe(200);
    const createBody = await createRes.json() as { id: string };
    projectId = createBody.id;
  });

  it("GET /api/projects returns the created project", async () => {
    const req = new Request("http://localhost/api/projects", {
      headers: { "Authorization": `Bearer ${userToken}` }
    });
    const res = await appFetchWrapper(req as any, testEnv);

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
    const res = await appFetchWrapper(req as any, testEnv);

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe("updated");

    // Verify change in DB
    const checkReq = new Request("http://localhost/api/projects", {
      headers: { "Authorization": `Bearer ${userToken}` }
    });
    const checkRes = await appFetchWrapper(checkReq as any, testEnv);
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
    const connectSharedRes = await stub.fetch(connectSharedReq as any);
    expect(connectSharedRes.status).toBe(101);
    const sharedWs = connectSharedRes.webSocket!;
    sharedWs.accept();

    // 2. Connect a private runner (with public_key)
    const keyPair = await crypto.subtle.generateKey(
      { name: "Ed25519" } as any,
      true,
      ["sign", "verify"]
    );
    const rawPubKey = await crypto.subtle.exportKey("raw", (keyPair as any).publicKey);
    const pubKeyHex = Array.from(new Uint8Array(rawPubKey))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const connectPrivateReq = new Request(`http://localhost/connect-runner?name=PrivateRunner1&public_key=${pubKeyHex}`, {
      headers: { "Upgrade": "websocket" }
    });
    const connectPrivateRes = await stub.fetch(connectPrivateReq as any);
    expect(connectPrivateRes.status).toBe(101);
    const privateWs = connectPrivateRes.webSocket!;
    privateWs.accept();

    // Challenge-response auth logic for private runner
    await new Promise<void>((resolve: any, reject: any) => {
      privateWs.addEventListener("message", async (evt) => {
        try {
          const msg = JSON.parse(evt.data as string);
          if (msg.type === "challenge") {
            const nonce = msg.nonce;
            const nonceBuffer = new TextEncoder().encode(nonce);
            const signatureBuffer = await crypto.subtle.sign(
              "Ed25519",
              (keyPair as any).privateKey,
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
    const res = await appFetchWrapper(req as any, testEnv);

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

  describe("GET /api/projects/:id/analytics", () => {
    it("returns correct project analytics data structure", async () => {
      await testEnv.DB.prepare(
        "INSERT INTO scans (id, project_id, target_url, profile, status, created_at, completed_at) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now', '+30 seconds'))"
      ).bind("scan-1", projectId, "http://target.com", "default", "completed").run();

      await testEnv.DB.prepare(
        "INSERT INTO findings (id, scan_id, rule_id, level, message) VALUES (?, ?, ?, ?, ?)"
      ).bind("finding-1", "scan-1", "swazz/xss", "High", "Reflected XSS").run();

      const res = await appFetchWrapper(new Request(`http://localhost/api/projects/${projectId}/analytics`, {
        headers: { "Authorization": `Bearer ${userToken}` }
      }), testEnv);
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.scanStats).toBeDefined();
      expect(data.scanStats.total).toBe(1);
      expect(data.scanStats.completed).toBe(1);
      expect(data.scanHistory.length).toBeGreaterThan(0);
      expect(data.findingsStats.length).toBe(1);
      expect(data.findingsStats[0].severity).toBe("High");
    });

    it("returns analytics grouped correctly based on period query param", async () => {
      const res = await appFetchWrapper(new Request(`http://localhost/api/projects/${projectId}/analytics?period=24h`, {
        headers: { "Authorization": `Bearer ${userToken}` }
      }), testEnv);
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.scanHistory).toBeDefined();
    });
  });

  it("DELETE /api/projects/:id removes the project", async () => {
    const req = new Request(`http://localhost/api/projects/${projectId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${userToken}` }
    });
    const res = await appFetchWrapper(req as any, testEnv);

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe("deleted");

    // Verify it is gone
    const checkReq = new Request("http://localhost/api/projects", {
      headers: { "Authorization": `Bearer ${userToken}` }
    });
    const checkRes = await appFetchWrapper(checkReq as any, testEnv);
    const checkBody = await checkRes.json() as { projects: any[] };
    const p = checkBody.projects.find(x => x.id === projectId);
    expect(p).toBeUndefined();
  });

  describe("POST /api/runners/:connectionId/restart", () => {
    it("returns 401 for unauthorized user", async () => {
      const req = new Request("http://localhost/api/runners/conn1/restart", {
        method: "POST"
      });
      const res = await appFetchWrapper(req as any, testEnv);
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
        const res = await appFetchWrapper(req as any, testEnv);
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
      const connectSharedRes = await stub.fetch(connectSharedReq as any);
      const sharedWs = connectSharedRes.webSocket!;
      sharedWs.accept();

      // Get connectionId
      const listReq = new Request("http://localhost/api/runners" as any, {
        headers: { "Authorization": `Bearer ${userToken}` }
      });
      const listRes = await appFetchWrapper(listReq as any, testEnv);
      const listBody = await listRes.json() as { runners: any[] };
      const sharedRunner = listBody.runners.find(r => r.name === 'SharedRunnerRestart');
      expect(sharedRunner).toBeDefined();
      expect(sharedRunner.connectionId).toBeDefined();

      // Attempt restart (user has no public key in database by default, and runner is shared anyway)
      const restartReq = new Request(`http://localhost/api/runners/${sharedRunner.connectionId}/restart`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${userToken}` }
      });
      const restartRes = await appFetchWrapper(restartReq as any, testEnv);
      expect(restartRes.status).toBe(403);
    });

    it("successfully restarts owned private runner and fails for non-owned", async () => {
      const id = env.COORDINATOR_DO.idFromName('global-coordinator');
      const stub = env.COORDINATOR_DO.get(id);

      // Fetch dynamic user ID for projuser
      const projUser = await env.DB.prepare("SELECT id FROM users WHERE username = ?")
        .bind("projuser")
        .first<{ id: string }>();
      const projUserId = projUser!.id;

      // 1. Register a public key for our test user
      const keyPair = await crypto.subtle.generateKey(
        { name: "Ed25519" },
        true,
        ["sign", "verify"]
      );
      const rawPubKey = await crypto.subtle.exportKey("raw", (keyPair as any).publicKey);
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
      const connectPrivateRes = await stub.fetch(connectPrivateReq as any);
      const privateWs = connectPrivateRes.webSocket!;
      privateWs.accept();

      // Authenticate runner
      await new Promise<void>((resolve: any, reject: any) => {
        privateWs.addEventListener("message", async (evt) => {
          try {
            const msg = JSON.parse(evt.data as string);
            if (msg.type === "challenge") {
              const nonce = msg.nonce;
              const nonceBuffer = new TextEncoder().encode(nonce);
              const signatureBuffer = await crypto.subtle.sign(
                "Ed25519",
                (keyPair as any).privateKey,
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
      const listRes = await appFetchWrapper(listReq as any, testEnv);
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
      const registerRes = await appFetchWrapper(registerReq as any, testEnv);
      expect(registerRes.status).toBe(200);

      const loginReq = new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "otheruserrestart", password: "Password123!" })
      });
      const loginRes = await appFetchWrapper(loginReq as any, testEnv);
      expect(loginRes.status).toBe(200);
      const loginBody = await loginRes.json() as { token: string };
      const otherToken = loginBody.token;

      const restartOtherReq = new Request(`http://localhost/api/runners/${privateRunner.connectionId}/restart`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${otherToken}` }
      });
      const restartOtherRes = await appFetchWrapper(restartOtherReq as any, testEnv);
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
      const restartOwnerRes = await appFetchWrapper(restartOwnerReq as any, testEnv);
      expect(restartOwnerRes.status).toBe(200);
      const restartBody = await restartOwnerRes.json() as { status: string };
      expect(restartBody.status).toBe("restarted");

      // Verify WebSocket message received by the agent client
      expect(restartMessageReceived).toBe(true);
    });
  });
});

describe("KV Session Cache", () => {
  const userToken = (() => {
    let token = '';
    return {
      get: () => token,
      set: (t: string) => { token = t; },
    };
  })();

  let testUserId: string;
  let testApiKey: string;

  // Helper: create a mock KV store
  function createMockKV() {
    const store = new Map<string, { value: string; expiration?: number }>();
    return {
      store,
      get: async (key: string) => {
        const entry = store.get(key);
        if (!entry) return null;
        if (entry.expiration && Date.now() / 1000 > entry.expiration) {
          store.delete(key);
          return null;
        }
        return entry.value;
      },
      put: async (key: string, value: string, opts?: { expirationTtl?: number }) => {
        const expiration = opts?.expirationTtl ? Date.now() / 1000 + opts.expirationTtl : undefined;
        store.set(key, { value, expiration });
      },
      delete: async (key: string) => {
        store.delete(key);
      },
    } as unknown as KVNamespace & { store: Map<string, { value: string; expiration?: number }> };
  }

  beforeAll(async () => {
    // Register a test user
    const regReq = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "kvtestuser", password: "TestPass123!" }),
    });
    const regRes = await appFetchWrapper(regReq as any, { ...env, /* as unknown as Env */ JWT_SECRET: 'test-secret', TURNSTILE_SITE_KEY: undefined, TURNSTILE_SECRET: undefined } as unknown as Env);
    const regBody = await regRes.json() as any;
    userToken.set(regBody.token);
    testUserId = regBody.id;

    // Get the user's API key via JWT-authed /api/auth/me
    const meReq = new Request("http://localhost/api/auth/me", {
      headers: { "Authorization": `Bearer ${regBody.token}` },
    });
    const meRes = await appFetchWrapper(meReq as any, { ...env, /* as unknown as Env */ JWT_SECRET: 'test-secret', TURNSTILE_SITE_KEY: undefined, TURNSTILE_SECRET: undefined } as unknown as Env);
    const meBody = await meRes.json() as any;
    testApiKey = meBody.api_key;
  });

  it("authenticates via API key and populates KV cache on first request", async () => {
    const mockKV = createMockKV();
    const kvEnv = { ...env, /* as unknown as Env */ JWT_SECRET: 'test-secret', TURNSTILE_SITE_KEY: undefined, TURNSTILE_SECRET: undefined, SESSION_CACHE: mockKV };

    // Use /api/projects which relies on getUserIdFromRequest middleware
    const req = new Request("http://localhost/api/projects", {
      headers: { "Authorization": `Bearer ${testApiKey}` },
    });
    const res = await appFetchWrapper(req as any, kvEnv);
    expect(res.status).toBe(200);

    // Verify KV was populated with the userId
    const cached = await mockKV.get(`apikey:${testApiKey}`);
    expect(cached).not.toBeNull();
    const parsed = JSON.parse(cached!);
    expect(parsed.userId).toBe(testUserId);
  });

  it("serves from KV cache on subsequent requests without querying D1 for api_key", async () => {
    const mockKV = createMockKV();
    const kvEnv = { ...env, /* as unknown as Env */ JWT_SECRET: 'test-secret', TURNSTILE_SITE_KEY: undefined, TURNSTILE_SECRET: undefined, SESSION_CACHE: mockKV };

    // Pre-populate the KV cache
    await mockKV.put(`apikey:${testApiKey}`, JSON.stringify({ userId: testUserId }), { expirationTtl: 300 });

    // Spy on DB.prepare to verify D1 is NOT called for the api_key lookup
    const originalPrepare = env.DB.prepare.bind(env.DB);
    let apiKeyQueryCalled = false;
    kvEnv.DB = {
      ...env.DB,
      prepare: (sql: string) => {
        if (sql.includes('WHERE api_key')) {
          apiKeyQueryCalled = true;
        }
        return originalPrepare(sql);
      },
    } as any;

    const req = new Request("http://localhost/api/projects", {
      headers: { "Authorization": `Bearer ${testApiKey}` },
    });
    const res = await appFetchWrapper(req as any, kvEnv);
    expect(res.status).toBe(200);

    // D1 should NOT have been queried for api_key (served from KV)
    expect(apiKeyQueryCalled).toBe(false);
  });

  it("negatively caches invalid API keys to prevent cache-miss storms", async () => {
    const mockKV = createMockKV();
    const kvEnv = { ...env, /* as unknown as Env */ JWT_SECRET: 'test-secret', TURNSTILE_SITE_KEY: undefined, TURNSTILE_SECRET: undefined, SESSION_CACHE: mockKV };

    const fakeKey = "swazz_live_invalidkey123456789";
    const req = new Request("http://localhost/api/projects", {
      headers: { "Authorization": `Bearer ${fakeKey}` },
    });
    const res = await appFetchWrapper(req as any, kvEnv);
    expect(res.status).toBe(401);

    // Verify negative cache entry was written
    const cached = await mockKV.get(`apikey:${fakeKey}`);
    expect(cached).not.toBeNull();
    const parsed = JSON.parse(cached!);
    expect(parsed.userId).toBeNull();
  });

  it("gracefully falls back to D1 when SESSION_CACHE is not bound", async () => {
    const noKvEnv = { ...env, /* as unknown as Env */ JWT_SECRET: 'test-secret', TURNSTILE_SITE_KEY: undefined, TURNSTILE_SECRET: undefined } as unknown as Env;
    const req = new Request("http://localhost/api/projects", {
      headers: { "Authorization": `Bearer ${testApiKey}` },
    });
    const res = await appFetchWrapper(req as any, noKvEnv);
    expect(res.status).toBe(200);
  });

  it("invalidates old KV cache entry when API key is regenerated", async () => {
    const mockKV = createMockKV();
    const kvEnv = { ...env, /* as unknown as Env */ JWT_SECRET: 'test-secret', TURNSTILE_SITE_KEY: undefined, TURNSTILE_SECRET: undefined, SESSION_CACHE: mockKV };

    // Pre-populate KV with the current API key
    await mockKV.put(`apikey:${testApiKey}`, JSON.stringify({ userId: testUserId }), { expirationTtl: 300 });
    expect(await mockKV.get(`apikey:${testApiKey}`)).not.toBeNull();

    // Regenerate the API key
    const regenReq = new Request("http://localhost/api/auth/regenerate-key", {
      method: "POST",
      headers: { "Authorization": `Bearer ${userToken.get()}` },
    });
    const regenRes = await appFetchWrapper(regenReq as any, kvEnv);
    expect(regenRes.status).toBe(200);
    const regenBody = await regenRes.json() as { api_key: string };

    // Old key should be invalidated from KV
    expect(await mockKV.get(`apikey:${testApiKey}`)).toBeNull();

    // New key should be proactively cached
    const newCached = await mockKV.get(`apikey:${regenBody.api_key}`);
    expect(newCached).not.toBeNull();
    const parsed = JSON.parse(newCached!);
    expect(parsed.userId).toBe(testUserId);

    testApiKey = regenBody.api_key;
  });

  it("cleanupScheduledDeletions invalidates deleted users' API keys from KV", async () => {
    const mockKV = createMockKV();
    const cleanupEnv = { ...env, /* as unknown as Env */ JWT_SECRET: 'test-secret', TURNSTILE_SITE_KEY: undefined, TURNSTILE_SECRET: undefined, SESSION_CACHE: mockKV };

    // Register a throwaway user for deletion
    const regReq = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "kvdeluser", password: "TestPass123!" }),
    });
    const regRes = await appFetchWrapper(regReq as any, cleanupEnv);
    const regBody = await regRes.json() as any;
    const delUserId = regBody.id;
    const delToken = regBody.token;

    // Get the user's API key
    const meReq = new Request("http://localhost/api/auth/me", {
      headers: { "Authorization": `Bearer ${delToken}` },
    });
    const meRes = await appFetchWrapper(meReq as any, cleanupEnv);
    const meBody = await meRes.json() as any;
    const delApiKey = meBody.api_key;

    // Pre-populate KV with this API key
    await mockKV.put(`apikey:${delApiKey}`, JSON.stringify({ userId: delUserId }), { expirationTtl: 300 });
    expect(await mockKV.get(`apikey:${delApiKey}`)).not.toBeNull();

    // Schedule deletion
    const delReq = new Request("http://localhost/api/users/me", {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${delToken}` },
    });
    await appFetchWrapper(delReq as any, cleanupEnv);

    // Age the deletion timestamp past the 7-day grace period
    await env.DB.prepare("UPDATE users SET delete_requested_at = datetime('now', '-8 days') WHERE id = ?").bind(delUserId).run();

    // Run the cleanup
    await cleanupScheduledDeletions(cleanupEnv);

    // Verify the API key was invalidated from KV
    expect(await mockKV.get(`apikey:${delApiKey}`)).toBeNull();

    // Verify the user was actually deleted from D1
    const userPost = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(delUserId).first();
    expect(userPost).toBeNull();
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
    const res = await appFetchWrapper(req as any, testEnv);
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
    const res = await appFetchWrapper(req as any, testEnv);
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
    const res = await appFetchWrapper(req as any, testEnv);
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
    const resTooShort = await appFetchWrapper(regReqTooShort as any, testEnv);
    expect(resTooShort.status).toBe(400);
    const bodyTooShort = await resTooShort.json() as any;
    expect(bodyTooShort.error).toContain("Password must be at least 12 characters long");

    // 2. Valid length (12 chars)
    const regReqStrong = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "stronguser", password: "Password123!" })
    });
    const resStrong = await appFetchWrapper(regReqStrong as any, testEnv);
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
    await appFetchWrapper(regReq as any, testEnv);

    // 1. Get challenge (step 1)
    const step1Req = new Request("http://localhost/api/auth/login/step1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username })
    });
    const step1Res = await appFetchWrapper(step1Req as any, testEnv);
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
    const step2Res = await appFetchWrapper(step2Req as any, testEnv);
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
      const res = await appFetchWrapper(req as any, testEnv);
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
      const res = await appFetchWrapper(req as any, testEnv);
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
      const res = await appFetchWrapper(req as any, testEnv);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/json");
      const bodyJson = await res.json() as { service: string; status: string };
      expect(bodyJson.service).toBe("swazz-edge");
      expect(bodyJson.status).toBe("ok");
    });
  });

  describe("Cloudflare Queues Integration", () => {
    it("verifies scan_events migration and DB inserting", async () => {
      const eventId = "test-event-id";
      const scanId = "test-scan-id";
      const type = "event";
      const payload = JSON.stringify({ type: "progress", message: "Fuzzing endpoint..." });

      await env.DB.prepare(
        `INSERT INTO scan_events (id, scan_id, type, payload) VALUES (?, ?, ?, ?)`
      )
        .bind(eventId, scanId, type, payload)
        .run();

      const row = await env.DB.prepare("SELECT * FROM scan_events WHERE id = ?").bind(eventId).first<any>();
      expect(row).toBeDefined();
      expect(row.scan_id).toBe(scanId);
      expect(row.type).toBe(type);
      expect(row.payload).toBe(payload);
    });

    it("processes FINDINGS_QUEUE messages correctly in bulk", async () => {
      const scanId = "findings-scan-id";
      const mockMessages = [
        {
          body: { scanId, type: "event", payload: { type: "progress", progress: 50 } },
          ack: vi.fn(),
        },
        {
          body: { scanId, type: "error", payload: "Fuzzer connection failed" },
          ack: vi.fn(),
        }
      ];

      const batch = {
        queue: "swazz-findings-queue",
        messages: mockMessages,
      } as any;

      await app.queue(batch, testEnv as any, {} as any);

      expect(mockMessages[0].ack).toHaveBeenCalled();
      expect(mockMessages[1].ack).toHaveBeenCalled();

      const { results } = await env.DB.prepare("SELECT * FROM scan_events WHERE scan_id = ?").bind(scanId).all<any>();
      expect(results.length).toBe(2);
      expect(results[0].type).toBe("event");
      expect(results[1].type).toBe("error");
    });

    it("extracts findings from result events and populates findings table in D1", async () => {
      const scanId = "findings-scan-id-result";
      await env.DB.prepare(
        "INSERT INTO scans (id, project_id, target_url, profile, status) VALUES (?, ?, ?, ?, ?)"
      ).bind(scanId, "proj-findings-1", "http://test.com", "default", "dispatched").run();

      const mockMessages = [
        {
          body: {
            scanId,
            type: "event",
            payload: {
              type: "result",
              data: {
                id: "req-1",
                endpoint: "/status",
                method: "GET",
                status: 200,
                analyzerFindings: [
                  {
                    ruleId: "swazz/sensitive-data-leak",
                    level: "warning",
                    message: "Sensitive data leaked.",
                    evidence: "192.168.1.15"
                  }
                ]
              }
            }
          },
          ack: vi.fn(),
        }
      ];

      const batch = {
        queue: "swazz-findings-queue",
        messages: mockMessages,
      } as any;

      await app.queue(batch, testEnv as any, {} as any);

      expect(mockMessages[0].ack).toHaveBeenCalled();

      const scanEvents = await env.DB.prepare("SELECT * FROM scan_events WHERE scan_id = ?").bind(scanId).all<any>();
      expect(scanEvents.results.length).toBe(1);

      const findings = await env.DB.prepare("SELECT * FROM findings WHERE scan_id = ?").bind(scanId).all<any>();
      expect(findings.results.length).toBe(1);
      expect(findings.results[0].rule_id).toBe("swazz/sensitive-data-leak");
      expect(findings.results[0].level).toBe("warning");
    });

    it("handles SCAN_QUEUE flow and updates D1 status to dispatched or keeps queued", async () => {
      const scanId = "scan-queue-id";

      await env.DB.prepare(
        "INSERT INTO scans (id, project_id, target_url, profile, status) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(scanId, "test-project", "http://test-url.com", "default", "queued")
        .run();

      const mockMessages = [
        {
          body: {
            runId: scanId,
            config: { base_url: "http://test-url.com" },
            userPublicKey: "",
            targetUrl: "http://test-url.com",
            profile: "default",
            projectId: "test-project",
            userId: null
          },
          ack: vi.fn(),
        }
      ];

      const batch = {
        queue: "swazz-scan-queue",
        messages: mockMessages,
      } as any;

      await app.queue(batch, testEnv as any, {} as any);

      expect(mockMessages[0].ack).toHaveBeenCalled();

      const scanRow = await env.DB.prepare("SELECT status FROM scans WHERE id = ?").bind(scanId).first<any>();
      expect(["queued", "dispatched"]).toContain(scanRow?.status);
    });

    describe("checkAndDispatchQueuedScans Coordinator Logic", () => {
      beforeEach(async () => {
        await env.DB.prepare("UPDATE scans SET status = 'dispatched' WHERE status = 'queued'").run();
      });

      it("dispatches queued public scans to shared runner on connection", async () => {
        const scanId = "qscan-" + crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO scans (id, project_id, target_url, profile, status) VALUES (?, ?, ?, ?, ?)"
        )
          .bind(scanId, "proj-shared-1", "http://target1.com", "default", "queued")
          .run();

        const id = env.COORDINATOR_DO.idFromName('global-coordinator');
        const stub = env.COORDINATOR_DO.get(id);

        const connectReq = new Request("http://localhost/connect-runner?name=QueueRunnerShared", {
          headers: { "Upgrade": "websocket" }
        });
        const connectRes = await stub.fetch(connectReq as any);
        expect(connectRes.status).toBe(101);
        const ws = connectRes.webSocket!;
        ws.accept();

        const dispatchMsg = await new Promise<any>((resolve: any, reject: any) => {
          const timeout = setTimeout(() => reject(new Error("Timeout waiting for dispatch")), 2000);
          ws.addEventListener("message", (evt) => {
            const msg = JSON.parse(evt.data as string);
            if (msg.type === "job_dispatch") {
              clearTimeout(timeout);
              resolve(msg);
            }
          });
        });

        expect(dispatchMsg.payload.runId).toBe(scanId);
        
        const scanRow = await env.DB.prepare("SELECT status FROM scans WHERE id = ?").bind(scanId).first<any>();
        expect(scanRow?.status).toBe("dispatched");

        ws.close();
      });

      it("does not dispatch private scans to shared runner", async () => {
        const scanId = "qscan-" + crypto.randomUUID();
        const testUsername = "u" + Date.now().toString().slice(-6) + "_" + Math.floor(Math.random() * 1000);
        const userId = crypto.randomUUID();
        const userPubKey = "pubkey-" + crypto.randomUUID();

        await env.DB.prepare(
          "INSERT INTO users (id, username, password_hash, public_key) VALUES (?, ?, ?, ?)"
        ).bind(userId, testUsername, "hashed", userPubKey).run();

        await env.DB.prepare(
          "INSERT INTO scans (id, project_id, target_url, profile, status, user_id) VALUES (?, ?, ?, ?, ?, ?)"
        )
          .bind(scanId, "proj-private-1", "http://target2.com", "default", "queued", userId)
          .run();

        const id = env.COORDINATOR_DO.idFromName('global-coordinator');
        const stub = env.COORDINATOR_DO.get(id);

        const connectReq = new Request("http://localhost/connect-runner?name=QueueRunnerSharedPrivateCheck", {
          headers: { "Upgrade": "websocket" }
        });
        const connectRes = await stub.fetch(connectReq as any);
        expect(connectRes.status).toBe(101);
        const ws = connectRes.webSocket!;
        ws.accept();

        // Wait a bit to ensure it is NOT dispatched
        await new Promise((resolve) => setTimeout(resolve as any, 300));

        const scanRow = await env.DB.prepare("SELECT status FROM scans WHERE id = ?").bind(scanId).first<any>();
        expect(scanRow?.status).toBe("queued");

        ws.close();
      });

      it("does not dispatch public scans with disable_shared_runners setting to shared runner", async () => {
        const scanId = "qscan-" + crypto.randomUUID();
        const projectId = "proj-disabled-shared";
        const profileName = "high-security";

        await env.DB.prepare(
          "INSERT INTO scans (id, project_id, target_url, profile, status) VALUES (?, ?, ?, ?, ?)"
        )
          .bind(scanId, projectId, "http://target3.com", profileName, "queued")
          .run();

        await env.DB.prepare(
          "INSERT INTO scan_configs (project_id, name, config_json) VALUES (?, ?, ?)"
        ).bind(projectId, profileName, JSON.stringify({ settings: { disable_shared_runners: true } })).run();

        const id = env.COORDINATOR_DO.idFromName('global-coordinator');
        const stub = env.COORDINATOR_DO.get(id);

        const connectReq = new Request("http://localhost/connect-runner?name=QueueRunnerSharedDisabledCheck", {
          headers: { "Upgrade": "websocket" }
        });
        const connectRes = await stub.fetch(connectReq as any);
        expect(connectRes.status).toBe(101);
        const ws = connectRes.webSocket!;
        ws.accept();

        // Wait a bit to ensure it is NOT dispatched
        await new Promise((resolve) => setTimeout(resolve as any, 300));

        const scanRow = await env.DB.prepare("SELECT status FROM scans WHERE id = ?").bind(scanId).first<any>();
        expect(scanRow?.status).toBe("queued");

        ws.close();
      });

      it("dispatches private scans to matching private runner", async () => {
        const scanId = "qscan-" + crypto.randomUUID();
        const testUsername = "u" + Date.now().toString().slice(-6) + "_" + Math.floor(Math.random() * 1000);
        const userId = crypto.randomUUID();

        const keyPair = await crypto.subtle.generateKey(
          { name: "Ed25519" },
          true,
          ["sign", "verify"]
        );
        const rawPubKey = await crypto.subtle.exportKey("raw", (keyPair as any).publicKey);
        const pubKeyHex = Array.from(new Uint8Array(rawPubKey))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');

        await env.DB.prepare(
          "INSERT INTO users (id, username, password_hash, public_key) VALUES (?, ?, ?, ?)"
        ).bind(userId, testUsername, "hashed", pubKeyHex).run();

        await env.DB.prepare(
          "INSERT INTO scans (id, project_id, target_url, profile, status, user_id) VALUES (?, ?, ?, ?, ?, ?)"
        )
          .bind(scanId, "proj-private-2", "http://target4.com", "default", "queued", userId)
          .run();

        const id = env.COORDINATOR_DO.idFromName('global-coordinator');
        const stub = env.COORDINATOR_DO.get(id);

        const connectReq = new Request(`http://localhost/connect-runner?name=QueueRunnerPrivate&public_key=${pubKeyHex}`, {
          headers: { "Upgrade": "websocket" }
        });
        const connectRes = await stub.fetch(connectReq as any);
        expect(connectRes.status).toBe(101);
        const ws = connectRes.webSocket!;
        ws.accept();

        // Challenge-response auth logic for private runner
        await new Promise<void>((resolve: any, reject: any) => {
          ws.addEventListener("message", async (evt) => {
            try {
              const msg = JSON.parse(evt.data as string);
              if (msg.type === "challenge") {
                const nonce = msg.nonce;
                const nonceBuffer = new TextEncoder().encode(nonce);
                const signatureBuffer = await crypto.subtle.sign(
                  "Ed25519",
                  (keyPair as any).privateKey,
                  nonceBuffer
                );
                const signatureHex = Array.from(new Uint8Array(signatureBuffer))
                  .map(b => b.toString(16).padStart(2, '0'))
                  .join('');
                ws.send(JSON.stringify({
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

        const dispatchMsg = await new Promise<any>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timeout waiting for dispatch")), 2000);
          ws.addEventListener("message", (evt) => {
            const msg = JSON.parse(evt.data as string);
            if (msg.type === "job_dispatch") {
              clearTimeout(timeout);
              resolve(msg);
            }
          });
        });

        expect(dispatchMsg.payload.runId).toBe(scanId);

        const scanRow = await env.DB.prepare("SELECT status FROM scans WHERE id = ?").bind(scanId).first<any>();
        expect(scanRow?.status).toBe("dispatched");

        ws.close();
      });
    });
  });

  describe("RBAC & Invitations Security & Validation", () => {
    let tokenOwner: string;
    let tokenInvitee: string;
    let inviteeUsername: string;
    let tokenOutsider: string;
    let projectId: string;

    beforeAll(async () => {
      // 1. Register/Login Owner (userA)
      const nameA = "u_owner_" + Date.now().toString().slice(-4);
      await appFetchWrapper(new Request("http://localhost/api/auth/register" as any, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: nameA, password: "Password123!" })
      }), testEnv);
      const resA = await appFetchWrapper(new Request("http://localhost/api/auth/login" as any, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: nameA, password: "Password123!" })
      }), testEnv);
      tokenOwner = ((await resA.json()) as any).token;

      // 2. Register/Login Invitee (userB)
      const nameB = "u_invitee_" + Date.now().toString().slice(-4);
      inviteeUsername = nameB;
      await appFetchWrapper(new Request("http://localhost/api/auth/register" as any, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: nameB, password: "Password123!" })
      }), testEnv);
      const resB = await appFetchWrapper(new Request("http://localhost/api/auth/login" as any, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: nameB, password: "Password123!" })
      }), testEnv);
      tokenInvitee = ((await resB.json()) as any).token;

      // 3. Register/Login Outsider (userC)
      const nameC = "u_outsider_" + Date.now().toString().slice(-4);
      await appFetchWrapper(new Request("http://localhost/api/auth/register" as any, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: nameC, password: "Password123!" })
      }), testEnv);
      const resC = await appFetchWrapper(new Request("http://localhost/api/auth/login" as any, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: nameC, password: "Password123!" })
      }), testEnv);
      tokenOutsider = ((await resC.json()) as any).token;

      // 4. Create a project under Owner
      const projRes = await appFetchWrapper(new Request("http://localhost/api/projects" as any, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${tokenOwner}`
        },
        body: JSON.stringify({ name: "RBAC Project" })
      }), testEnv);
      projectId = ((await projRes.json()) as any).id;
    });

    describe("Role Creation Validation & Edge Cases", () => {
      it("fails to create role with empty or whitespace-only name", async () => {
        const res = await appFetchWrapper(new Request(`http://localhost/api/projects/${projectId}/roles` as any, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${tokenOwner}`
          },
          body: JSON.stringify({ name: "   ", permissions: ["get:/api/projects/:id"] })
        }), testEnv);
        expect(res.status).toBe(400);
        expect(((await res.json()) as any).error).toContain("Role name is required");
      });

      it("fails to create role with unknown permissions", async () => {
        const res = await appFetchWrapper(new Request(`http://localhost/api/projects/${projectId}/roles` as any, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${tokenOwner}`
          },
          body: JSON.stringify({ name: "Auditor", permissions: ["invalid-perm-key"] })
        }), testEnv);
        expect(res.status).toBe(400);
        expect(((await res.json()) as any).error).toContain("Unknown permission keys");
      });

      it("fails to create role inheriting unknown role IDs", async () => {
        const res = await appFetchWrapper(new Request(`http://localhost/api/projects/${projectId}/roles` as any, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${tokenOwner}`
          },
          body: JSON.stringify({ name: "Auditor", included_roles: ["non-existent-role-id"] })
        }), testEnv);
        expect(res.status).toBe(400);
        expect(((await res.json()) as any).error).toContain("Unknown role IDs");
      });

      it("successfully creates custom role and rejects duplicate name", async () => {
        // Create first time
        const res1 = await appFetchWrapper(new Request(`http://localhost/api/projects/${projectId}/roles` as any, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${tokenOwner}`
          },
          body: JSON.stringify({ name: "Custom Auditor", permissions: ["get:/api/projects/:id"] })
        }), testEnv);
        expect(res1.status).toBe(200);

        // Try duplicate creation (exact name)
        const res2 = await appFetchWrapper(new Request(`http://localhost/api/projects/${projectId}/roles` as any, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${tokenOwner}`
          },
          body: JSON.stringify({ name: "Custom Auditor", permissions: ["get:/api/projects/:id"] })
        }), testEnv);
        expect(res2.status).toBe(400);
        expect(((await res2.json()) as any).error).toContain("already exists");

        // Try duplicate creation (trailing/leading whitespace)
        const res3 = await appFetchWrapper(new Request(`http://localhost/api/projects/${projectId}/roles` as any, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${tokenOwner}`
          },
          body: JSON.stringify({ name: "  Custom Auditor  ", permissions: ["get:/api/projects/:id"] })
        }), testEnv);
        expect(res3.status).toBe(400);
        expect(((await res3.json()) as any).error).toContain("already exists");
      });
    });

    describe("Access Restrictions (requirePermission)", () => {
      it("restricts GET /permissions to authenticated project members", async () => {
        // 1. Owner succeeds
        const resOwner = await appFetchWrapper(new Request(`http://localhost/api/projects/${projectId}/permissions` as any, {
          headers: { "Authorization": `Bearer ${tokenOwner}` }
        }), testEnv);
        expect(resOwner.status).toBe(200);

        // 2. Outsider fails (403 Forbidden)
        const resOutsider = await appFetchWrapper(new Request(`http://localhost/api/projects/${projectId}/permissions` as any, {
          headers: { "Authorization": `Bearer ${tokenOutsider}` }
        }), testEnv);
        expect(resOutsider.status).toBe(403);
      });

      it("restricts POST /invitations to authorized roles", async () => {
        // Outsider fails (403 Forbidden)
        const res = await appFetchWrapper(new Request(`http://localhost/api/projects/${projectId}/invitations` as any, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${tokenOutsider}`
          },
          body: JSON.stringify({ username: "someuser", roles: ["viewer"] })
        }), testEnv);
        expect(res.status).toBe(403);

        // Register/Login Editor (userD)
        const nameD = "u_editor_" + Date.now().toString().slice(-4);
        const resRegD = await appFetchWrapper(new Request("http://localhost/api/auth/register" as any, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: nameD, password: "Password123!" })
        }), testEnv);
        const regData = (await resRegD.json()) as any;
        const editorUserId = regData.id;

        const resD = await appFetchWrapper(new Request("http://localhost/api/auth/login" as any, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: nameD, password: "Password123!" })
        }), testEnv);
        const editorData = (await resD.json()) as any;
        const tokenEditor = editorData.token;

        // Assign 'editor' role to userD in the database
        await testEnv.DB.prepare("INSERT INTO project_member_roles (project_id, user_id, role_id) VALUES (?, ?, ?)")
          .bind(projectId, editorUserId, "editor").run();

        // Editor succeeds (200 OK)
        const resEditor = await appFetchWrapper(new Request(`http://localhost/api/projects/${projectId}/invitations` as any, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${tokenEditor}`
          },
          body: JSON.stringify({ username: "someotheruser", roles: ["viewer"] })
        }), testEnv);
        expect(resEditor.status).toBe(200);
      });
    });

    describe("Invitation System Security & Flow", () => {
      it("fails to invite with empty roles array", async () => {
        const res = await appFetchWrapper(new Request(`http://localhost/api/projects/${projectId}/invitations` as any, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${tokenOwner}`
          },
          body: JSON.stringify({ username: "someuser", roles: [] })
        }), testEnv);
        expect(res.status).toBe(400);
        expect(((await res.json()) as any).error).toContain("At least one role must be specified");
      });

      it("prevents acceptance of expired invitations", async () => {
        // Insert an expired invitation directly in DB
        const expiredToken = "expired-token-" + crypto.randomUUID();
        const expiresAt = new Date(Date.now() - 3600 * 1000).toISOString(); // 1 hour ago
        await testEnv.DB.prepare(`
          INSERT INTO project_invitations (id, project_id, email, username, target_role_ids, status, token, expires_at)
          VALUES (?, ?, NULL, ?, ?, 'Pending', ?, ?)
        `).bind(crypto.randomUUID(), projectId, inviteeUsername, JSON.stringify(["viewer"]), expiredToken, expiresAt).run();

        const acceptRes = await appFetchWrapper(new Request("http://localhost/api/auth/invitations/accept" as any, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${tokenInvitee}`
          },
          body: JSON.stringify({ token: expiredToken })
        }), testEnv);
        expect(acceptRes.status).toBe(400);
        expect(((await acceptRes.json()) as any).error).toContain("Invalid or expired invitation");
      });

      it("prevents user mismatch when username/email is targeted", async () => {
        // Create invitation targeted to "specific_user"
        const targetToken = "target-token-" + crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
        await testEnv.DB.prepare(`
          INSERT INTO project_invitations (id, project_id, email, username, target_role_ids, status, token, expires_at)
          VALUES (?, ?, NULL, 'specific_user', ?, 'Pending', ?, ?)
        `).bind(crypto.randomUUID(), projectId, JSON.stringify(["viewer"]), targetToken, expiresAt).run();

        // Attempt to accept using tokenInvitee (who is NOT "specific_user")
        const acceptRes = await appFetchWrapper(new Request("http://localhost/api/auth/invitations/accept" as any, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${tokenInvitee}`
          },
          body: JSON.stringify({ token: targetToken })
        }), testEnv);

        expect(acceptRes.status).toBe(403);
        expect(((await acceptRes.json()) as any).error).toContain("Invitation is for a different username");

        // Verify the invitation status rolled back to 'Pending'
        const row = await testEnv.DB.prepare("SELECT status FROM project_invitations WHERE token = ?").bind(targetToken).first<any>();
        expect(row?.status).toBe("Pending");
      });

      it("allows declining a pending invitation", async () => {
        const declineToken = "decline-token-" + crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
        await testEnv.DB.prepare(`
          INSERT INTO project_invitations (id, project_id, email, username, target_role_ids, status, token, expires_at)
          VALUES (?, ?, NULL, ?, ?, 'Pending', ?, ?)
        `).bind(crypto.randomUUID(), projectId, inviteeUsername, JSON.stringify(["viewer"]), declineToken, expiresAt).run();

        const declineRes = await appFetchWrapper(new Request("http://localhost/api/auth/invitations/decline" as any, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${tokenInvitee}`
          },
          body: JSON.stringify({ token: declineToken })
        }), testEnv);

        expect(declineRes.status).toBe(200);
        expect(((await declineRes.json()) as any).status).toBe("declined");

        const row = await testEnv.DB.prepare("SELECT status FROM project_invitations WHERE token = ?").bind(declineToken).first<any>();
        expect(row?.status).toBe("Revoked");
      });

      it("fails to invite when both email and username are missing", async () => {
        const res = await appFetchWrapper(new Request(`http://localhost/api/projects/${projectId}/invitations` as any, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${tokenOwner}`
          },
          body: JSON.stringify({ roles: ["viewer"] })
        }), testEnv);
        expect(res.status).toBe(400);
        expect(((await res.json()) as any).error).toContain("Either email or username must be specified");
      });
    });

    describe("User Billing Plans & Admin Endpoint Management", () => {
      it("supports user billing plans and admin plan management", async () => {
        // Test registration includes default plan 'Free'
        const regUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
        const regRes = await appFetchWrapper(new Request("http://localhost/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: regUsername,
            password: "SecurePassword123!",
            email: `${regUsername}@example.com`
          })
        }), testEnv);
        expect(regRes.status).toBe(200);
        const regBody = await regRes.json() as any;
        expect(regBody.token).toBeDefined();

        // Get user profile and verify plan is 'Free'
        const profileRes = await appFetchWrapper(new Request("http://localhost/api/auth/me", {
          headers: { "Authorization": `Bearer ${regBody.token}` }
        }), testEnv);
        expect(profileRes.status).toBe(200);
        const profileBody = await profileRes.json() as any;
        expect(profileBody.plan).toBe("Free");

        // Attempt plan upgrade with invalid secret
        const upgradeResFail = await appFetchWrapper(new Request("http://localhost/api/admin/users/plan", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Admin-Secret": "wrong-secret"
          },
          body: JSON.stringify({ username: regUsername, plan: "Supporter Plan" })
        }), testEnv);
        expect(upgradeResFail.status).toBe(401);

        // Attempt plan upgrade with valid secret
        const upgradeResSuccess = await appFetchWrapper(new Request("http://localhost/api/admin/users/plan", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Admin-Secret": "admin-secret"
          },
          body: JSON.stringify({ username: regUsername, plan: "Supporter Plan" })
        }), testEnv);
        expect(upgradeResSuccess.status).toBe(200);
        const upgradeBody = await upgradeResSuccess.json() as any;
        expect(upgradeBody.status).toBe("ok");
        expect(upgradeBody.plan).toBe("Supporter Plan");

        // Verify updated plan in user profile
        const updatedProfileRes = await appFetchWrapper(new Request("http://localhost/api/auth/me", {
          headers: { "Authorization": `Bearer ${regBody.token}` }
        }), testEnv);
        expect(updatedProfileRes.status).toBe(200);
        const updatedProfileBody = await updatedProfileRes.json() as any;
        expect(updatedProfileBody.plan).toBe("Supporter Plan");
      });
    });

    describe("Findings Authorization (BOLA/IDOR Prevention)", () => {
      let projectId: string;
      let scanId: string;
      let findingId: string;
      let tokenOwner: string;
      let tokenGuest: string;

      beforeAll(async () => {
        projectId = crypto.randomUUID();
        scanId = crypto.randomUUID();
        findingId = crypto.randomUUID();

        // 1. Create project owner
        const ownerUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
        const regOwnerRes = await appFetchWrapper(new Request("http://localhost/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: ownerUsername,
            password: "SecurePassword123!",
            email: `${ownerUsername}@example.com`
          })
        }), testEnv);
        expect(regOwnerRes.status).toBe(200);
        tokenOwner = ((await regOwnerRes.json()) as any).token;

        // 2. Create another user (guest who shouldn't have access to owner's project)
        const guestUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
        const regGuestRes = await appFetchWrapper(new Request("http://localhost/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: guestUsername,
            password: "SecurePassword123!",
            email: `${guestUsername}@example.com`
          })
        }), testEnv);
        expect(regGuestRes.status).toBe(200);
        tokenGuest = ((await regGuestRes.json()) as any).token;

        // 3. Directly inject scan and finding linked to the owner's project in D1
        const ownerRow = await testEnv.DB.prepare("SELECT id FROM users WHERE username = ?").bind(ownerUsername).first<{ id: string }>();
        const userIdOwner = ownerRow!.id;
        await testEnv.DB.batch([
          testEnv.DB.prepare("INSERT INTO projects (id, name, description) VALUES (?, 'Owner Project', 'Private Project')").bind(projectId),
          testEnv.DB.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')").bind(projectId, userIdOwner),
          testEnv.DB.prepare("INSERT INTO scans (id, project_id, target_url, profile, status) VALUES (?, ?, 'http://example.com', 'default', 'completed')").bind(scanId, projectId),
          testEnv.DB.prepare("INSERT INTO findings (id, scan_id, rule_id, level, message, evidence) VALUES (?, ?, 'swazz/bola-idor', 'High', 'Vulnerability', 'evidence')").bind(findingId, scanId)
        ]);
      });

      it("allows project members to view a finding", async () => {
        const res = await appFetchWrapper(new Request(`http://localhost/api/findings/${findingId}`, {
          headers: { "Authorization": `Bearer ${tokenOwner}` }
        }), testEnv);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.finding.id).toBe(findingId);
      });

      it("rejects unauthorized users from viewing a finding", async () => {
        const res = await appFetchWrapper(new Request(`http://localhost/api/findings/${findingId}`, {
          headers: { "Authorization": `Bearer ${tokenGuest}` }
        }), testEnv);
        expect(res.status).toBe(403);
      });

      it("allows authorized project members to update a finding", async () => {
        const res = await appFetchWrapper(new Request(`http://localhost/api/findings/${findingId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${tokenOwner}`
          },
          body: JSON.stringify({ ai_status: "triaged", ai_relevance: "True Positive" })
        }), testEnv);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.finding.ai_status).toBe("triaged");
        expect(body.finding.ai_relevance).toBe("True Positive");
      });

      it("rejects unauthorized users from updating a finding", async () => {
        const res = await appFetchWrapper(new Request(`http://localhost/api/findings/${findingId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${tokenGuest}`
          },
          body: JSON.stringify({ ai_status: "triaged" })
        }), testEnv);
        expect(res.status).toBe(403);
      });
    });
  });

  describe("Project Custom Session Expiration", () => {
    let projectId: string;
    let userId: string;
    let expiredToken: string;
    let validToken: string;

    beforeAll(async () => {
      projectId = ulid();
      userId = ulid();
      
      // Insert user, project with 1 second session timeout, and membership
      await testEnv.DB.batch([
        testEnv.DB.prepare("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)").bind(userId, "timeoutuser", "hash"),
        testEnv.DB.prepare("INSERT INTO projects (id, name, description, member_session_timeout) VALUES (?, ?, ?, ?)")
          .bind(projectId, "Timeout Project", "Desc", 1), // 1 second timeout
        testEnv.DB.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')").bind(projectId, userId),
        testEnv.DB.prepare("INSERT INTO project_member_roles (project_id, user_id, role_id) VALUES (?, ?, 'owner')").bind(projectId, userId)
      ]);

      // Sign expired token (iat: current time - 5 seconds, exp: far future)
      const expiredPayload = {
        sub: userId,
        iat: Math.floor(Date.now() / 1000) - 5,
        exp: Math.floor(Date.now() / 1000) + 3600
      };
      expiredToken = await sign(expiredPayload, 'test-secret');

      // Sign valid token (iat: current time, exp: far future)
      const validPayload = {
        sub: userId,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      };
      validToken = await sign(validPayload, 'test-secret');
    });

    it("allows request to project-scoped endpoints with a valid active session", async () => {
      const res = await appFetchWrapper(new Request(`http://localhost/api/projects/${projectId}/config`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${validToken}`
        }
      }), testEnv);
      expect(res.status).not.toBe(401);
    });

    it("rejects request to project-scoped endpoints if session age exceeds member_session_timeout", async () => {
      const res = await appFetchWrapper(new Request(`http://localhost/api/projects/${projectId}/config`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${expiredToken}`
        }
      }), testEnv);
      expect(res.status).toBe(401);
      const body = await res.json() as any;
      expect(body.error).toContain("Session expired");
    });
  });

  describe("RBAC Guest user write restrictions", () => {
    let guestToken: string;
    let projectId: string;

    beforeEach(async () => {
      projectId = "p_" + ulid();
      const guestUserId = "user-guest-" + ulid();
      const guestUsername = "guest_" + ulid().toLowerCase();
      // Insert guest user
      await testEnv.DB.batch([
        testEnv.DB.prepare("INSERT INTO users (id, username, password_hash, is_guest) VALUES (?, ?, 'hash', 1)").bind(guestUserId, guestUsername),
        testEnv.DB.prepare("INSERT INTO projects (id, name, description) VALUES (?, 'Guest Proj', '')").bind(projectId),
        testEnv.DB.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')").bind(projectId, guestUserId)
      ]);

      const payload = {
        sub: guestUserId,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      };
      guestToken = await sign(payload, 'test-secret');
    });

    it("rejects guest user attempting to create custom roles", async () => {
      const res = await appFetchWrapper(new Request(`http://localhost/api/projects/${projectId}/roles`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${guestToken}`
        },
        body: JSON.stringify({ name: "Custom Auditor", permissions: ["get:/api/projects/:id"] })
      }), testEnv);
      expect(res.status).toBe(403);
      expect(((await res.json()) as any).error).toContain("Guest accounts cannot modify members or roles");
    });

    it("rejects guest user attempting to invite members", async () => {
      const res = await appFetchWrapper(new Request(`http://localhost/api/projects/${projectId}/invitations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${guestToken}`
        },
        body: JSON.stringify({ email: "test@example.com", roles: ["viewer"] })
      }), testEnv);
      expect(res.status).toBe(403);
      expect(((await res.json()) as any).error).toContain("Guest accounts cannot modify members or roles");
    });

    it("rejects guest user attempting to modify member roles", async () => {
      const res = await appFetchWrapper(new Request(`http://localhost/api/projects/${projectId}/members/some-user`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${guestToken}`
        },
        body: JSON.stringify({ roles: ["editor"] })
      }), testEnv);
      expect(res.status).toBe(403);
      expect(((await res.json()) as any).error).toContain("Guest accounts cannot modify members or roles");
    });
  });

  describe("Admin Logs API", () => {
    function createMockKV() {
      const store = new Map<string, string>();
      return {
        get: async (key: string) => store.get(key) || null,
        put: async (key: string, value: string) => { store.set(key, value); }
      };
    }

    it("should reject unauthorized requests to /api/admin/logs", async () => {
      const req = new Request("http://localhost/api/admin/logs");
      const res = await appFetchWrapper(req, testEnv);
      expect(res.status).toBe(401);
    });

    it("should return logs when valid admin secret is provided", async () => {
      const mockKV = createMockKV();
      const mockLogs = [{ timestamp: new Date().toISOString(), level: 'info', module: 'test', msg: 'hello' }];
      await mockKV.put('admin:logs', JSON.stringify(mockLogs));

      const customEnv = {
        ...testEnv,
        SESSION_CACHE: mockKV as any
      };

      const req = new Request("http://localhost/api/admin/logs", {
        headers: { 'Authorization': `Bearer admin-secret` }
      });
      const res = await appFetchWrapper(req, customEnv);
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.length).toBe(1);
      expect(data[0].msg).toBe('hello');
    });

    it("should return empty list if SESSION_CACHE is not bound", async () => {
      const customEnv = {
        ...testEnv,
        SESSION_CACHE: undefined
      };
      const req = new Request("http://localhost/api/admin/logs", {
        headers: { 'Authorization': `Bearer admin-secret` }
      });
      const res = await appFetchWrapper(req, customEnv);
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data).toEqual([]);
    });

    it("should reject with 401 if ADMIN_SECRET is not configured", async () => {
      const customEnv = {
        ...testEnv,
        ADMIN_SECRET: undefined
      };
      const req = new Request("http://localhost/api/admin/logs", {
        headers: { 'Authorization': `Bearer admin-secret` }
      });
      const res = await appFetchWrapper(req, customEnv);
      expect(res.status).toBe(401);
      const data = await res.json() as any;
      expect(data.error).toBe("Unauthorized: Admin secret is not configured");
    });
  });

  describe("GitHub OAuth routes", () => {
    const oauthEnv = {
      ...testEnv,
      GITHUB_CLIENT_ID: "test-client-id",
      GITHUB_CLIENT_SECRET: "test-client-secret",
      GITHUB_REDIRECT_URI: "http://localhost:8787/api/auth/callback/github",
    };

    it("GET /api/auth/login/github redirects to GitHub authorize endpoint", async () => {
      const req = new Request("http://localhost/api/auth/login/github");
      const res = await appFetchWrapper(req, oauthEnv);
      expect(res.status).toBe(302);
      const location = res.headers.get("Location");
      expect(location).toContain("https://github.com/login/oauth/authorize");
      expect(location).toContain("client_id=test-client-id");
      expect(location).toContain("redirect_uri=" + encodeURIComponent("http://localhost:8787/api/auth/callback/github"));
      expect(location).toContain("state=");
    });

    it("GET /api/auth/callback/github returns error if state/code is missing", async () => {
      const req = new Request("http://localhost/api/auth/callback/github?code=123");
      const res = await appFetchWrapper(req, oauthEnv);
      expect(res.status).toBe(302);
      const location = res.headers.get("Location");
      expect(location).toContain("?error=" + encodeURIComponent("Missing code or state"));
    });

    it("GET /api/auth/callback/github returns error if state is invalid", async () => {
      const req = new Request("http://localhost/api/auth/callback/github?code=123&state=invalidstate");
      const res = await appFetchWrapper(req, oauthEnv);
      expect(res.status).toBe(302);
      const location = res.headers.get("Location");
      expect(location).toContain("?error=" + encodeURIComponent("Invalid or expired state"));
    });

    it("GET /api/info returns github_auth_enabled: true when configured", async () => {
      const req = new Request("http://localhost/api/info");
      const res = await appFetchWrapper(req, oauthEnv);
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.github_auth_enabled).toBe(true);
    });

    it("GET /api/info returns github_auth_enabled: false when not configured", async () => {
      const req = new Request("http://localhost/api/info");
      const res = await appFetchWrapper(req, testEnv);
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.github_auth_enabled).toBe(false);
    });
  });
});

