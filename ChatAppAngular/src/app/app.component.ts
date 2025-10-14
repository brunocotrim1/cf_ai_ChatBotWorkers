import { Component, OnDestroy, OnInit, ViewChild,ElementRef } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WebsocketService } from './services/websocket.service';
import { ChatMessage } from './models/message.model';
import { HttpClientModule } from '@angular/common/http';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  providers: [DatePipe]
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'ChatAppAngular';

  userId = '';
  inputText = '';
  messages: ChatMessage[] = [];
  connected = false;
  loading = false; 
  private subs: Subscription[] = [];
  private assistantStreamBuffer = '';
  @ViewChild('target') messagesDiv!: ElementRef<HTMLDivElement>;

  constructor(private wsService: WebsocketService) {}

  ngOnInit() {
    this.subs.push(
      this.wsService.status().subscribe((s) => {
        this.connected = s;
      })
    );

    this.subs.push(
      this.wsService.messages().subscribe((msg) => {
        // Expecting streaming tokens of type { type: 'token', response: '...' } and { type: 'done' }
        if (!msg) return;

        if (msg.type === 'token') {
          const tokenText = msg.response ?? msg.token ?? msg.data ?? '';
          // append or create assistant message in UI
          if (this.assistantStreamBuffer === '') {
            // create new assistant message
            const newMsg: ChatMessage = { role: 'assistant', content: tokenText, time: new Date().toISOString() };
            this.messages.push(newMsg);
            this.assistantStreamBuffer = tokenText;
          } else {
            // update latest assistant message
            this.assistantStreamBuffer += tokenText;
            const last = this.messages[this.messages.length - 1];
            if (last && last.role === 'assistant') {
              last.content = this.assistantStreamBuffer;
            }
            setTimeout(() => {
              this.messagesDiv.nativeElement.scrollTop = this.messagesDiv.nativeElement.scrollHeight;
            }, 0);
          }
        } else if (msg.type === 'done') {
          // assistant finished
          this.assistantStreamBuffer = '';
          this.loading = false;
        } else if (msg.type === 'raw') {
          // fallback - show raw
          this.messages.push({ role: 'assistant', content: String(msg.data), time: new Date().toISOString() });
        } else {
          // other message types (could be history updates etc)
          // If the server returns complete messages object, handle it:
          if (Array.isArray(msg)) {
            msg.forEach((m: any) => this.pushMessageFromServer(m));
          } else if (msg.role && msg.content) {
            this.pushMessageFromServer(msg);
          }
        }
      })
    );
  }

  private pushMessageFromServer(m: any) {
    const mapped: ChatMessage = { role: m.role ?? 'assistant', content: m.content ?? String(m), time: m.time ?? new Date().toISOString() };
    this.messages.push(mapped);
  }

  async connect() {
    if (!this.userId?.trim()) {
      alert('Please enter a User ID.');
      return;
    }
    this.messages = [];
    try {
      // load history via REST
      const history = await this.wsService.fetchHistory(this.userId);
      if (Array.isArray(history)) {
        this.messages = history.map(h => ({ ...h }));
      }
    } catch (err) {
      console.warn('Could not fetch history', err);
      // continue anyway
    }

    try {
      this.wsService.connect(this.userId);
    } catch (err) {
      console.error(err);
      alert('Failed to connect to websocket: ' + (err as any)?.message);
    }
  }

  disconnect() {
    this.wsService.disconnect();
    this.messages = [];
    this.userId = '';
    this.connected = false;
  }

  async send(el: HTMLElement) {
    const text = this.inputText?.trim();
    if (!text || !this.connected || this.loading) return;
  
    // Push user message
    this.messages.push({ role: 'user', content: text, time: new Date().toISOString() });
    this.inputText = '';
    this.loading = true;
  
    // Wait a bit for Angular to render the new message, then scroll
    setTimeout(() => {
      el.scrollTop = el.scrollHeight;
    }, 0);
  
    try {
      this.wsService.sendPrompt(text);
    } catch (err) {
      console.error(err);
      this.loading = false;
      alert('Failed to send prompt: ' + (err as any)?.message);
    }
  }
  
  async clear() {
    if (!this.userId) return;
    try {
      await this.wsService.clearHistory(this.userId);
      this.messages = [];
    } catch (err) {
      console.error('clearHistory error', err);
    }
  }

  trackByIndex(i: number) {
    return i;
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
    this.wsService.disconnect();
  }
}
