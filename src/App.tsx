import { useEffect } from 'react';
import { LoadingScreen } from './components/LoadingScreen';
import { ScrollProgress } from './components/ScrollProgress';
import { ParticleBackground } from './components/ParticleBackground';
import { FloatingActionButton } from './components/FloatingActionButton';
import { BackToTop } from './components/BackToTop';
import { CursorFollower } from './components/CursorFollower';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { About } from './components/About';
import { Stats } from './components/Stats';
import { Skills } from './components/Skills';
import { Achievements } from './components/Achievements';
import { Projects } from './components/Projects';
import { Experience } from './components/Experience';
import { Testimonials } from './components/Testimonials';
import { Contact } from './components/Contact';
import { Footer } from './components/Footer';

export default function App() {
  useEffect(() => {
    // Set initial theme based on user preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      document.documentElement.classList.add('dark');
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
          <Stats />
          <About />
          <Skills />
          <Achievements />
          <Projects />
          <Experience />
          <Testimonials />
          <Contact />
        </main>
        <Footer />
      </div>
    </>
  );
}