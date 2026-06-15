const { spawn } = require("child_process");
const readline = require("readline");
const { discoverCodexRuntime, formatDiscoveryReport } = require("./codex-runtime-discovery.cjs");

let runtime = null;
const codexPath = process.argv[2] || (() => {
  runtime = discoverCodexRuntime();
  return runtime.path;
})();

const child = spawn(codexPath, ["app-server", "--stdio"], {
  stdio: ["pipe", "pipe", "pipe"],
});

let nextId = 1;
const pending = new Map();
let settled = false;

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function request(method, params, onResult) {
  const id = nextId++;
  pending.set(id, onResult);
  send({ id, method, params });
}

function finishOk(value) {
  if (settled) return;
  settled = true;
  console.log(JSON.stringify(value));
  child.kill();
}

function finishError(message) {
  if (settled) return;
  settled = true;
  console.error(runtime ? `${message}\n${formatDiscoveryReport(runtime.attempts)}` : message);
  child.kill();
  process.exitCode = 1;
}

const timer = setTimeout(() => {
  finishError("Timed out waiting for account/rateLimits/read response");
}, 15000);

const stdout = readline.createInterface({ input: child.stdout });
stdout.on("line", (line) => {
  if (!line.trim()) {
    return;
  }

  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    finishError(`Failed to parse app-server JSON: ${error.message}`);
    return;
  }

  if (Object.prototype.hasOwnProperty.call(message, "id") && !message.method) {
    const handler = pending.get(message.id);
    if (handler) {
      pending.delete(message.id);
      handler(message);
    }
  }
});

const stderr = readline.createInterface({ input: child.stderr });
const stderrLines = [];
stderr.on("line", (line) => {
  stderrLines.push(line);
});

child.on("exit", () => {
  clearTimeout(timer);
  if (!settled) {
    const stderrText = stderrLines.join("\n").trim();
    finishError(
      stderrText
        ? `Codex app-server exited early:\n${stderrText}`
        : "Codex app-server exited before returning rate limits",
    );
  }
});

request(
  "initialize",
  {
    clientInfo: {
      name: "axiowl-rate-limit-probe",
      version: "0.1.0",
    },
    capabilities: {
      experimentalApi: true,
      requestAttestation: false,
      optOutNotificationMethods: [],
    },
  },
  (initializeResponse) => {
    if (initializeResponse.error) {
      finishError(`Initialize failed: ${JSON.stringify(initializeResponse.error)}`);
      return;
    }

    send({ method: "initialized" });
    request("account/rateLimits/read", null, (rateLimitResponse) => {
      if (rateLimitResponse.error) {
        finishError(
          `account/rateLimits/read failed: ${JSON.stringify(rateLimitResponse.error)}`,
        );
        return;
      }

      const result = rateLimitResponse.result;
      if (!result || !result.rateLimits) {
        finishError("Rate limit response did not include rateLimits");
        return;
      }

      finishOk(result);
    });
  },
);
