import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

export type UserRole = "super_admin" | "admin" | "doctor" | "nurse" | "front_desk" | "xray_staff" | "lab_staff";

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
  token: string | null;
  login: (user: AuthUser, token: string) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const storedToken = localStorage.getItem("clinic_token");
    const storedUser = localStorage.getItem("clinic_user");
    if (storedToken && storedUser) {
      try {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      } catch {
        localStorage.removeItem("clinic_token");
        localStorage.removeItem("clinic_user");
      }
    }
  }, []);

  const login = (user: AuthUser, token: string) => {
    setUser(user);
    setToken(token);
    localStorage.setItem("clinic_token", token);
    localStorage.setItem("clinic_user", JSON.stringify(user));
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem("clinic_token");
    localStorage.removeItem("clinic_user");
    queryClient.clear();
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isAuthenticated: !!user }}>
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
  return allowedRoles.includes(role);
}
