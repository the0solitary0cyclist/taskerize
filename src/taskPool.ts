import type { Filters, Task } from './types';

const intersects = <T,>(selected: T[], values: T[]) =>
  selected.length === 0 || selected.some(value => values.includes(value));

export function taskMatches(task: Task, filters: Filters) {
  if (task.completed) return false;
  if (!intersects(filters.folderIds, [task.folder ?? 0])) return false;
  if (!intersects(filters.contextIds, [task.context ?? 0])) return false;
  if (!intersects(filters.goalIds, [task.goal ?? 0])) return false;
  if (!intersects(filters.locationIds, [task.location ?? 0])) return false;

  const taskTags = (task.tag || '').split(',').map(tag => tag.trim()).filter(Boolean);
  if (!intersects(filters.tags, taskTags)) return false;
  if (!intersects(filters.statuses, [task.status ?? 0])) return false;
  if (!intersects(filters.priorities, [task.priority ?? 0])) return false;
  if (filters.starredOnly && task.star !== 1) return false;

  if (filters.availableMinutes !== null) {
    const length = task.length ?? 0;
    if (length <= 0 && !filters.includeUnestimated) return false;
    if (length > filters.availableMinutes) return false;
  }

  return true;
}

export function buildPool(tasks: Task[], filters: Filters, excludedIds: Set<number>) {
  return tasks.filter(task => !excludedIds.has(task.id) && taskMatches(task, filters));
}

export function randomTask(pool: Task[]) {
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}
