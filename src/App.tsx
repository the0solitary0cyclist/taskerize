import { useEffect, useMemo, useState } from 'react';
import './App.css';
import { buildPool, randomTask } from './taskPool';
import type {
  Bootstrap,
  Filters,
  NamedItem,
  Task
} from './types';

const STATUSES = [
  [0, 'None'],
  [1, 'Next Action'],
  [2, 'Active'],
  [3, 'Planning'],
  [4, 'Delegated'],
  [5, 'Waiting'],
  [6, 'Hold'],
  [7, 'Postponed'],
  [8, 'Someday'],
  [9, 'Canceled'],
  [10, 'Reference']
] as const;

const PRIORITIES = [
  [-1, 'Negative'],
  [0, 'Low'],
  [1, 'Medium'],
  [2, 'High'],
  [3, 'Top']
] as const;

type DueDateFilter =
  | 'today'
  | 'last7'
  | 'overdue';

const defaultFilters: Filters = {
  folderIds: [],
  contextIds: [],
  goalIds: [],
  locationIds: [],
  tags: [],
  statuses: [],
  priorities: [],
  starredOnly: false,
  availableMinutes: null,
  includeUnestimated: true
};

function loadFilters(): Filters {
  try {
    return {
      ...defaultFilters,
      ...JSON.parse(
        localStorage.getItem('taskerize-filters') || '{}'
      )
    };
  } catch {
    return defaultFilters;
  }
}

function loadDueDateFilters(): DueDateFilter[] {
  try {
    const stored = localStorage.getItem(
      'taskerize-due-date-filters'
    );

    if (!stored) {
      return [];
    }

    return JSON.parse(stored) as DueDateFilter[];
  } catch {
    return [];
  }
}

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);

  return result;
}

function matchesDueDateFilters(
  task: Task,
  filters: DueDateFilter[]
): boolean {
  /*
   * No due-date filter selected means
   * "allow any due date", including no due date.
   */
  if (filters.length === 0) {
    return true;
  }

  if (!task.duedate) {
    return false;
  }

  const today = startOfDay(new Date());

  const dueDate = startOfDay(
    new Date(task.duedate * 1000)
  );

  const sevenDaysAgo = new Date(today);

  sevenDaysAgo.setDate(
    sevenDaysAgo.getDate() - 7
  );

  return filters.some(filter => {
    switch (filter) {
      case 'today':
        return (
          dueDate.getTime() ===
          today.getTime()
        );

      case 'last7':
        return (
          dueDate < today &&
          dueDate >= sevenDaysAgo
        );

      case 'overdue':
        return dueDate < today;

      default:
        return false;
    }
  });
}

function formatDueDate(task: Task): string | undefined {
  if (!task.duedate) {
    return undefined;
  }

  return new Date(
    task.duedate * 1000
  ).toLocaleDateString(
    undefined,
    {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }
  );
}

