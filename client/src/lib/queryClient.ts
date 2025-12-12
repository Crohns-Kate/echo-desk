import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Active tenant storage key
const ACTIVE_TENANT_KEY = "echodesk_active_tenant_id";

/**
 * Get the currently active tenant ID from localStorage
 */
export function getActiveTenantId(): number | null {
  const stored = localStorage.getItem(ACTIVE_TENANT_KEY);
  if (stored) {
    const parsed = parseInt(stored, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

/**
 * Set the active tenant ID in localStorage
 */
export function setActiveTenantId(tenantId: number | null): void {
  if (tenantId) {
    localStorage.setItem(ACTIVE_TENANT_KEY, tenantId.toString());
  } else {
    localStorage.removeItem(ACTIVE_TENANT_KEY);
  }
}

/**
 * Get headers for API requests, including X-Tenant-Id if set
 */
export function getApiHeaders(contentType?: string): HeadersInit {
  const headers: HeadersInit = {};

  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  const tenantId = getActiveTenantId();
  if (tenantId) {
    headers["X-Tenant-Id"] = tenantId.toString();
  }

  return headers;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers = getApiHeaders(data ? "application/json" : undefined);

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const headers = getApiHeaders();

    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      headers,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
