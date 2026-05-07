import type { DailyAction } from '@/types/ai';

export const DEFAULT_DAILY_TOP_ACTIONS: DailyAction[] = [
  {
    id: 'default-move-10',
    title: '10-minute mobility reset',
    description: 'Do one short mobility session to unlock your day.',
    category: 'movement',
    completed: false,
  },
  {
    id: 'default-protein-plate',
    title: 'Build one protein-first plate',
    description: 'Anchor lunch or dinner with a lean protein source.',
    category: 'nutrition',
    completed: false,
  },
  {
    id: 'default-breath-2min',
    title: '2-minute breathing break',
    description: 'Take a short pause to downshift stress before your next task.',
    category: 'mindfulness',
    completed: false,
  },
];

export const DEFAULT_HOME_INSIGHT_TEXT =
  'Small consistent actions compound. Complete your top 3 to keep momentum today.';
