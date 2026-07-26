export interface Role {
  company: string;
  role: string;
  period: string;
  location: string;
  current?: boolean;
  description: string;
  highlights: readonly string[];
  tech: readonly string[];
}

export const experience: readonly Role[] = [
  {
    company: 'March Health',
    role: 'Full Stack Engineer',
    period: 'Nov 2024 — Present',
    location: 'Remote · Türkiye',
    current: true,
    description:
      'Building production full-stack systems: Flutter 3.24 across iOS, Android and Web, Python FastAPI microservices and Java Spring Boot on GCP Cloud Run. Leading the HIPAA-compliant EHR AI Clinical Assistant and its integration with Cerner/Oracle Health and the Mayo Clinic Platform via SMART on FHIR.',
    highlights: [
      'Shipped the EHR AI Clinical Assistant with 123+ endpoints, an OAuth2 token vault, rate limiting and automatic pagination',
      'Cut API response times by 50% and lifted overall app performance by 30%',
      'Reduced payment fraud by 40% with encrypted flows, with zero security incidents to date',
      'Own delivery end to end: architecture, CI/CD on GitHub Actions and Codemagic, App Store and Google Play releases',
      'Wrote 20,000+ lines of technical documentation and mentored engineers across time zones',
    ],
    tech: ['Flutter', 'FastAPI', 'Spring Boot', 'GCP Cloud Run', 'SMART on FHIR', 'OAuth2'],
  },
  {
    company: 'Capgroup',
    role: 'Software Engineering Team Lead',
    period: 'May 2021 — Jan 2025',
    location: 'California, USA · Remote',
    description:
      'Directed an engineering team building scalable mobile and web applications for financial services, serving 10,000+ users in the U.S. market.',
    highlights: [
      'Led a team of 8 engineers across mobile and web delivery',
      'Implemented clean architecture patterns, improving system maintainability by 35% and reducing technical debt',
      'Reached a 98% sprint delivery success rate, improving platform stability through Agile practice',
      'Managed REST API integrations, keeping feature parity across Android and iOS',
    ],
    tech: ['Flutter', 'Dart', 'Clean Architecture', 'REST APIs', 'Android', 'iOS'],
  },
  {
    company: 'March Health',
    role: 'Data Scientist (Part-time)',
    period: 'May 2024 — Nov 2024',
    location: 'Remote · Türkiye',
    description:
      'Worked on the Mayo Clinic Platform with one of the largest real-world clinical datasets available, focused on cleaning, standardising and aggregating multi-million-patient de-identified records.',
    highlights: [
      'Transformed raw EHR extracts, clinical notes, lab results and medication histories with Python (pandas, Polars) and SQL',
      'Built reproducible pipelines that took cohort preparation from weeks down to days',
      'Resolved duplicates and standardised coding systems across ICD, LOINC, RxNorm and SNOMED',
      'Maintained strict HIPAA compliance and data governance inside a secure cloud enclave',
    ],
    tech: ['Python', 'pandas', 'Polars', 'SQL', 'ICD/LOINC/SNOMED', 'HIPAA'],
  },
  {
    company: 'Robintel',
    role: 'Software Engineer',
    period: '2019 — 2021',
    location: 'Isfahan, Iran',
    description:
      'Built app features in Flutter and Java, designed UX flows for usability, and integrated third-party APIs and secure payment processing.',
    highlights: [
      'Shipped 5 education apps passing 50,000 downloads at a 4.5-star average rating',
      'Designed and built 3 banking apps that processed over $2 million in transactions',
      'Contributed to 10+ mobile apps across the education and banking sectors',
      'Maintained 99.9% app uptime and improved user retention by 15% through UX work',
    ],
    tech: ['Flutter', 'Java', 'REST APIs', 'Payments', 'UX'],
  },
  {
    company: 'Byte Group',
    role: 'Android Developer',
    period: 'Jan 2018 — Mar 2019',
    location: 'Isfahan, Iran',
    description:
      'Led Android development for client projects across several industries, ran code reviews, and worked directly with clients and UX teams.',
    highlights: [
      'Integrated Facebook and Instagram APIs, lifting user engagement by 20%',
      'Applied MVVM and MVP architectures across 90% of the app portfolio',
      'Improved reported user satisfaction by 25% through interface redesign',
      'Reduced potential security exposure by 30% through hardened integrations',
    ],
    tech: ['Android', 'Java', 'Kotlin', 'MVVM', 'MVP'],
  },
] as const;
