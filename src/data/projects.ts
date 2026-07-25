/** Cover art is generated locally from these two fields — no remote images. */
export type ArtworkPattern = 'nodes' | 'waves' | 'grid' | 'orbit' | 'stack';

export interface Project {
  slug: string;
  title: string;
  summary: string;
  /** One line on why the project is technically interesting. */
  angle: string;
  tags: readonly string[];
  category: ProjectCategory;
  repo: string;
  demo?: string;
  featured: boolean;
  pattern: ArtworkPattern;
  /** Base hue (OKLCH degrees) for the generated artwork. */
  hue: number;
}

export const projectCategories = ['AI & ML', 'Backend', 'Mobile', 'Algorithms'] as const;
export type ProjectCategory = (typeof projectCategories)[number];

export const projects: readonly Project[] = [
  {
    slug: 'neurochain-orchestrator',
    title: 'NeuroChain Orchestrator',
    summary:
      'A distributed local-AI workflow engine pairing Flutter, Spring Boot and Python to run automation pipelines fully offline, using on-device LLMs, vision models and event-driven orchestration.',
    angle:
      'Visual workflow builder, plugin system and multi-device execution, with no inference leaving the machine.',
    tags: ['Flutter', 'Spring Boot', 'Python', 'LLM', 'Docker', 'GraphQL'],
    category: 'AI & ML',
    repo: 'https://github.com/MohammadSharafi/neurochain-orchestrator',
    featured: true,
    pattern: 'nodes',
    hue: 262,
  },
  {
    slug: 'nodeflow-ai',
    title: 'NodeFlow AI',
    summary:
      'A Java-powered distributed automation engine that runs AI models locally through a node-based workflow system, gRPC transport and dynamic plugin loading.',
    angle:
      'Event-driven orchestration across nodes, with plugins hot-loaded at runtime rather than compiled in.',
    tags: ['Java', 'gRPC', 'Event-Driven', 'Plugins', 'Distributed'],
    category: 'Backend',
    repo: 'https://github.com/MohammadSharafi/NodeFlow-AI-Distributed-Automation-System',
    featured: true,
    pattern: 'orbit',
    hue: 200,
  },
  {
    slug: 'adaptive-productivity-engine',
    title: 'Adaptive Productivity Engine',
    summary:
      'A privacy-first productivity assistant combining behavioural analytics, task management and personalised recommendations across Flutter, Spring Boot and Python.',
    angle: 'Runs entirely offline on local models, so behavioural data never leaves the device.',
    tags: ['Flutter', 'Spring Boot', 'Python', 'Local AI', 'Privacy'],
    category: 'AI & ML',
    repo: 'https://github.com/MohammadSharafi/adaptive-productivity-engine',
    featured: true,
    pattern: 'waves',
    hue: 305,
  },
  {
    slug: 'pocketmind-knowledge-engine',
    title: 'PocketMind Knowledge Engine',
    summary:
      'A personal knowledge engine that organises, retrieves and connects information using local AI processing, advanced search and generated insights.',
    angle:
      'Semantic retrieval over a private corpus with all indexing and inference kept on-device.',
    tags: ['Flutter', 'Spring Boot', 'Python', 'Search', 'Local AI'],
    category: 'AI & ML',
    repo: 'https://github.com/MohammadSharafi/pocketmind-knowledge-engine',
    featured: false,
    pattern: 'grid',
    hue: 168,
  },
  {
    slug: 'doctor-voice-flutter',
    title: 'Doctor Voice',
    summary:
      'A cross-platform voice recording and analysis app built in Flutter on the BLoC pattern, aimed at clinical voice capture.',
    angle: 'Clean BLoC separation between capture, processing and presentation layers.',
    tags: ['Flutter', 'BLoC', 'Dart', 'Audio', 'Mobile'],
    category: 'Mobile',
    repo: 'https://github.com/MohammadSharafi/doctor-voice-flutter',
    featured: false,
    pattern: 'waves',
    hue: 220,
  },
  {
    slug: 'generalized-dispersion-problem',
    title: 'Generalized Dispersion Problem',
    summary:
      'Algorithms and computational methods for solving generalised dispersion problems, a family of combinatorial optimisation tasks.',
    angle: 'Optimisation heuristics benchmarked against exact solutions on generated instances.',
    tags: ['Algorithms', 'Optimisation', 'Mathematics'],
    category: 'Algorithms',
    repo: 'https://github.com/MohammadSharafi/GeneralizedDispersionProblem',
    featured: false,
    pattern: 'stack',
    hue: 40,
  },
  {
    slug: 'role-chooser',
    title: 'Role Chooser',
    summary:
      'A role management and selection tool with matching and recommendation logic for assigning people to positions.',
    angle: 'Constraint-driven matching turned into a simple, opinionated interface.',
    tags: ['Matching', 'Recommendation', 'Tooling'],
    category: 'Algorithms',
    repo: 'https://github.com/MohammadSharafi/rolechosser',
    featured: false,
    pattern: 'grid',
    hue: 12,
  },
] as const;

export const githubProfileUrl = 'https://github.com/MohammadSharafi?tab=repositories';
