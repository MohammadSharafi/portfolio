export interface Testimonial {
  name: string;
  /** Trimmed to the part that establishes credibility — full LinkedIn headlines
   *  are too long to read inside a card. */
  role: string;
  company?: string;
  quote: string;
  avatar: string;
  source: string;
}

export const testimonials: readonly Testimonial[] = [
  {
    name: 'Mahdi Hamidi',
    role: 'Head of Growth & Marketing',
    company: 'HealthTech & AI',
    quote:
      'Mohammad is an outstanding professional and a remarkable individual — highly motivated, adaptable and incredibly reliable. His thoughtful approach and professionalism make him an asset to any team.',
    avatar: '/testimonials/mahdi-hamidi.jpg',
    source: 'LinkedIn recommendation',
  },
  {
    name: 'Masoome Hadiyan K.',
    role: 'Senior Product Designer & Product Owner',
    company: 'March Health',
    quote:
      'I had the pleasure of working with Mohammad at March Health. He is a highly skilled engineer who consistently delivers high-quality, user-focused solutions. Beyond his technical expertise, he is a proactive problem-solver and a great collaborator.',
    avatar: '/testimonials/masoome-hadiyan.jpg',
    source: 'LinkedIn recommendation',
  },
  {
    name: 'Mahoor Jahanbani',
    role: 'User Experience Specialist & Product Researcher',
    quote:
      'Beyond his technical abilities, Mohammad is a fantastic team player. He actively collaborates with designers, back-end developers and other stakeholders to ensure seamless integration and delivery of projects.',
    avatar: '/testimonials/mahoor-jahanbani.jpg',
    source: 'LinkedIn recommendation',
  },
  {
    name: 'Amirali Hariri',
    role: 'Researcher & Data Scientist, PharmD',
    company: 'March Health',
    quote:
      'I worked alongside Mohammad for two years at March Health. As our Team Lead Software Engineer, he consistently demonstrated exceptional leadership and technical prowess, driving team success through communication and problem-solving.',
    avatar: '/testimonials/amirali-hariri.jpg',
    source: 'LinkedIn recommendation',
  },
  {
    name: 'Farzad Sobhani Kazemi',
    role: 'Senior Backend Engineer & Data Science Professional',
    quote:
      'A skilled developer with strong technical abilities in Flutter, Java and Swift. Mohammad is a problem-solver, a team player and a fast learner who consistently delivers high-quality, responsive apps.',
    avatar: '/testimonials/farzad-sobhani.jpg',
    source: 'LinkedIn recommendation',
  },
] as const;
