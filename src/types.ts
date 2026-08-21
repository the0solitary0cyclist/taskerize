export type NamedItem = {
  id: number;
  name: string;
  archived?: number;
};

export type Task = {
  id: number;
  title: string;
  modified: number;
  completed: number;

  folder?: number;
  context?: number;
  goal?: number;
  location?: number;

  tag?: string;
  status?: number;
  priority?: number;
  length?: number;
  star?: number;

  duedate?: number;
  duetime?: number;
  startdate?: number;

  repeat?: string;
  duedatemod?: number;

  note?: string;
};

export type Bootstrap = {
  folders: NamedItem[];
  contexts: NamedItem[];
  goals: NamedItem[];
  locations: NamedItem[];
  tags: string[];
  tasks: Task[];
};

export type IncludeExclude<T> = {
  include: T[];
  exclude: T[];
};

export type Filters = {
  folderIds: IncludeExclude<number>;
  contextIds: IncludeExclude<number>;
  goalIds: IncludeExclude<number>;
  locationIds: IncludeExclude<number>;

  tags: IncludeExclude<string>;

  statuses: IncludeExclude<number>;
  priorities: IncludeExclude<number>;

  starredOnly: boolean;

  availableMinutes: number | null;

  includeUnestimated: boolean;
};
