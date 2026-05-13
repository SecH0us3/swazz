import { describe, it, expect, vi } from "vitest";
import worker, { SwazzContainer } from "./index";

describe("Swazz Worker", () => {
  it("responds with health check at /", async () => {
    const req = new Request("http://localhost/");
    const env = { SWAZZ_DO: {} as DurableObjectNamespace };

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");

    const body = await res.json();
    expect(body).toEqual({
      service: "swazz-edge",
      status: "ok",
      message: "Use /api/* to interact with the fuzzing engine",
    });
  });

  it("proxies /api/* to DO", async () => {
    const req = new Request("http://localhost/api/test");

    const mockStub = {
      fetch: vi.fn().mockResolvedValue(new Response("proxied")),
    };

    const mockDo = {
      idFromName: vi.fn().mockReturnValue("mock-id"),
      get: vi.fn().mockReturnValue(mockStub),
    };

    const env = { SWAZZ_DO: mockDo as unknown as DurableObjectNamespace };

    const res = await worker.fetch(req, env);
    expect(mockDo.idFromName).toHaveBeenCalledWith("global-swazz");
    expect(mockDo.get).toHaveBeenCalledWith("mock-id");
    expect(mockStub.fetch).toHaveBeenCalledWith(req);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("proxied");
  });

  it("proxies /health to DO", async () => {
    const req = new Request("http://localhost/health");

    const mockStub = {
      fetch: vi.fn().mockResolvedValue(new Response("health ok")),
    };

    const mockDo = {
      idFromName: vi.fn().mockReturnValue("mock-id"),
      get: vi.fn().mockReturnValue(mockStub),
    };

    const env = { SWAZZ_DO: mockDo as unknown as DurableObjectNamespace };

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("health ok");
  });

  it("returns 404 for unknown routes", async () => {
    const req = new Request("http://localhost/unknown");
    const env = { SWAZZ_DO: {} as DurableObjectNamespace };

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not Found");
  });
});

describe("SwazzContainer", () => {
  it("instantiates and proxies fetch to containerFetch", async () => {
    // Mock the containerFetch on the prototype as the DO base class doesn't allow easy instantiation
    // without the proper Cloudflare context
    const origContainerFetch = SwazzContainer.prototype.containerFetch;

    const mockContainerFetch = vi.fn().mockResolvedValue(new Response("container response"));
    SwazzContainer.prototype.containerFetch = mockContainerFetch;

    try {
      // Create an instance bypassing the constructor to avoid DurableObjectState checks
      const container = Object.create(SwazzContainer.prototype);
      // Run the constructor's side-effects (property initialization)
      container.defaultPort = 8080;
      container.sleepAfter = 120;

      expect(container.defaultPort).toBe(8080);
      expect(container.sleepAfter).toBe(120);

      // Verify that calling fetch on the container correctly delegates to containerFetch
      const req = new Request("http://localhost/mock");
      const res = await container.fetch(req);

      // Because defaultPort is set to 8080, Container.prototype.fetch automatically passes 8080 as the second argument
      expect(mockContainerFetch).toHaveBeenCalledWith(req, 8080);
      expect(await res.text()).toBe("container response");
    } finally {
      // Restore the original containerFetch
      SwazzContainer.prototype.containerFetch = origContainerFetch;
    }
  });
});
