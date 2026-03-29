export function rankByScore<T extends { score: number }>(items: T[]) {
  return [...items].sort((left, right) => right.score - left.score);
}
