import { useEffect, useMemo, useState } from 'react';
import './App.css';
import { buildPool, randomTask } from './taskPool';
import type { Bootstrap, Filters, NamedItem, Task } from './types';

const STATUSES = [
  [0, 'None'], [1, 'Next Action'], [2, 'Active'], [3, 'Planning'], [4, 'Delegated'],
  [5, 'Waiting'], [6, 'Hold'], [7, 'Postponed'], [8, 'Someday'], [9, 'Canceled'], [10, 'Reference']
] as const;
const PRIORITIES = [[-1, 'Negative'], [0, 'Low'], [1, 'Medium'], [2, 'High'], [3, 'Top']] as const;

const defaultFilters: Filters = {
  folderIds: [], contextIds: [], goalIds: [], locationIds: [], tags: [], statuses: [], priorities: [],
  starredOnly: false, availableMinutes: null, includeUnestimated: true
};

function loadFilters(): Filters {
  try { return { ...defaultFilters, ...JSON.parse(localStorage.getItem('taskerize-filters') || '{}') }; }
  catch { return defaultFilters; }
}

function App() {
  const [connected, setConnected] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [data, setData] = useState<Bootstrap | null>(null);
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set());
  const [chosen, setChosen] = useState<Task | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/status').then(r => r.json()).then(status => {
      setConnected(status.connected);
      setConfigured(status.configured);
      if (status.connected) return fetch('/api/bootstrap').then(r => r.json()).then(result => {
        if (result.error) throw new Error(result.error);
        setData(result);
      });
    }).catch(error => setMessage(error.message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => localStorage.setItem('taskerize-filters', JSON.stringify(filters)), [filters]);

  const pool = useMemo(() => data ? buildPool(data.tasks, filters, excludedIds) : [], [data, filters, excludedIds]);

  function taskerize() {
    const nextExcluded = new Set(excludedIds);
    if (chosen) nextExcluded.add(chosen.id);
    const nextPool = data ? buildPool(data.tasks, filters, nextExcluded) : [];
    const next = randomTask(nextPool);
    setExcludedIds(nextExcluded);
    setChosen(next);
    setMessage(next ? '' : 'No more eligible tasks in this pool.');
  }

  async function complete() {
    if (!chosen || !data) return;
    setMessage('Completing in Toodledo…');
    const response = await fetch(`/api/tasks/${chosen.id}/complete`, { method: 'POST' });
    const result = await response.json();
    if (!response.ok || result.error) {
      setMessage(result.error || 'Could not complete task.');
      return;
    }
    setData({ ...data, tasks: data.tasks.filter(task => task.id !== chosen.id) });
    setExcludedIds(prev => new Set(prev).add(chosen.id));
    setChosen(null);
    setMessage('Completed in Toodledo. Taskerize again when you’re ready.');
  }

  if (loading) return <main className="shell"><h1>Taskerize</h1><p>Loading…</p></main>;

  if (!connected) {
    return <main className="shell welcome">
      <div className="brand">TASKERIZE</div>
      <h1>Stop choosing. Start doing.</h1>
      <p>Build a pool from your Toodledo tasks, tell Taskerize how much time you have, and let it pick.</p>
      {!configured && <p className="warning">Add your Toodledo client ID and secret to <code>.env</code> first.</p>}
      <a className="primary button" href="/api/auth/login">Connect Toodledo</a>
    </main>;
  }

  if (!data) return <main className="shell"><h1>Taskerize</h1><p>{message || 'Could not load tasks.'}</p></main>;

  return <main className="shell">
    <header>
      <div><div className="brand">TASKERIZE</div><p className="subtitle">Random task selection, with rules.</p></div>
      <button className="linkButton" onClick={() => fetch('/api/auth/disconnect', { method: 'POST' }).then(() => location.reload())}>Disconnect</button>
    </header>

    <section className="layout">
      <aside className="panel filters">
        <h2>Build the pool</h2>
        <p className="hint">Within a section, selected values are OR. Across sections, they are AND. Leave a section empty to allow all.</p>
        <Facet title="Folders" items={data.folders.filter(i => !i.archived)} selected={filters.folderIds} onChange={v => setFilters({ ...filters, folderIds: v })} includeNone />
        <Facet title="Contexts" items={data.contexts} selected={filters.contextIds} onChange={v => setFilters({ ...filters, contextIds: v })} includeNone />
        <Facet title="Goals" items={data.goals.filter(i => !i.archived)} selected={filters.goalIds} onChange={v => setFilters({ ...filters, goalIds: v })} includeNone />
        <Facet title="Locations" items={data.locations} selected={filters.locationIds} onChange={v => setFilters({ ...filters, locationIds: v })} includeNone />
        <StringFacet title="Tags" items={data.tags} selected={filters.tags} onChange={v => setFilters({ ...filters, tags: v })} />
        <NumberFacet title="Status" items={STATUSES} selected={filters.statuses} onChange={v => setFilters({ ...filters, statuses: v })} />
        <NumberFacet title="Priority" items={PRIORITIES} selected={filters.priorities} onChange={v => setFilters({ ...filters, priorities: v })} />
        <label className="check"><input type="checkbox" checked={filters.starredOnly} onChange={e => setFilters({ ...filters, starredOnly: e.target.checked })} /> Starred only</label>
      </aside>

      <section className="mainColumn">
        <div className="panel timePanel">
          <h2>How much time do you have?</h2>
          <div className="timeChoices">
            {[10, 15, 30, 45, 60, 90].map(minutes => <button key={minutes} className={filters.availableMinutes === minutes ? 'chip active' : 'chip'} onClick={() => setFilters({ ...filters, availableMinutes: minutes })}>{minutes} min</button>)}
            <button className={filters.availableMinutes === null ? 'chip active' : 'chip'} onClick={() => setFilters({ ...filters, availableMinutes: null })}>Any</button>
          </div>
          <label className="check"><input type="checkbox" checked={filters.includeUnestimated} onChange={e => setFilters({ ...filters, includeUnestimated: e.target.checked })} /> Include tasks with no time estimate</label>
        </div>

        <div className="panel chooser">
          <div className="poolCount">{pool.length} eligible {pool.length === 1 ? 'task' : 'tasks'} remaining</div>
          {chosen ? <>
            <div className="pickedLabel">YOUR TASK</div>
            <h1 className="taskTitle">{chosen.title}</h1>
            <TaskMeta task={chosen} data={data} />
            <div className="actions">
              <button className="primary" onClick={complete}>✓ I did it</button>
              <button className="secondary" onClick={taskerize}>Taskerize again</button>
            </div>
          </> : <>
            <h1>Ready to stop deciding?</h1>
            <p>Taskerize will choose one eligible task at random.</p>
            <button className="primary giant" disabled={pool.length === 0} onClick={taskerize}>TASKERIZE</button>
          </>}
          {message && <p className="message">{message}</p>}
          {excludedIds.size > 0 && <button className="linkButton" onClick={() => { setExcludedIds(new Set()); setChosen(null); setMessage('Pool reset.'); }}>Reset skipped tasks</button>}
        </div>
      </section>
    </section>
  </main>;
}

