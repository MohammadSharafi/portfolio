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
  /**
   * The public repository, when there is one.
   *
   * Optional on purpose. Some of the work worth showing is proprietary — the
   * FHIR toolkit and the payments core are employer code — and the choice was
   * either to leave them off the site or to link them somewhere plausible.
   * Both are worse than saying so: a portfolio arguing that every figure on it
   * is checkable cannot quietly point a "source" link at a profile page.
   * `closed` carries who owns it instead.
   */
  repo?: string;
  /** Why there is no repository — shown in place of the source link. */
  closed?: string;
  demo?: string;
  featured: boolean;
  pattern: ArtworkPattern;
  /** Base hue (OKLCH degrees) for the generated artwork. */
  hue: number;
}

export const projectCategories = [
  'AI & ML',
  'Backend',
  'Mobile',
  'Graphics',
  'Algorithms',
] as const;
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
  {
    slug: 'portfolio-room',
    title: 'This Room',
    summary:
      'The portfolio you are standing in: a procedurally generated 3D room built by a Blender Python script, lit by a Cycles lightmap bake, and driven in the browser by React Three Fiber with a playable character, physics props and a diegetic music player.',
    angle:
      'The room is generated by ~5,000 lines of Python rather than modelled by hand, so the geometry, its UVs and its aging masks are all reproducible from source.',
    tags: ['Three.js', 'React', 'Blender', 'Python', 'WebGL', 'Cycles'],
    category: 'Graphics',
    repo: 'https://github.com/MohammadSharafi/portfolio',
    demo: 'https://mohammadsharafi.com',
    featured: true,
    pattern: 'grid',
    hue: 190,
  },
  {
    slug: 'fhir-integration-toolkit',
    title: 'SMART on FHIR Toolkit',
    summary:
      'The integration layer behind the clinical assistant: OAuth2 token vaulting, automatic pagination over FHIR bundles, retry budgets and rate limiting against Cerner/Oracle Health and the Mayo Clinic Platform.',
    angle:
      'Every EHR speaks a slightly different FHIR; the toolkit absorbs the differences so feature code never learns which vendor it is talking to.',
    tags: ['Python', 'FastAPI', 'SMART on FHIR', 'OAuth2', 'HIPAA'],
    category: 'Backend',
    closed: 'Proprietary — built at March Health',
    featured: false,
    pattern: 'stack',
    hue: 145,
  },
  {
    slug: 'clinical-voice-pipeline',
    title: 'Clinical Voice Pipeline',
    summary:
      'On-device speech capture and transcription for clinical note-taking, with the audio and the model kept on the handset so recordings never leave it.',
    angle:
      'Whisper-class inference on a phone, streamed in chunks so the transcript keeps up with the speaker instead of arriving after them.',
    tags: ['Flutter', 'Whisper', 'On-device ML', 'Audio', 'Privacy'],
    category: 'AI & ML',
    repo: 'https://github.com/MohammadSharafi/doctor-voice-flutter',
    featured: false,
    pattern: 'waves',
    hue: 280,
  },
  {
    slug: 'flutter-payments-core',
    title: 'Encrypted Payments Core',
    summary:
      'The payment layer from the fintech work: end-to-end encrypted flows, tokenised cards and a fraud-scoring hook, packaged as a Flutter module reused across several apps.',
    angle:
      'Fraud fell 40% not from a smarter model but from removing the places raw card data was allowed to exist.',
    tags: ['Flutter', 'Dart', 'Encryption', 'Payments', 'Fintech'],
    category: 'Mobile',
    closed: 'Proprietary — built at Robintel',
    featured: false,
    pattern: 'orbit',
    hue: 95,
  },
] as const;

export const githubProfileUrl = 'https://github.com/MohammadSharafi?tab=repositories';
