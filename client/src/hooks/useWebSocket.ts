import { useEffect, useRef, useState } from 'react';
import { queryClient } from '@/lib/queryClient';

type WebSocketMessage = {
  event: string;
  data: any;
};

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();

  const connect = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const WS_TOKEN = import.meta.env.VITE_WS_TOKEN;
    const wsUrl = `${protocol}//${window.location.host}/ws${WS_TOKEN ? `?ws_token=${WS_TOKEN}` : ''}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WS] Connected');
      setIsConnected(true);
      reconnectAttemptRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        console.log('[WS] Message:', message);

        switch (message.event) {
          case 'call:started':
          case 'call:updated':
          case 'call:ended':
            queryClient.invalidateQueries({ queryKey: ['/api/calls'] });
            queryClient.invalidateQueries({ queryKey: ['/api/calls/recent'] });
            queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
            break;

          case 'alert:created':
          case 'alert:dismissed':
            queryClient.invalidateQueries({ queryKey: ['/api/alerts'] });
            queryClient.invalidateQueries({ queryKey: ['/api/alerts/recent'] });
            queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
            break;
        }
      } catch (e) {
        console.error('[WS] Failed to parse message', e);
      }
    };

    ws.onerror = (error) => {
      console.error('[WS] Error:', error);
    };

    ws.onclose = () => {
      console.log('[WS] Disconnected');
      setIsConnected(false);
      
      // Reconnect with exponential backoff
      const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 30000);
      console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttemptRef.current + 1})`);
      
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectAttemptRef.current += 1;
        connect();
      }, delay);
    };
  };

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return { isConnected };
}
