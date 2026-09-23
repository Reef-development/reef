import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import reefLogo from "@/assets/reef-logo.png.asset.json";
import reefVideo from "@/assets/reef-login.mp4.asset.json";
import reefPoster from "@/assets/reef-login-poster.jpg.asset.json";
import { Mountain, Users, Building2, Gauge } from "lucide-react";

const STATS = [
  { icon: Users, value: "42", label: "Active crew", sub: "on contract" },
  { icon: Building2, value: "03", label: "Client mines", sub: "Mpumalanga" },
  { icon: Mountain, value: "11", label: "Years running", sub: "since 2014" },
  { icon: Gauge, value: "24/7", label: "Plant uptime", sub: "monitored" },
] as const;

const TICKER = [
  "MAGNETITE · 18.4 t on hand",
  "DMS PLANT · running",
  "NORTH PIT · 1 240 t MTD",
  "R 148.20 / TON",
  "WASH PLANT · service due 9d",
  "SOUTH PIT · 0 downtime 72h",
];

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: "Sign in — Reef Ops" },
      { name: "description", content: "Sign in to Reef Energy Engineering Fuels operations platform." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [signupRole, setSignupRole] = useState<"worker" | "owner" | "manager">("worker");
  const [loading, setLoading] = useState(false);

  const onLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Signed in");
    navigate({ to: "/" });
  };

  const onSignup = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: fullName, role: signupRole },
      },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Account created — check your email if confirmation is required.");
  };

  const onGoogle = async () => {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) return toast.error(result.error.message ?? "Google sign-in failed");
    if (result.redirected) return;
    navigate({ to: "/" });
  };

  const quickLogin = async (testEmail: string) => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: testEmail, password: "test123" });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success(`Signed in as ${testEmail}`);
    navigate({ to: "/" });
  };

  return (
    <div
      className="min-h-screen grid lg:grid-cols-[1.1fr_1fr] relative overflow-hidden"
      style={{ background: "#0d1b2a" }}
    >
      {/* LEFT — brand panel */}
      <div className="relative hidden lg:flex flex-col justify-between p-10 xl:p-12 gap-8 text-primary-foreground overflow-hidden animate-fade-in-soft"
           style={{ background: "linear-gradient(155deg, #0d1b2a 0%, #0a1522 55%, #05080e 100%)" }}>
        {/* looping site footage */}
        <video
          className="reef-video absolute inset-0 h-full w-full object-cover"
          src={reefVideo.url}
          poster={reefPoster.url}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
        />
        <div className="absolute inset-0 pointer-events-none"
             style={{ background: "linear-gradient(155deg, rgba(13,27,42,0.82) 0%, rgba(10,21,34,0.88) 55%, rgba(5,8,14,0.95) 100%)" }} />
        <div className="reef-sweep absolute inset-0 pointer-events-none overflow-hidden" />
        <div className="reef-grain absolute inset-0 pointer-events-none overflow-hidden" />
        {/* diagonal industrial hatch */}
        <div className="absolute inset-0 opacity-[0.08] pointer-events-none"
             style={{ backgroundImage: "repeating-linear-gradient(135deg, #c9a227 0 1px, transparent 1px 16px)" }} />
        {/* corner rivets */}
        <div className="absolute top-6 left-6 h-2 w-2 rounded-full bg-accent/60" />
        <div className="absolute top-6 right-6 h-2 w-2 rounded-full bg-accent/60" />
        <div className="absolute bottom-6 left-6 h-2 w-2 rounded-full bg-accent/60" />
        <div className="absolute bottom-6 right-6 h-2 w-2 rounded-full bg-accent/60" />

        <div className="relative animate-fade-up">
          <img src={reefLogo.url} alt="R.E.E.F — Resource Energy Engineering Fuels" className="h-24 w-auto transition-transform hover:scale-[1.02]" />
          <div className="mining-rule mt-8 max-w-[220px]" />
          <p className="mt-6 text-[10px] tracking-[0.35em] uppercase text-accent/80">Est. 2014 · Mpumalanga</p>
        </div>

        <div className="relative space-y-6 max-w-md animate-fade-up" style={{ animationDelay: "120ms" }}>
          <div className="flex items-center gap-2 text-[10px] tracking-[0.3em] uppercase text-accent/90"
               style={{ fontFamily: "var(--font-sans)", fontWeight: 600 }}>
            <span className="reef-live-dot h-1.5 w-1.5 rounded-full bg-accent" />
            Operations online
          </div>
          <h1 className="text-display text-5xl leading-[1.05] text-white">
            Move earth.<br/>Move numbers.
          </h1>
          <p className="text-sm text-white/70 leading-relaxed max-w-sm normal-case tracking-normal" style={{fontFamily:"var(--font-sans)"}}>
            The operations platform for Resource Energy Engineering Fuels — maintenance,
            magnetite, tonnage and rand-per-ton, live across every contract mine.
          </p>
        </div>

        <div className="relative space-y-6">
          {/* stat rail */}
          <div className="grid grid-cols-2 xl:grid-cols-4 border-t border-l border-accent/20">
            {STATS.map(({ icon: Icon, value, label, sub }, i) => (
              <div key={label}
                   className="reef-scanline border-b border-r border-accent/20 p-4 animate-fade-up transition-colors hover:bg-accent/[0.06]"
                   style={{ animationDelay: `${200 + i * 70}ms` }}>
                <Icon className="h-4 w-4 text-accent/80 mb-3" strokeWidth={1.75} />
                <div className="num-mono text-2xl leading-none text-white">{value}</div>
                <div className="mt-2 text-[10px] tracking-[0.22em] uppercase text-white/70"
                     style={{ fontFamily: "var(--font-sans)", fontWeight: 600 }}>{label}</div>
                <div className="text-[9px] tracking-[0.2em] uppercase text-accent/60"
                     style={{ fontFamily: "var(--font-sans)" }}>{sub}</div>
              </div>
            ))}
          </div>

          {/* live ticker */}
          <div className="relative overflow-hidden border-y border-accent/20 py-2.5">
            <div className="reef-marquee gap-10 pr-10">
              {[...TICKER, ...TICKER].map((t, i) => (
                <span key={i}
                      className="whitespace-nowrap num-mono text-[10px] tracking-[0.18em] uppercase text-white/55">
                  <span className="text-accent/70 mr-2">◆</span>{t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT — form panel */}
      <div className="relative flex items-center justify-center p-4 sm:p-6 md:p-10 bg-background">
        {/* mobile: same footage as an ambient backdrop */}
        <video
          className="reef-video lg:hidden absolute inset-0 h-full w-full object-cover opacity-[0.18]"
          src={reefVideo.url}
          poster={reefPoster.url}
          autoPlay
          loop
          muted
          playsInline
          preload="none"
          aria-hidden="true"
        />
        <div className="absolute inset-0 opacity-[0.5] pointer-events-none"
             style={{ backgroundImage:
               "radial-gradient(oklch(0.75 0.14 85 / 0.06) 1px, transparent 1px), radial-gradient(oklch(0.18 0.03 250 / 0.04) 1px, transparent 1px)",
               backgroundSize: "22px 22px, 22px 22px",
               backgroundPosition: "0 0, 11px 11px" }} />
        <Card className="w-full max-w-md relative border-2 border-primary/10 shadow-[0_30px_80px_-20px_rgba(13,27,42,0.25)] rounded-none animate-scale-in-soft">
          <div className="mining-rule" />
          <CardHeader className="space-y-3 pt-8">
            {/* mobile-only brand */}
            <div className="lg:hidden mx-auto rounded-none px-4 py-3 border border-accent/30 animate-fade-up" style={{ backgroundColor: "#0d1b2a" }}>
              <img src={reefLogo.url} alt="R.E.E.F" className="h-12 w-auto mx-auto" />
            </div>
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-primary/20" />
              <span className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground">Access Terminal</span>
              <div className="h-px flex-1 bg-primary/20" />
            </div>
            <CardTitle className="text-display text-3xl text-center">Sign in to Reef Ops</CardTitle>
            <CardDescription className="text-center text-xs tracking-[0.15em] uppercase">
              Authorised personnel only
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-8">
            <Tabs defaultValue="login">
              <TabsList className="grid w-full grid-cols-2 rounded-none bg-secondary/60">
                <TabsTrigger value="login" className="rounded-none tracking-[0.15em] uppercase text-xs">Sign in</TabsTrigger>
                <TabsTrigger value="signup" className="rounded-none tracking-[0.15em] uppercase text-xs">Register</TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="space-y-4 mt-6">
                <form onSubmit={onLogin} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground">Email</Label>
                    <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                           className="rounded-none h-11 border-primary/20 focus-visible:border-accent" placeholder="you@reef.co" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground">Password</Label>
                    <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                           className="rounded-none h-11 border-primary/20 focus-visible:border-accent" placeholder="••••••••" />
                  </div>
                  <Button type="submit" disabled={loading}
                          className="w-full h-11 rounded-none bg-accent text-accent-foreground hover:bg-accent/90 tracking-[0.2em] uppercase text-xs font-semibold">
                    {loading ? "Verifying…" : "Enter Site"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup" className="space-y-4 mt-6">
                <form onSubmit={onSignup} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground">Full name</Label>
                    <Input required value={fullName} onChange={(e) => setFullName(e.target.value)} className="rounded-none h-11 border-primary/20" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground">Email</Label>
                    <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-none h-11 border-primary/20" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground">Password</Label>
                    <Input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="rounded-none h-11 border-primary/20" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground">Role</Label>
                    <Select value={signupRole} onValueChange={(v) => setSignupRole(v as any)}>
                      <SelectTrigger className="rounded-none h-11 border-primary/20"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="worker">Worker — mobile logging</SelectItem>
                        <SelectItem value="manager">Manager — full dashboard</SelectItem>
                        <SelectItem value="owner">Owner — full dashboard</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="submit" disabled={loading}
                          className="w-full h-11 rounded-none bg-accent text-accent-foreground hover:bg-accent/90 tracking-[0.2em] uppercase text-xs font-semibold">
                    {loading ? "Creating…" : "Request Access"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-primary/15" /></div>
              <div className="relative flex justify-center"><span className="bg-card px-3 text-[10px] tracking-[0.3em] uppercase text-muted-foreground">or</span></div>
            </div>
            <Button variant="outline" className="w-full h-11 rounded-none border-primary/20 tracking-[0.15em] uppercase text-xs" onClick={onGoogle}>
              Continue with Google
            </Button>

            <div className="mt-6 border border-dashed border-accent/40 p-4 space-y-3">
              <div className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground text-center">
                Demo access · password test123
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="secondary" disabled={loading}
                        className="h-10 rounded-none tracking-[0.15em] uppercase text-[10px]"
                        onClick={() => quickLogin("owner@test.com")}>
                  Owner demo
                </Button>
                <Button type="button" variant="secondary" disabled={loading}
                        className="h-10 rounded-none tracking-[0.15em] uppercase text-[10px]"
                        onClick={() => quickLogin("worker@test.com")}>
                  Worker demo
                </Button>
              </div>
            </div>

            {/* mobile stat strip */}
            <div className="lg:hidden mt-6 grid grid-cols-4 border-t border-l border-primary/15">
              {STATS.map(({ value, label }) => (
                <div key={label} className="border-b border-r border-primary/15 py-3 text-center">
                  <div className="num-mono text-base text-foreground">{value}</div>
                  <div className="text-[8px] tracking-[0.15em] uppercase text-muted-foreground mt-1">{label}</div>
                </div>
              ))}
            </div>

            <p className="mt-6 text-center text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
              Reef.co · Farm 43 Hekpoort
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}