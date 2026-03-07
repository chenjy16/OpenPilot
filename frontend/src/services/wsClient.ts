// WebSocket 消息类型
export type WSMessageType =
  | 'stream_start'
  | 'stream_chunk'
  | 'stream_end'
  | 'error'
  | 'tool_call_start'
  | 'tool_call_result'
  | 'process_output'
  | 'resource_update'
  | 'recorder_step'
  | 'download_progress'
  | 'task_execution';

// WebSocket 消息接口
export interface WSMessage {
  type: WSMessageType;
  sessionId?: string;
  data?: unknown;
}

// 连接状态
export type WSStatus = 'connected' | 'disconnected' | 'reconnecting';

// 事件回调类型
type WSEventCallback = (message: WSMessage) => void;

// Derive WS URL from current page location (works with any host/port/proxy)
const DEFAULT_URL = typeof window !== 'undefined'
  ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
  : 'ws://localhost:3000/ws';
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 5000;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Map<string, Set<WSEventCallback>>();
  private _status: WSStatus = 'disconnected';
  private _url: string = DEFAULT_URL;

  get status(): WSStatus {
    return this._status;
  }

  connect(url: string = DEFAULT_URL): void {
    this._url = url;
    this.cleanup();

    this._status = this.reconnectAttempts > 0 ? 'reconnecting' : 'disconnected';

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this._status = 'connected';
      this.emit('status_change', { type: 'status_change' as WSMessageType, data: { status: 'connected' } });
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const msg: WSMessage = JSON.parse(event.data as string);
        this.handleMessage(msg);
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.handleDisconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror, so disconnect handling happens there
    };
  }

  disconnect(): void {
    this.reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // Prevent auto-reconnect
    this.cleanup();
    this._status = 'disconnected';
    this.emit('status_change', { type: 'status_change' as WSMessageType, data: { status: 'disconnected' } });
  }

  private cleanup(): void {
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  private handleDisconnect(): void {
    this.ws = null;

    if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      this._status = 'reconnecting';
      this.emit('status_change', { type: 'status_change' as WSMessageType, data: { status: 'reconnecting' } });

      this.reconnectTimer = setTimeout(() => {
        this.reconnectAttempts++;
        this.connect(this._url);
      }, RECONNECT_DELAY_MS);
    } else {
      this._status = 'disconnected';
      this.emit('status_change', { type: 'status_change' as WSMessageType, data: { status: 'disconnected' } });
    }
  }

  /** Send a JSON message through the WebSocket connection */
  send(data: Record<string, unknown>): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  /** Manual reconnect — resets attempt counter and connects */
  manualReconnect(): void {
    this.reconnectAttempts = 0;
    this.connect(this._url);
  }

  private handleMessage(msg: WSMessage): void {
    this.emit(msg.type, msg);
  }

  // --- Event listener pattern ---

  on(type: string, callback: WSEventCallback): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(callback);
  }

  off(type: string, callback: WSEventCallback): void {
    this.listeners.get(type)?.delete(callback);
  }

  private emit(type: string, message: WSMessage): void {
    this.listeners.get(type)?.forEach((cb) => cb(message));
  }
}

// Singleton instance
export const wsClient = new WebSocketClient();
