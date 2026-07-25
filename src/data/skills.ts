/**
 * Skills are described by depth of use rather than a self-assigned percentage.
 * "Dart — 95%" tells a reader nothing verifiable; "used daily in production for
 * six years" does.
 */
export type Proficiency = 'core' | 'working' | 'exploring';

export const proficiencyLabel: Record<Proficiency, string> = {
  core: 'Core',
  working: 'Working',
  exploring: 'Exploring',
};

export const proficiencyDescription: Record<Proficiency, string> = {
  core: 'Used daily in production and taken to release',
  working: 'Shipped with, comfortable owning features end to end',
  exploring: 'Actively learning and applying to side projects',
};

export interface Skill {
  name: string;
  level: Proficiency;
}

export interface SkillGroup {
  title: string;
  description: string;
  skills: readonly Skill[];
}

export const skillGroups: readonly SkillGroup[] = [
  {
    title: 'Mobile',
    description: 'Where most of my production code has shipped.',
    skills: [
      { name: 'Flutter', level: 'core' },
      { name: 'Dart', level: 'core' },
      { name: 'BLoC', level: 'core' },
      { name: 'Android (Java/Kotlin)', level: 'core' },
      { name: 'freezed', level: 'working' },
      { name: 'Swift / iOS', level: 'working' },
    ],
  },
  {
    title: 'Backend & APIs',
    description: 'Services behind the apps, mostly Python and Java.',
    skills: [
      { name: 'Python', level: 'core' },
      { name: 'FastAPI', level: 'core' },
      { name: 'REST', level: 'core' },
      { name: 'Java / Spring Boot', level: 'working' },
      { name: 'gRPC', level: 'working' },
      { name: 'GraphQL', level: 'working' },
    ],
  },
  {
    title: 'Cloud & Delivery',
    description: 'Getting builds to stores and services into production.',
    skills: [
      { name: 'Firebase', level: 'core' },
      { name: 'GitHub Actions', level: 'core' },
      { name: 'AWS (S3, Lambda)', level: 'working' },
      { name: 'GCP Cloud Run', level: 'working' },
      { name: 'Docker', level: 'working' },
      { name: 'Codemagic', level: 'working' },
    ],
  },
  {
    title: 'Health & Security',
    description: 'The regulated side of healthcare software.',
    skills: [
      { name: 'HIPAA compliance', level: 'core' },
      { name: 'SMART on FHIR', level: 'working' },
      { name: 'OAuth2', level: 'working' },
      { name: 'End-to-end encryption', level: 'working' },
      { name: 'ICD / LOINC / SNOMED', level: 'working' },
      { name: 'Secure payments', level: 'core' },
    ],
  },
  {
    title: 'Data',
    description: 'Clinical datasets, pipelines and storage.',
    skills: [
      { name: 'pandas', level: 'working' },
      { name: 'Polars', level: 'working' },
      { name: 'SQL / PostgreSQL', level: 'working' },
      { name: 'MongoDB', level: 'working' },
      { name: 'Redis', level: 'working' },
      { name: 'NumPy', level: 'working' },
    ],
  },
  {
    title: 'AI & ML',
    description: 'Growing focus: models that run close to the data.',
    skills: [
      { name: 'Local LLMs', level: 'working' },
      { name: 'ONNX Runtime', level: 'exploring' },
      { name: 'scikit-learn', level: 'exploring' },
      { name: 'Prompt & RAG design', level: 'working' },
      { name: 'Vector search', level: 'exploring' },
      { name: 'Model evaluation', level: 'exploring' },
    ],
  },
] as const;

/** Secondary skills shown as a marquee; not worth a full card each. */
export const alsoFamiliarWith: readonly string[] = [
  'Event-driven architecture',
  'Microservices',
  'WebSockets',
  'System design',
  'Clean architecture',
  'MVVM / MVP',
  'Agile & Scrum',
  'Technical writing',
  'Mentoring',
  'Git',
  'App Store & Play Store release',
  'Performance profiling',
] as const;
