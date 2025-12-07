import { motion } from 'motion/react';
import { Mail, Github, Linkedin, Twitter } from 'lucide-react';

const contactInfo = [
  {
    icon: Mail,
    label: 'Email',
    value: 'mohammadsharafi.official@gmail.com',
    href: 'mailto:mohammadsharafi.official@gmail.com',
  },
];

const socialLinks = [
  { icon: Github, href: 'https://github.com/MohammadSharafi', label: 'GitHub' },
  { icon: Linkedin, href: 'https://www.linkedin.com/in/mohammadsharafi/', label: 'LinkedIn' },
  { icon: Twitter, href: 'https://x.com/moe_sharafi', label: 'Twitter' },
];

export function Contact() {
  return (
    <section id="contact" className="py-32 px-4 bg-muted/30">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
          className="text-center mb-16"
        >
          <span className="text-primary text-sm uppercase tracking-wider">Get In Touch</span>
          <h2 className="text-4xl md:text-5xl mt-2">Let&apos;s Work Together</h2>
          <p className="text-muted-foreground mt-4 max-w-2xl mx-auto">
            Have a project in mind? Let&apos;s discuss how I can help bring your ideas to life.
          </p>
        </motion.div>

        <div className="max-w-2xl mx-auto">
          {/* Contact Info */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
            className="space-y-8"
          >
            <div className="space-y-6">
              <h3 className="text-2xl">Contact Information</h3>
              <p className="text-muted-foreground leading-relaxed">
                Feel free to reach out through any of these channels. I typically respond within
                24 hours.
              </p>
            </div>

            {/* Contact Cards */}
            <div className="space-y-4">
              {contactInfo.map((info, index) => (
                <motion.a
                  key={index}
                  href={info.href}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  whileHover={{ x: 4 }}
                  className="glass rounded-2xl p-6 flex items-center gap-4 hover:shadow-soft transition-shadow group"
                >
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    <info.icon className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{info.label}</p>
                    <p className="font-medium">{info.value}</p>
                  </div>
                </motion.a>
              ))}
            </div>

            {/* Social Links */}
            <div className="space-y-4">
              <h4 className="text-lg">Follow Me</h4>
              <div className="flex gap-4">
                {socialLinks.map((social, index) => (
                  <motion.a
                    key={index}
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    initial={{ opacity: 0, scale: 0 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.3 + index * 0.1 }}
                    whileHover={{ scale: 1.1, rotate: 5 }}
                    whileTap={{ scale: 0.9 }}
                    className="w-12 h-12 rounded-full glass flex items-center justify-center hover:bg-primary hover:text-white transition-colors"
                    aria-label={social.label}
                  >
                    <social.icon className="w-5 h-5" />
                  </motion.a>
                ))}
              </div>
            </div>

            {/* Decorative Element */}
            <div className="relative mt-8">
              <div className="absolute -z-10 w-64 h-64 bg-primary/10 rounded-full blur-3xl" />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}