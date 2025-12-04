/**
 * Auth Provider Component
 * Wraps the app with authentication context
 */

import { ReactNode } from "react";
import { AuthContext, useAuthState } from "@/hooks/useAuth";

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const authState = useAuthState();

  return (
    <AuthContext.Provider value={authState}>
      {children}
    </AuthContext.Provider>
  );
}
