import { Injectable, NgZone } from '@angular/core';
import { Observable, BehaviorSubject, Subject, timer } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { ChatMessage } from '../models/message.model';
import { filter, takeUntil, switchMap } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs'; 

@Injectable({
  providedIn: 'root'
})
export class WebsocketService {
  // Replace with your API base or move to environment.ts
  private readonly API_BASE = 'https://workerai.bruno-cotrim1.workers.dev';
  private ws: WebSocket | null = null;
  private incoming$ = new Subject<any>();
  private connected$ = new BehaviorSubject<boolean>(false);
  private closeSignal$ = new Subject<void>();
  private reconnectDelayMs = 2000;

  constructor(private http: HttpClient, private ngZone: NgZone) {}

  // Observable for raw messages from server
  messages(): Observable<any> {
    return this.incoming$.asObservable();
  }

  // Connection status observable
  status(): Observable<boolean> {
    return this.connected$.asObservable();
  }

  // Initialize or re-init websocket for a given userId
  connect(userId: string) {
    this.disconnect(); // clear prior one
    if (!userId) {
      throw new Error('userId required to connect');
    }
    // Open socket inside ngZone.runOutsideAngular to avoid change detection floods
    const url = this.API_BASE.replace(/^http/, 'ws') + `/connect?userId=${encodeURIComponent(userId)}`;
    try {
      this.ngZone.runOutsideAngular(() => {
        this.ws = new WebSocket(url);
        this.ws.onopen = () => {
          this.ngZone.run(() => {
            this.connected$.next(true);
          });
        };

        let assistantBuffer = '';

        this.ws.onmessage = (event) => {
          // parse JSON if possible, otherwise pass raw
          let parsed: any;
          try {
            parsed = JSON.parse(event.data);
          } catch {
            parsed = { type: 'raw', data: event.data };
          }
          this.ngZone.run(() => {
            this.incoming$.next(parsed);
          });
        };

        this.ws.onclose = () => {
          this.ngZone.run(() => {
            this.connected$.next(false);
          });
          // reconnect after delay unless explicitly closed
          timer(this.reconnectDelayMs).pipe(takeUntil(this.closeSignal$)).subscribe(() => {
            // only try reconnect if not closed by disconnect()
            if (!this.closeSignal$.isStopped) {
              this.connect(userId);
              console.log('WebSocket reconnecting...');
            }
          });
        };

        this.ws.onerror = (err) => {
          console.error('WebSocket error', err);
        };
      });
    } catch (err) {
      console.error('WebSocket connect failed', err);
    }
  }

  sendPrompt(prompt: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'prompt', prompt }));
    } else {
      throw new Error('WebSocket not connected');
    }
  }

  disconnect() {
    // signal to stop reconnect timers
    try {
      this.closeSignal$.next();
      this.closeSignal$.complete();
    } catch {}
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.connected$.next(false);
    // create a fresh closeSignal$ for possible future connect
    this.closeSignal$ = new Subject<void>();
  }

   fetchHistory(userId: string): Promise<ChatMessage[]> {
    const url = `${this.API_BASE}/getHistory?userId=${encodeURIComponent(userId)}`;
    return firstValueFrom(this.http.get<ChatMessage[]>(url));
  }
  
  clearHistory(userId: string): Promise<void> {
    const url = `${this.API_BASE}/clearHistory?userId=${encodeURIComponent(userId)}`;
    return firstValueFrom(this.http.post<void>(url, {}));
  }
  
}