function Facet({ title, items, selected, onChange, includeNone = false }: { title: string; items: NamedItem[]; selected: number[]; onChange: (v: number[]) => void; includeNone?: boolean }) {
  const all = includeNone ? [{ id: 0, name: `No ${title.slice(0, -1)}` }, ...items] : items;
  return <details className="facet" open={title === 'Folders'}><summary>{title}<span>{selected.length || 'all'}</span></summary><div className="facetBody">
    {all.map(item => <label className="check" key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={() => onChange(selected.includes(item.id) ? selected.filter(id => id !== item.id) : [...selected, item.id])} /> {item.name}</label>)}
  </div></details>;
}

function StringFacet({ title, items, selected, onChange }: { title: string; items: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  return <details className="facet"><summary>{title}<span>{selected.length || 'all'}</span></summary><div className="facetBody">
    {items.map(item => <label className="check" key={item}><input type="checkbox" checked={selected.includes(item)} onChange={() => onChange(selected.includes(item) ? selected.filter(v => v !== item) : [...selected, item])} /> {item}</label>)}
  </div></details>;
}

function NumberFacet({ title, items, selected, onChange }: { title: string; items: readonly (readonly [number, string])[]; selected: number[]; onChange: (v: number[]) => void }) {
  return <details className="facet"><summary>{title}<span>{selected.length || 'all'}</span></summary><div className="facetBody">
    {items.map(([value, label]) => <label className="check" key={value}><input type="checkbox" checked={selected.includes(value)} onChange={() => onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value])} /> {label}</label>)}
  </div></details>;
}

function TaskMeta({ task, data }: { task: Task; data: Bootstrap }) {
  const name = (items: NamedItem[], id = 0) => items.find(item => item.id === id)?.name;
  const bits = [
    task.length ? `${task.length} min` : 'No estimate',
    name(data.folders, task.folder),
    name(data.contexts, task.context),
    task.tag || undefined
  ].filter(Boolean);
  return <div className="meta">{bits.map(bit => <span key={bit}>{bit}</span>)}</div>;
}

export default App;
