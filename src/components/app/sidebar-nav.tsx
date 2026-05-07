'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { useEffect, useState } from 'react';
import {
  LogOut,
  User,
  Settings,
  Shield,
  Menu,
  PanelLeft,
  PanelLeftClose,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { APP_NAV_ITEMS, type AppNavItem } from '@/components/app/app-nav-items';
import { FnexLogoBadge } from '@/components/branding/fnex-logo-badge';

const STORAGE_KEY = 'wellness-sidebar-collapsed';

function NavLinkButton({
  item,
  pathname,
  collapsed,
  onNavigate,
}: {
  item: AppNavItem;
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const isActive = pathname.startsWith(item.href);
  const inner = (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
        collapsed && 'justify-center px-2',
        isActive
          ? 'bg-gradient-to-r from-primary/20 to-cyan-400/10 text-primary shadow-[inset_0_0_20px_rgba(139,92,246,0.12)] border border-primary/20 animate-[borderGlow_4s_ease-in-out_infinite]'
          : 'text-muted-foreground hover:bg-primary/10 hover:text-foreground'
      )}
    >
      <item.icon
        className={cn('h-5 w-5 shrink-0', isActive && 'text-primary drop-shadow-[0_0_8px_rgba(139,92,246,0.5)]')}
      />
      {!collapsed && <span>{item.label}</span>}
      {collapsed && <span className="sr-only">{item.label}</span>}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{inner}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    );
  }
  return inner;
}

