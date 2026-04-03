FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends git curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Minimal API server that responds to the Sandbox SDK's internal /api/* requests.
# The SDK pings /api/ping and /api/version to confirm readiness.
RUN cat <<'AGENT' > /opt/agent.js
const http = require("http");
const { execSync, spawn } = require("child_process");
const version = "0.8.4";

http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  // Collect body for POST
  let body = "";
  req.on("data", c => body += c);
  req.on("end", () => {
    try {
      const data = body ? JSON.parse(body) : {};

      if (path === "/api/ping") {
        return res.end(JSON.stringify({ message: "pong" }));
      }
      if (path === "/api/version") {
        return res.end(JSON.stringify({ version }));
      }
      if (path === "/api/session/create") {
        return res.end(JSON.stringify({ sessionId: data.sessionId || "default" }));
      }
      if (path === "/api/execute") {
        const result = execSync(data.command || "echo ok", {
          cwd: data.workdir || "/workspace",
          timeout: 120000,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        return res.end(JSON.stringify({
          stdout: result || "",
          stderr: "",
          exitCode: 0,
          success: true,
        }));
      }
      if (path === "/api/read") {
        const fs = require("fs");
        const content = fs.readFileSync(data.path, data.encoding || "utf8");
        return res.end(JSON.stringify({ content }));
      }
      if (path === "/api/write") {
        const fs = require("fs");
        const dir = require("path").dirname(data.path);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(data.path, data.content || "", data.encoding || "utf8");
        return res.end(JSON.stringify({ success: true }));
      }
      if (path === "/api/ls" || path === "/api/list") {
        const fs = require("fs");
        const entries = fs.readdirSync(data.path || "/workspace", { withFileTypes: true })
            .map(e => ({ name: e.name, type: e.isDirectory() ? "directory" : "file" }));
        return res.end(JSON.stringify({ entries }));
      }
      if (path === "/api/mkdir") {
        const fs = require("fs");
        fs.mkdirSync(data.path, { recursive: true });
        return res.end(JSON.stringify({ success: true }));
      }
      if (path === "/api/delete") {
        const fs = require("fs");
        fs.rmSync(data.path, { recursive: true, force: true });
        return res.end(JSON.stringify({ success: true }));
      }
      if (path === "/api/exists") {
        const fs = require("fs");
        return res.end(JSON.stringify({ exists: fs.existsSync(data.path) }));
      }
      if (path === "/api/process/start") {
        const proc = spawn("sh", ["-c", data.command], {
          detached: true, cwd: data.workdir || "/workspace",
          stdio: ["ignore", "pipe", "pipe"]
        });
        proc.unref();
        return res.end(JSON.stringify({ processId: String(proc.pid), command: data.command }));
      }
      if (path === "/api/process/list") {
        return res.end(JSON.stringify({ processes: [] }));
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: "Unknown endpoint: " + path }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({
        stdout: "",
        stderr: e.stderr || e.message || String(e),
        exitCode: e.status || 1,
        success: false,
      }));
    }
  });
}).listen(3000, () => console.log("Sandbox agent ready on :3000"));
AGENT

EXPOSE 3000

CMD ["node", "/opt/agent.js"]
