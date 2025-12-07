import { motion } from 'motion/react';
import { Code2, Sparkles, Zap, Target } from 'lucide-react';

const strengths = [
  { icon: Code2, text: 'Mobile Development Excellence (Flutter, Android)' },
  { icon: Sparkles, text: 'AI Integration & Data Science' },
  { icon: Zap, text: 'HIPAA-Compliant Healthcare Solutions' },
  { icon: Target, text: 'Award-Winning Product Development' },
];

export function About() {
  return (
    <section id="about" className="py-32 px-4">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="text-primary text-sm uppercase tracking-wider">About Me</span>
          <h2 className="text-4xl md:text-5xl mt-2">Who I Am</h2>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left - Image */}
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="relative"
          >
            <div className="relative rounded-3xl overflow-hidden shadow-soft">
                <img
                  src="https://images.unsplash.com/photo-1660810731526-0720827cbd38?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzb2Z0d2FyZSUyMGVuZ2luZWVyJTIwd29ya3NwYWNlfGVufDF8fHx8MTc2NDk3ODYwNnww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral"
                  alt="Mohammad Sharafi"
                  className="w-full h-[500px] object-cover"
                  loading="lazy"
                  decoding="async"
                />
              <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
            </div>

            {/* Floating Stats */}
            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 3, repeat: Infinity }}
              className="absolute top-8 right-8 glass-strong rounded-2xl p-4 shadow-soft"
            >
              <div className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                6+
              </div>
              <div className="text-sm text-muted-foreground">Years Experience</div>
            </motion.div>
          </motion.div>

          {/* Right - Content */}
          <motion.div
            initial={{ opacity: 0, x: 50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="space-y-8"
          >
            <div className="space-y-4">
              <p className="text-lg text-muted-foreground leading-relaxed">
                Distinguished Software Engineer with over 6 years of experience crafting innovative mobile
                applications in digital health, fintech, and education. Led the development of an award-winning
                AI-powered women&apos;s health assistant at March Health, earning the 2025 Best Pain Management
                Technology award by integrating advanced AI, HIPAA-compliant payment systems, and cloud
                technologies (Firebase, AWS).
              </p>
              <p className="text-lg text-muted-foreground leading-relaxed">
                Expert in Flutter, Dart, Android (Java/Kotlin), and RESTful APIs, with a proven ability to
                optimize performance and deliver scalable solutions. Currently advancing expertise in data science
                and machine learning, combining software engineering prowess with analytical skills to pioneer
                data-driven healthcare solutions. My rare blend of mobile development, AI integration, and emerging
                data science expertise enables me to build transformative solutions at the intersection of
                technology and healthcare.
              </p>
            </div>

            {/* Strengths Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {strengths.map((strength, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  whileHover={{ scale: 1.05 }}
                  className="glass rounded-2xl p-4 flex items-start gap-3 hover:shadow-soft cursor-pointer"
                >
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <strength.icon className="w-5 h-5 text-primary" />
                  </div>
                  <span className="text-sm leading-relaxed">{strength.text}</span>
                </motion.div>
              ))}
            </div>

            {/* Quick Stats */}
            <div className="flex flex-wrap gap-8 pt-4">
              {[
                { label: 'Projects Completed', value: '50+' },
                { label: 'Technologies', value: '20+' },
                { label: 'Happy Clients', value: '30+' },
              ].map((stat, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, scale: 0.5 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.2 + index * 0.1 }}
                >
                  <div className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                    {stat.value}
                  </div>
                  <div className="text-sm text-muted-foreground">{stat.label}</div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
