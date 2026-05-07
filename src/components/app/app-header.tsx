'use client';

import { useSession, signOut } from 'next-auth/react';
import { LogOut, User, Settings } from 'lucide-react';
import Link from 'next/link';
import { FnexLogoBadge } from '@/components/branding/fnex-logo-badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';

export function AppHeader() {
  const { data: session } = useSession();
  const email = session?.user?.email || '';
  const initials = email.slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
        <Link
          href="/home"
          aria-label="Go to home"
          className="relative z-10 flex items-center gap-2 cursor-pointer pointer-events-auto"
        >
          <FnexLogoBadge size="sm" priority />
          <span className="font-semibold">FitNexus</span>
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full">
              <Avatar className="h-8 w-8">
                <AvatarImage src={session?.user?.image || ''} />
                <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-medium truncate">{email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/blueprint/profile" className="flex items-center gap-2 cursor-pointer">
                <User className="h-4 w-4" /> Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/blueprint/privacy" className="flex items-center gap-2 cursor-pointer">
                <Settings className="h-4 w-4" /> Privacy
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut({ callbackUrl: '/login' })} className="flex items-center gap-2 cursor-pointer text-destructive">
              <LogOut className="h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
