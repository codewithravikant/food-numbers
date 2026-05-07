import { z } from 'zod';

export const exerciseRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  bodyPart: z.string(),
  targetMuscle: z.string(),
  secondaryMuscles: z.array(z.string()),
  equipment: z.array(z.string()),
  difficulty: z.string().nullable(),
  instructions: z.array(z.string()),
  tips: z.array(z.string()),
  mediaType: z.enum(['image', 'gif', 'video']).nullable(),
  mediaUrl: z.string().nullable(),
  mediaLocalPath: z.string().nullable(),
  sourceName: z.string(),
  sourceUrl: z.string(),
  licenseType: z.string(),
  licenseUrl: z.string().optional(),
  attribution: z.string(),
  lastVerifiedAt: z.string().nullable().optional(),
});

export const exerciseDatasetSchema = z.object({
  meta: z.object({
    version: z.number(),
    source: z.string(),
    fetchedCount: z.number().optional(),
    note: z.string().optional(),
  }),
  exercises: z.array(exerciseRecordSchema),
});

export type ExerciseRecord = z.infer<typeof exerciseRecordSchema>;
export type ExerciseDataset = z.infer<typeof exerciseDatasetSchema>;
