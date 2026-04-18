import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  is_admin: boolean;
  is_active: boolean;
  total_cost_usd: number;
  daily_cap_usd: number;
  created_at: string;
};

export type WorkspaceLite = { id: string; name: string; owner_id: string };

const ACTIVE_WS_KEY = "afs.activeWorkspaceId";

type Ctx = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  workspaces: WorkspaceLite[];
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: (id: string | null) => void;
  refreshWorkspaces: () => Promise<WorkspaceLite[]>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthCtx = createContext<Ctx>({
  user: null,
  session: null,
  profile: null,
  loading: true,
  workspaces: [],
  activeWorkspaceId: null,
  setActiveWorkspaceId: () => {},
  refreshWorkspaces: async () => [],
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<WorkspaceLite[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string | null>(null);

  const setActiveWorkspaceId = useCallback((id: string | null) => {
    setActiveWorkspaceIdState(id);
    try {
      if (id) localStorage.setItem(ACTIVE_WS_KEY, id);
      else localStorage.removeItem(ACTIVE_WS_KEY);
    } catch {}
  }, []);

  const loadProfile = async (uid: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("id,email,full_name,is_admin,is_active,total_cost_usd,daily_cap_usd,created_at")
      .eq("id", uid)
      .maybeSingle();
    if (data) {
      if (!data.is_active) {
        await supabase.auth.signOut();
        setProfile(null);
        setUser(null);
        setSession(null);
        alert("Tu cuenta está suspendida. Contacta al administrador.");
        return;
      }
      setProfile(data as unknown as Profile);
    }
  };

  const refreshWorkspaces = useCallback(async (): Promise<WorkspaceLite[]> => {
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) {
      setWorkspaces([]);
      return [];
    }
    // RLS already filters: admins see all, members see their own
    const { data, error } = await supabase
      .from("workspaces")
      .select("id,name,owner_id")
      .order("created_at", { ascending: true });
    if (error) {
      console.warn("workspaces load error", error.message);
      setWorkspaces([]);
      return [];
    }
    const list = (data ?? []) as WorkspaceLite[];
    setWorkspaces(list);

    // pick active: stored → first
    let stored: string | null = null;
    try { stored = localStorage.getItem(ACTIVE_WS_KEY); } catch {}
    const exists = stored && list.some((w) => w.id === stored);
    if (exists) {
      setActiveWorkspaceIdState(stored!);
    } else if (list.length > 0) {
      setActiveWorkspaceIdState(list[0].id);
      try { localStorage.setItem(ACTIVE_WS_KEY, list[0].id); } catch {}
    } else {
      setActiveWorkspaceIdState(null);
    }
    return list;
  }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        setTimeout(() => {
          loadProfile(s.user.id);
          refreshWorkspaces();
        }, 0);
      } else {
        setProfile(null);
        setWorkspaces([]);
        setActiveWorkspaceIdState(null);
      }
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        Promise.all([loadProfile(s.user.id), refreshWorkspaces()]).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, [refreshWorkspaces]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setWorkspaces([]);
    setActiveWorkspaceIdState(null);
    try { localStorage.removeItem(ACTIVE_WS_KEY); } catch {}
  };

  const refreshProfile = async () => {
    if (user) await loadProfile(user.id);
  };

  return (
    <AuthCtx.Provider
      value={{
        user, session, profile, loading,
        workspaces, activeWorkspaceId, setActiveWorkspaceId, refreshWorkspaces,
        signOut, refreshProfile,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
