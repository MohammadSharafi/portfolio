import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, Clock, Download, MapPin, Sparkles } from 'lucide-react';
import { profile, socialLinks } from '@/data/profile';
import { useReducedMotion } from '@/hooks/useReducedMotion';

function RoleRotator({ roles }: { roles: readonly string[] }) {
  const prefersReducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion || roles.length < 2) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % roles.length);
    }, 2800);
    return () => window.clearInterval(timer);
  }, [prefersReducedMotion, roles.length]);

  // The live region announces each change; the fixed height stops the headline
  // below from reflowing as phrases of different lengths cycle through.
  return (
    <span className="relative block h-[1.4em] overflow-hidden" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={roles[index]}
          initial={prefersReducedMotion ? false : { y: '100%', opacity: 0 }}
          animate={{ y: '0%', opacity: 1 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { y: '-100%', opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-x-0 block"
        >
          {roles[index]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

const codeLines: ReadonlyArray<ReadonlyArray<{ text: string; tone: string }>> = [
  [
    { text: 'class ', tone: 'text-accent' },
    { text: 'Engineer ', tone: 'text-foreground' },
    { text: 'extends ', tone: 'text-accent' },
    { text: 'Human {', tone: 'text-foreground' },
  ],
  [
    { text: '  final ', tone: 'text-accent' },
    { text: 'domain = ', tone: 'text-foreground' },
    { text: "'digital health'", tone: 'text-success' },
    { text: ';', tone: 'text-foreground' },
  ],
  [
    { text: '  final ', tone: 'text-accent' },
    { text: 'stack = [', tone: 'text-foreground' },
    { text: "'Flutter'", tone: 'text-success' },
    { text: ', ', tone: 'text-foreground' },
    { text: "'Python'", tone: 'text-success' },
    { text: '];', tone: 'text-foreground' },
  ],
  [],
  [{ text: '  @override', tone: 'text-muted-foreground' }],
  [
    { text: '  Future', tone: 'text-primary' },
    { text: '<', tone: 'text-foreground' },
    { text: 'Product', tone: 'text-primary' },
    { text: '> ', tone: 'text-foreground' },
    { text: 'build', tone: 'text-foreground' },
    { text: '(Problem p) ', tone: 'text-foreground' },
    { text: 'async ', tone: 'text-accent' },
    { text: '{', tone: 'text-foreground' },
  ],
  [
    { text: '    await ', tone: 'text-accent' },
    { text: 'understand(p);', tone: 'text-foreground' },
  ],
  [
    { text: '    return ', tone: 'text-accent' },
    { text: 'ship(measure: ', tone: 'text-foreground' },
    { text: 'true', tone: 'text-primary' },
    { text: ');', tone: 'text-foreground' },
  ],
  [{ text: '  }', tone: 'text-foreground' }],
  [{ text: '}', tone: 'text-foreground' }],
];

function CodeCard() {
  return (
    <div className="glass-strong overflow-hidden rounded-2xl shadow-soft">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="size-3 rounded-full bg-[#ff5f57]" />
        <span className="size-3 rounded-full bg-[#febc2e]" />
        <span className="size-3 rounded-full bg-[#28c840]" />
        <span className="ml-2 font-mono text-xs text-muted-foreground">engineer.dart</span>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed">
        <code>
          {codeLines.map((line, lineIndex) => (
            <span key={lineIndex} className="block">
              {line.length === 0
                ? ' '
                : line.map((token, tokenIndex) => (
                    <span key={tokenIndex} className={token.tone}>
                      {token.text}
                    </span>
                  ))}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

export function Hero() {
  const prefersReducedMotion = useReducedMotion();

  return (
    <section id="top" className="relative overflow-hidden px-4 pb-20 pt-32 sm:pt-40">
      <div className="bg-grid absolute inset-0 -z-10 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      <div className="absolute -right-32 -top-32 -z-10 size-[32rem] rounded-full bg-primary/20 blur-3xl" />
      <div className="absolute -bottom-40 -left-32 -z-10 size-[28rem] rounded-full bg-accent/20 blur-3xl" />

      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="space-y-7"
        >
          <p className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm">
            <span className="relative flex size-2">
              <span className="animate-pulse-ring absolute inline-flex size-full rounded-full bg-success" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
            {profile.availability}
          </p>

          <div className="space-y-3">
            <h1 className="font-display text-4xl font-bold leading-[1.1] sm:text-6xl lg:text-7xl">
              {profile.firstName} <span className="text-gradient">{profile.lastName}</span>
            </h1>
            <p className="font-display text-xl text-muted-foreground sm:text-3xl">
              <RoleRotator roles={profile.roleRotation} />
            </p>
          </div>

          <p className="max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            {profile.tagline}
          </p>

          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <dt className="sr-only">Location</dt>
              <MapPin className="size-4 text-primary" aria-hidden="true" />
              <dd>{profile.location}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="sr-only">Timezone</dt>
              <Clock className="size-4 text-primary" aria-hidden="true" />
              <dd>{profile.timezone}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="sr-only">Focus</dt>
              <Sparkles className="size-4 text-primary" aria-hidden="true" />
              <dd>Healthcare & applied AI</dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-3">
            <a
              href="#projects"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-medium text-primary-foreground shadow-soft transition-transform hover:scale-[1.03]"
            >
              View my work
              <ArrowDown className="size-4" aria-hidden="true" />
            </a>
            <a
              href={profile.cvPath}
              download={profile.cvFileName}
              className="glass inline-flex items-center gap-2 rounded-full px-6 py-3 font-medium transition-transform hover:scale-[1.03]"
            >
              <Download className="size-4" aria-hidden="true" />
              Download résumé
            </a>
          </div>

          <ul className="flex gap-3">
            {socialLinks.map(({ label, href, icon: Icon }) => (
              <li key={label}>
                <a
                  href={href}
                  target={href.startsWith('mailto:') ? undefined : '_blank'}
                  rel="noopener noreferrer"
                  className="glass flex size-11 items-center justify-center rounded-full transition-colors hover:bg-primary hover:text-primary-foreground"
                  aria-label={label}
                >
                  <Icon className="size-5" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </motion.div>

        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          className="hidden lg:block"
        >
          <CodeCard />
        </motion.div>
      </div>
    </section>
  );
}
