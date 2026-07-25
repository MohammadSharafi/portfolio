import type { LucideIcon } from 'lucide-react';
import { Github, Linkedin, Mail, Twitter } from 'lucide-react';

/** First year of professional work — every "years of experience" figure on the
 *  site derives from this so the copy can never go stale. */
export const CAREER_START_YEAR = 2018;

export const yearsOfExperience = (now: Date = new Date()): number =>
  Math.max(1, now.getFullYear() - CAREER_START_YEAR);

export const SITE_URL = 'https://mohammadsharafi.vercel.app';

export interface SocialLink {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Shown in the footer and used as the accessible name. */
  handle: string;
}

export const socialLinks: readonly SocialLink[] = [
  {
    label: 'GitHub',
    href: 'https://github.com/MohammadSharafi',
    icon: Github,
    handle: '@MohammadSharafi',
  },
  {
    label: 'LinkedIn',
    href: 'https://www.linkedin.com/in/mohammadsharafi/',
    icon: Linkedin,
    handle: 'in/mohammadsharafi',
  },
  {
    label: 'X',
    href: 'https://x.com/moe_sharafi',
    icon: Twitter,
    handle: '@moe_sharafi',
  },
  {
    label: 'Email',
    href: 'mailto:mohammadsharafi.official@gmail.com',
    icon: Mail,
    handle: 'mohammadsharafi.official@gmail.com',
  },
] as const;

export const profile = {
  name: 'Mohammad Sharafi',
  firstName: 'Mohammad',
  lastName: 'Sharafi',
  initials: 'MS',
  role: 'Software Engineer',
  /** Rotated in the hero. Keep each one short enough for a single line on mobile. */
  roleRotation: [
    'Software Engineer',
    'Flutter & Mobile Specialist',
    'Digital Health Engineer',
    'Applied AI & Data',
  ],
  location: 'Türkiye',
  timezone: 'GMT+3',
  email: 'mohammadsharafi.official@gmail.com',
  availability: 'Open to senior engineering roles',
  cvPath: '/cv.pdf',
  cvFileName: 'Mohammad-Sharafi-CV.pdf',

  tagline:
    'I build production mobile and backend systems for regulated healthcare — Flutter apps, HIPAA-compliant services, and AI that runs where the data lives.',

  summary: [
    `Software engineer with ${yearsOfExperience()} years of experience building mobile and full-stack products across digital health, fintech and education. At March Health I led the AI-powered women's health assistant that won the 2025 Best Pain Management Technology award, integrating clinical AI, HIPAA-compliant payments and cloud infrastructure on Firebase, AWS and GCP.`,
    'My core is Flutter, Dart and Android (Java/Kotlin) backed by Python and Java services, with a track record of measurable wins: API latency halved, app performance up 30%, payment fraud down 40%. I am extending that foundation into data science and machine learning, working with large de-identified clinical datasets to build healthcare software that reasons about its own data.',
  ],

  languages: [
    { name: 'English', level: 'Professional proficiency' },
    { name: 'Persian', level: 'Native' },
  ],
} as const;
