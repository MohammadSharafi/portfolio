import { motion } from 'motion/react';
import { Briefcase, Calendar } from 'lucide-react';

const experiences = [
  {
    company: 'March Health',
    role: 'Full Stack Engineer',
    period: 'Nov 2024 - Present',
    description:
      'Designing and building production full-stack systems using Flutter 3.24 (iOS, Android, Web) + Python FastAPI microservices + Java Spring Boot on GCP Cloud Run. Leading development and integration of HIPAA-compliant EHR AI Clinical Assistant with Cerner/Oracle Health and Mayo Clinic Platform via SMART on FHIR.',
    highlights: [
      'Built HIPAA-compliant EHR AI Clinical Assistant with 123+ endpoints, OAuth2 vault, rate limiting, and automatic pagination',
      'Delivered 50% faster API response times and 30% performance gains',
      'Achieved 40% fraud reduction via encrypted payments and zero security incidents',
      'Own end-to-end delivery: architecture, CI/CD (GitHub Actions/Codemagic), App Store & Google Play publishing',
      'Authored 20,000+ lines of technical documentation and mentored global engineers',
    ],
  },
  {
    company: 'March Health',
    role: 'Data Scientist (Part-time)',
    period: 'May 2024 - Nov 2024',
    description:
      'Worked directly on the Mayo Clinic Platform with one of the world\'s largest real-world clinical datasets. Focused on large-scale data cleaning, standardization, and aggregation of multi-million-patient de-identified records.',
    highlights: [
      'Transformed raw EHR extracts, clinical notes, lab results, and medication histories using Python (pandas, Polars) and SQL',
      'Built automated, reproducible pipelines that reduced cohort preparation time from weeks to days',
      'Resolved duplicates, standardized coding systems (ICD, LOINC, RxNorm, SNOMED), and handled missing values',
      'Maintained strict HIPAA compliance and data governance standards in secure cloud environment',
    ],
  },
  {
    company: 'March Health',
    role: 'Software Engineering Team Lead',
    period: 'May 2021 - Jan 2024',
    description:
      'Led development of mobile app using Flutter and Dart with BLoC state management, freezed, and functional programming. Implemented RESTful APIs with Dio, Firebase, and AWS S3, resulting in significant performance improvements.',
    highlights: [
      'Reduced API response time by 50% and improved app performance by 30%',
      'Increased user engagement by 20% through intuitive UI/UX design using Flutter Hooks',
      'Decreased fraudulent activities by 40% through secure payment systems and encryption',
      'Contributed to mobile app offering support for over 311 septillion different health conditions',
      'Managed app publishing on Play Store and App Store, version control, and CI/CD pipelines',
      'Company won Startup of the Year in IT World Awards, Best Biz Awards, and One Planet Awards 2020',
    ],
  },
  {
    company: 'Robintel',
    role: 'Software Engineer',
    period: '2019 - 2021',
    description:
      'Developed and programmed app features using Flutter and Java. Designed and implemented UX features for optimal app usability. Integrated APIs, third-party libraries, and ensured secure payment processing.',
    highlights: [
      'Developed 5 educational apps downloaded over 50,000 times with 4.5-star average rating',
      'Designed and developed 3 banking apps facilitating over $2 million in transactions',
      'Participated in development of 10+ mobile apps across education and banking sectors',
      'Spent 60% time on feature development, 20% on UX design, 20% on API integration and security',
    ],
  },
  {
    company: 'Byte Group',
    role: 'Android Developer',
    period: 'Jan 2018 - Mar 2019',
    description:
      'Led development of Android applications for multiple clients across various industries. Conducted code reviews, participated in client meetings, and collaborated with UX/UI teams to deliver high-quality solutions.',
    highlights: [
      'Integrated Facebook and Instagram APIs, resulting in 20% increase in user engagement',
      'Implemented MVVM and MVP architectures in 90% of applications for maintainability and scalability',
      'Designed user-friendly interfaces that increased user satisfaction by 25%',
      'Reduced potential security breaches by 30% through secure integrations',
      'Contributed to 50% increase in client retention rate and 20% increase in company revenue',
    ],
  },
];

export function Experience() {
  return (
    <section id="experience" className="py-32 px-4 bg-muted/30">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
          className="text-center mb-16"
        >
          <span className="text-primary text-sm uppercase tracking-wider">Journey</span>
          <h2 className="text-4xl md:text-5xl mt-2">Work Experience</h2>
          <p className="text-muted-foreground mt-4 max-w-2xl mx-auto">
            A timeline of my professional growth and achievements
          </p>
        </motion.div>

        <div className="relative">
          {/* Vertical Line */}
          <div className="absolute left-8 md:left-1/2 top-0 bottom-0 w-0.5 bg-gradient-to-b from-primary via-accent to-transparent" />

          {/* Experience Items */}
          <div className="space-y-12">
            {experiences.map((exp, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.2 }}
                className={`relative flex items-start gap-8 ${
                  index % 2 === 0 ? 'md:flex-row' : 'md:flex-row-reverse'
                }`}
              >
                {/* Timeline Dot */}
                <div className="absolute left-8 md:left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-primary border-4 border-background z-10">
                  <motion.div
                    animate={{
                      scale: [1, 1.5, 1],
                      opacity: [1, 0, 1],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                    className="absolute inset-0 rounded-full bg-primary"
                  />
                </div>

                {/* Content Card */}
                <motion.div
                  whileHover={{ scale: 1.02 }}
                  className={`ml-16 md:ml-0 md:w-[calc(50%-3rem)] glass-strong rounded-3xl p-6 shadow-soft hover:shadow-lg transition-shadow ${
                    index % 2 === 0 ? 'md:mr-auto' : 'md:ml-auto'
                  }`}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                        <Briefcase className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="text-xl">{exp.role}</h3>
                        <p className="text-sm text-muted-foreground">{exp.company}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="w-4 h-4" />
                      <span>{exp.period}</span>
                    </div>
                  </div>

                  {/* Description */}
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                    {exp.description}
                  </p>

                  {/* Highlights */}
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wider text-primary">Key Achievements</p>
                    <ul className="space-y-2">
                      {exp.highlights.map((highlight, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                          <span className="text-muted-foreground">{highlight}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </motion.div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
