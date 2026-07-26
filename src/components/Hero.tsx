import { lazy, Suspense, useEffect, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { ArrowDown, Clock, Download, MapPin, Sparkles } from 'lucide-react';
import { profile, socialLinks } from '@/data/profile';
import { Journey } from './Journey';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { useRoom } from '@/hooks/useRoom';
import { cn } from '@/lib/utils';

// The Three.js scene and the room geometry stay out of the initial bundle.
const RoomScene = lazy(() => import('./RoomScene'));

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
        <m.span
          key={roles[index]}
          initial={prefersReducedMotion ? false : { y: '100%', opacity: 0 }}
          animate={{ y: '0%', opacity: 1 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { y: '-100%', opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-x-0 block"
        >
          {roles[index]}
        </m.span>
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

export function Hero({ room }: { room: ReturnType<typeof useRoom> }) {
  const prefersReducedMotion = useReducedMotion();
  const { showRoom, quality, progress, roomReady, onRoomReady, sceneRef } = room;
  const [chapter, setChapter] = useState(0);

  // The title card holds through the opening chapter and then hands the frame
  // over to the journey's own captions, which take it from there.
  const copyOpacity = showRoom ? Math.max(0, 1 - Math.max(0, progress - 0.05) / 0.07) : 1;
  // Chapter captions only once the title card is out of the way.
  const captionOpacity = showRoom ? Math.min(1, Math.max(0, (progress - 0.11) / 0.05)) : 1;

  return (
    <section
      id="top"
      ref={sceneRef}
      className={cn(
        'relative',
        // The journey is a lit, dark world. Scoping `dark` here re-binds the
        // colour tokens for the subtree, so the hero reads as one scene in
        // either site theme while the rest of the page follows the toggle.
        showRoom ? 'dark h-[620vh] text-foreground' : 'overflow-hidden px-4 pb-20 pt-32 sm:pt-40'
      )}
    >
      <div
        className={cn(
          showRoom &&
            'sticky top-0 flex h-screen flex-col justify-center overflow-hidden px-4 pt-24'
        )}
      >
        {showRoom ? (
          <>
            {/* The room sits behind the content and is purely decorative — every
              fact it renders also exists in the DOM. */}
            <div className="absolute inset-0 -z-20">
              <Suspense fallback={null}>
                <RoomScene
                  progress={progress}
                  reducedMotion={prefersReducedMotion}
                  quality={quality}
                  onReady={onRoomReady}
                  onChapter={setChapter}
                />
              </Suspense>
            </div>
            {/* Scrim: keeps the overlaid copy at AA contrast over a lit 3D scene.
              Runs bottom-up on a phone, where the captions sit under the frame
              and a side gradient leaves a visible vertical seam across it, and
              left-to-right once there is room for copy beside the scene. */}
            <div
              className="absolute inset-0 -z-10 bg-gradient-to-t from-[#0b0e15] via-[#0b0e15]/70 to-transparent sm:bg-gradient-to-r sm:via-[#0b0e15]/80 lg:via-[#0b0e15]/55"
              aria-hidden="true"
            />
            <div
              className="absolute inset-x-0 bottom-0 -z-10 h-72 bg-gradient-to-t from-[#0b0e15] via-[#0b0e15]/80 to-transparent"
              aria-hidden="true"
            />
          </>
        ) : (
          <>
            <div className="bg-grid absolute inset-0 -z-10 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
            <div className="absolute -right-32 -top-32 -z-10 size-[32rem] rounded-full bg-primary/20 blur-3xl" />
            <div className="absolute -bottom-40 -left-32 -z-10 size-[28rem] rounded-full bg-accent/20 blur-3xl" />
          </>
        )}

        <div
          className={cn(
            'mx-auto grid max-w-6xl items-center gap-12',
            showRoom ? 'lg:grid-cols-[minmax(0,34rem)_1fr]' : 'lg:grid-cols-[1.1fr_0.9fr]'
          )}
        >
          <m.div
            initial={prefersReducedMotion ? false : { opacity: 0, y: 24 }}
            // Motion owns `opacity` on this node, so the scroll fade is driven
            // through `animate` rather than a style prop it would overwrite.
            animate={{ opacity: copyOpacity, y: 0 }}
            transition={{
              duration: 0.6,
              ease: [0.22, 1, 0.36, 1],
              opacity: { duration: 0.2 },
            }}
            className={cn('space-y-7', copyOpacity === 0 && 'pointer-events-none')}
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
          </m.div>

          {showRoom ? null : (
            <m.div
              initial={prefersReducedMotion ? false : { opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
              className="hidden lg:block"
            >
              <CodeCard />
            </m.div>
          )}
        </div>

        {showRoom ? (
          <>
            {/* The narrative. Always in the document and in the accessibility
              tree — only its visibility follows the camera. */}
            <m.div
              className="pointer-events-none absolute inset-0"
              initial={false}
              animate={{ opacity: captionOpacity }}
              transition={{ duration: 0.25 }}
            >
              <Journey activeIndex={chapter} variant="overlay" />
            </m.div>

            <m.p
              initial={prefersReducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: roomReady ? copyOpacity : 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-xs uppercase tracking-[0.2em] text-muted-foreground"
            >
              Scroll to begin the journey
            </m.p>
          </>
        ) : (
          <div className="mx-auto w-full max-w-6xl">
            <Journey activeIndex={chapter} variant="static" />
          </div>
        )}
      </div>
    </section>
  );
}
