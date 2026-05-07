import 'server-only';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { exerciseDatasetSchema, type ExerciseDataset, type ExerciseRecord } from './schema';

/**
 * Exercise data is loaded from a local JSON file (generated offline by scripts/exercises/fetch_wger.py).
 * There is no runtime call to wger and no API key for this feature.
 *
 * Optional: set EXERCISES_DATA_PATH in .env to an absolute path to a custom dataset file (same JSON shape).
 */
function resolveExercisesFilePath(): string {
  const override = process.env.EXERCISES_DATA_PATH?.trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.join(process.cwd(), override);
  }
  return path.join(process.cwd(), 'data', 'exercises', 'exercises.json');
}

let cache: ExerciseDataset | null = null;

export function loadExerciseDataset(): ExerciseDataset {
  if (cache) return cache;
  const filePath = resolveExercisesFilePath();
  const raw = readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  const data = exerciseDatasetSchema.parse(parsed);
  cache = data;
  return data;
}

export function listExercises(filter?: { q?: string; bodyPart?: string }): ExerciseRecord[] {
  const { exercises } = loadExerciseDataset();
  let list = [...exercises];
  const q = filter?.q?.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.targetMuscle.toLowerCase().includes(q) ||
        e.equipment.some((x) => x.toLowerCase().includes(q))
    );
  }
  const bp = filter?.bodyPart?.trim();
  if (bp) {
    list = list.filter((e) => e.bodyPart.toLowerCase() === bp.toLowerCase());
  }
  return list;
}
