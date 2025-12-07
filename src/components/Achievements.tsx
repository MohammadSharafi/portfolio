import { motion } from 'motion/react';
import { Award, Trophy, Star, Target, Zap, Rocket } from 'lucide-react';

const achievements = [
  {
    icon: Trophy,
    title: 'Top Performer',
    description: 'Employee of the Year 2023',
    color: 'from-yellow-500 to-orange-500',
  },
  {
    icon: Award,
    title: 'AWS Certified',
    description: 'Solutions Architect Professional',
    color: 'from-orange-500 to-red-500',
  },
  {
    icon: Star,
    title: '50+ Projects',
    description: 'Successfully Delivered',
    color: 'from-blue-500 to-cyan-500',
  },
  {
    icon: Target,
    title: '99.9% Uptime',
    description: 'System Reliability',
    color: 'from-green-500 to-emerald-500',
  },
  {
    icon: Zap,
    title: 'Performance',
    description: '10M+ Requests/Day',
    color: 'from-purple-500 to-pink-500',
  },
  {
    icon: Rocket,
    title: 'Innovation',
    description: '3 Patents Filed',
    color: 'from-indigo-500 to-purple-500',
  },
];

export function Achievements() {
  return (
    <section className="py-32 px-4 relative overflow-hidden">
      {/* Background Gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-muted/20 to-background -z-10" />
      
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
          className="text-center mb-16"
        >
          <span className="text-primary text-sm uppercase tracking-wider">Recognition</span>
          <h2 className="text-4xl md:text-5xl mt-2">Achievements & Certifications</h2>
          <p className="text-muted-foreground mt-4 max-w-2xl mx-auto">
            Milestones and recognitions earned throughout my career
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {achievements.map((achievement, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20, rotateY: -10 }}
              whileInView={{ opacity: 1, y: 0, rotateY: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              whileHover={{ y: -8, rotateY: 5, scale: 1.02 }}
              className="glass-strong rounded-3xl p-6 shadow-soft hover:shadow-xl transition-all relative group overflow-hidden"
            >
              {/* Gradient Background on Hover */}
              <motion.div
                className={`absolute inset-0 bg-gradient-to-br ${achievement.color} opacity-0 group-hover:opacity-10 transition-opacity`}
              />

              <div className="relative z-10">
                {/* Icon */}
                <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${achievement.color} flex items-center justify-center mb-4 shadow-lg`}>
                  <achievement.icon className="w-8 h-8 text-white" />
                </div>

                {/* Content */}
                <h3 className="text-xl mb-2">{achievement.title}</h3>
                <p className="text-sm text-muted-foreground">{achievement.description}</p>

                {/* Decorative Corner */}
                <motion.div
                  className={`absolute -top-2 -right-2 w-20 h-20 bg-gradient-to-br ${achievement.color} rounded-full blur-2xl opacity-0 group-hover:opacity-30 transition-opacity`}
                />
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