export function SidebarNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  const email = session?.user?.email || '';
  const fallbackName = email ? email.split('@')[0].replace(/[._-]+/g, ' ') : 'User';
  const displayName = session?.user?.name?.trim() || fallbackName || 'User';
  const initials =
    displayName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('') || 'U';

  useEffect(() => {
    document.documentElement.style.setProperty('--app-sidebar-width', collapsed ? '4.5rem' : '15rem');
  }, [collapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const closeMobile = () => setMobileOpen(false);

  const accountTriggerClass = (opts: { compact: boolean; sheet?: boolean }) =>
    cn(
      'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      opts.compact && 'justify-center px-2',
      opts.sheet && 'border border-primary/15 bg-primary/5'
    );

  const accountMenuContent = (side: 'top' | 'bottom') => (
    <DropdownMenuContent align="end" side={side} className="w-52">
      <DropdownMenuLabel className="font-normal">
        <p className="truncate text-sm font-medium">{displayName}</p>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link href="/blueprint/profile" className="flex cursor-pointer items-center gap-2" onClick={closeMobile}>
          <User className="h-4 w-4" /> Profile
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link href="/blueprint/privacy" className="flex cursor-pointer items-center gap-2" onClick={closeMobile}>
          <Shield className="h-4 w-4" /> Privacy
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link href="/settings" className="flex cursor-pointer items-center gap-2" onClick={closeMobile}>
          <Settings className="h-4 w-4" /> Settings
        </Link>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={() => {
          closeMobile();
          signOut({ callbackUrl: '/login' });
        }}
        className="flex cursor-pointer items-center gap-2 text-destructive"
      >
        <LogOut className="h-4 w-4" /> Sign out
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  return (
    <>
      {/* Mobile header */}
      <header
        data-app-shell="mobile-header"
        className="fixed left-0 right-0 top-0 z-40 flex h-16 items-center justify-between border-b border-primary/20 bg-[rgba(10,12,30,0.82)] px-4 backdrop-blur-[40px] backdrop-saturate-[1.6] md:hidden"
      >
        <Link
          href="/home"
          onClick={closeMobile}
          aria-label="Go to home"
          className="relative z-10 flex min-w-0 items-center gap-3 cursor-pointer pointer-events-auto"
        >
          <FnexLogoBadge size="sm" className="shrink-0" priority />
          <div className="min-w-0">
            <span className="block truncate font-bold gradient-text">FitNexus</span>
            <p className="text-[10px] leading-none text-muted-foreground">Wellness Platform</p>
          </div>
        </Link>
        <button
          type="button"
          className="rounded-lg p-2 text-muted-foreground hover:bg-primary/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Open menu"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="h-6 w-6" />
        </button>
      </header>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[min(100%,20rem)] max-w-none">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-3 text-left">
              <Link
                href="/home"
                onClick={closeMobile}
                aria-label="Go to home"
                className="relative z-10 flex items-center gap-3 cursor-pointer pointer-events-auto"
              >
                <FnexLogoBadge size="sm" priority />
                <span className="gradient-text">FitNexus</span>
              </Link>
            </SheetTitle>
          </SheetHeader>
          <nav className="flex flex-1 flex-col gap-1 px-4 py-4">
            {APP_NAV_ITEMS.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={closeMobile}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
                    isActive
                      ? 'border border-primary/20 bg-gradient-to-r from-primary/20 to-cyan-400/10 text-primary shadow-[inset_0_0_20px_rgba(139,92,246,0.12)]'
                      : 'text-muted-foreground hover:bg-primary/10 hover:text-foreground'
                  )}
                >
                  <item.icon
                    className={cn(
                      'h-5 w-5 shrink-0',
                      isActive && 'text-primary drop-shadow-[0_0_8px_rgba(139,92,246,0.5)]'
                    )}
                  />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto border-t border-primary/20 p-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={accountTriggerClass({ compact: false, sheet: true })}>
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={session?.user?.image || ''} />
                    <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{displayName}</p>
                    <p className="text-[10px] text-muted-foreground">Manage account</p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              {accountMenuContent('bottom')}
            </DropdownMenu>
          </div>
        </SheetContent>
      </Sheet>

      {/* Desktop rail */}
      <TooltipProvider delayDuration={0}>
        <aside
          data-app-shell="sidebar"
          className={cn(
            'fixed left-0 top-0 z-40 hidden h-screen flex-col border-r border-primary/20 bg-[rgba(10,12,30,0.72)] backdrop-blur-[40px] backdrop-saturate-[1.6] transition-[width] duration-200 md:flex',
            collapsed ? 'w-[4.5rem]' : 'w-60'
          )}
        >
          <div
            className={cn(
              'flex border-b border-primary/20',
              collapsed ? 'flex-col items-center gap-2 px-2 py-3' : 'h-16 items-center gap-3 px-5'
            )}
          >
            <div
              className={cn(
                'flex items-center gap-3',
                collapsed ? 'justify-center' : 'min-w-0 flex-1'
              )}
            >
              <Link
                href="/home"
                aria-label="Go to home"
                className={cn(
                  'relative z-10 flex items-center gap-3 cursor-pointer pointer-events-auto',
                  collapsed && 'justify-center'
                )}
              >
                <FnexLogoBadge size="sm" className="shrink-0" priority />
                {!collapsed && (
                  <div className="min-w-0">
                    <span className="font-bold text-lg gradient-text">FitNexus</span>
                    <p className="text-[10px] leading-none text-muted-foreground">Wellness Platform</p>
                  </div>
                )}
              </Link>
            </div>
            <button
              type="button"
              className={cn(
                'rounded-lg p-2 text-muted-foreground hover:bg-primary/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                collapsed ? 'shrink-0' : 'ml-auto shrink-0'
              )}
              aria-expanded={!collapsed}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={() => setCollapsed((c) => !c)}
            >
              {collapsed ? <PanelLeft className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
            </button>
          </div>

          <nav className="flex flex-1 flex-col space-y-1 px-3 py-4">
            {APP_NAV_ITEMS.map((item) => (
              <NavLinkButton key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
            ))}
          </nav>

          <div className="border-t border-primary/20 p-3">
            {collapsed ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={accountTriggerClass({ compact: true })} title="Account">
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarImage src={session?.user?.image || ''} />
                      <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                    </Avatar>
                    <span className="sr-only">{displayName}</span>
                  </button>
                </DropdownMenuTrigger>
                {accountMenuContent('top')}
              </DropdownMenu>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={accountTriggerClass({ compact: false })}>
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarImage src={session?.user?.image || ''} />
                      <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{displayName}</p>
                      <p className="text-[10px] text-muted-foreground">Manage account</p>
                    </div>
                  </button>
                </DropdownMenuTrigger>
                {accountMenuContent('top')}
              </DropdownMenu>
            )}
          </div>
        </aside>
      </TooltipProvider>
    </>
  );
}
