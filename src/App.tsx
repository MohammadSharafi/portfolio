import { lazy, Suspense } from 'react';
import { LazyMotion, domAnimation } from 'motion/react';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { Stats } from './components/Stats';
import { ScrollProgress } from './components/ScrollProgress';
import { BackToTop } from './components/BackToTop';
import { useReducedMotion } from './hooks/useReducedMotion';
import { useRoom } from './hooks/useRoom';

// Everything below the fold is split out; the first screen ships without it.
const About = lazy(() => import('./components/About').then((m) => ({ default: m.About })));
const Skills = lazy(() => import('./components/Skills').then((m) => ({ default: m.Skills })));
const Projects = lazy(() => import('./components/Projects').then((m) => ({ default: m.Projects })));
const Experience = lazy(() =>
  import('./components/Experience').then((m) => ({ default: m.Experience }))
);
const Recognition = lazy(() =>
  import('./components/Recognition').then((m) => ({ default: m.Recognition }))
);
const Testimonials = lazy(() =>
  import('./components/Testimonials').then((m) => ({ default: m.Testimonials }))
);
const Contact = lazy(() => import('./components/Contact').then((m) => ({ default: m.Contact })));
const Footer = lazy(() => import('./components/Footer').then((m) => ({ default: m.Footer })));

/** Reserves vertical space while a lazy section loads so the page does not jump. */
function SectionFallback() {
  return <div className="h-96" aria-hidden="true" />;
}

// The single-room experience. Behind a flag until it replaces the written site
// outright, so the live page is never a half-finished migration.
const RoomExperience = lazy(() =>
  import('./room/RoomExperience').then((m) => ({ default: m.RoomExperience }))
);

/**
 * The written site. Split out from `App` so the room can be chosen before any
 * of its hooks run — a conditional return above `useRoom()` would change hook
 * order between the two branches.
 */
function WrittenSite() {
  // Owned here so the navbar can switch to dark styling while it floats over
  // the lit 3D scene, and the hero can drive the camera from the same state.
  const room = useRoom();

  return (
    // Components use the tree-shakeable `m` primitives; LazyMotion supplies the
    // feature set once. `domAnimation` omits Motion's layout-animation engine,
    // which cuts 13KB gzip from the critical path — the one effect that needed
    // it (the navbar indicator) is now a CSS transform instead.
    <LazyMotion features={domAnimation} strict>
      <a
        href="#main"
        className="sr-only z-[70] focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:rounded-full focus:bg-primary focus:px-5 focus:py-3 focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <ScrollProgress />
      <Navbar overScene={room.showRoom && room.progress < 0.99} />

      <main id="main">
        <Hero room={room} />
        <Stats />

        <Suspense fallback={<SectionFallback />}>
          <About />
          <Skills />
          <Projects />
          <Experience />
          <Recognition />
          <Testimonials />
          <Contact />
        </Suspense>
      </main>

      <Suspense fallback={null}>
        <Footer />
      </Suspense>

      <BackToTop />
    </LazyMotion>
  );
}

export default function App() {
  // Keeps the `.reduce-motion` class on <html> in sync with the OS preference.
  useReducedMotion();

  const showRoom =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('room');

  if (showRoom) {
    return (
      <Suspense fallback={<div className="fixed inset-0 bg-[#05070c]" />}>
        <RoomExperience />
      </Suspense>
    );
  }

  return <WrittenSite />;
}
