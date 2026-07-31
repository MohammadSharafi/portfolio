import { describe, expect, it } from 'vitest';
import { CAREER_START_YEAR, profile, socialLinks, yearsOfExperience } from './profile';
import { projectCategories, projects } from './projects';
import { experience } from './experience';
import { skillGroups } from './skills';
import { awards, education } from './credentials';
import { testimonials } from './testimonials';
import { navItems } from './navigation';
import { stats } from './stats';

describe('profile', () => {
  it('derives years of experience from the career start year', () => {
    expect(yearsOfExperience(new Date('2026-06-01'))).toBe(2026 - CAREER_START_YEAR);
  });

  it('never reports less than a year, even for a clock skewed into the past', () => {
    expect(yearsOfExperience(new Date('2015-01-01'))).toBe(1);
  });

  it('exposes a reachable email in both the profile and the social links', () => {
    const mailto = socialLinks.find((link) => link.href.startsWith('mailto:'));
    expect(mailto?.href).toBe(`mailto:${profile.email}`);
  });

  it('points every external social link at https', () => {
    const external = socialLinks.filter((link) => !link.href.startsWith('mailto:'));
    expect(external.length).toBeGreaterThan(0);
    external.forEach((link) => expect(link.href.startsWith('https://')).toBe(true));
  });
});

describe('projects', () => {
  it('has a unique slug per project', () => {
    const slugs = projects.map((project) => project.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('only uses declared categories', () => {
    projects.forEach((project) => {
      expect(projectCategories).toContain(project.category);
    });
  });

  it('links every project to a real repository, or says why it cannot', () => {
    // A profile listing is not a repository. Pointing a "source" link at one
    // is the kind of small dishonesty this site is built to avoid, so a
    // project either has a specific repo or states who owns the code.
    projects.forEach((project) => {
      if (project.repo === undefined) {
        expect(project.closed, `${project.slug} has neither a repo nor a reason`).toBeTruthy();
        return;
      }
      expect(project.repo).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/);
    });
  });

  it('gives every project at least one tag and a non-empty summary', () => {
    projects.forEach((project) => {
      expect(project.tags.length).toBeGreaterThan(0);
      expect(project.summary.trim().length).toBeGreaterThan(20);
    });
  });

  it('features at least one project so the grid never opens empty-handed', () => {
    expect(projects.some((project) => project.featured)).toBe(true);
  });
});

describe('experience', () => {
  it('marks exactly one role as current', () => {
    expect(experience.filter((role) => role.current).length).toBe(1);
  });

  it('gives every role highlights and a tech list', () => {
    experience.forEach((role) => {
      expect(role.highlights.length).toBeGreaterThan(0);
      expect(role.tech.length).toBeGreaterThan(0);
    });
  });
});

describe('credentials', () => {
  it('attributes every award to an issuer and a year', () => {
    awards.forEach((award) => {
      expect(award.issuer.trim()).not.toBe('');
      expect(award.year).toMatch(/^\d{4}$/);
    });
  });

  it('distinguishes team awards from individual ones', () => {
    expect(awards.some((award) => award.scope === 'team')).toBe(true);
    expect(awards.some((award) => award.scope === 'individual')).toBe(true);
  });

  it('lists education with an institution', () => {
    expect(education.length).toBeGreaterThan(0);
    education.forEach((entry) => expect(entry.institution.trim()).not.toBe(''));
  });
});

describe('skills', () => {
  it('never repeats a skill name across groups', () => {
    const names = skillGroups.flatMap((group) => group.skills.map((skill) => skill.name));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('testimonials', () => {
  it('references a local avatar for every quote', () => {
    testimonials.forEach((testimonial) => {
      expect(testimonial.avatar.startsWith('/testimonials/')).toBe(true);
    });
  });

  it('attributes every quote to a named person', () => {
    testimonials.forEach((testimonial) => {
      expect(testimonial.name.trim()).not.toBe('');
      expect(testimonial.quote.trim().length).toBeGreaterThan(40);
    });
  });
});

describe('navigation', () => {
  it('has unique section ids', () => {
    const ids = navItems.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('stats', () => {
  it('attaches an attribution detail to every headline number', () => {
    stats.forEach((stat) => {
      expect(stat.detail.trim().length).toBeGreaterThan(10);
      expect(stat.value).toBeGreaterThan(0);
    });
  });
});
