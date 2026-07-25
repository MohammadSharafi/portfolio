import type { LucideIcon } from 'lucide-react';
import { Award, GraduationCap, Medal, Trophy } from 'lucide-react';

export interface Credential {
  icon: LucideIcon;
  title: string;
  issuer: string;
  year: string;
  description: string;
  /** Distinguishes work earned individually from recognition won by the team. */
  scope: 'individual' | 'team';
}

export const awards: readonly Credential[] = [
  {
    icon: Trophy,
    title: 'Best Pain Management Technology',
    issuer: 'Innovation Award · March Health',
    year: '2025',
    description:
      "Awarded for the AI-powered women's health assistant I led — clinical AI, HIPAA-compliant payments and cloud integration in one Flutter product.",
    scope: 'individual',
  },
  {
    icon: Medal,
    title: 'Finalist, Mobile Programming Marathon 8',
    issuer: 'MPM',
    year: '2020',
    description:
      "Reached the finals of Iran's national mobile programming competition, judged on architecture, performance and delivery under time pressure.",
    scope: 'individual',
  },
  {
    icon: Award,
    title: 'Startup of the Year',
    issuer: 'IT World Awards · Best in Biz · One Planet Awards',
    year: '2020',
    description:
      'Company-level recognition earned while I was on the engineering team building and shipping the mobile product.',
    scope: 'team',
  },
] as const;

export interface Education {
  icon: LucideIcon;
  degree: string;
  institution: string;
  period: string;
  detail: string;
  highlights: readonly string[];
}

export const education: readonly Education[] = [
  {
    icon: GraduationCap,
    degree: 'B.Eng. Computer Software Engineering',
    institution: 'Isfahan University of Technology, Iran',
    period: '2018 — 2022',
    detail: 'GPA 3.0 / 4.0',
    highlights: [
      'Specialised in mobile application development and software architecture',
      'Coursework in algorithms, optimisation and distributed systems',
    ],
  },
] as const;

/** Ongoing study — stated as in-progress rather than as a held credential. */
export const learning: readonly string[] = [
  'Data science and machine learning applied to healthcare datasets (Python, pandas, scikit-learn)',
  'Ethical AI and decentralised health systems',
  'Optimisation algorithms for wearable health devices',
] as const;