function App() {
  const [
    connected,
    setConnected
  ] = useState(false);

  const [
    configured,
    setConfigured
  ] = useState(true);

  const [
    data,
    setData
  ] = useState<Bootstrap | null>(null);

  const [
    filters,
    setFilters
  ] = useState<Filters>(loadFilters);

  const [
    dueDateFilters,
    setDueDateFilters
  ] = useState<DueDateFilter[]>(
    loadDueDateFilters
  );

  const [
    excludedIds,
    setExcludedIds
  ] = useState<Set<number>>(
    new Set()
  );

  const [
    chosen,
    setChosen
  ] = useState<Task | null>(null);

  const [
    message,
    setMessage
  ] = useState('');

  const [
    loading,
    setLoading
  ] = useState(true);

  async function loadBootstrap() {
    const response = await fetch(
      '/api/bootstrap'
    );

    const result = await response.json();

    if (
      !response.ok ||
      result.error
    ) {
      throw new Error(
        result.error ||
          'Could not load Toodledo tasks.'
      );
    }

    setData(result);

    return result as Bootstrap;
  }

  useEffect(() => {
    fetch('/api/auth/status')
      .then(response =>
        response.json()
      )
      .then(async status => {
        setConnected(
          status.connected
        );

        setConfigured(
          status.configured
        );

        if (status.connected) {
          await loadBootstrap();
        }
      })
      .catch(error => {
        setMessage(
          error instanceof Error
            ? error.message
            : 'Could not connect.'
        );
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    localStorage.setItem(
      'taskerize-filters',
      JSON.stringify(filters)
    );
  }, [filters]);

  useEffect(() => {
    localStorage.setItem(
      'taskerize-due-date-filters',
      JSON.stringify(
        dueDateFilters
      )
    );
  }, [dueDateFilters]);

  const pool = useMemo(() => {
    if (!data) {
      return [];
    }

    const basePool = buildPool(
      data.tasks,
      filters,
      excludedIds
    );

    return basePool.filter(task =>
      matchesDueDateFilters(
        task,
        dueDateFilters
      )
    );
  }, [
    data,
    filters,
    excludedIds,
    dueDateFilters
  ]);

  function buildCurrentPool(
    exclusions: Set<number>
  ) {
    if (!data) {
      return [];
    }

    return buildPool(
      data.tasks,
      filters,
      exclusions
    ).filter(task =>
      matchesDueDateFilters(
        task,
        dueDateFilters
      )
    );
  }

  function taskerize() {
    const nextExcluded =
      new Set(excludedIds);

    /*
     * Taskerize Again excludes the current
     * task for the rest of this session.
     */
    if (chosen) {
      nextExcluded.add(
        chosen.id
      );
    }

    const nextPool =
      buildCurrentPool(
        nextExcluded
      );

    const next =
      randomTask(nextPool);

    setExcludedIds(
      nextExcluded
    );

    setChosen(next);

    setMessage(
      next
        ? ''
        : 'No more eligible tasks in this pool.'
    );
  }

  async function complete() {
    if (!chosen) {
      return;
    }

    const completedTaskId = chosen.id;

    setMessage(
      'Completing in Toodledo…'
    );

    try {
      const response = await fetch(
        `/api/tasks/${completedTaskId}/complete`,
        {
          method: 'POST'
        }
      );

      const result =
        await response.json();

      if (
        !response.ok ||
        result.error
      ) {
        setMessage(
          result.error ||
            'Could not complete task.'
        );

        return;
      }

      /*
      * Redact the completed task from
      * this Taskerize session.
      */
      const nextExcluded =
        new Set(excludedIds);

      nextExcluded.add(
        completedTaskId
      );

      setExcludedIds(
        nextExcluded
      );

      /*
      * Reload directly from Toodledo.
      *
      * loadBootstrap() both updates `data`
      * and returns the fresh Bootstrap object.
      */
      const refreshed =
        await loadBootstrap();

      /*
      * Explicitly calculate the remaining
      * pool from the freshly loaded tasks.
      */
      const refreshedPool =
        buildPool(
          refreshed.tasks,
          filters,
          nextExcluded
        ).filter(task =>
          matchesDueDateFilters(
            task,
            dueDateFilters
          )
        );

      setChosen(null);

      setMessage(
        refreshedPool.length === 0
          ? 'No more eligible tasks in this pool.'
          : 'Completed in Toodledo. Taskerize again when you’re ready.'
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Could not complete task.'
      );
    }
  }

  function toggleDueDateFilter(
    filter: DueDateFilter
  ) {
    setDueDateFilters(current =>
      current.includes(filter)
        ? current.filter(
            value =>
              value !== filter
          )
        : [
            ...current,
            filter
          ]
    );
  }

  if (loading) {
    return (
      <main className="shell">
        <h1>Taskerize</h1>
        <p>Loading…</p>
      </main>
    );
  }

  if (!connected) {
    return (
      <main className="shell welcome">
        <div className="brand">
          TASKERIZE
        </div>

        <h1>
          Stop choosing.
          Start doing.
        </h1>

        <p>
          Build a pool from your Toodledo tasks,
          tell Taskerize how much time you have,
          and let it pick.
        </p>

        {!configured && (
          <p className="warning">
            Add your Toodledo client ID and secret
            to the server environment first.
          </p>
        )}

        <a
          className="primary button"
          href="/api/auth/login"
        >
          Connect Toodledo
        </a>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="shell">
        <h1>Taskerize</h1>

        <p>
          {message ||
            'Could not load tasks.'}
        </p>
      </main>
    );
  }

  return (
    <main className="shell">
      <header>
        <div>
          <div className="brand">
            TASKERIZE
          </div>

          <p className="subtitle">
            Random task selection,
            with rules.
          </p>
        </div>

        <button
          className="linkButton"
          onClick={() =>
            fetch(
              '/api/auth/disconnect',
              {
                method: 'POST'
              }
            ).then(() =>
              location.reload()
            )
          }
        >
          Disconnect
        </button>
      </header>

      <section className="layout">
        <aside className="panel filters">
          <h2>
            Build the pool
          </h2>

          <p className="hint">
            Within a section,
            selected values are OR.
            Across sections,
            they are AND.
            Leave a section empty
            to allow all.
          </p>

          <DueDateFacet
            selected={
              dueDateFilters
            }
            onToggle={
              toggleDueDateFilter
            }
          />

          <Facet
            title="Folders"
            items={
              data.folders.filter(
                item =>
                  !item.archived
              )
            }
            selected={
              filters.folderIds
            }
            onChange={value =>
              setFilters({
                ...filters,
                folderIds:
                  value
              })
            }
            includeNone
          />

          <Facet
            title="Contexts"
            items={
              data.contexts
            }
            selected={
              filters.contextIds
            }
            onChange={value =>
              setFilters({
                ...filters,
                contextIds:
                  value
              })
            }
            includeNone
          />

          <Facet
            title="Goals"
            items={
              data.goals.filter(
                item =>
                  !item.archived
              )
            }
            selected={
              filters.goalIds
            }
            onChange={value =>
              setFilters({
                ...filters,
                goalIds:
                  value
              })
            }
            includeNone
          />

          <Facet
            title="Locations"
            items={
              data.locations
            }
            selected={
              filters.locationIds
            }
            onChange={value =>
              setFilters({
                ...filters,
                locationIds:
                  value
              })
            }
            includeNone
          />

          <StringFacet
            title="Tags"
            items={
              data.tags
            }
            selected={
              filters.tags
            }
            onChange={value =>
              setFilters({
                ...filters,
                tags: value
              })
            }
          />

          <NumberFacet
            title="Status"
            items={
              STATUSES
            }
            selected={
              filters.statuses
            }
            onChange={value =>
              setFilters({
                ...filters,
                statuses:
                  value
              })
            }
          />

          <NumberFacet
            title="Priority"
            items={
              PRIORITIES
            }
            selected={
              filters.priorities
            }
            onChange={value =>
              setFilters({
                ...filters,
                priorities:
                  value
              })
            }
          />

          <label className="check">
            <input
              type="checkbox"
              checked={
                filters.starredOnly
              }
              onChange={event =>
                setFilters({
                  ...filters,
                  starredOnly:
                    event.target.checked
                })
              }
            />

            Starred only
          </label>
        </aside>

        <section className="mainColumn">
          <div className="panel timePanel">
            <h2>
              How much time
              do you have?
            </h2>

            <div className="timeChoices">
              {[
                10,
                15,
                30,
                45,
                60,
                90
              ].map(minutes => (
                <button
                  key={
                    minutes
                  }
                  className={
                    filters.availableMinutes ===
                    minutes
                      ? 'chip active'
                      : 'chip'
                  }
                  onClick={() =>
                    setFilters({
                      ...filters,
                      availableMinutes:
                        minutes
                    })
                  }
                >
                  {minutes} min
                </button>
              ))}

              <button
                className={
                  filters.availableMinutes ===
                  null
                    ? 'chip active'
                    : 'chip'
                }
                onClick={() =>
                  setFilters({
                    ...filters,
                    availableMinutes:
                      null
                  })
                }
              >
                Any
              </button>
            </div>

            <label className="check">
              <input
                type="checkbox"
                checked={
                  filters.includeUnestimated
                }
                onChange={event =>
                  setFilters({
                    ...filters,
                    includeUnestimated:
                      event.target.checked
                  })
                }
              />

              Include tasks with no time estimate
            </label>
          </div>

          <div className="panel chooser">
            <div className="poolCount">
              {pool.length}{' '}
              eligible{' '}
              {pool.length === 1
                ? 'task'
                : 'tasks'}{' '}
              remaining
            </div>

            {chosen ? (
              <>
                <div className="pickedLabel">
                  YOUR TASK
                </div>

                <h1 className="taskTitle">
                  {chosen.title}
                </h1>

                <TaskMeta
                  task={chosen}
                  data={data}
                />

                <div className="actions">
                  <button
                    className="primary"
                    onClick={
                      complete
                    }
                  >
                    ✓ I did it
                  </button>

                  <button
                    className="secondary"
                    onClick={
                      taskerize
                    }
                  >
                    Taskerize again
                  </button>
                </div>
              </>
            ) : (
              <>
                <h1>
                  Ready to stop
                  deciding?
                </h1>

                <p>
                  Taskerize will
                  choose one
                  eligible task
                  at random.
                </p>

                <button
                  className="primary giant"
                  disabled={
                    pool.length ===
                    0
                  }
                  onClick={
                    taskerize
                  }
                >
                  TASKERIZE
                </button>
              </>
            )}

            {message && (
              <p className="message">
                {message}
              </p>
            )}

            {excludedIds.size >
              0 && (
              <button
                className="linkButton"
                onClick={() => {
                  setExcludedIds(
                    new Set()
                  );

                  setChosen(
                    null
                  );

                  setMessage(
                    'Pool reset.'
                  );
                }}
              >
                Reset skipped
                tasks
              </button>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function DueDateFacet({
  selected,
  onToggle
}: {
  selected: DueDateFilter[];
  onToggle: (
    value: DueDateFilter
  ) => void;
}) {
  return (
    <details
      className="facet"
      open
    >
      <summary>
        Due Date

        <span>
          {selected.length ||
            'all'}
        </span>
      </summary>

      <div className="facetBody">
        <label className="check">
          <input
            type="checkbox"
            checked={
              selected.includes(
                'today'
              )
            }
            onChange={() =>
              onToggle('today')
            }
          />

          Today
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={
              selected.includes(
                'last7'
              )
            }
            onChange={() =>
              onToggle('last7')
            }
          />

          Last 7 Days
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={
              selected.includes(
                'overdue'
              )
            }
            onChange={() =>
              onToggle('overdue')
            }
          />

          All Overdue
        </label>
      </div>
    </details>
  );
}

function Facet({
  title,
  items,
  selected,
  onChange,
  includeNone = false
}: {
  title: string;
  items: NamedItem[];
  selected: number[];
  onChange: (
    value: number[]
  ) => void;
  includeNone?: boolean;
}) {
  const all =
    includeNone
      ? [
          {
            id: 0,
            name: `No ${title.slice(
              0,
              -1
            )}`
          },
          ...items
        ]
      : items;

  return (
    <details
      className="facet"
      open={
        title === 'Folders'
      }
    >
      <summary>
        {title}

        <span>
          {selected.length ||
            'all'}
        </span>
      </summary>

      <div className="facetBody">
        {all.map(item => (
          <label
            className="check"
            key={item.id}
          >
            <input
              type="checkbox"
              checked={
                selected.includes(
                  item.id
                )
              }
              onChange={() =>
                onChange(
                  selected.includes(
                    item.id
                  )
                    ? selected.filter(
                        id =>
                          id !== item.id
                      )
                    : [
                        ...selected,
                        item.id
                      ]
                )
              }
            />

            {item.name}
          </label>
        ))}
      </div>
    </details>
  );
}

function StringFacet({
  title,
  items,
  selected,
  onChange
}: {
  title: string;
  items: string[];
  selected: string[];
  onChange: (
    value: string[]
  ) => void;
}) {
  return (
    <details className="facet">
      <summary>
        {title}

        <span>
          {selected.length ||
            'all'}
        </span>
      </summary>

      <div className="facetBody">
        {items.map(item => (
          <label
            className="check"
            key={item}
          >
            <input
              type="checkbox"
              checked={
                selected.includes(
                  item
                )
              }
              onChange={() =>
                onChange(
                  selected.includes(
                    item
                  )
                    ? selected.filter(
                        value =>
                          value !== item
                      )
                    : [
                        ...selected,
                        item
                      ]
                )
              }
            />

            {item}
          </label>
        ))}
      </div>
    </details>
  );
}

function NumberFacet({
  title,
  items,
  selected,
  onChange
}: {
  title: string;
  items: readonly (
    readonly [
      number,
      string
    ]
  )[];
  selected: number[];
  onChange: (
    value: number[]
  ) => void;
}) {
  return (
    <details className="facet">
      <summary>
        {title}

        <span>
          {selected.length ||
            'all'}
        </span>
      </summary>

      <div className="facetBody">
        {items.map(
          ([
            value,
            label
          ]) => (
            <label
              className="check"
              key={value}
            >
              <input
                type="checkbox"
                checked={
                  selected.includes(
                    value
                  )
                }
                onChange={() =>
                  onChange(
                    selected.includes(
                      value
                    )
                      ? selected.filter(
                          item =>
                            item !== value
                        )
                      : [
                          ...selected,
                          value
                        ]
                  )
                }
              />

              {label}
            </label>
          )
        )}
      </div>
    </details>
  );
}

function TaskMeta({
  task,
  data
}: {
  task: Task;
  data: Bootstrap;
}) {
  const name = (
    items: NamedItem[],
    id = 0
  ) =>
    items.find(
      item =>
        item.id === id
    )?.name;

  const dueDate =
    formatDueDate(task);

  const bits = [
    task.length
      ? `${task.length} min`
      : 'No estimate',

    dueDate
      ? `Due: ${dueDate}`
      : undefined,

    task.repeat
      ? `Repeats: ${task.repeat}`
      : undefined,

    name(
      data.folders,
      task.folder
    ),

    name(
      data.contexts,
      task.context
    ),

    task.tag ||
      undefined
  ].filter(Boolean) as string[];

  return (
    <div className="meta">
      {bits.map(bit => (
        <span key={bit}>
          {bit}
        </span>
      ))}
    </div>
  );
}

export default App;