import { motion } from 'motion/react';
import { Quote, Star, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';

const testimonials = [
  {
    name: 'Mahdi Hamidi',
    role: 'Head of Growth & Marketing | HealthTech & AI | Business Development, Partnerships & Fundraising',
    content:
      'I am pleased to recommend Mohammad, who is an outstanding professional and a remarkable individual. He is highly motivated, adaptable, and incredibly reliable in all his endeavors. Mohammad\'s thoughtful approach and professionalism make him an asset to any team. I am confident that he will bring immense value to any candidate he chooses to hire, and I wholeheartedly support his efforts.',
    rating: 5,
    avatar: '/testimonials/mahdi-hamidi.jpg',
  },
  {
    name: 'Masoome Hadiyan K.',
    role: 'Senior Product Designer & Product Owner | 7+ yrs in UX/UI, Product Strategy & Agile | Driving Growth in Tech & Digital Health',
    content:
      'I had the pleasure of working with Mohammad at March Health. He is a highly skilled engineer and consistently delivers high-quality, user-focused solutions. Beyond his technical expertise, Mohammad is a proactive problem-solver and a great collaborator. His dedication and drive make him an invaluable teammate, and I wholeheartedly recommend him.',
    rating: 5,
    avatar: '/testimonials/masoome-hadiyan.jpg',
  },
  {
    name: 'Mahoor Jahanbani',
    role: 'User Experience Specialist | UX & Product Researcher',
    content:
      'I am thrilled to recommend Mohammad for his exceptional skills and dedication as a front-end developer. Beyond his technical abilities, Mohammad is a fantastic team player. He actively collaborates with designers, back-end developers, and other stakeholders to ensure seamless integration and delivery of projects.',
    rating: 5,
    avatar: '/testimonials/mahoor-jahanbani.jpg',
  },
  {
    name: 'Amirali Hariri',
    role: 'Researcher | Data Scientist | Medical Olympiad Gold medalist | PharmD',
    content:
      'I\'ve had the pleasure of working alongside Mohammad for 2 years at March Health. As our Team Lead Software Engineer, Mohammad consistently demonstrates exceptional leadership and technical prowess. His ability to drive team success through effective communication and problem-solving is commendable. Mohammad would undoubtedly be a valuable asset to any organization seeking a skilled and dedicated leader.',
    rating: 5,
    avatar: '/testimonials/amirali-hariri.jpg',
  },
  {
    name: 'Farzad Sobhani Kazemi',
    role: 'Senior Backend Engineer & Data Science Professional | JavaScript (Node.js), Python, C#, Java',
    content:
      'I highly recommend Mohammad for a Flutter Developer position. He\'s a skilled developer with strong technical abilities in Flutter, Java, and Swift. Mohammad is a problem-solver, a team player, and a fast learner who consistently delivers high-quality, responsive apps.',
    rating: 5,
    avatar: '/testimonials/farzad-sobhani.jpg',
  },
];

export function Testimonials() {
  const [currentIndex, setCurrentIndex] = useState(0);

  const nextTestimonial = () => {
    setCurrentIndex((prev) => (prev + 1) % testimonials.length);
  };

  const prevTestimonial = () => {
    setCurrentIndex((prev) => (prev - 1 + testimonials.length) % testimonials.length);
  };

  return (
    <section id="testimonials" className="py-32 px-4">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="text-primary text-sm uppercase tracking-wider">Testimonials</span>
          <h2 className="text-4xl md:text-5xl mt-2">What People Say</h2>
          <p className="text-muted-foreground mt-4 max-w-2xl mx-auto">
            Feedback from colleagues and clients I&apos;ve had the pleasure to work with
          </p>
        </motion.div>

        <div className="relative">
          {/* Main Testimonial Card */}
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -100 }}
            transition={{ duration: 0.5 }}
            className="glass-strong rounded-3xl p-8 md:p-12 shadow-soft max-w-4xl mx-auto"
          >
            {/* Quote Icon */}
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
              <Quote className="w-8 h-8 text-primary" />
            </div>

            {/* Testimonial Content */}
            <p className="text-xl md:text-2xl leading-relaxed mb-8 text-foreground/90">
              &quot;{testimonials[currentIndex].content}&quot;
            </p>

            {/* Rating */}
            <div className="flex gap-1 mb-6">
              {Array.from({ length: testimonials[currentIndex].rating }).map((_, i) => (
                <Star key={i} className="w-5 h-5 fill-primary text-primary" />
              ))}
            </div>

            {/* Author Info */}
            <div className="flex items-center gap-4">
              <img
                src={testimonials[currentIndex].avatar}
                alt={testimonials[currentIndex].name}
                className="w-16 h-16 rounded-full object-cover border-2 border-primary/20"
              />
              <div>
                <h4 className="font-semibold">{testimonials[currentIndex].name}</h4>
                <p className="text-sm text-muted-foreground">
                  {testimonials[currentIndex].role}
                </p>
              </div>
            </div>
          </motion.div>

          {/* Navigation Buttons */}
          <div className="flex justify-center gap-4 mt-8">
            <motion.button
              onClick={prevTestimonial}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              className="w-12 h-12 rounded-full glass flex items-center justify-center hover:bg-primary hover:text-white transition-colors"
              aria-label="Previous testimonial"
            >
              <ChevronLeft className="w-5 h-5" />
            </motion.button>

            {/* Dots Indicator */}
            <div className="flex items-center gap-2">
              {testimonials.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setCurrentIndex(index)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    index === currentIndex
                      ? 'w-8 bg-primary'
                      : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'
                  }`}
                  aria-label={`Go to testimonial ${index + 1}`}
                />
              ))}
            </div>

            <motion.button
              onClick={nextTestimonial}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              className="w-12 h-12 rounded-full glass flex items-center justify-center hover:bg-primary hover:text-white transition-colors"
              aria-label="Next testimonial"
            >
              <ChevronRight className="w-5 h-5" />
            </motion.button>
          </div>

          {/* Background Thumbnails - Hidden on Mobile */}
          <div className="hidden lg:block">
            {testimonials.map((testimonial, index) => {
              if (index === currentIndex) return null;
              const offset = index - currentIndex;
              const isLeft = offset < 0;

              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0 }}
                  animate={{
                    opacity: 0.3,
                    x: isLeft ? -200 : 200,
                    y: Math.abs(offset) * 50,
                    scale: 0.8,
                  }}
                  className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{
                    [isLeft ? 'left' : 'right']: '0',
                  }}
                >
                  <div className="glass rounded-2xl p-6 w-64 shadow-soft blur-sm">
                    <div className="flex items-center gap-3 mb-3">
                      <img
                        src={testimonial.avatar}
                        alt={testimonial.name}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                      <div className="text-sm">
                        <p>{testimonial.name}</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-3">
                      {testimonial.content}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
