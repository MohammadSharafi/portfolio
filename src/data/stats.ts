import type { LucideIcon } from 'lucide-react';
import { CalendarClock, Download, Gauge, Wallet } from 'lucide-react';
import { yearsOfExperience } from './profile';

export interface Stat {
  icon: LucideIcon;
  value: number;
  /** Rendered after the counted value, e.g. "+" or "%". */
  suffix: string;
  prefix?: string;
  label: string;
  /** Where the number comes from — keeps every headline figure attributable. */
  detail: string;
}

export const stats: readonly Stat[] = [
  {
    icon: CalendarClock,
    value: yearsOfExperience(),
    suffix: '+',
    label: 'Years shipping software',
    detail: 'Android, Flutter and full-stack roles since 2018',
  },
  {
    icon: Download,
    value: 50,
    suffix: 'K+',
    label: 'App downloads',
    detail: 'Across education and fintech apps at Robintel, 4.5★ average',
  },
  {
    icon: Wallet,
    value: 2,
    prefix: '$',
    suffix: 'M+',
    label: 'Payments processed',
    detail: 'Through banking apps built with end-to-end encrypted flows',
  },
  {
    icon: Gauge,
    value: 50,
    suffix: '%',
    label: 'API latency cut',
    detail: 'Response times taken from 800ms to 400ms at March Health',
  },
] as const;
