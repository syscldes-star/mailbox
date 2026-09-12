import { create } from "zustand";
import { apiGet, apiPost, ApiError } from "@/lib/api/client";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Administrator",
  manager: "Manager",
  staff: "Staff",
  readonly: "Read Only",
};

/** Display-friendly label for a role string -- falls back to the raw
 * value (capitalized) for any role not in the known set, rather than
 * showing nothing. */
export function getRoleLabel(role: string | null): string {
  if (!role) return "";
  return ROLE_LABELS[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
}

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
}

// This app has no Workspace model of its own (see app/api/auth/me/route.ts) --
// name is intentionally absent here, unlike the main/site apps' version of
// this store.
export interface AuthWorkspace {
  id: string;
}

interface MeResponse {
  user: AuthUser;
  workspace: AuthWorkspace;
  role: string;
}

interface AuthState {
  user: AuthUser | null;
  workspace: AuthWorkspace | null;
  role: string | null;
  isLoading: boolean;

  checkSession: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  workspace: null,
  role: null,
  isLoading: true,

  checkSession: async () => {
    try {
      const data = await apiGet<MeResponse>("/api/auth/me");
      set({ user: data.user, workspace: data.workspace, role: data.role, isLoading: false });
    } catch {
      // Not logged in is a normal outcome here, not an error to surface.
      set({ user: null, workspace: null, role: null, isLoading: false });
    }
  },

  logout: async () => {
    await apiPost("/api/auth/logout");
    set({ user: null, workspace: null, role: null, isLoading: false });
  },
}));

export { ApiError };
