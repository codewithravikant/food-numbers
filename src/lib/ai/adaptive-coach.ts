import { computeMealCompliance } from '@/lib/nutrition/compliance';
import { prisma } from '@/lib/prisma';

export async function buildAdaptiveCoachDelta(userId: string) {
  const [compliance, recentScores] = await Promise.all([
    computeMealCompliance(userId, 7),
    prisma.wellnessScore.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      take: 8,
      select: { score: true },
    }),
  ]);
  const latest = recentScores[0]?.score ?? 0;
  const previous = recentScores[recentScores.length - 1]?.score ?? latest;
  const delta = latest - previous;

  const changes: string[] = [];
  if (compliance.slotCompliance < 0.6) changes.push('Increase meal logging reminders and lighter plan complexity.');
  if (compliance.overeatingRisk !== 'low') changes.push('Reduce calorie density in dinner and snack recommendations.');
  if (delta < 0) changes.push('Increase recovery-oriented actions and reduce intensity by 10%.');
  if (changes.length === 0) changes.push('Maintain strategy; increase variety while preserving macro consistency.');

  return {
    scoreDelta: delta,
    whatChanged: changes,
    whyChanged: `compliance=${(compliance.slotCompliance * 100).toFixed(0)}%, risk=${compliance.overeatingRisk}`,
    confidence: Math.max(0.4, Math.min(0.95, 0.6 + compliance.slotCompliance * 0.3)),
  };
}
