import { motion, AnimatePresence } from 'motion/react';
import { MessageCircle, X, Mail, Github, Linkedin, Twitter } from 'lucide-react';
import { useState } from 'react';

const quickActions = [
  { icon: Mail, label: 'Email', href: 'mailto:mohammadsharafi.official@gmail.com', color: 'bg-blue-500' },
  { icon: Github, label: 'GitHub', href: 'https://github.com/MohammadSharafi', color: 'bg-gray-800' },
  { icon: Linkedin, label: 'LinkedIn', href: 'https://www.linkedin.com/in/mohammadsharafi/', color: 'bg-blue-600' },
  { icon: Twitter, label: 'Twitter', href: 'https://x.com/moe_sharafi', color: 'bg-black' },
];

export function FloatingActionButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="fixed bottom-8 right-8 z-40">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0 }}
            className="absolute bottom-20 right-0 flex flex-col gap-3 items-end"
          >
            {quickActions.map((action, index) => (
              <motion.a
                key={action.label}
                href={action.href}
                target="_blank"
                rel="noopener noreferrer"
                initial={{ opacity: 0, x: 50, y: 20 }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                exit={{ opacity: 0, x: 50, y: 20 }}
                transition={{ delay: index * 0.05 }}
                whileHover={{ scale: 1.1, x: -4 }}
                className="flex items-center gap-3 group"
              >
                <span className="px-4 py-2 rounded-full glass-strong text-sm opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                  {action.label}
                </span>
                <div className={`w-12 h-12 rounded-full ${action.color} flex items-center justify-center text-white shadow-lg`}>
                  <action.icon className="w-5 h-5" />
                </div>
              </motion.a>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        onClick={() => setIsOpen(!isOpen)}
        className="w-16 h-16 rounded-full bg-gradient-to-r from-primary to-accent text-white flex items-center justify-center shadow-2xl"
        whileHover={{ scale: 1.1, rotate: 90 }}
        whileTap={{ scale: 0.9 }}
        animate={isOpen ? { rotate: 45 } : { rotate: 0 }}
      >
        {isOpen ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
      </motion.button>
    </div>
  );
}
