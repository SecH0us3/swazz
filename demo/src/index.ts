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
        throw new Error("You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '" + strValue + "'");
      }

      // 2. XSS
      const xssRegex = /(<script|onload|onerror|iframe|javascript:|alert\()/i;
      if (xssRegex.test(strValue)) {
        throw new Error("HTML Parser Error: Unexpected token '<'\n    at parseHTML (/usr/src/app/node_modules/htmlparser2/lib/Parser.js:12:34)\n    at Object.parse (/usr/src/app/node_modules/htmlparser2/lib/index.js:5:10)");
      }

      // 3. Path Traversal
      const traversalRegex = /(\.\.\/|\.\.\\|\/etc\/passwd|file:\/\/)/i;
      if (traversalRegex.test(strValue)) {
        throw new Error("java.io.FileNotFoundException: Access denied\n\tat java.io.FileInputStream.open0(Native Method)\n\tat java.io.FileInputStream.open(FileInputStream.java:195)");
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
            },
            "/welcome": {
              get: {
                summary: "Welcome page (HTML)",
                parameters: [
                  {
                    name: "name",
                    in: "query",
                    schema: { type: "string" },
                    description: "User's name"
                  }
                ],
                responses: {
                  "200": {
                    description: "HTML output reflection",
                    content: {
                      "text/html": {
                        schema: { type: "string" }
                      }
                    }
                  }
                }
              }
            },
            "/status": {
              get: {
                summary: "System status info",
                responses: {
                  "200": {
                    description: "Internal status containing secrets",
                    content: {
                      "application/json": {
                        schema: {
                          type: "object",
                          properties: {
                            status: { type: "string" },
                            awsKey: { type: "string" },
                            internalIP: { type: "string" }
                          }
                        }
                      }
                    }
                  }
                }
              }
            },
            "/headers": {
              get: {
                summary: "Reflects custom query params into response headers to simulate CRLF vulnerabilities",
                parameters: [
                  {
                    name: "custom_header",
                    in: "query",
                    schema: { type: "string" },
                    description: "Header name to inject"
                  },
                  {
                    name: "custom_value",
                    in: "query",
                    schema: { type: "string" },
                    description: "Header value to inject"
                  }
                ],
                responses: {
                  "200": {
                    description: "Reflected headers response"
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

      if (method === "GET" && path === "/headers") {
        const customHeader = url.searchParams.get("custom_header");
        const customValue = url.searchParams.get("custom_value");
        const origin = request.headers.get("Origin");
        const responseHeaders: Record<string, string> = {
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Content-Type": "text/plain"
        };

        if (origin) {
          responseHeaders["Access-Control-Allow-Origin"] = origin;
        } else {
          responseHeaders["Access-Control-Allow-Origin"] = "*";
        }

        const addHeaderWithCRLF = (name: string, value: string) => {
          const rawLine = `${name}: ${value}`;
          const normalized = rawLine.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
          const parts = normalized.split("\n");

          for (const part of parts) {
            const line = part.trim();
            if (line) {
              const colonIdx = line.indexOf(":");
              if (colonIdx !== -1) {
                const hName = line.substring(0, colonIdx).trim();
                const hVal = line.substring(colonIdx + 1).trim();
                if (hName.toLowerCase() !== "content-length" && hName.toLowerCase() !== "transfer-encoding") {
                  responseHeaders[hName] = hVal;
                }
              }
            }
          }
        };

        let hName = "X-Reflected";
        let hVal = "default-value";

        if (customHeader) {
          try {
            hName = decodeURIComponent(customHeader);
          } catch (e) {
            hName = customHeader;
          }
        }

        if (customValue) {
          try {
            hVal = decodeURIComponent(customValue);
          } catch (e) {
            hVal = customValue;
          }
        }

        addHeaderWithCRLF(hName, hVal);

        return new Response("OK", {
          headers: responseHeaders
        });
      }

      if (method === "GET" && path === "/welcome") {
        const name = url.searchParams.get("name") || "Guest";
        return new Response(`<h1>Welcome ${name}!</h1>`, {
          headers: { ...corsHeaders, "Content-Type": "text/html" }
        });
      }

      if (method === "GET" && path === "/status") {
        return new Response(JSON.stringify({
          status: "healthy",
          awsKey: "AKIAIOSFODNN7EXAMPLE",
          internalIP: "192.168.1.15"
        }), {
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
          return new Response(JSON.stringify({ token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      }

      if (path === "/graphql") {
        const introspectionSchema = {
          data: {
            __schema: {
              queryType: { name: "Query" },
              mutationType: { name: "Mutation" },
              types: [
                {
                  kind: "OBJECT",
                  name: "Query",
                  fields: [
                    {
                      name: "user",
                      args: [
                        {
                          name: "id",
                          type: {
                            kind: "NON_NULL",
                            ofType: {
                              kind: "SCALAR",
                              name: "ID"
                            }
                          }
                        }
                      ],
                      type: {
                        kind: "OBJECT",
                        name: "User"
                      }
                    }
                  ]
                },
                {
                  kind: "OBJECT",
                  name: "Mutation",
                  fields: [
                    {
                      name: "createUser",
                      args: [
                        {
                          name: "username",
                          type: {
                            kind: "NON_NULL",
                            ofType: {
                              kind: "SCALAR",
                              name: "String"
                            }
                          }
                        }
                      ],
                      type: {
                        kind: "OBJECT",
                        name: "User"
                      }
                    }
                  ]
                },
                {
                  kind: "OBJECT",
                  name: "User",
                  fields: [
                    {
                      name: "id",
                      type: {
                        kind: "SCALAR",
                        name: "ID"
                      }
                    },
                    {
                      name: "name",
                      type: {
                        kind: "SCALAR",
                        name: "String"
                      }
                    }
                  ]
                }
              ]
            }
          }
        };

        if (method === "GET") {
          return new Response(JSON.stringify(introspectionSchema), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (method === "POST") {
          let body: any;
          try {
            body = await request.json();
          } catch (e) {
            return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
          }

          if (body && typeof body === "object") {
            const query = body.query || "";
            if (query.includes("IntrospectionQuery") || query.includes("__schema")) {
              return new Response(JSON.stringify(introspectionSchema), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }

            if (body.variables && typeof body.variables === "object") {
              for (const key of Object.keys(body.variables)) {
                checkAllVulnerabilities(body.variables[key]);
              }
            }
          }

          // Return mock GraphQL execution success response
          return new Response(JSON.stringify({
            data: {
              user: { id: "1", name: "Alice" },
              createUser: { id: "2", name: "Bob" }
            }
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
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
