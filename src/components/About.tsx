import { Brain, ShieldCheck, Smartphone, Workflow } from 'lucide-react';
import { profile } from '@/data/profile';
import { learning } from '@/data/credentials';
import { Section } from './ui/Section';
import { Reveal } from './ui/Reveal';

const pillars = [
  {
    icon: Smartphone,
    title: 'Mobile at production scale',
    body: 'Flutter and Android apps shipped to the App Store and Play Store, with release engineering and CI/CD owned end to end.',
  },
  {
    icon: ShieldCheck,
    title: 'Regulated by default',
    body: 'HIPAA-compliant services, SMART on FHIR integrations, OAuth2 token vaults and encrypted payment flows.',
  },
  {
    icon: Brain,
    title: 'AI close to the data',
    body: 'Clinical assistants and offline-first tools built on local LLMs, so sensitive records never leave their boundary.',
  },
  {
    icon: Workflow,
    title: 'Measured outcomes',
    body: 'Latency halved, performance up 30%, fraud down 40% — the work is tracked against numbers, not adjectives.',
  },
] as const;

export function About() {
  return (
    <Section
      id="about"
      eyebrow="About"
      title="Engineering for healthcare, where correctness matters"
      description="I work on the parts of software where a bug is a clinical or financial event, not a cosmetic one."
    >
      <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:gap-16">
        <Reveal direction="left" className="space-y-5">
          {profile.summary.map((paragraph) => (
            <p
              key={paragraph.slice(0, 32)}
              className="text-base leading-relaxed text-muted-foreground"
            >
              {paragraph}
            </p>
          ))}

          <div className="glass rounded-2xl p-5">
            <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-primary">
              Currently learning
            </h3>
            <ul className="mt-3 space-y-2">
              {learning.map((item) => (
                <li key={item} className="flex gap-3 text-sm text-muted-foreground">
                  <span
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-primary"
                    aria-hidden="true"
                  />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
            {profile.languages.map((language) => (
              <div key={language.name}>
                <p className="font-medium">{language.name}</p>
                <p className="text-muted-foreground">{language.level}</p>
              </div>
            ))}
          </div>
        </Reveal>

        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {pillars.map((pillar, index) => (
            <Reveal key={pillar.title} as="li" delay={index * 0.08} direction="right">
              <div className="glass-strong h-full rounded-2xl p-5 shadow-soft">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/12">
                  <pillar.icon className="size-5 text-primary" aria-hidden="true" />
                </div>
                <h3 className="mt-4 font-display text-base font-semibold">{pillar.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{pillar.body}</p>
              </div>
            </Reveal>
          ))}
        </ul>
      </div>
    </Section>
  );
}
