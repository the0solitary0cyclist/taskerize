# Taskerize

Taskerize connects to Toodledo, builds a user-defined pool of incomplete tasks, and randomly chooses what to do next.

## What it does

- Connects to Toodledo using OAuth 2.
- Loads incomplete tasks plus folders, contexts, goals, locations, and tags.
- Filters the pool by any combination of those dimensions, plus status, priority, and star.
- Lets you specify available time. A task with a Toodledo `length` greater than that number of minutes is excluded.
- Lets you decide whether tasks with no time estimate remain eligible.
- **Taskerize** chooses an eligible task at random.
- **Taskerize again** removes the current task from the current run and chooses another, so repeated clicks do not immediately recycle skipped tasks.
- **I did it** completes the task in Toodledo. The completion request asks Toodledo to reschedule repeating tasks.
- **Reset skipped tasks** restores skipped tasks to the pool.
- Filter preferences persist in browser local storage.

## Run locally

1. Register Taskerize as a Toodledo API v3 application and use this redirect URI:

   `http://localhost:3001/api/auth/callback`

2. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

3. Fill in your Toodledo client ID and client secret in `.env`.

4. Install dependencies:

   ```bash
   npm install
   ```

5. Load the environment and start both frontend and backend:

   ```bash
   set -a; source .env; set +a
   npm run dev
   ```

6. Open `http://localhost:5173` and click **Connect Toodledo**.

## Pool semantics

Taskerize treats filters this way:

- No selection in a section means “allow every value in this section.”
- Multiple checked values in one section are ORed together. For example, Folder = Home OR Errands.
- Different sections are ANDed together. For example, (Home OR Errands) AND Context = Phone.
- If a time limit is selected, estimated task length must be less than or equal to the available minutes.

## Security notes

The Toodledo client secret never goes to the browser. OAuth tokens are stored locally in `.taskerize-tokens.json`, which is gitignored and written with owner-only file permissions. This is deliberately a simple single-user/local-first MVP. For a hosted multi-user version, use encrypted server-side per-user token storage and normal application sessions.

## Possible next features

- Saved Taskerize presets (for example “At home”, “Low energy”, “15-minute cleanup”).
- Weight random selection by priority, due date, age, or star rather than making every task equally likely.
- “Snooze this task for today” rather than merely skipping it for the current run.
- Due-date constraints such as overdue / due today / due this week.
- A task-detail drawer with notes and Toodledo metadata.
- A history showing skipped, selected, and completed tasks.
