import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Zap, Loader2 } from "lucide-react";

const search = z.object({
  mode: z.enum(["signin", "signup"]).default("signin"),
});

export const Route = createFileRoute("/auth")({
  validateSearch: search,
  component: AuthPage,
});

function AuthPage() {
  const { mode } = Route.useSearch();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [isSignup, setIsSignup] = useState(mode === "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setIsSignup(mode === "signup"), [mode]);

  useEffect(() => {
    if (!authLoading && user) navigate({ to: "/dashboard" });
  }, [user, authLoading, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: `${window.location.origin}/dashboard`,
          },
        });
        if (error) throw error;
        if (data.user && !data.session) {
          toast.success("Revisa tu email para verificar la cuenta.");
        } else if (data.session) {
          toast.success("Cuenta creada");
          navigate({ to: "/dashboard" });
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          if (error.message.toLowerCase().includes("email not confirmed")) {
            toast.error("Debes verificar tu email antes de iniciar sesión.");
          } else {
            toast.error(error.message);
          }
          return;
        }
        // Check if active
        const { data: { user: u } } = await supabase.auth.getUser();
        if (u) {
          const { data: prof } = await supabase
            .from("profiles")
            .select("is_active")
            .eq("id", u.id)
            .maybeSingle();
          if (prof && !prof.is_active) {
            await supabase.auth.signOut();
            toast.error("Tu cuenta está suspendida. Contacta al administrador.");
            return;
          }
        }
        toast.success("Bienvenido");
        navigate({ to: "/dashboard" });
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          <span className="font-mono-display text-sm font-bold">
            AD FACTORY <span className="text-primary">STUDIO</span>
          </span>
        </Link>

        <div className="rounded-2xl border border-border bg-card p-8">
          <h1 className="font-mono-display text-xl font-bold text-foreground">
            {isSignup ? "Crear cuenta" : "Iniciar sesión"}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {isSignup
              ? "El primer usuario registrado será el administrador."
              : "Continúa con tu email y contraseña."}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {isSignup && (
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Nombre
                </Label>
                <Input
                  id="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  autoComplete="name"
                  className="bg-background"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="bg-background"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pwd" className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Password
              </Label>
              <Input
                id="pwd"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={isSignup ? "new-password" : "current-password"}
                className="bg-background"
              />
            </div>

            <Button
              type="submit"
              disabled={busy}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : isSignup ? "Crear cuenta" : "Sign in"}
            </Button>
          </form>

          <div className="mt-6 text-center text-xs text-muted-foreground">
            {isSignup ? (
              <>
                ¿Ya tienes cuenta?{" "}
                <Link to="/auth" search={{ mode: "signin" }} className="text-primary hover:underline">
                  Sign in
                </Link>
              </>
            ) : (
              <>
                ¿No tienes cuenta?{" "}
                <Link to="/auth" search={{ mode: "signup" }} className="text-primary hover:underline">
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
