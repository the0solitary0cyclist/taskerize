import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);

const appRoot =
  path.resolve(
    __dirname,
    '../..'
  );

const app =
  express();

app.use(
  cookieParser()
);

app.use(
  express.json()
);

app.use(
  express.urlencoded({
    extended: true
  })
);

const PORT =
  Number(
    process.env.PORT ||
      3001
  );

const CLIENT_ID =
  process.env
    .TOODLEDO_CLIENT_ID ||
  '';

const CLIENT_SECRET =
  process.env
    .TOODLEDO_CLIENT_SECRET ||
  '';

const REDIRECT_URI =
  process.env
    .TOODLEDO_REDIRECT_URI ||
  `http://localhost:${PORT}/api/auth/callback`;

const TOKEN_FILE =
  path.join(
    appRoot,
    '.taskerize-tokens.json'
  );

const TASK_FIELDS =
  'folder,context,goal,location,tag,status,priority,length,star,duedate,duetime,startdate,repeat,duedatemod';

type Tokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  obtained_at: number;
};

type ToodledoTask = {
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
};

function readTokens():
  Tokens | null {
  try {
    return JSON.parse(
      fs.readFileSync(
        TOKEN_FILE,
        'utf8'
      )
    ) as Tokens;
  } catch {
    return null;
  }
}

function writeTokens(
  tokens:
    | Omit<
        Tokens,
        'obtained_at'
      >
    | Tokens
): Tokens {
  const withTimestamp = {
    ...tokens,
    obtained_at:
      Date.now()
  } as Tokens;

  fs.writeFileSync(
    TOKEN_FILE,
    JSON.stringify(
      withTimestamp,
      null,
      2
    ),
    {
      mode: 0o600
    }
  );

  return withTimestamp;
}

async function exchangeToken(
  params: URLSearchParams
): Promise<Tokens> {
  if (
    !CLIENT_ID ||
    !CLIENT_SECRET
  ) {
    throw new Error(
      'Missing Toodledo client credentials.'
    );
  }

  const auth =
    Buffer.from(
      `${CLIENT_ID}:${CLIENT_SECRET}`
    ).toString(
      'base64'
    );

  const response =
    await fetch(
      'https://api.toodledo.com/3/account/token.php',
      {
        method:
          'POST',

        headers: {
          Authorization:
            `Basic ${auth}`,

          'Content-Type':
            'application/x-www-form-urlencoded'
        },

        body:
          params
      }
    );

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `Token exchange failed (${response.status}): ${text}`
    );
  }

  const data =
    (await response.json()) as
      Omit<
        Tokens,
        'obtained_at'
      > & {
        error?: string;
        error_description?: string;
      };

  if (data.error) {
    throw new Error(
      data.error_description ||
        data.error
    );
  }

  return writeTokens(
    data
  );
}

async function getAccessToken():
  Promise<string> {
  const tokens =
    readTokens();

  if (!tokens) {
    throw new Error(
      'Not connected to Toodledo.'
    );
  }

  const expiresAt =
    tokens.obtained_at +
    (
      tokens.expires_in -
      60
    ) *
      1000;

  if (
    Date.now() <
    expiresAt
  ) {
    return tokens.access_token;
  }

  const refreshed =
    await exchangeToken(
      new URLSearchParams({
        grant_type:
          'refresh_token',

        refresh_token:
          tokens.refresh_token
      })
    );

  return refreshed.access_token;
}

async function toodledoGet(
  endpoint: string,
  params:
    Record<
      string,
      string
    > = {}
) {
  const accessToken =
    await getAccessToken();

  const url =
    new URL(
      `https://api.toodledo.com/3/${endpoint}`
    );

  url.searchParams.set(
    'access_token',
    accessToken
  );

  Object.entries(
    params
  ).forEach(
    ([
      key,
      value
    ]) => {
      url.searchParams.set(
        key,
        value
      );
    }
  );

  const response =
    await fetch(url);

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `Toodledo request failed (${response.status}): ${text}`
    );
  }

  const data =
    await response.json();

  if (
    data?.errorCode
  ) {
    throw new Error(
      data.errorDesc ||
        'Toodledo API error'
    );
  }

  return data;
}

