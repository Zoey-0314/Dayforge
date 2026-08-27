export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTY_EXP: Record<Difficulty, number> = {
  easy: 10,
  medium: 25,
  hard: 50,
};

export function getDifficultyExperience(difficulty: Difficulty): number {
  return DIFFICULTY_EXP[difficulty];
}
