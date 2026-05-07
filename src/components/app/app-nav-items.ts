import { Home, Utensils, Activity, LayoutDashboard, Settings, type LucideIcon } from 'lucide-react';

export type AppNavItem = {
  href: string;
  label: string;
  bottomLabel: string;
  icon: LucideIcon;
};

export const APP_NAV_ITEMS: AppNavItem[] = [
  { href: '/home', label: 'Wellness Dashboard', bottomLabel: 'Home', icon: Home },
  { href: '/fuel', label: 'Intake', bottomLabel: 'Intake', icon: Utensils },
  { href: '/vitality', label: 'Vitality', bottomLabel: 'Vitality', icon: Activity },
  { href: '/blueprint', label: 'Blueprint', bottomLabel: 'Blueprint', icon: LayoutDashboard },
  { href: '/settings', label: 'Settings', bottomLabel: 'Settings', icon: Settings },
];
