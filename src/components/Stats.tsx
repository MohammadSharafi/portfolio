import { motion, useMotionValue, useTransform, animate } from 'motion/react';
import { useEffect, useRef } from 'react';
import { Code2, Users, Award, Coffee } from 'lucide-react';

const stats = [
  {
    icon: Code2,
    value: 50,
    suffix: '+',
    label: 'Projects Completed',
    color: 'from-blue-500 to-cyan-500',
  },
  {
    icon: Users,
    value: 30,
    suffix: '+',
    label: 'Happy Clients',
    color: 'from-purple-500 to-pink-500',
  },
  {
    icon: Award,
    value: 15,
    suffix: '+',
    label: 'Awards Won',
    color: 'from-orange-500 to-red-500',
  },
  {
    icon: Coffee,
    value: 1000,
    suffix: '+',
    label: 'Cups of Tea',
    color: 'from-green-500 to-emerald-500',
  },
];

function Counter({ value, suffix }: { value: number; suffix: string }) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, Math.round);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const controls = animate(count, value, { duration: 1.5, ease: [0.4, 0, 0.6, 1] });
    return controls.stop;
  }, [count, value]);

  useEffect(() => {
    const unsubscribe = rounded.on('change', (latest) => {
      if (ref.current) {
        ref.current.textContent = latest.toString();
      }
    });
    return () => unsubscribe();
  }, [rounded]);

  return (
    <span className="inline-flex items-baseline">
      <span ref={ref}>0</span>
      <span>{suffix}</span>
    </span>
  );
}

export function Stats() {
  return (
    <section className="py-20 px-4 bg-gradient-to-b from-background to-muted/30">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
          {stats.map((stat, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, scale: 0.5 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.05, duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
              whileHover={{ scale: 1.05, y: -8 }}
              className="glass-strong rounded-3xl p-6 text-center shadow-soft hover:shadow-xl transition-all group relative overflow-hidden"
            >
              {/* Background Gradient */}
              <div className={`absolute inset-0 bg-gradient-to-br ${stat.color} opacity-0 group-hover:opacity-10 transition-opacity`} />

              {/* Icon */}
              <div className={`w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br ${stat.color} flex items-center justify-center shadow-lg`}>
                <stat.icon className="w-8 h-8 text-white" />
              </div>

              {/* Counter */}
              <div className={`text-4xl font-bold mb-2 bg-gradient-to-r ${stat.color} bg-clip-text text-transparent`}>
                <Counter value={stat.value} suffix={stat.suffix} />
              </div>

              {/* Label */}
              <p className="text-sm text-muted-foreground">{stat.label}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
