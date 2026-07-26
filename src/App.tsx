import { lazy, Suspense } from 'react';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { Stats } from './components/Stats';
import { ScrollProgress } from './components/ScrollProgress';
import { BackToTop } from './components/BackToTop';
import { useReducedMotion } from './hooks/useReducedMotion';

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

export default function App() {
  // Keeps the `.reduce-motion` class on <html> in sync with the OS preference.
  useReducedMotion();

  return (
    <>
      <a
        href="#main"
        className="sr-only z-[70] focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:rounded-full focus:bg-primary focus:px-5 focus:py-3 focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <ScrollProgress />
      <Navbar />

      <main id="main">
        <Hero />
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
    </>
  );
}
