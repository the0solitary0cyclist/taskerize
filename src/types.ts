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
  startdate?: number;

  repeat?: string;
  duedatemod?: number;
};

export type Bootstrap = {
  folders: NamedItem[];
  contexts: NamedItem[];
  goals: NamedItem[];
  locations: NamedItem[];
  tags: string[];
  tasks: Task[];
};

export type Filters = {
  folderIds: number[];
  contextIds: number[];
  goalIds: number[];
  locationIds: number[];
  tags: string[];
  statuses: number[];
  priorities: number[];
  starredOnly: boolean;
  availableMinutes: number | null;
  includeUnestimated: boolean;
};