import { motion } from 'motion/react';
import { useState } from 'react';

const skillCategories = [
  {
    title: 'Languages',
    skills: [
      { name: 'Dart', level: 95 },
      { name: 'Python', level: 92 },
      { name: 'Java', level: 90 },
      { name: 'Kotlin', level: 88 },
      { name: 'Swift', level: 85 },
      { name: 'JavaScript', level: 80 },
    ],
  },
  {
    title: 'Mobile & Frameworks',
    skills: [
      { name: 'Flutter', level: 95 },
      { name: 'Spring Boot', level: 92 },
      { name: 'FastAPI', level: 90 },
      { name: 'Android SDK', level: 88 },
      { name: 'BLoC Pattern', level: 90 },
      { name: 'RESTful APIs', level: 92 },
    ],
  },
  {
    title: 'Cloud & DevOps',
    skills: [
      { name: 'Firebase', level: 92 },
      { name: 'AWS', level: 88 },
      { name: 'Docker', level: 90 },
      { name: 'CI/CD', level: 92 },
      { name: 'GitHub Actions', level: 90 },
      { name: 'GCP Cloud Run', level: 85 },
    ],
  },
  {
    title: 'Data & AI/ML',
    skills: [
      { name: 'PostgreSQL', level: 90 },
      { name: 'MongoDB', level: 88 },
      { name: 'Redis', level: 85 },
      { name: 'Local LLMs', level: 88 },
      { name: 'Pandas/Polars', level: 90 },
      { name: 'ONNX Runtime', level: 85 },
    ],
  },
];

export function Skills() {
  const [activeCategory, setActiveCategory] = useState<number | null>(null);

  return (
    <section id="skills" className="py-32 px-4 bg-muted/30">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
          className="text-center mb-16"
        >
          <span className="text-primary text-sm uppercase tracking-wider">Expertise</span>
          <h2 className="text-4xl md:text-5xl mt-2">Technical Skills</h2>
          <p className="text-muted-foreground mt-4 max-w-2xl mx-auto">
            A comprehensive toolkit built through years of hands-on experience and continuous learning
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          {skillCategories.map((category, categoryIndex) => (
            <motion.div
              key={category.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: categoryIndex * 0.05, duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
              onHoverStart={() => setActiveCategory(categoryIndex)}
              onHoverEnd={() => setActiveCategory(null)}
              className="glass-strong rounded-3xl p-6 shadow-soft hover:shadow-xl transition-all relative overflow-hidden"
            >
              {/* Hover Gradient Background */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: activeCategory === categoryIndex ? 0.1 : 0 }}
                className="absolute inset-0 bg-gradient-to-br from-primary to-accent"
              />

              <div className="relative z-10">
                <h3 className="text-xl mb-6 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                  {category.title}
                </h3>

                <div className="space-y-4">
                  {category.skills.map((skill, skillIndex) => (
                    <motion.div
                      key={skill.name}
                      initial={{ opacity: 0, x: -20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: categoryIndex * 0.05 + skillIndex * 0.03, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
                      whileHover={{ x: 4 }}
                      className="group"
                    >
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-medium">{skill.name}</span>
                        <motion.span
                          initial={{ opacity: 0, scale: 0 }}
                          whileInView={{ opacity: 1, scale: 1 }}
                          className="text-xs text-primary font-semibold px-2 py-1 rounded-full bg-primary/10"
                        >
                          {skill.level}%
                        </motion.span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          whileInView={{ width: `${skill.level}%` }}
                          viewport={{ once: true }}
                          transition={{
                            duration: 0.8,
                            delay: categoryIndex * 0.05 + skillIndex * 0.03 + 0.15,
                            ease: [0.4, 0, 0.6, 1],
                          }}
                          className="h-full bg-gradient-to-r from-primary to-accent rounded-full relative"
                        >
                          <motion.div
                            animate={{
                              x: ['-100%', '100%'],
                            }}
                            transition={{
                              duration: 2.5,
                              repeat: Infinity,
                              ease: [0.4, 0, 0.6, 1],
                            }}
                            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                          />
                        </motion.div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Floating Skill Pills Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4 }}
          className="mt-16 text-center"
        >
          <h3 className="text-2xl mb-8">Also Experienced With</h3>
          <div className="flex flex-wrap justify-center gap-3">
            {[
              'GraphQL',
              'gRPC',
              'SMART on FHIR',
              'HIPAA Compliance',
              'Event-Driven Architecture',
              'Microservices',
              'WebSockets',
              'SQL',
              'Data Science',
              'Machine Learning',
              'System Design',
              'Agile/Scrum',
              'Git',
              'Codemagic',
              'App Store Publishing',
              'Play Store Publishing',
            ].map((skill, index) => (
              <motion.div
                key={skill}
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.05 }}
                whileHover={{ scale: 1.1, y: -4 }}
                className="px-5 py-2 rounded-full glass hover:bg-primary hover:text-white cursor-pointer transition-colors"
              >
                <span className="text-sm">{skill}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}