import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { handleApiError, ApiError } from '@/lib/api-error';
import { generateDailyPlan } from '@/lib/ai/insight-generator';
import { resolveInsightForDailyActionUpdate } from '@/lib/daily-plan-action-insight';
import {
  DEFAULT_DAILY_TOP_ACTIONS,
  DEFAULT_HOME_INSIGHT_TEXT,
} from '@/lib/daily-top-actions-default';
import type { DailyAction } from '@/types/ai';

const AUTO_ACTION_NOTE_PREFIX = 'top-action:';

const DEFAULT_ACTION_IDS = new Set(DEFAULT_DAILY_TOP_ACTIONS.map((a) => a.id));

function isDefaultDashboardActionId(id: string): boolean {
  return DEFAULT_ACTION_IDS.has(id);
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new ApiError(401, 'Unauthorized');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const insight = await prisma.aIInsight.findFirst({
      where: {
        userId: session.user.id,
        generatedAt: { gte: today },
        modelUsed: { not: 'observation_summary_v1' },
      },
      orderBy: { generatedAt: 'desc' },
    });

    if (!insight) {
      return NextResponse.json({
        plan: null,
        message: 'No plan generated for today yet',
      });
    }

    return NextResponse.json({ plan: insight });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new ApiError(401, 'Unauthorized');

    const body = await request.json().catch(() => ({}));

    // If no action payload, generate a new plan (and return cached plan if AI is down).
    if (!body?.planId && !body?.actionId) {
      const preserveMode = body?.preserveMode ?? false;
      const plan = await generateDailyPlan(session.user.id, preserveMode);
      return NextResponse.json(plan, { status: 201 });
    }

    const clientPlanId = typeof body.planId === 'string' ? body.planId : 'default';
    const { actionId, completed } = body;

    if (!actionId) {
      throw new ApiError(400, 'actionId is required');
    }
    if (typeof completed !== 'boolean') {
      throw new ApiError(400, 'completed must be a boolean');
    }

    let insight;
    try {
      insight = await resolveInsightForDailyActionUpdate(session.user.id, clientPlanId);
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 404 &&
        isDefaultDashboardActionId(actionId)
      ) {
        insight = await prisma.aIInsight.create({
          data: {
            userId: session.user.id,
            insightText: DEFAULT_HOME_INSIGHT_TEXT,
            recommendations: JSON.parse(
              JSON.stringify({
                actions: DEFAULT_DAILY_TOP_ACTIONS,
                priority: 'medium',
              })
            ),
            weeklyFocus: null,
            fallbackUsed: true,
            promptVersion: 'default-actions-v1',
            modelUsed: 'default_actions_v1',
            contextHash: null,
          },
        });
      } else {
        throw err;
      }
    }

    const planId = insight.id;

    const recommendations = (insight.recommendations as Record<string, unknown>) || {};
    let actions = Array.isArray(recommendations.actions) ? (recommendations.actions as DailyAction[]) : [];

    let existing = actions.find((a) => a.id === actionId);
    if (!existing && isDefaultDashboardActionId(actionId)) {
      actions = DEFAULT_DAILY_TOP_ACTIONS.map((a) => ({ ...a }));
      existing = actions.find((a) => a.id === actionId);
    }

    if (!existing) {
      throw new ApiError(404, 'Action not found');
    }
    if (!actions.length) {
      throw new ApiError(400, 'No actions found on this plan');
    }

    if (existing.completed && completed) {
      return NextResponse.json({ success: true, alreadyCompleted: true });
    }
    if (existing.completed && !completed) {
      throw new ApiError(409, 'Completed actions stay locked for the day.');
    }

    const nowIso = new Date().toISOString();
    const updatedActions = actions.map((action) =>
      action.id === actionId
        ? {
            ...action,
            completed,
            completedAt: completed ? action.completedAt ?? nowIso : undefined,
          }
        : action
    );

    await prisma.aIInsight.update({
      where: { id: planId },
      data: {
        recommendations: JSON.parse(
          JSON.stringify({
            ...recommendations,
            actions: updatedActions,
          })
        ),
      },
    });

    if (completed) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const autoNote = `${AUTO_ACTION_NOTE_PREFIX}${actionId}`;

      const existingLog = await prisma.activityLog.findFirst({
        where: {
          userId: session.user.id,
          loggedAt: { gte: today },
          notes: autoNote,
        },
      });

      if (!existingLog) {
        const updatedAction = updatedActions.find((a) => a.id === actionId);
        await prisma.activityLog.create({
          data: {
            userId: session.user.id,
            activityType: `Top Action: ${updatedAction?.title || 'Daily action'}`,
            durationMin: 10,
            intensityLevel: updatedAction?.category === 'movement'
              ? 'MODERATE'
              : updatedAction?.category === 'mindfulness'
                ? 'LOW'
                : 'LOW',
            notes: autoNote,
          },
        });
      }
    }

    return NextResponse.json({ success: true, planId });
  } catch (error) {
    return handleApiError(error);
  }
}
