const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

// Helper to simulate various vulnerability errors based on inputs
function checkAllVulnerabilities(input) {
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
    throw new Error("HTML Parser Error: Unexpected token '<'\n    at parseHTML (/usr/src/app/node_modules/htmlparser2/lib/Parser.js:12:34)");
  }

  // 3. Path Traversal
  const traversalRegex = /(\.\.\/|\.\.\\|\/etc\/passwd|file:\/\/)/i;
  if (traversalRegex.test(strValue)) {
    throw new Error("java.io.FileNotFoundException: Access denied\n\tat java.io.FileInputStream.open0(Native Method)");
  }
}

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const reqBody = JSON.parse(line);
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
          name: "demo-mcp-server-stdio",
          version: "1.0.0"
        }
      };
    } else if (methodRPC === "notifications/initialized") {
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
          // Exit process directly to simulate server crash
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
            // Crash the server on SQL injection payloads to simulate A10:2025 crash
            console.error(`Database panic: ${err.message}`);
            process.exit(1);
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

    console.log(JSON.stringify(response));
  } catch (err) {
    // Write a JSON-RPC error response if parsing failed
    console.log(JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32700,
        message: "Parse error"
      }
    }));
  }
});
