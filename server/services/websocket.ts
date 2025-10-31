import { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

export function initializeWebSocket(server: Server) {
  wss = new WebSocketServer({ server, path: '/ws' });
  
  wss.on('connection', (ws: WebSocket) => {
    console.log('[WS] Client connected');
    clients.add(ws);
    
    ws.on('close', () => {
      console.log('[WS] Client disconnected');
      clients.delete(ws);
    });
    
    ws.on('error', (err) => {
      console.error('[WS] Client error', err);
      clients.delete(ws);
    });
  });
  
  console.log('[WS] WebSocket server initialized');
}

export function broadcastEvent(event: string, data: any) {
  if (!wss) return;
  
  const message = JSON.stringify({ event, data });
  
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

export function emitCallStarted(call: any) {
  broadcastEvent('call:started', call);
}

export function emitCallUpdated(call: any) {
  broadcastEvent('call:updated', call);
}

export function emitCallEnded(call: any) {
  broadcastEvent('call:ended', call);
}

export function emitAlertCreated(alert: any) {
  broadcastEvent('alert:created', alert);
}

export function emitAlertDismissed(alert: any) {
  broadcastEvent('alert:dismissed', alert);
}
