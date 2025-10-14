import { DurableObject } from 'cloudflare:workers';

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
				const stream = await this.env.AI.run('@cf/meta/llama-3-8b-instruct', { stream: true, messages: messages });
				const reader = stream.getReader();
				const decoder = new TextDecoder();
				let finalMessage = '';

				while (true) {
					const { done, value } = await reader.read();
					if (done) {
						websocket.send(JSON.stringify({ type: 'done' }));
						break;
					}

					const chunk = decoder.decode(value, { stream: true });
					const lines = chunk.split('\n').filter((line) => line.trim());

					for (const line of lines) {
						try {
							if (line.startsWith('data: ')) {
								const data = line.slice(6);
								if (data === '[DONE]') {
									websocket.send(JSON.stringify({ type: 'done' }));
									break;
								}
								const parsed = JSON.parse(data);

								if (parsed.usage) {
									websocket.send(JSON.stringify({ type: 'usage', usage: parsed.usage }));
								}

								if (parsed.response) {
									websocket.send(JSON.stringify({ type: 'token', response: parsed.response }));
									finalMessage += parsed.response;
								} else {
									websocket.send(JSON.stringify({ type: 'data', data }));
								}
							} else {
								websocket.send(JSON.stringify({ type: 'token', token: line }));
							}
						} catch {
							websocket.send(JSON.stringify({ type: 'token', token: line }));
						}
					}
				}

				// Save assistant response to history
				if (finalMessage) {
					await this.addMessage('user', userMessage.prompt);
					await this.addMessage('assistant', finalMessage);
				}
			}
		} catch (err) {
			websocket.send(JSON.stringify({ type: 'error', error: err.message, message: message.toString() }));
		}
	}
}

// ---------------- Worker Entry ----------------
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
