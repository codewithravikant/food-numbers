import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { SidebarNav } from '@/components/app/sidebar-nav';
import { BottomNav } from '@/components/app/bottom-nav';
import { FloatingActionButton } from '@/components/app/floating-action-button';
import { FloatingShoppingNotepad } from '@/components/app/floating-shopping-notepad';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const profile = await prisma.healthProfile.findUnique({
    where: { userId: session.user.id },
    select: { onboardingCompleted: true },
  });

  if (!profile?.onboardingCompleted) redirect('/onboarding');

  return (
    <div className="min-h-screen bg-background relative nature-ambient">
      <SidebarNav />
      <main className="relative z-10 ml-0 min-h-screen pb-24 pt-16 transition-[margin-left] duration-200 md:ml-[var(--app-sidebar-width)] md:pb-0 md:pt-0">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 md:px-8">{children}</div>
      </main>
      <BottomNav className="md:hidden" />
      <FloatingShoppingNotepad />
      <FloatingActionButton />
    </div>
  );
}
