/**
 * Authentication Hook and Context
 * Manages user authentication state across the app
 */

import { createContext, useContext, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// Types
export interface User {
  id: number;
  tenantId: number | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: "super_admin" | "tenant_admin" | "tenant_staff";
  isActive: boolean;
  emailVerified: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Tenant {
  id: number;
  slug: string;
  clinicName: string;
  phoneNumber: string | null;
  timezone: string;
  onboardingCompleted: boolean;
  onboardingStep: number;
  subscriptionTier: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  isActive: boolean;
}

export interface AuthState {
  user: User | null;
  tenant: Tenant | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  isTenantAdmin: boolean;
  mustChangePassword: boolean;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthContextValue extends AuthState {
  login: (credentials: LoginCredentials) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
  refreshAuth: () => void;
}

// Create context
export const AuthContext = createContext<AuthContextValue | null>(null);

// API functions
async function fetchCurrentUser(): Promise<{ user: User; tenant: Tenant | null } | null> {
  const response = await fetch("/api/auth/me", {
    credentials: "include",
  });

  if (!response.ok) {
    if (response.status === 401) {
      return null;
    }
    throw new Error("Failed to fetch user");
  }

  return response.json();
}

async function loginUser(credentials: LoginCredentials): Promise<{
  user: User;
  tenant: Tenant | null;
  mustChangePassword: boolean;
}> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(credentials),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Login failed");
  }

  return data;
}

async function logoutUser(): Promise<void> {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Logout failed");
  }
}

async function changeUserPassword(currentPassword: string, newPassword: string): Promise<void> {
  const response = await fetch("/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ currentPassword, newPassword }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Password change failed");
  }
}

// Custom hook to use auth context
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

// Hook to provide auth state (used in AuthProvider)
export function useAuthState(): AuthContextValue {
  const queryClient = useQueryClient();

  // Fetch current user
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["currentUser"],
    queryFn: fetchCurrentUser,
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: loginUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
    },
  });

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: logoutUser,
    onSuccess: () => {
      queryClient.setQueryData(["currentUser"], null);
      queryClient.clear(); // Clear all cached data on logout
    },
  });

  // Change password mutation
  const changePasswordMutation = useMutation({
    mutationFn: ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) =>
      changeUserPassword(currentPassword, newPassword),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
    },
  });

  // Computed state
  const user = data?.user ?? null;
  const tenant = data?.tenant ?? null;
  const isAuthenticated = !!user;
  const isSuperAdmin = user?.role === "super_admin";
  const isTenantAdmin = user?.role === "tenant_admin" || user?.role === "super_admin";
  const mustChangePassword = user?.mustChangePassword ?? false;

  // Actions
  const login = useCallback(
    async (credentials: LoginCredentials): Promise<{ success: boolean; error?: string }> => {
      try {
        await loginMutation.mutateAsync(credentials);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Login failed" };
      }
    },
    [loginMutation]
  );

  const logout = useCallback(async (): Promise<void> => {
    await logoutMutation.mutateAsync();
  }, [logoutMutation]);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> => {
      try {
        await changePasswordMutation.mutateAsync({ currentPassword, newPassword });
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Password change failed" };
      }
    },
    [changePasswordMutation]
  );

  const refreshAuth = useCallback(() => {
    refetch();
  }, [refetch]);

  return {
    user,
    tenant,
    isLoading,
    isAuthenticated,
    isSuperAdmin,
    isTenantAdmin,
    mustChangePassword,
    login,
    logout,
    changePassword,
    refreshAuth,
  };
}
