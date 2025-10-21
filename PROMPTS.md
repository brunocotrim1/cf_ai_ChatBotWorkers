**Model:** GPT-4o

**Purpose / Context:** Generate an interactive frontend skeleton for the Worker AI backend

**Prompt:** Given my Cloudflare Worker AI + Durable object code, please use its API to provide me with an Angular 19 skeleton that will serve as a base for me to work of a ChatBot Interface that makes use of this API to allow a user to input his room id and when connected he is able to see his Chat History, Chat new messages and delete the room contents. I want a modern dark styte look. 

Given my Cloudflare Worker AI with Durable Objects, please create an Angular 19 skeleton that uses its API to serve as a base for me to work on a ChatBot interface. The app should allow a user to enter a room ID, and once connected, they should be able to view their chat history, send new messages, and delete the room’s contents. I would like the interface to feature a modern dark-themed design. 

Here follows the Worker Code: 

```ts
import { DurableObject } from 'cloudflare:workers';

export class UserChatHistory extends DurableObject {
	state: DurableObjectState;
	history: Array<{ role: string; content: string }> = [];

	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.state = state;
		this.initialize();
	}

	async initialize() {
		const stored = await this.state.storage.get<Array<{ role: string; content: string }>>('history');
		const userId = this.state.id.toString();
		if (stored) this.history = stored;
	}

	async addMessage(role: string, content: string) {
		this.history.push({ role, content });
		await this.state.storage.put('history', this.history);
	}

	async getMessages(): Promise<Array<{ role: string; content: string }>> {
		const stored = await this.state.storage.get<Array<{ role: string; content: string }>>('history');
		return stored || [];
	}

	clearMessages() {
		this.history = [];
		return this.state.storage.delete('history');
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const env = this.env as Env;

		const userId = url.searchParams.get('userId');
		if (!userId) return new Response('Missing userId query parameter', { status: 400 });

		if (request.method === 'OPTIONS') {
			return new Response(null, {
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
					'Access-Control-Allow-Headers': '*',
				},
			});
		}
		const JSON_CORS_HEADERS = {
			'Content-Type': 'application/json',
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': '*',
		};

		if (url.pathname === '/getHistory') {
			const history = this.history;
			return new Response(JSON.stringify(history), {
				headers: JSON_CORS_HEADERS,
			});
		}
		if (url.pathname === '/clearHistory') {
			if (request.method !== 'POST') {
				return new Response('Method not allowed', { status: 405 });
			}

			await this.clearMessages();

			return new Response(JSON.stringify({ success: true }), {
				headers: JSON_CORS_HEADERS,
			});
		}

		if (url.pathname === '/connect') {
			if (request.headers.get('Connection') !== 'Upgrade') {
				return new Response('Expected Connection: Upgrade', { status: 400 });
			}

			if (request.headers.get('Upgrade') !== 'websocket') {
				return new Response('Expected Upgrade: websocket', { status: 400 });
			}

			const webSocketPair = new WebSocketPair();
			const [client, server] = Object.values(webSocketPair);

			this.ctx.acceptWebSocket(server);

			return new Response(null, {
				status: 101,
				webSocket: client,
			});
		}
		return new Response('Not found', { status: 404 });
	}

async webSocketMessage(websocket: WebSocket, message: ArrayBuffer | string) {
  try {
    const userMessage = JSON.parse(message.toString());

    if (userMessage.type === 'prompt') {
      // Fetch chat history
      const history = await this.getMessages();

      // Combine history + latest user message
      const messages = [...history, { role: 'user', content: userMessage.prompt }];

      // Stream model response
      const stream = await this.env.AI.run('@cf/meta/llama-3-8b-instruct', {
        stream: true,
        messages,
      });

      let finalMessage = '';
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        for await (const chunk of stream) {
          let str = chunk;
          if (chunk instanceof Uint8Array) {
            str = decoder.decode(chunk, { stream: true });
          }

          buffer += str;
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed.startsWith('data: ')) {
              const data = trimmed.slice(6).trim();
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);

                if (parsed.response) {
                  websocket.send(JSON.stringify({ type: 'token', response: parsed.response }));
                  finalMessage += parsed.response;
                }

                if (parsed.usage) {
                  websocket.send(JSON.stringify({ type: 'usage', usage: parsed.usage }));
                }

              } catch (e) {
                console.error('Failed to parse chunk:', data);
                websocket.send(JSON.stringify({ type: 'token', token: data }));
              }
            }
          }
        }

        if (buffer.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(buffer.slice(6).trim());
            if (parsed.response) {
              websocket.send(JSON.stringify({ type: 'token', response: parsed.response }));
              finalMessage += parsed.response;
            }
          } catch {}
        }

        websocket.send(JSON.stringify({ type: 'done' }));

      } catch (err) {
        websocket.send(JSON.stringify({ type: 'error', error: err.message }));
      }

      // Save assistant response to history
      if (finalMessage) {
        await this.addMessage('user', userMessage.prompt);
        await this.addMessage('assistant', finalMessage);
      }
    }

  } catch (err) {
    websocket.send(JSON.stringify({
      type: 'error',
      error: err.message,
      message: message.toString()
    }));
  }
}

}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		const userId = url.searchParams.get('userId');
		if (!userId) return new Response('Missing userId query parameter', { status: 400 });

		const id = env.USER_CHAT_HISTORY.idFromName(userId);
		const obj = env.USER_CHAT_HISTORY.get(id);

		return obj.fetch(request);
	},
};
