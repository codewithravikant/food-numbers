const unique = (items: string[]): string[] => Array.from(new Set(items));

export const PREF_PREFIX = 'pref:';

export const ADDITIONAL_DIETARY_TAGS = [
  'Diabetes-friendly',
  'Vegan',
  'Vegetarian',
  'Keto',
] as const;

export const DIETARY_RESTRICTION_OPTIONS = [
  'Peanuts',
  'Tree nuts',
  'Dairy',
  'Eggs',
  'Soy',
  'Wheat',
  'Gluten',
  'Fish',
  'Shellfish',
  'Sesame',
] as const;

const prefSet = new Set<string>(ADDITIONAL_DIETARY_TAGS);
const restrictionSet = new Set<string>(DIETARY_RESTRICTION_OPTIONS);

const BAN_TOKEN_MAP: Record<string, string[]> = {
  Peanuts: ['peanut', 'groundnut'],
  'Tree nuts': ['almond', 'cashew', 'walnut', 'pecan', 'pistachio', 'hazelnut', 'macadamia'],
  Dairy: ['milk', 'cheese', 'butter', 'cream', 'ghee', 'yogurt', 'yoghurt', 'paneer'],
  Eggs: ['egg', 'eggs', 'egg white', 'egg yolk'],
  Soy: ['soy', 'soya', 'tofu', 'tempeh', 'miso', 'edamame'],
  Wheat: ['wheat'],
  Gluten: ['gluten', 'barley', 'rye'],
  Fish: ['fish', 'salmon', 'tuna', 'sardine', 'anchovy', 'cod', 'tilapia'],
  Shellfish: ['shrimp', 'prawn', 'crab', 'lobster', 'mussel', 'clam', 'oyster', 'scallop'],
  Sesame: ['sesame', 'tahini'],
};

const PREF_BAN_TOKEN_MAP: Record<string, string[]> = {
  Vegan: ['beef', 'pork', 'chicken', 'turkey', 'fish', 'shrimp', 'egg', 'milk', 'cheese', 'butter', 'honey'],
  Vegetarian: ['beef', 'pork', 'chicken', 'turkey', 'fish', 'shrimp', 'anchovy'],
  'Diabetes-friendly': [],
  Keto: [],
};

export function prefTag(label: string): string {
  return `${PREF_PREFIX}${label}`;
}

export function prefLabelsFromRestrictions(restrictions: string[] = []): string[] {
  return restrictions
    .filter((entry) => entry.startsWith(PREF_PREFIX))
    .map((entry) => entry.slice(PREF_PREFIX.length))
    .filter((label) => prefSet.has(label));
}

export function isKnownDietRestrictionEntry(value: string): boolean {
  if (!value) return false;
  if (restrictionSet.has(value)) return true;
  if (!value.startsWith(PREF_PREFIX)) return false;
  const label = value.slice(PREF_PREFIX.length);
  return prefSet.has(label);
}

export function allBannedIngredientTokens(restrictions: string[] = []): string[] {
  const tokens: string[] = [];

  for (const entry of restrictions) {
    if (!entry) continue;

    if (entry.startsWith(PREF_PREFIX)) {
      const label = entry.slice(PREF_PREFIX.length);
      tokens.push(...(PREF_BAN_TOKEN_MAP[label] ?? []));
      continue;
    }

    tokens.push(...(BAN_TOKEN_MAP[entry] ?? []));
    if (!restrictionSet.has(entry)) {
      tokens.push(entry.toLowerCase());
    }
  }

  return unique(tokens.map((t) => t.trim().toLowerCase()).filter(Boolean));
}
