-- AlterTable
ALTER TABLE "MealPlanItem" ADD COLUMN     "videoDuration" TEXT,
ADD COLUMN     "videoTitle" TEXT,
ADD COLUMN     "videoUrl" TEXT;

-- CreateTable
CREATE TABLE "GeneratedRecipeLink" (
    "id" TEXT NOT NULL,
    "mealPlanId" TEXT NOT NULL,
    "mealItemId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "source" TEXT,
    "version" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedRecipeLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShoppingListItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'g',
    "category" TEXT,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "sourceMealPlanId" TEXT,
    "sourceMealItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShoppingListItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeneratedRecipeLink_mealPlanId_idx" ON "GeneratedRecipeLink"("mealPlanId");

-- CreateIndex
CREATE INDEX "GeneratedRecipeLink_mealItemId_idx" ON "GeneratedRecipeLink"("mealItemId");

-- CreateIndex
CREATE INDEX "GeneratedRecipeLink_recipeId_idx" ON "GeneratedRecipeLink"("recipeId");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedRecipeLink_mealItemId_recipeId_key" ON "GeneratedRecipeLink"("mealItemId", "recipeId");

-- CreateIndex
CREATE INDEX "ShoppingListItem_userId_checked_idx" ON "ShoppingListItem"("userId", "checked");

-- CreateIndex
CREATE INDEX "ShoppingListItem_sourceMealPlanId_idx" ON "ShoppingListItem"("sourceMealPlanId");

-- AddForeignKey
ALTER TABLE "GeneratedRecipeLink" ADD CONSTRAINT "GeneratedRecipeLink_mealPlanId_fkey" FOREIGN KEY ("mealPlanId") REFERENCES "MealPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedRecipeLink" ADD CONSTRAINT "GeneratedRecipeLink_mealItemId_fkey" FOREIGN KEY ("mealItemId") REFERENCES "MealPlanItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedRecipeLink" ADD CONSTRAINT "GeneratedRecipeLink_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingListItem" ADD CONSTRAINT "ShoppingListItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingListItem" ADD CONSTRAINT "ShoppingListItem_sourceMealItemId_fkey" FOREIGN KEY ("sourceMealItemId") REFERENCES "MealPlanItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
