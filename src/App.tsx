import { useEffect, lazy, Suspense } from 'react';
import { LoadingScreen } from './components/LoadingScreen';
import { ScrollProgress } from './components/ScrollProgress';
import { ParticleBackground } from './components/ParticleBackground';
import { FloatingActionButton } from './components/FloatingActionButton';
import { BackToTop } from './components/BackToTop';
import { CursorFollower } from './components/CursorFollower';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';

// Lazy load heavy components
const About = lazy(() => import('./components/About').then(m => ({ default: m.About })));
const Stats = lazy(() => import('./components/Stats').then(m => ({ default: m.Stats })));
const Skills = lazy(() => import('./components/Skills').then(m => ({ default: m.Skills })));
const Achievements = lazy(() => import('./components/Achievements').then(m => ({ default: m.Achievements })));
const Projects = lazy(() => import('./components/Projects').then(m => ({ default: m.Projects })));
const Experience = lazy(() => import('./components/Experience').then(m => ({ default: m.Experience })));
const Testimonials = lazy(() => import('./components/Testimonials').then(m => ({ default: m.Testimonials })));
const Contact = lazy(() => import('./components/Contact').then(m => ({ default: m.Contact })));
const Footer = lazy(() => import('./components/Footer').then(m => ({ default: m.Footer })));

export default function App() {
  useEffect(() => {
    // Set initial theme based on user preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      document.documentElement.classList.add('dark');
    }

    // Detect reduced motion preference
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      document.documentElement.classList.add('reduce-motion');
    }
  }, []);

  return (
    <>
      <LoadingScreen />
      <ScrollProgress />
      <ParticleBackground />
      <FloatingActionButton />
      <BackToTop />
      <CursorFollower />
      
      <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
        <Navbar />
        <main>
          <Hero />
          <Suspense fallback={<div className="h-32" />}>
            <Stats />
          </Suspense>
          <Suspense fallback={<div className="h-32" />}>
            <About />
          </Suspense>
          <Suspense fallback={<div className="h-32" />}>
            <Skills />
          </Suspense>
          <Suspense fallback={<div className="h-32" />}>
            <Achievements />
          </Suspense>
          <Suspense fallback={<div className="h-32" />}>
            <Projects />
          </Suspense>
          <Suspense fallback={<div className="h-32" />}>
            <Experience />
          </Suspense>
          <Suspense fallback={<div className="h-32" />}>
            <Testimonials />
          </Suspense>
          <Suspense fallback={<div className="h-32" />}>
            <Contact />
          </Suspense>
        </main>
        <Suspense fallback={null}>
          <Footer />
        </Suspense>
      </div>
    </>
  );
}