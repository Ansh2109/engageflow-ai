import Link from "next/link";
import {
  Zap,
  MessageSquare,
  Shield,
  BarChart3,
  ArrowRight,
  CheckCircle,
} from "lucide-react";
import { Instagram } from "@/components/icons/Instagram";

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* ── Navigation ── */}
      <header className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-xl">
            <Zap className="h-6 w-6 text-primary" />
            <span>EngageFlow AI</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
            <Link href="#features" className="hover:text-foreground transition-colors">
              Features
            </Link>
            <Link href="#how-it-works" className="hover:text-foreground transition-colors">
              How it works
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 transition-opacity"
            >
              Get started free
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ── Hero ── */}
        <section className="pt-20 pb-24 px-4 text-center bg-gradient-to-b from-muted/40 to-background">
          <div className="max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary text-sm font-medium px-3 py-1.5 rounded-full mb-6">
              <Instagram className="h-4 w-4" />
              Instagram automation — no coding required
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-tight mb-6">
              Turn comments into{" "}
              <span className="text-primary">conversations</span> automatically
            </h1>
            <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
              EngageFlow AI detects keywords in Instagram comments and DMs, then
              automatically sends your predefined reply — through the{" "}
              <strong>official Meta API</strong>, always compliant.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground font-semibold px-8 py-3.5 rounded-lg hover:opacity-90 transition-opacity text-base"
              >
                Start for free
                <ArrowRight className="h-5 w-5" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 border border-border text-foreground font-semibold px-8 py-3.5 rounded-lg hover:bg-muted transition-colors text-base"
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>

        {/* ── How it works ── */}
        <section id="how-it-works" className="py-20 px-4">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl font-bold text-center mb-4">
              Five steps to automation
            </h2>
            <p className="text-muted-foreground text-center mb-14 max-w-xl mx-auto">
              Connect once, then let EngageFlow handle the repetitive replies.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 md:gap-2 items-start">
              {steps.map((step, i) => (
                <div key={i} className="flex flex-col items-center text-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-lg">
                    {i + 1}
                  </div>
                  <h3 className="font-semibold text-sm">{step.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {step.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Features ── */}
        <section id="features" className="py-20 px-4 bg-muted/40">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl font-bold text-center mb-4">
              Everything you need
            </h2>
            <p className="text-muted-foreground text-center mb-14 max-w-xl mx-auto">
              Built for Instagram creators and businesses who want results, not
              complexity.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {features.map((f, i) => (
                <div
                  key={i}
                  className="bg-card rounded-xl p-6 border border-border flex flex-col gap-4"
                >
                  <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    <f.Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-semibold">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {f.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Compliance banner ── */}
        <section className="py-16 px-4">
          <div className="max-w-3xl mx-auto bg-primary/5 border border-primary/20 rounded-2xl p-8 text-center">
            <Shield className="h-10 w-10 text-primary mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-3">
              100% official Meta API
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-6">
              EngageFlow AI uses only the official Instagram Graph API and Meta
              Webhooks. No scraping, no browser automation, no private APIs.
              Every message is sent through the approved channel — keeping your
              account safe and compliant.
            </p>
            <ul className="flex flex-col sm:flex-row gap-3 justify-center text-sm">
              {["Webhook-driven", "Policy compliant", "No spam risk", "Token encrypted"].map(
                (badge) => (
                  <li
                    key={badge}
                    className="flex items-center gap-1.5 text-muted-foreground"
                  >
                    <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                    {badge}
                  </li>
                )
              )}
            </ul>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="py-20 px-4 text-center">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-3xl font-bold mb-4">Ready to automate?</h2>
            <p className="text-muted-foreground mb-8">
              Connect your Instagram Professional account and create your first
              automation in minutes.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-8 py-3.5 rounded-lg hover:opacity-90 transition-opacity text-base"
            >
              Create your free account
              <ArrowRight className="h-5 w-5" />
            </Link>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-border py-8 px-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <Zap className="h-4 w-4 text-primary" />
            EngageFlow AI
          </div>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-foreground transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">
              Terms
            </Link>
          </div>
          <p>© 2026 EngageFlow AI. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

const steps = [
  { title: "Connect Instagram", desc: "Link your Professional account via official Meta OAuth." },
  { title: "Select a post", desc: "Pick any post or Reel you want to monitor." },
  { title: "Add keywords", desc: "Enter the words that should trigger your automation." },
  { title: "Write your message", desc: "Compose the predefined DM or comment reply to send." },
  { title: "Activate", desc: "Turn it on. EngageFlow handles every eligible interaction." },
];

const features = [
  {
    Icon: MessageSquare,
    title: "Comment-to-DM automation",
    desc: "When someone comments a keyword on your post, automatically send them a private reply.",
  },
  {
    Icon: Zap,
    title: "DM keyword triggers",
    desc: "Reply to incoming DMs instantly when they contain your configured keywords.",
  },
  {
    Icon: BarChart3,
    title: "Activity logs",
    desc: "See every received event, matched automation and execution result at a glance.",
  },
  {
    Icon: Shield,
    title: "Policy-safe by design",
    desc: "Built-in eligibility checks, deduplication and rate safeguards prevent policy violations.",
  },
  {
    Icon: CheckCircle,
    title: "No AI key required",
    desc: "The core product works with simple predefined messages — no Gemini or OpenAI key needed.",
  },
  {
    Icon: Instagram,
    title: "Professional accounts",
    desc: "Connect any eligible Instagram Business or Creator account through official Meta OAuth.",
  },
];
