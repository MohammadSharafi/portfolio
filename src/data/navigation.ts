export interface NavItem {
  id: string;
  label: string;
}

/** Order here drives both the navbar and the scroll-spy, so the two can never
 *  drift apart. */
export const navItems: readonly NavItem[] = [
  { id: 'about', label: 'About' },
  { id: 'skills', label: 'Skills' },
  { id: 'projects', label: 'Projects' },
  { id: 'experience', label: 'Experience' },
  { id: 'recognition', label: 'Recognition' },
  { id: 'testimonials', label: 'References' },
  { id: 'contact', label: 'Contact' },
] as const;
