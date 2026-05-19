export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Helper to simulate various vulnerability errors based on inputs
    const checkAllVulnerabilities = (input: any) => {
      if (input === undefined || input === null) return;

      const strValue = typeof input === "object" ? JSON.stringify(input) : String(input);

      // 1. SQL Injection
      const sqliRegex = /(\b(OR|AND|UNION|SELECT|DROP|INSERT|UPDATE|DELETE)\b|'|--)/i;
      if (sqliRegex.test(strValue)) {
        throw new Error("Database query failed: Syntax error or access violation");
      }

      // 2. XSS
      const xssRegex = /(<script|onload|onerror|iframe|javascript:|alert\()/i;
      if (xssRegex.test(strValue)) {
        throw new Error("HTML Parser Error: Unexpected token '<' or unhandled script execution");
      }

      // 3. Path Traversal
      const traversalRegex = /(\.\.\/|\.\.\\|\/etc\/passwd|file:\/\/)/i;
      if (traversalRegex.test(strValue)) {
        throw new Error("java.io.FileNotFoundException: Access denied to local file system resource");
      }

      // 4. Null byte / CRLF injection / HTTP smuggling
      const protocolRegex = /(\x00|%00|\r\n)/;
      if (protocolRegex.test(strValue)) {
        throw new Error("Protocol Exception: Illegal character in request stream");
      }

      // 5. Extreme numbers / Date abuse (NaN, Infinity, weird dates, arrays, nested structures)
      if (
        strValue.includes("NaN") || 
        strValue.includes("Infinity") || 
        strValue.includes("1e500") || 
        strValue.includes("2023-13-32") || 
        strValue.includes("2023-02-29") || 
        strValue.includes("10000-01-01")
      ) {
        throw new Error("ArithmeticException / DateTimeException: Value out of range or invalid representation");
      }

      // 6. Type confusion (sending empty objects/arrays where a string is expected)
      if (typeof input === "object") {
        throw new Error("NullPointerException: Cannot cast complex object to primitive string");
      }
    };

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (method === "GET" && path === "/swagger.json") {
        const swagger = {
          openapi: "3.0.0",
          info: {
            title: "Swazz Demo Vulnerable API",
            version: "1.0.0",
            description: "A deliberately vulnerable API for testing Swazz fuzzing engine."
          },
          paths: {
            "/users": {
              get: {
                summary: "Get a list of users",
                parameters: [
                  {
                    name: "search",
                    in: "query",
                    schema: { type: "string" },
                    description: "Search term to filter users"
                  }
                ],
                responses: {
                  "200": {
                    description: "A JSON array of user names",
                    content: {
                      "application/json": {
                        schema: {
                          type: "array",
                          items: { type: "string" }
                        }
                      }
                    }
                  }
                }
              }
            },
            "/login": {
              post: {
                summary: "Login",
                requestBody: {
                  required: true,
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          username: { type: "string" },
                          password: { type: "string" }
                        },
                        required: ["username", "password"]
                      }
                    }
                  }
                },
                responses: {
                  "200": {
                    description: "Successful login"
                  },
                  "401": {
                    description: "Unauthorized"
                  }
                }
              }
            }
          }
        };
        return new Response(JSON.stringify(swagger), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (method === "GET" && path === "/users") {
        const search = url.searchParams.get("search");
        checkAllVulnerabilities(search);

        const users = ["admin", "alice", "bob"];
        const filtered = search ? users.filter(u => u.includes(search)) : users;
        return new Response(JSON.stringify(filtered), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (method === "POST" && path === "/login") {
        let body;
        try {
          body = await request.json();
        } catch (e) {
          return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
        }
        
        checkAllVulnerabilities(body.username);
        checkAllVulnerabilities(body.password);

        if (body.username === "admin" && body.password === "secret") {
          return new Response(JSON.stringify({ token: "fake-jwt-token" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      }

      return new Response("Not Found", { status: 404, headers: corsHeaders });

    } catch (e: any) {
      // Return 500 on simulated SQLi
      return new Response(JSON.stringify({ error: "Internal Server Error", detail: e.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  },
};