async function toodledoPost(
  endpoint: string,
  params: Record<
    string,
    string
  >
) {
  const accessToken =
    await getAccessToken();

  const body =
    new URLSearchParams({
      access_token:
        accessToken,

      ...params
    });

  const response =
    await fetch(
      `https://api.toodledo.com/3/${endpoint}`,
      {
        method:
          'POST',

        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded'
        },

        body
      }
    );

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `Toodledo request failed (${response.status}): ${text}`
    );
  }

  const data =
    await response.json();

  if (
    data?.errorCode
  ) {
    throw new Error(
      data.errorDesc ||
        'Toodledo API error'
    );
  }

  return data;
}

/*
 * Convert a Toodledo due-date timestamp
 * into a local calendar day.
 *
 * We compare calendar dates rather than
 * exact timestamps because Taskerize's
 * due-date filters are date based.
 */
function calendarDay(
  timestamp: number
): Date {
  const date =
    new Date(
      timestamp * 1000
    );

  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
}

function todayDay():
  Date {
  const today =
    new Date();

  return new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
}

/*
 * Taskerize currently downloads only:
 *
 * - tasks with no due date
 * - overdue tasks
 * - tasks due today
 *
 * Future-dated tasks are excluded.
 *
 * duedatemod is preserved and sent to
 * the frontend so the UI can distinguish:
 *
 * 0 = Due By
 * 1 = Due On
 * 2 = Due After
 * 3 = Optionally On
 *
 * Note that a past "Due After" date is
 * still eligible: the date marks when
 * the task becomes available.
 */
function isNotFutureTask(
  task: ToodledoTask
): boolean {
  if (
    !task.duedate
  ) {
    return true;
  }

  const dueDay =
    calendarDay(
      task.duedate
    );

  const today =
    todayDay();

  return (
    dueDay.getTime() <=
    today.getTime()
  );
}

/*
 * Toodledo returns at most 1000 tasks
 * from a tasks/get.php request.
 *
 * We page through every incomplete task
 * so relevant tasks cannot disappear just
 * because they occur after the first
 * 1000 API results.
 */
async function getAllCurrentTasks():
  Promise<
    ToodledoTask[]
  > {
  const relevantTasks:
    ToodledoTask[] = [];

  const pageSize =
    1000;

  let start = 0;

  let total:
    number | null =
    null;

  while (
    total === null ||
    start < total
  ) {
    const rawTasks =
      await toodledoGet(
        'tasks/get.php',
        {
          comp:
            '0',

          start:
            String(
              start
            ),

          num:
            String(
              pageSize
            ),

          fields:
            TASK_FIELDS
        }
      );

    if (
      !Array.isArray(
        rawTasks
      )
    ) {
      throw new Error(
        'Unexpected response from Toodledo task API.'
      );
    }

    const metadata =
      rawTasks[0] as {
        num?: number;
        total?: number;
      };

    if (
      typeof metadata
        ?.total ===
      'number'
    ) {
      total =
        metadata.total;
    }

    const pageTasks =
      (
        rawTasks as
          unknown[]
      ).filter(
        (
          item: any
        ) =>
          item &&
          typeof item.id ===
            'number'
      ) as ToodledoTask[];

    const relevantPageTasks =
      pageTasks.filter(
        isNotFutureTask
      );

    relevantTasks.push(
      ...relevantPageTasks
    );

    console.log(
      'Toodledo task page',
      {
        start,

        returned:
          pageTasks.length,

        relevant:
          relevantPageTasks.length,

        total,

        relevantSoFar:
          relevantTasks.length
      }
    );

    if (
      pageTasks.length ===
      0
    ) {
      break;
    }

    start +=
      pageSize;

    if (
      total === null &&
      pageTasks.length <
        pageSize
    ) {
      break;
    }
  }

  console.log(
    'Taskerize task load complete',
    {
      totalIncomplete:
        total,

      currentTasks:
        relevantTasks.length
    }
  );

  return relevantTasks;
}

/*
 * Convert a local calendar date into
 * the date timestamp used when sending
 * a due date back to Toodledo.
 *
 * Using noon UTC keeps us well away
 * from midnight/time-zone boundaries.
 */
function toToodledoDate(
  date: Date
): number {
  return Math.floor(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      12,
      0,
      0
    ) / 1000
  );
}

/*
 * Authentication
 */

app.get(
  '/api/auth/status',
  (_req, res) => {
    res.json({
      connected:
        Boolean(
          readTokens()
        ),

      configured:
        Boolean(
          CLIENT_ID &&
            CLIENT_SECRET
        )
    });
  }
);

