const { spawn } = require("child_process");
const readline = require("readline");
const path = require("path");
const { discoverCodexRuntime } = require("./codex-runtime-discovery.cjs");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function buildDecision(method, mode) {
  if (!mode || mode === "observe") {
    return null;
  }

  if (method === "item/commandExecution/requestApproval") {
    if (mode === "accept") return { decision: "accept" };
    if (mode === "acceptForSession") return { decision: "acceptForSession" };
    if (mode === "cancel") return { decision: "cancel" };
    return { decision: "decline" };
  }

  if (method === "item/fileChange/requestApproval") {
    if (mode === "accept") return { decision: "accept" };
    if (mode === "acceptForSession") return { decision: "acceptForSession" };
    if (mode === "cancel") return { decision: "cancel" };
    return { decision: "decline" };
  }

  if (method === "applyPatchApproval" || method === "execCommandApproval") {
    if (mode === "accept") return { decision: "approved" };
    if (mode === "acceptForSession") return { decision: "approved_for_session" };
    if (mode === "cancel") return { decision: "abort" };
    return { decision: "denied" };
  }

  if (method === "item/permissions/requestApproval") {
    if (mode === "accept" || mode === "acceptForSession") {
      return {
        permissions: {},
        scope: mode === "acceptForSession" ? "session" : "turn",
        strictAutoReview: false,
      };
    }
    return null;
  }

  return null;
}

function jsonLine(value) {
  return `${JSON.stringify(value)}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  const runtime = args.codex ? null : discoverCodexRuntime();
  const codexPath = args.codex || runtime.path;
  const workspace =
    args.workspace || path.join(process.env.USERPROFILE, "AxiOwl", "approval-on-request-probe");
  const prompt =
    args.prompt ||
    "Run exactly this shell command in the active workspace: Remove-Item -LiteralPath .\\nested-dir -Recurse -Force";
  const approvalMode = args.decision || "observe";
  const model = args.model || "gpt-5.4-mini";
  const serviceTier = args.speed || "fast";
  const effort = args.reasoning || "high";
  const timeoutMs = Number(args.timeoutMs || 120000);

  console.log(`CODEX=${codexPath}`);
  if (runtime) {
    console.log(`CODEX_SOURCE=${runtime.source}`);
    console.log(`CODEX_VERSION=${runtime.version}`);
    console.log(`CODEX_DISCOVERY_ATTEMPTS=${runtime.attempts.length}`);
  }
  console.log(`WORKSPACE=${workspace}`);
  console.log(`DECISION_MODE=${approvalMode}`);
  console.log(`PROMPT=${prompt}`);

  const child = spawn(codexPath, ["app-server", "--stdio"], {
    cwd: workspace,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const pendingRequests = new Map();
  let nextId = 1;
  let threadId = null;
  let finished = false;

  function send(message) {
    child.stdin.write(jsonLine(message));
  }

  function request(method, params, onResult) {
    const id = nextId++;
    pendingRequests.set(id, onResult);
    send({ id, method, params });
  }

  function finish(reason) {
    if (finished) {
      return;
    }
    finished = true;
    console.log(`FINISH=${reason}`);
    child.kill();
  }

  const timer = setTimeout(() => finish("timeout"), timeoutMs);

  const stdout = readline.createInterface({ input: child.stdout });
  stdout.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      console.log(`STDOUT_TEXT ${line}`);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, "id") && !message.method) {
      const handler = pendingRequests.get(message.id);
      if (handler) {
        pendingRequests.delete(message.id);
        handler(message);
        return;
      }
    }

    if (message.method) {
      console.log(`SERVER ${message.method} ${JSON.stringify(message.params ?? {})}`);

      if (message.method === "thread/started" && message.params?.thread?.id) {
        threadId = message.params.thread.id;
      }

      if (message.method === "turn/completed") {
        finish("turn/completed");
        return;
      }

      const response = buildDecision(message.method, approvalMode);
      if (response) {
        console.log(`CLIENT_RESPONSE ${message.method} ${JSON.stringify(response)}`);
        send({ id: message.id, result: response });
      }
      return;
    }

    console.log(`STDOUT_JSON ${JSON.stringify(message)}`);
  });

  const stderr = readline.createInterface({ input: child.stderr });
  stderr.on("line", (line) => {
    console.log(`STDERR ${line}`);
  });

  child.on("exit", (code, signal) => {
    clearTimeout(timer);
    console.log(`EXIT code=${code} signal=${signal}`);
  });

  request(
    "initialize",
    {
      clientInfo: {
        name: "axiowl-app-server-probe",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        optOutNotificationMethods: [],
      },
    },
    (message) => {
      console.log(`INITIALIZE_RESPONSE ${JSON.stringify(message.result ?? message.error ?? {})}`);
      send({ method: "initialized" });
      request(
        "thread/start",
        {
          cwd: workspace,
          approvalPolicy: "on-request",
          sandbox: "workspace-write",
          model,
          serviceTier,
          config: {
            model_reasoning_effort: effort,
          },
          developerInstructions: "Keep outputs concise and favor explicit tool decisions.",
        },
        (threadStart) => {
          const startedThreadId = threadStart.result?.thread?.id || threadId;
          threadId = startedThreadId;
          console.log(`THREAD_START_RESPONSE ${JSON.stringify(threadStart.result ?? threadStart.error ?? {})}`);
          if (!threadId) {
            finish("missing-thread-id");
            return;
          }

          request(
            "turn/start",
            {
              threadId,
              input: [
                {
                  type: "text",
                  text: prompt,
                  text_elements: [],
                },
              ],
              cwd: workspace,
              approvalPolicy: "on-request",
              model,
              serviceTier,
              effort,
            },
            (turnStart) => {
              console.log(`TURN_START_RESPONSE ${JSON.stringify(turnStart.result ?? turnStart.error ?? {})}`);
            },
          );
        },
      );
    },
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
