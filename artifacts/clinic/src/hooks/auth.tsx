import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

export type UserRole = "super_admin" | "admin" | "doctor" | "nurse" | "front_desk" | "xray_staff" | "lab_staff" | "compliance_officer" | "billing_manager" | "pharmacist";

export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  fullNameAr?: string;
  email?: string;
  role: UserRole;
  isActive: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  login: (user: AuthUser) => void;
  logout: () => void;
  isAuthenticated: boolean;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  // On mount: restore session by calling /auth/me — HttpOnly cookie is sent automatically
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && data.id) setUser(data as AuthUser);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const login = (user: AuthUser) => {
    setUser(user);
  };

  const logout = async () => {
    const csrfToken = typeof document !== "undefined"
      ? document.cookie.split("; ").find(row => row.startsWith("_csrf="))?.split("=")[1]
      : undefined;
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: csrfToken ? { "X-CSRF-Token": csrfToken } : {},
    }).catch(() => {});
    setUser(null);
    queryClient.clear();
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isAuthenticated: !!user, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function canAccess(role: UserRole, allowedRoles: UserRole[]): boolean {
  // super_admin MUST bypass ALL access checks — architectural invariant.
  if (role === "super_admin") return true;
  return allowedRoles.includes(role);
}
