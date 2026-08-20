import { useEffect, useMemo, useState } from 'react';
import './App.css';
import { buildPool, randomTask } from './taskPool';
import type {
  Bootstrap,
  Filters,
  IncludeExclude,
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

const TIME_OPTIONS: Array<
  [number, string]
> = [
  [10, '10 min'],
  [15, '15 min'],
  [30, '30 min'],
  [45, '45 min'],
  [60, '1h'],
  [90, '1.5h'],
  [120, '2h'],
  [180, '3h'],
  [240, '4h']
];

type DueDateFilter =
  | 'today'
  | 'last7'
  | 'overdue';

type ChoiceState =
  | 'neutral'
  | 'include'
  | 'exclude';

type PushDestination =
  | 'tomorrow'
  | 'week'
  | 'month'
  | 'clear';

const emptyRule = <T,>():
  IncludeExclude<T> => ({
  include: [],
  exclude: []
});

const defaultFilters: Filters = {
  folderIds: emptyRule<number>(),
  contextIds: emptyRule<number>(),
  goalIds: emptyRule<number>(),
  locationIds: emptyRule<number>(),
  tags: emptyRule<string>(),
  statuses: emptyRule<number>(),
  priorities: emptyRule<number>(),
  starredOnly: false,
  availableMinutes: null,
  includeUnestimated: true
};

/*
 * This lets an existing browser migrate from
 * our original:
 *
 *   folderIds: [1, 2]
 *
 * format to:
 *
 *   folderIds: {
 *     include: [1, 2],
 *     exclude: []
 *   }
 */
function normalizeRule<T>(
  value:
    | T[]
    | IncludeExclude<T>
    | undefined
): IncludeExclude<T> {
  if (Array.isArray(value)) {
    return {
      include: value,
      exclude: []
    };
  }

  if (
    value &&
    Array.isArray(value.include) &&
    Array.isArray(value.exclude)
  ) {
    return value;
  }

  return {
    include: [],
    exclude: []
  };
}

function loadFilters(): Filters {
  try {
    const stored = JSON.parse(
      localStorage.getItem(
        'taskerize-filters'
      ) || '{}'
    );

    return {
      ...defaultFilters,

      folderIds:
        normalizeRule<number>(
          stored.folderIds
        ),

      contextIds:
        normalizeRule<number>(
          stored.contextIds
        ),

      goalIds:
        normalizeRule<number>(
          stored.goalIds
        ),

      locationIds:
        normalizeRule<number>(
          stored.locationIds
        ),

      tags:
        normalizeRule<string>(
          stored.tags
        ),

      statuses:
        normalizeRule<number>(
          stored.statuses
        ),

      priorities:
        normalizeRule<number>(
          stored.priorities
        ),

      starredOnly:
        Boolean(
          stored.starredOnly
        ),

      availableMinutes:
        typeof stored.availableMinutes ===
          'number'
          ? stored.availableMinutes
          : null,

      includeUnestimated:
        stored.includeUnestimated ===
        false
          ? false
          : true
    };
  } catch {
    return defaultFilters;
  }
}

function loadDueDateFilters():
  DueDateFilter[] {
  try {
    const stored =
      localStorage.getItem(
        'taskerize-due-date-filters'
      );

    if (!stored) {
      return [];
    }

    return JSON.parse(
      stored
    ) as DueDateFilter[];
  } catch {
    return [];
  }
}

function startOfDay(
  date: Date
): Date {
  const result =
    new Date(date);

  result.setHours(
    0,
    0,
    0,
    0
  );

  return result;
}

function matchesDueDateFilters(
  task: Task,
  filters: DueDateFilter[]
): boolean {
  /*
   * Nothing selected means:
   * don't filter by due date.
   *
   * Undated tasks are therefore allowed.
   */
  if (filters.length === 0) {
    return true;
  }

  /*
   * If a due-date category is selected,
   * undated tasks do not match it.
   */
  if (!task.duedate) {
    return false;
  }

  const today =
    startOfDay(
      new Date()
    );

  const dueDate =
    startOfDay(
      new Date(
        task.duedate * 1000
      )
    );

  const sevenDaysAgo =
    new Date(today);

  sevenDaysAgo.setDate(
    sevenDaysAgo.getDate() - 7
  );

  return filters.some(
    filter => {
      switch (filter) {
        case 'today':
          return (
            dueDate.getTime() ===
            today.getTime()
          );

        case 'last7':
          return (
            dueDate < today &&
            dueDate >=
              sevenDaysAgo
          );

        case 'overdue':
          return dueDate < today;

        default:
          return false;
      }
    }
  );
}

function formatDueDate(
  task: Task
): string | undefined {
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

function getChoiceState<T>(
  value: T,
  filter: IncludeExclude<T>
): ChoiceState {
  if (
    filter.include.includes(
      value
    )
  ) {
    return 'include';
  }

  if (
    filter.exclude.includes(
      value
    )
  ) {
    return 'exclude';
  }

  return 'neutral';
}

function setChoiceState<T>(
  value: T,
  state: ChoiceState,
  filter: IncludeExclude<T>
): IncludeExclude<T> {
  /*
   * Remove the value from either list
   * before assigning its new state.
   */
  const withoutValue = {
    include:
      filter.include.filter(
        item =>
          item !== value
      ),

    exclude:
      filter.exclude.filter(
        item =>
          item !== value
      )
  };

  if (
    state === 'include'
  ) {
    return {
      ...withoutValue,

      include: [
        ...withoutValue.include,
        value
      ]
    };
  }

  if (
    state === 'exclude'
  ) {
    return {
      ...withoutValue,

      exclude: [
        ...withoutValue.exclude,
        value
      ]
    };
  }

  return withoutValue;
}

function filterCount<T>(
  filter: IncludeExclude<T>
): number {
  return (
    filter.include.length +
    filter.exclude.length
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
  ] =
    useState<Bootstrap | null>(
      null
    );

  const [
    filters,
    setFilters
  ] =
    useState<Filters>(
      loadFilters
    );

  const [
    dueDateFilters,
    setDueDateFilters
  ] =
    useState<DueDateFilter[]>(
      loadDueDateFilters
    );

  const [
    excludedIds,
    setExcludedIds
  ] =
    useState<Set<number>>(
      new Set()
    );

  const [
    chosen,
    setChosen
  ] =
    useState<Task | null>(
      null
    );

  const [
    message,
    setMessage
  ] =
    useState('');

  const [
    loading,
    setLoading
  ] =
    useState(true);

  const [
    pushing,
    setPushing
  ] =
    useState(false);

  async function loadBootstrap() {
    const response =
      await fetch(
        '/api/bootstrap'
      );

    const result =
      await response.json();

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
    fetch(
      '/api/auth/status'
    )
      .then(response =>
        response.json()
      )
      .then(
        async status => {
          setConnected(
            status.connected
          );

          setConfigured(
            status.configured
          );

          if (
            status.connected
          ) {
            await loadBootstrap();
          }
        }
      )
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
      JSON.stringify(
        filters
      )
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

  const pool =
    useMemo(() => {
      if (!data) {
        return [];
      }

      return buildPool(
        data.tasks,
        filters,
        excludedIds
      ).filter(
        task =>
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
    ).filter(
      task =>
        matchesDueDateFilters(
          task,
          dueDateFilters
        )
    );
  }

  function taskerize() {
    const nextExcluded =
      new Set(
        excludedIds
      );

    /*
     * Taskerize Again means:
     * don't offer this task again
     * during the current run.
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
      randomTask(
        nextPool
      );

    setExcludedIds(
      nextExcluded
    );

    setChosen(
      next
    );

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

    const completedTaskId =
      chosen.id;

    setMessage(
      'Completing in Toodledo…'
    );

    try {
      const response =
        await fetch(
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
       * Redact this occurrence from
       * the current Taskerize session.
       */
      const nextExcluded =
        new Set(
          excludedIds
        );

      nextExcluded.add(
        completedTaskId
      );

      setExcludedIds(
        nextExcluded
      );

      /*
       * Re-fetch active tasks from
       * Toodledo.
       *
       * This is necessary for
       * repeating tasks, which may
       * now have a new due date.
       */
      const refreshed =
        await loadBootstrap();

      const refreshedPool =
        buildPool(
          refreshed.tasks,
          filters,
          nextExcluded
        ).filter(
          task =>
            matchesDueDateFilters(
              task,
              dueDateFilters
            )
        );

      setChosen(null);

      setMessage(
        refreshedPool.length ===
          0
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

  async function pushTask(
    destination:
      PushDestination
  ) {
    if (!chosen) {
      return;
    }

    const pushedTaskId =
      chosen.id;

    setPushing(true);

    setMessage(
      'Updating due date in Toodledo…'
    );

    try {
      const response =
        await fetch(
          `/api/tasks/${pushedTaskId}/push`,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json'
            },

            body:
              JSON.stringify({
                destination
              })
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
            'Could not push task.'
        );

        return;
      }

      const nextExcluded =
        new Set(
          excludedIds
        );

      nextExcluded.add(
        pushedTaskId
      );

      setExcludedIds(
        nextExcluded
      );

      setChosen(null);

      await loadBootstrap();

      setMessage(
        'Task pushed in Toodledo. Taskerize again when you’re ready.'
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Could not push task.'
      );
    } finally {
      setPushing(false);
    }
  }

  function toggleDueDateFilter(
    filter: DueDateFilter
  ) {
    setDueDateFilters(
      current =>
        current.includes(
          filter
        )
          ? current.filter(
              value =>
                value !==
                filter
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
        <h1>
          Taskerize
        </h1>

        <p>
          Loading…
        </p>
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
          Build a pool from
          your Toodledo tasks,
          tell Taskerize how
          much time you have,
          and let it pick.
        </p>

        {!configured && (
          <p className="warning">
            Add your Toodledo
            client ID and secret
            to the server
            environment first.
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
        <h1>
          Taskerize
        </h1>

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
            Include means the
            task must match one
            of the included values
            in that section.
            Exclude always removes
            matching tasks.
            Any leaves that value
            unrestricted.
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
            filter={
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
            filter={
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
            filter={
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
            filter={
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
            filter={
              filters.tags
            }
            onChange={value =>
              setFilters({
                ...filters,
                tags:
                  value
              })
            }
          />

          <NumberFacet
            title="Status"
            items={
              STATUSES
            }
            filter={
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
            filter={
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
                    event.target
                      .checked
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
              {TIME_OPTIONS.map(
                ([
                  minutes,
                  label
                ]) => (
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
                    {label}
                  </button>
                )
              )}

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
                All Day
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
                      event.target
                        .checked
                  })
                }
              />

              Include tasks with
              no time estimate
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

                  <select
                    className="pushSelect"
                    aria-label="Push task"
                    disabled={
                      pushing
                    }
                    defaultValue=""
                    onChange={event => {
                      const value =
                        event.target
                          .value as
                          | PushDestination
                          | '';

                      if (value) {
                        void pushTask(
                          value
                        );

                        event.target.value =
                          '';
                      }
                    }}
                  >
                    <option
                      value=""
                      disabled
                    >
                      Push task…
                    </option>

                    <option value="tomorrow">
                      Tomorrow
                    </option>

                    <option value="week">
                      +1 week
                    </option>

                    <option value="month">
                      +1 month
                    </option>

                    <option value="clear">
                      Clear due date
                    </option>
                  </select>
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
              onToggle(
                'today'
              )
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
              onToggle(
                'last7'
              )
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
              onToggle(
                'overdue'
              )
            }
          />

          All Overdue
        </label>
      </div>
    </details>
  );
}

function FilterChoice({
  label,
  state,
  onChange
}: {
  label: string;
  state: ChoiceState;
  onChange: (state: ChoiceState) => void;
}) {
  return (
    <div className="filterChoice">
      <span className="filterChoiceLabel">
        {label}
      </span>

      <div className="filterChoiceIcons">
        <button
          type="button"
          className={
            state === 'include'
              ? 'filterIcon active'
              : 'filterIcon'
          }
          aria-label={`Include ${label}`}
          title={`Include ${label}`}
          onClick={() =>
            onChange(
              state === 'include'
                ? 'neutral'
                : 'include'
            )
          }
        >
          +
        </button>

        <button
          type="button"
          className={
            state === 'exclude'
              ? 'filterIcon active exclude'
              : 'filterIcon'
          }
          aria-label={`Exclude ${label}`}
          title={`Exclude ${label}`}
          onClick={() =>
            onChange(
              state === 'exclude'
                ? 'neutral'
                : 'exclude'
            )
          }
        >
          −
        </button>
      </div>
    </div>
  );
}

function Facet({
  title,
  items,
  filter,
  onChange,
  includeNone = false
}: {
  title: string;
  items: NamedItem[];

  filter:
    IncludeExclude<number>;

  onChange: (
    value:
      IncludeExclude<number>
  ) => void;

  includeNone?: boolean;
}) {
  const all =
    includeNone
      ? [
          {
            id: 0,

            name:
              `No ${title.slice(
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
        title ===
        'Folders'
      }
    >
      <summary>
        {title}

        <span>
          {filterCount(
            filter
          ) || 'all'}
        </span>
      </summary>

      <div className="facetBody">
        {all.map(
          item => (
            <FilterChoice
              key={
                item.id
              }
              label={
                item.name
              }
              state={
                getChoiceState(
                  item.id,
                  filter
                )
              }
              onChange={state =>
                onChange(
                  setChoiceState(
                    item.id,
                    state,
                    filter
                  )
                )
              }
            />
          )
        )}
      </div>
    </details>
  );
}

function StringFacet({
  title,
  items,
  filter,
  onChange
}: {
  title: string;
  items: string[];

  filter:
    IncludeExclude<string>;

  onChange: (
    value:
      IncludeExclude<string>
  ) => void;
}) {
  return (
    <details className="facet">
      <summary>
        {title}

        <span>
          {filterCount(
            filter
          ) || 'all'}
        </span>
      </summary>

      <div className="facetBody">
        {items.map(
          item => (
            <FilterChoice
              key={
                item
              }
              label={
                item
              }
              state={
                getChoiceState(
                  item,
                  filter
                )
              }
              onChange={state =>
                onChange(
                  setChoiceState(
                    item,
                    state,
                    filter
                  )
                )
              }
            />
          )
        )}
      </div>
    </details>
  );
}

function NumberFacet({
  title,
  items,
  filter,
  onChange
}: {
  title: string;

  items: readonly (
    readonly [
      number,
      string
    ]
  )[];

  filter:
    IncludeExclude<number>;

  onChange: (
    value:
      IncludeExclude<number>
  ) => void;
}) {
  return (
    <details className="facet">
      <summary>
        {title}

        <span>
          {filterCount(
            filter
          ) || 'all'}
        </span>
      </summary>

      <div className="facetBody">
        {items.map(
          ([
            value,
            label
          ]) => (
            <FilterChoice
              key={
                value
              }
              label={
                label
              }
              state={
                getChoiceState(
                  value,
                  filter
                )
              }
              onChange={state =>
                onChange(
                  setChoiceState(
                    value,
                    state,
                    filter
                  )
                )
              }
            />
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
    formatDueDate(
      task
    );

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
  ].filter(
    Boolean
  ) as string[];

  return (
    <div className="meta">
      {bits.map(
        bit => (
          <span key={bit}>
            {bit}
          </span>
        )
      )}
    </div>
  );
}

export default App;
