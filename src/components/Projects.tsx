import { motion, AnimatePresence } from 'motion/react';
import { ExternalLink, Github, Filter } from 'lucide-react';
import { useState } from 'react';

const projects = [
  {
    title: 'NeuroChain Orchestrator',
    description:
      'A distributed local-AI workflow engine combining Flutter, Spring Boot, and Python to run intelligent automation pipelines fully offline using on-device LLMs, vision models, and event-driven orchestration. Features visual workflow builder, plugin system, and multi-device execution support.',
    image: 'https://images.unsplash.com/photo-1764303017761-2f94cb677efe?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb2Rlcm4lMjB0ZWNoJTIwYWJzdHJhY3QlMjBibHVlfGVufDF8fHx8MTc2NTA0NDMyNHww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral',
    tags: ['Flutter', 'Spring Boot', 'Python', 'LLM', 'Docker', 'GraphQL', 'Workflow Engine'],
    github: 'https://github.com/MohammadSharafi/neurochain-orchestrator',
    category: 'AI/ML',
  },
  {
    title: 'NodeFlow AI - Distributed Automation',
    description:
      'A Java-powered distributed automation engine that runs AI models locally using a node-based workflow system, gRPC communication, dynamic plugins, and event-driven orchestration.',
    image: 'https://images.unsplash.com/photo-1644088379091-d574269d422f?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxhYnN0cmFjdCUyMHRlY2hub2xvZ3klMjBuZXR3b3JrfGVufDF8fHx8MTc2NDk0MTc1Nnww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral',
    tags: ['Java', 'gRPC', 'Event-Driven', 'Plugin System', 'Distributed'],
    github: 'https://github.com/MohammadSharafi/NodeFlow-AI-Distributed-Automation-System',
    category: 'Backend',
  },
  {
    title: 'Adaptive Productivity Engine',
    description:
      'Privacy-first AI productivity assistant with behavioral analytics, task management, and personalized recommendations. Built with Flutter, Spring Boot, and Python. Fully offline with local AI models for complete data privacy.',
    image: 'https://images.unsplash.com/photo-1660810731526-0720827cbd38?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzb2Z0d2FyZSUyMGVuZ2luZWVyJTIwd29ya3NwYWNlfGVufDF8fHx8MTc2NDk3ODYwNnww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral',
    tags: ['Flutter', 'Spring Boot', 'Python', 'AI', 'Privacy-First', 'Local AI'],
    github: 'https://github.com/MohammadSharafi/adaptive-productivity-engine',
    category: 'AI/ML',
  },
  {
    title: 'PocketMind Knowledge Engine',
    description:
      'AI-assisted personal knowledge engine with local AI processing. Built with Flutter, Spring Boot, and Python to organize, retrieve, and connect information using advanced search and AI-powered insights while keeping all data local.',
    image: 'https://images.unsplash.com/photo-1717996563514-e3519f9ef9f7?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb2Rlcm4lMjB3ZWIlMjBhcHBsaWNhdGlvbnxlbnwxfHx8fDE3NjQ5NzI3NTB8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral',
    tags: ['Flutter', 'Spring Boot', 'Python', 'AI', 'Knowledge Management', 'Local Processing'],
    github: 'https://github.com/MohammadSharafi/pocketmind-knowledge-engine',
    category: 'AI/ML',
  },
  {
    title: 'Generalized Dispersion Problem',
    description:
      'A mathematical optimization solution for solving generalized dispersion problems with efficient algorithms and computational methods.',
    image: 'https://images.unsplash.com/photo-1644088379091-d574269d422f?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxhYnN0cmFjdCUyMHRlY2hub2xvZ3klMjBuZXR3b3JrfGVufDF8fHx8MTc2NDk0MTc1Nnww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral',
    tags: ['Algorithms', 'Optimization', 'Mathematics', 'Computational'],
    github: 'https://github.com/MohammadSharafi/GeneralizedDispersionProblem',
    category: 'Backend',
  },
  {
    title: 'Role Chooser',
    description:
      'An application for managing and selecting roles with intelligent matching and recommendation capabilities.',
    image: 'https://images.unsplash.com/photo-1764303017761-2f94cb677efe?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb2Rlcm4lMjB0ZWNoJTIwYWJzdHJhY3QlMjBibHVlfGVufDF8fHx8MTc2NTA0NDMyNHww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral',
    tags: ['Role Management', 'Matching', 'Recommendation'],
    github: 'https://github.com/MohammadSharafi/rolechosser',
    category: 'Frontend',
  },
  {
    title: 'Doctor Voice Flutter',
    description:
      'A voice analysis application built with Flutter using BLoC state management pattern for cross-platform voice recording and analysis capabilities.',
    image: 'https://images.unsplash.com/photo-1660810731526-0720827cbd38?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzb2Z0d2FyZSUyMGVuZ2luZWVyJTIwd29ya3NwYWNlfGVufDF8fHx8MTc2NDk3ODYwNnww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral',
    tags: ['Flutter', 'BLoC', 'Voice Analysis', 'Mobile', 'Dart'],
    github: 'https://github.com/MohammadSharafi/doctor-voice-flutter',
    category: 'Frontend',
  },
];

