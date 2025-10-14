export interface ChatMessage {
    role: 'user' | 'assistant' | string;
    content: string;
    time?: string; // optional timestamp for UI
  }
  