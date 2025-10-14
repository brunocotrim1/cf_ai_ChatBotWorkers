import { DurableObject } from "cloudflare:workers";

// ---------------- Durable Object ----------------
export class UserChatHistory extends DurableObject {
  state: DurableObjectState;
  history: Array<{ role: string; content: string }> = [];

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.initialize();
  }

  async initialize() {
    const stored = await this.state.storage.get<Array<{ role: string; content: string }>>("history");
    if (stored) this.history = stored;
  }

  async addMessage(role: string, content: string) {
    this.history.push({ role, content });
    await this.state.storage.put("history", this.history);
  }

  async getMessages(): Promise<Array<{ role: string; content: string }>> {
    const stored = await this.state.storage.get<Array<{ role: string; content: string }>>("history");
    return stored || [];
  }

  clearMessages() {
    this.history = [];
    return this.state.storage.delete("history");
  }
}

// ---------------- Worker Entry ----------------
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // ----- Handle CORS preflight -----
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        },
      });
    }

    // ----- HTTP GET endpoint for history -----
    if (url.pathname === "/getHistory") {
      const userId = url.searchParams.get("userId");
      if (!userId) return new Response("Missing userId query parameter", { status: 400 });

      const id = env.USER_CHAT_HISTORY.idFromName(userId);
      const obj = env.USER_CHAT_HISTORY.get(id);

      const history = await obj.getMessages();

      return new Response(JSON.stringify(history), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
    // ----- HTTP POST endpoint to clear history -----
if (url.pathname === "/clearHistory") {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const userId = url.searchParams.get("userId");
  if (!userId) return new Response("Missing userId query parameter", { status: 400 });

  const id = env.USER_CHAT_HISTORY.idFromName(userId);
  const obj = env.USER_CHAT_HISTORY.get(id);

  await obj.clearMessages();

  return new Response(JSON.stringify({ success: true }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}


    // ----- WebSocket handling -----
    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    const userId = url.searchParams.get("userId");
    if (!userId) return new Response("Missing userId query parameter", { status: 400 });

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    handleWebSocketSession(server, env, userId);

    return new Response(null, { status: 101, webSocket: client });
  },
};

// ---------------- WebSocket session ----------------
async function handleWebSocketSession(websocket: WebSocket, env: Env, userId: string) {
  const id = env.USER_CHAT_HISTORY.idFromName(userId);
  const obj = env.USER_CHAT_HISTORY.get(id);

  websocket.accept();

  websocket.addEventListener("message", async (event) => {
    try {
      const userMessage = JSON.parse(event.data);

      // Save user message to Durable Object
      await obj.addMessage("user", userMessage.prompt);

      if (userMessage.type === "prompt") {
        await processPrompt(websocket, env, obj, userMessage.prompt);
      }

    } catch (err) {
      websocket.send(JSON.stringify({ type: "error", error: err.message }));
    }
  });

  websocket.addEventListener("close", () => console.log("Client disconnected"));
  websocket.addEventListener("error", (err) => console.error("WebSocket error:", err));
}

// ---------------- Process prompt ----------------
async function processPrompt(websocket: WebSocket, env: Env, obj: DurableObjectStub<UserChatHistory>, userMessage: string) {
  // Fetch chat history
  const history = await obj.getMessages();

  // Combine history + latest user message
  const messages = [...history, { role: "user", content: userMessage }];
  const promptString = messages.map(m => `${m.role}: ${m.content}`).join("\n");

  // Stream model response
  const stream = await env.AI.run("@cf/meta/llama-3-8b-instruct", 
  {stream: true, messages: messages });
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let finalMessage = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      websocket.send(JSON.stringify({ type: "done" }));
      break;
    }

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n").filter((line) => line.trim());

    for (const line of lines) {
      try {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            websocket.send(JSON.stringify({ type: "done" }));
            break;
          }
          const parsed = JSON.parse(data);

          if (parsed.usage) {
            websocket.send(JSON.stringify({ type: "usage", usage: parsed.usage }));
          }

          if (parsed.response) {
            websocket.send(JSON.stringify({ type: "token", response: parsed.response }));
            finalMessage += parsed.response;
          } else {
            websocket.send(JSON.stringify({ type: "data", data }));
          }
        } else {
          websocket.send(JSON.stringify({ type: "token", token: line }));
        }
      } catch {
        websocket.send(JSON.stringify({ type: "token", token: line }));
      }
    }
  }

  // Save assistant response to history
  if (finalMessage) {
    await obj.addMessage("assistant", finalMessage);
  }
}
