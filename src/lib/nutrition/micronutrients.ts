const micronutrientHints: Record<string, string[]> = {
  'vitamin d': ['salmon', 'egg yolk', 'fortified milk', 'mushrooms'],
  b12: ['eggs', 'fish', 'yogurt', 'fortified cereal'],
  iron: ['spinach', 'lentils', 'beans', 'pumpkin seeds'],
  magnesium: ['almonds', 'dark chocolate', 'avocado', 'whole grains'],
};

export function suggestMicronutrients(deficiencies: string[]) {
  return deficiencies.map((d) => ({
    nutrient: d,
    foods: micronutrientHints[d.toLowerCase()] || ['Leafy greens', 'Legumes', 'Seeds'],
  }));
}