app.get(
  '/api/auth/login',
  (_req, res) => {
    if (
      !CLIENT_ID
    ) {
      return res
        .status(500)
        .send(
          'TOODLEDO_CLIENT_ID is not configured.'
        );
    }

    const state =
      crypto
        .randomBytes(
          24
        )
        .toString(
          'hex'
        );

    res.cookie(
      'toodledo_oauth_state',
      state,
      {
        httpOnly:
          true,

        secure:
          process.env
            .NODE_ENV ===
          'production',

        sameSite:
          'lax',

        maxAge:
          10 *
          60 *
          1000
      }
    );

    const url =
      new URL(
        'https://api.toodledo.com/3/account/authorize.php'
      );

    url.searchParams.set(
      'response_type',
      'code'
    );

    url.searchParams.set(
      'client_id',
      CLIENT_ID
    );

    url.searchParams.set(
      'state',
      state
    );

    url.searchParams.set(
      'scope',
      'basic tasks write'
    );

    res.redirect(
      url.toString()
    );
  }
);

app.get(
  '/api/auth/callback',
  async (
    req,
    res
  ) => {
    try {
      const code =
        String(
          req.query.code ||
            ''
        );

      const returnedState =
        String(
          req.query.state ||
            ''
        );

      const savedState =
        req.cookies
          .toodledo_oauth_state;

      if (
        !code ||
        !returnedState ||
        !savedState ||
        returnedState !==
          savedState
      ) {
        console.error(
          'OAuth state mismatch',
          {
            hasCode:
              Boolean(
                code
              ),

            hasReturnedState:
              Boolean(
                returnedState
              ),

            hasSavedState:
              Boolean(
                savedState
              )
          }
        );

        return res
          .status(400)
          .send(
            'Invalid OAuth state or missing code.'
          );
      }

      res.clearCookie(
        'toodledo_oauth_state'
      );

      await exchangeToken(
        new URLSearchParams({
          grant_type:
            'authorization_code',

          code,

          redirect_uri:
            REDIRECT_URI
        })
      );

      res.redirect(
        '/'
      );
    } catch (
      error
    ) {
      console.error(
        error
      );

      res
        .status(500)
        .send(
          error instanceof
            Error
            ? error.message
            : 'Authentication failed'
        );
    }
  }
);

app.post(
  '/api/auth/disconnect',
  (_req, res) => {
    try {
      fs.unlinkSync(
        TOKEN_FILE
      );
    } catch {
      /*
       * Nothing to remove.
       */
    }

    res.json({
      connected:
        false
    });
  }
);

/*
 * Bootstrap
 */

app.get(
  '/api/bootstrap',
  async (
    _req,
    res
  ) => {
    try {
      const [
        folders,
        contexts,
        goals,
        locations,
        tasks
      ] =
        await Promise.all([
          toodledoGet(
            'folders/get.php'
          ),

          toodledoGet(
            'contexts/get.php'
          ),

          toodledoGet(
            'goals/get.php'
          ),

          toodledoGet(
            'locations/get.php'
          ),

          getAllCurrentTasks()
        ]);

      const tags =
        [
          ...new Set(
            tasks.flatMap(
              task =>
                (
                  task.tag ||
                  ''
                )
                  .split(
                    ','
                  )
                  .map(
                    tag =>
                      tag.trim()
                  )
                  .filter(
                    Boolean
                  )
            )
          )
        ].sort(
          (
            a,
            b
          ) =>
            a.localeCompare(
              b
            )
        );

      res.json({
        folders,
        contexts,
        goals,
        locations,
        tags,
        tasks
      });
    } catch (
      error
    ) {
      console.error(
        error
      );

      res
        .status(500)
        .json({
          error:
            error instanceof
              Error
              ? error.message
              : 'Could not load Toodledo data.'
        });
    }
  }
);

/*
 * Complete a task.
 *
 * reschedule belongs on the individual
 * edited task. This is important for
 * repeating Toodledo tasks.
 */