const categories = ['All', 'AI/ML', 'Backend', 'DevOps', 'Frontend'];

export function Projects() {
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [filteredProjects, setFilteredProjects] = useState(projects);

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category);
    if (category === 'All') {
      setFilteredProjects(projects);
    } else {
      setFilteredProjects(projects.filter(project => project.category === category));
    }
  };

  return (
    <section id="projects" className="py-32 px-4">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="text-primary text-sm uppercase tracking-wider">Portfolio</span>
          <h2 className="text-4xl md:text-5xl mt-2">Featured Projects</h2>
          <p className="text-muted-foreground mt-4 max-w-2xl mx-auto">
            A showcase of my recent work and technical achievements
          </p>
        </motion.div>

        {/* Category Filter */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="flex flex-wrap justify-center gap-3 mb-12"
        >
          <div className="flex items-center gap-2 px-4 py-2 rounded-full glass">
            <Filter className="w-4 h-4 text-primary" />
            <span className="text-sm">Filter:</span>
          </div>
          {categories.map((category) => (
            <motion.button
              key={category}
              onClick={() => handleCategoryChange(category)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className={`px-6 py-2 rounded-full transition-all ${
                selectedCategory === category
                  ? 'bg-primary text-white shadow-lg'
                  : 'glass hover:bg-primary/10'
              }`}
            >
              {category}
            </motion.button>
          ))}
        </motion.div>

        <AnimatePresence mode="wait">
          <motion.div
            key={selectedCategory}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="grid md:grid-cols-2 lg:grid-cols-3 gap-8"
          >
            {filteredProjects.map((project, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                whileHover={{ y: -8 }}
                className="glass-strong rounded-3xl overflow-hidden shadow-soft hover:shadow-xl transition-all group"
              >
                {/* Project Image */}
                <div className="relative h-56 overflow-hidden">
                  <img
                    src={project.image}
                    alt={project.title}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent opacity-60" />

                  {/* Hover Actions */}
                  <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <motion.a
                      href={project.github}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-10 h-10 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center hover:bg-primary hover:text-white transition-colors"
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Github className="w-5 h-5" />
                    </motion.a>
                  </div>
                </div>

                {/* Project Info */}
                <div className="p-6 space-y-4">
                  <h3 className="text-xl">{project.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {project.description}
                  </p>

                  {/* Tech Stack Tags */}
                  <div className="flex flex-wrap gap-2">
                    {project.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-3 py-1 rounded-full text-xs bg-primary/10 text-primary border border-primary/20"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  {/* View Project Button */}
                  <motion.a
                    href={project.github}
                    target="_blank"
                    rel="noopener noreferrer"
                    whileHover={{ x: 4 }}
                    className="flex items-center gap-2 text-primary group/btn"
                  >
                    <span className="text-sm">View on GitHub</span>
                    <ExternalLink className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
                  </motion.a>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </AnimatePresence>

        {/* View All Projects CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.6 }}
          className="text-center mt-12"
        >
          <motion.a
            href="https://github.com/MohammadSharafi?tab=repositories"
            target="_blank"
            rel="noopener noreferrer"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="inline-block px-8 py-4 rounded-full glass hover:bg-primary hover:text-white transition-colors"
          >
            View All Projects on GitHub
          </motion.a>
        </motion.div>
      </div>
    </section>
  );
}