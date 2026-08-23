import type {
  Filters,
  IncludeExclude,
  Task
} from './types';

function matchesIncludeExclude<T>(
  value: T,
  filter: IncludeExclude<T>
): boolean {
  /*
   * Exclusion always wins.
   */
  if (
    filter.exclude.includes(value)
  ) {
    return false;
  }

  /*
   * If nothing is explicitly included,
   * this facet is otherwise unrestricted.
   */
  if (
    filter.include.length === 0
  ) {
    return true;
  }

  /*
   * Otherwise the task must match
   * one of the included values.
   */
  return filter.include.includes(
    value
  );
}

function getTaskTags(
  task: Task
): string[] {
  return (task.tag || '')
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean);
}

function matchesTagFilter(
  task: Task,
  filter: IncludeExclude<string>
): boolean {
  const taskTags =
    getTaskTags(task);

  /*
   * Any excluded tag disqualifies
   * the task.
   */
  const hasExcludedTag =
    filter.exclude.some(tag =>
      taskTags.includes(tag)
    );

  if (hasExcludedTag) {
    return false;
  }

  /*
   * If no tags are explicitly included,
   * then any task that survived exclusion
   * is allowed.
   */
  if (
    filter.include.length === 0
  ) {
    return true;
  }

  /*
   * Included tags are OR:
   * matching any included tag is enough.
   */
  return filter.include.some(tag =>
    taskTags.includes(tag)
  );
}

function matchesTimeFilter(
  task: Task,
  filters: Filters
): boolean {
  const selectedTime =
    filters.availableMinutes;

  const hasEstimate =
    Boolean(task.length);

  /*
   * No time bucket selected.
   *
   * Estimated tasks of any length
   * are eligible.
   *
   * Unestimated tasks are eligible
   * only when enabled.
   */
  if (selectedTime === null) {
    return hasEstimate
      ? true
      : filters.includeUnestimated;
  }

  /*
   * Unestimated tasks may join any
   * selected bucket when enabled.
   */
  if (!hasEstimate) {
    return filters.includeUnestimated;
  }

  /*
   * Explicit All Day bucket.
   */
  if (selectedTime === 'all-day') {
    return task.length! > 240;
  }

  const timeBoundaries = [
    10,
    15,
    30,
    45,
    60,
    90,
    120,
    180,
    240
  ];

  const index =
    timeBoundaries.indexOf(
      selectedTime
    );

  if (index === -1) {
    return false;
  }

  const lowerBound =
    index === 0
      ? 0
      : timeBoundaries[index - 1];

  return (
    task.length! > lowerBound &&
    task.length! <= selectedTime
  );
}

function matchesTask(
  task: Task,
  filters: Filters,
  excludedIds: Set<number>
): boolean {
  /*
   * Tasks skipped or already handled in
   * the current Taskerize run are excluded.
   */
  if (
    excludedIds.has(task.id)
  ) {
    return false;
  }

  /*
   * The backend is already requesting
   * incomplete tasks, but keep this guard
   * in case completed data ever slips in.
   */
  if (task.completed) {
    return false;
  }

  if (
    !matchesIncludeExclude(
      task.folder ?? 0,
      filters.folderIds
    )
  ) {
    return false;
  }

  if (
    !matchesIncludeExclude(
      task.context ?? 0,
      filters.contextIds
    )
  ) {
    return false;
  }

  if (
    !matchesIncludeExclude(
      task.goal ?? 0,
      filters.goalIds
    )
  ) {
    return false;
  }

  if (
    !matchesIncludeExclude(
      task.location ?? 0,
      filters.locationIds
    )
  ) {
    return false;
  }

  if (
    !matchesTagFilter(
      task,
      filters.tags
    )
  ) {
    return false;
  }

  if (
    !matchesIncludeExclude(
      task.status ?? 0,
      filters.statuses
    )
  ) {
    return false;
  }

  if (
    !matchesIncludeExclude(
      task.priority ?? 0,
      filters.priorities
    )
  ) {
    return false;
  }

  if (
    filters.starredOnly &&
    !task.star
  ) {
    return false;
  }

  if (
    !matchesTimeFilter(
      task,
      filters
    )
  ) {
    return false;
  }

  return true;
}

export function buildPool(
  tasks: Task[],
  filters: Filters,
  excludedIds: Set<number>
): Task[] {
  return tasks.filter(task =>
    matchesTask(
      task,
      filters,
      excludedIds
    )
  );
}

export function randomTask(
  tasks: Task[]
): Task | null {
  if (tasks.length === 0) {
    return null;
  }

  const index =
    Math.floor(
      Math.random() *
        tasks.length
    );

  return tasks[index];
}