app.post(
  '/api/tasks/:id/complete',
  async (
    req,
    res
  ) => {
    try {
      const id =
        Number(
          req.params.id
        );

      if (
        !Number.isFinite(
          id
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              'Invalid task id.'
          });
      }

      const rawTasks =
        await toodledoGet(
          'tasks/get.php',
          {
            id:
              String(
                id
              ),

            fields:
              TASK_FIELDS
          }
        );

      if (
        !Array.isArray(
          rawTasks
        )
      ) {
        throw new Error(
          'Unexpected response from Toodledo task API.'
        );
      }

      const task =
        (
          rawTasks as
            unknown[]
        ).find(
          (
            item: any
          ) =>
            item &&
            Number(
              item.id
            ) === id
        ) as
          | ToodledoTask
          | undefined;

      if (
        !task
      ) {
        return res
          .status(404)
          .json({
            error:
              'Task not found in Toodledo.'
          });
      }

      console.log(
        'Completing task',
        {
          id:
            task.id,

          title:
            task.title,

          duedate:
            task.duedate,

          duetime:
            task.duetime,

          duedatemod:
            task.duedatemod,

          repeat:
            task.repeat
        }
      );

      const completed =
        Math.floor(
          Date.now() /
            1000
        );

      const result =
        await toodledoPost(
          'tasks/edit.php',
          {
            tasks:
              JSON.stringify([
                {
                  id,
                  completed,
                  reschedule:
                    1
                }
              ]),

            fields:
              TASK_FIELDS
          }
        );

      console.log(
        'Toodledo completion result',
        JSON.stringify(
          result
        )
      );

      res.json(
        result
      );
    } catch (
      error
    ) {
      console.error(
        error
      );

      res
        .status(500)
        .json({
          error:
            error instanceof
              Error
              ? error.message
              : 'Could not complete task.'
        });
    }
  }
);

/*
 * Push / reset the due date of a task.
 *
 * This changes the date directly rather
 * than completing/rescheduling the task.
 * The recurrence rule and due-date
 * modifier are left untouched.
 */
app.post(
  '/api/tasks/:id/push',
  async (
    req,
    res
  ) => {
    try {
      const id =
        Number(
          req.params.id
        );

      if (
        !Number.isFinite(
          id
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              'Invalid task id.'
          });
      }

      const destination =
        String(
          req.body
            .destination ||
            ''
        );

      const today =
        new Date();

      let duedate:
        number;

      switch (
        destination
      ) {
        case 'tomorrow': {
          const date =
            new Date(
              today
            );

          date.setDate(
            date.getDate() +
              1
          );

          duedate =
            toToodledoDate(
              date
            );

          break;
        }

        case 'week': {
          const date =
            new Date(
              today
            );

          date.setDate(
            date.getDate() +
              7
          );

          duedate =
            toToodledoDate(
              date
            );

          break;
        }

        case 'month': {
          const date =
            new Date(
              today
            );

          date.setMonth(
            date.getMonth() +
              1
          );

          duedate =
            toToodledoDate(
              date
            );

          break;
        }

        case 'clear':
          duedate =
            0;

          break;

        default:
          return res
            .status(400)
            .json({
              error:
                'Invalid push destination.'
            });
      }

      const result =
        await toodledoPost(
          'tasks/edit.php',
          {
            tasks:
              JSON.stringify([
                {
                  id,
                  duedate
                }
              ]),

            fields:
              TASK_FIELDS
          }
        );

      console.log(
        'Pushed task',
        {
          id,
          destination,
          duedate
        }
      );

      res.json(
        result
      );
    } catch (
      error
    ) {
      console.error(
        error
      );

      res
        .status(500)
        .json({
          error:
            error instanceof
              Error
              ? error.message
              : 'Could not push task.'
        });
    }
  }
);

/*
 * Serve the Vite build.
 */

const distPath =
  path.join(
    appRoot,
    'dist'
  );

app.use(
  express.static(
    distPath
  )
);

/*
 * SPA fallback.
 *
 * Avoid Express "*" wildcard routes here;
 * newer path-to-regexp versions reject
 * that syntax.
 */
app.use(
  (
    req,
    res,
    next
  ) => {
    if (
      req.path.startsWith(
        '/api/'
      )
    ) {
      return next();
    }

    res.sendFile(
      path.join(
        distPath,
        'index.html'
      )
    );
  }
);

/*
 * Unknown API route.
 */

app.use(
  '/api',
  (
    _req,
    res
  ) => {
    res
      .status(404)
      .json({
        error:
          'API endpoint not found.'
      });
  }
);

/*
 * Start server.
 */

app.listen(
  PORT,
  () => {
    console.log(
      `Taskerize listening on port ${PORT}`
    );

    console.log(
      `OAuth redirect URI: ${REDIRECT_URI}`
    );

    console.log(
      `Frontend path: ${distPath}`
    );
  }
);
