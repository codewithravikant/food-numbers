import { prisma } from '@/lib/prisma';

export const inferShoppingCategory = (name: string) => {
  const n = name.toLowerCase();
  if (/(tomato|cucumber|onion|pepper|spinach|lettuce|vegetable)/.test(n)) return 'Produce';
  if (/(chicken|beef|fish|tofu|egg|salmon|turkey|paneer)/.test(n)) return 'Protein';
  if (/(rice|quinoa|bread|pasta|oats)/.test(n)) return 'Grains';
  if (/(milk|yogurt|cheese|feta)/.test(n)) return 'Dairy';
  return 'Pantry';
};

type IngredientLine = { name: string; quantity: number; unit: string };

function getShoppingDelegate() {
  return (prisma as unknown as { shoppingListItem?: {
    deleteMany: (...args: unknown[]) => Promise<unknown>;
    create: (...args: unknown[]) => Promise<unknown>;
  } }).shoppingListItem;
}

export async function syncShoppingListFromMealPlan(userId: string, mealPlanId: string) {
  const shopping = getShoppingDelegate();
  if (!shopping) {
    // Prisma client in current process was generated before ShoppingListItem existed.
    // Avoid 500; caller can still render derived/empty list until process restart.
    return [];
  }
  const mealPlan = await prisma.mealPlan.findUnique({
    where: { id: mealPlanId },
    include: { items: true },
  });
  if (!mealPlan || mealPlan.userId !== userId) return [];
  const planJson = (mealPlan.planJson || {}) as Record<string, unknown>;
  const meals = Array.isArray(planJson.meals) ? (planJson.meals as Record<string, unknown>[]) : [];
  const ingredientMap = new Map<string, IngredientLine>();
  for (const meal of meals) {
    const ingredients = Array.isArray(meal.ingredients) ? meal.ingredients : [];
    for (const raw of ingredients) {
      if (typeof raw === 'string') {
        const key = raw.trim().toLowerCase();
        if (!key) continue;
        const existing = ingredientMap.get(key);
        if (existing) existing.quantity += 1;
        else ingredientMap.set(key, { name: raw.trim(), quantity: 1, unit: 'each' });
        continue;
      }
      if (!raw || typeof raw !== 'object') continue;
      const line = raw as Record<string, unknown>;
      const name = String(line.name || '').trim();
      if (!name) continue;
      const quantity = Number(line.quantity || 0) || 0;
      const unit = String(line.unit || 'g');
      const key = name.toLowerCase();
      const existing = ingredientMap.get(key);
      if (existing) existing.quantity += quantity;
      else ingredientMap.set(key, { name, quantity, unit });
    }
  }

  await shopping.deleteMany({
    where: { userId, sourceMealPlanId: mealPlanId },
  });
  const created = await Promise.all(
    Array.from(ingredientMap.values()).map((it) =>
      shopping.create({
        data: {
          userId,
          name: it.name,
          quantity: it.quantity,
          unit: it.unit,
          category: inferShoppingCategory(it.name),
          sourceMealPlanId: mealPlanId,
        },
      })
    )
  );
  return created;
}
