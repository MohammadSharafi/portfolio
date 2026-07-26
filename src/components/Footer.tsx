import { profile, socialLinks } from '@/data/profile';
import { navItems } from '@/data/navigation';

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="no-print border-t border-border px-4 py-12">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-8 md:flex-row md:justify-between">
          <div>
            <p className="font-display text-lg font-bold text-gradient">{profile.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {profile.role} · {profile.location}
            </p>
            <a
              href={`mailto:${profile.email}`}
              className="mt-2 inline-block text-sm text-primary hover:underline"
            >
              {profile.email}
            </a>
          </div>

          <nav aria-label="Footer">
            <ul className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3 md:grid-cols-2">
              {navItems.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    className="text-muted-foreground transition-colors hover:text-primary"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <ul className="flex gap-3">
            {socialLinks.map(({ label, href, icon: Icon }) => (
              <li key={label}>
                <a
                  href={href}
                  target={href.startsWith('mailto:') ? undefined : '_blank'}
                  rel="noopener noreferrer"
                  className="glass flex size-10 items-center justify-center rounded-full transition-colors hover:bg-primary hover:text-primary-foreground"
                  aria-label={label}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-10 flex flex-col items-center gap-2 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:justify-between">
          <p>
            © {year} {profile.name}. All rights reserved.
          </p>
          <p>
            Built with React, TypeScript, Tailwind CSS and Motion.{' '}
            <a
              href="https://github.com/MohammadSharafi/portfolio"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              Source on GitHub
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
