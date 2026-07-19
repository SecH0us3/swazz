const http = require('http');
const url = require('url');

const PORT = 8789;
const activeConnections = new Set();

// Helper to simulate various vulnerability errors based on inputs
function checkAllVulnerabilities(input) {
  if (input === undefined || input === null) return;
  const strValue = typeof input === "object" ? JSON.stringify(input) : String(input);

  // If input contains any non-alphanumeric special characters, treat it as fuzzed/vulnerable!
  const specialCharRegex = /[^a-zA-Z0-9\s]/;
  if (specialCharRegex.test(strValue)) {
    // 1. SQL Injection simulation
    const sqliRegex = /(\b(OR|AND|UNION|SELECT|DROP|INSERT|UPDATE|DELETE)\b|'|--)/i;
    if (sqliRegex.test(strValue) || strValue.includes("'") || strValue.includes("-")) {
      throw new Error("You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '" + strValue + "'");
    }

    // 2. XSS or general exception simulation
    throw new Error("HTML Parser Error: Unexpected token '<'\n    at parseHTML (/usr/src/app/node_modules/htmlparser2/lib/Parser.js:12:34)");
  }
}

const server = http.createServer((req, res) => {
  // CORS - more restrictive for security
  const origin = req.headers.origin;
  const allowedOrigins = ["http://localhost:3000", "http://localhost:8789", "http://localhost:5173", "http://127.0.0.1:5173", "http://127.0.0.1:8789"];
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;

  if (req.method === "GET" && path === "/mcp/sse") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });

    // Write endpoint event immediately
    res.write("event: endpoint\ndata: /mcp/message\n\n");

    activeConnections.add(res);

    req.on("close", () => {
      activeConnections.delete(res);
    });
    return;
  }

  if (req.method === "POST" && (path === "/mcp" || path === "/mcp/message")) {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
    });

    req.on("end", () => {
      try {
        const reqBody = JSON.parse(body);
        const id = reqBody.id;
        const methodRPC = reqBody.method;
        const params = reqBody.params;

        let response = {
          jsonrpc: "2.0",
          id: id
        };

        if (methodRPC === "initialize") {
          response.result = {
            protocolVersion: "2024-11-05",
            capabilities: {},
            serverInfo: {
              name: "demo-mcp-server-sse",
              version: "1.0.0"
            }
          };
        } else if (methodRPC === "notifications/initialized") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
          return;
        } else if (methodRPC === "tools/list") {
          response.result = {
            tools: [
              {
                name: "get_info",
                description: "Returns system info",
                inputSchema: {
                  type: "object",
                  properties: {
                    name: { type: "string" }
                  },
                  required: ["name"]
                }
              },
              {
                name: "query_db",
                description: "Queries the database",
                inputSchema: {
                  type: "object",
                  properties: {
                    query: { type: "string" }
                  },
                  required: ["query"]
                }
              }
            ]
          };
        } else if (methodRPC === "tools/call") {
          const toolName = params?.name;
          const args = params?.arguments || {};

          if (toolName === "get_info") {
            response.result = {
              content: [
                {
                  type: "text",
                  text: `Hello ${args.name || "Guest"}`
                }
              ]
            };
          } else if (toolName === "query_db") {
            if (args.query && args.query.includes("CRASH")) {
              process.exit(1);
            }

            try {
              checkAllVulnerabilities(args.query);
              response.result = {
                content: [
                  {
                    type: "text",
                    text: `Query success: records found for ${args.query}`
                  }
                ]
              };
            } catch (err) {
              if (err.message.includes("SQL syntax")) {
                console.error(`Database panic: ${err.message}`);
                // Respond with HTTP 500 to simulate a server crash or exit
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: err.message }));
                return;
              }
              // Return exception text on other payloads to simulate A05:2025 exception reflection
              response.result = {
                content: [
                  {
                    type: "text",
                    text: `Unhandled exception in database: ${err.message}`
                  }
                ]
              };
            }
          } else {
            response.error = {
              code: -32601,
              message: `Method not found: ${toolName}`
            };
          }
        } else {
          response.error = {
            code: -32601,
            message: `Method not found: ${methodRPC}`
          };
        }

        if (path === "/mcp") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(response));
          return;
        }

        // Send HTTP response to the POST request
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "received" }));

        // Broadcast JSON-RPC response via SSE message event
        const sseMsg = `event: message\ndata: ${JSON.stringify(response)}\n\n`;
        for (const client of activeConnections) {
          client.write(sseMsg);
        }
      } catch (err) {
        console.error("Request processing error:", err.message);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid request" }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`Demo SSE MCP Server running at http://localhost:${PORT}/mcp/sse`);
});

// Cleanup on process exit
process.on('SIGTERM', () => {
  console.log('Shutting down server...');
  server.close(() => {
    console.log('Server shut down gracefully');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Shutting down server...');
  server.close(() => {
    console.log('Server shut down gracefully');
    process.exit(0);
  });
});
