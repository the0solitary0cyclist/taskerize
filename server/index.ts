import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appRoot = path.resolve(__dirname, '../..');

const app = express();

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = Number(process.env.PORT || 3001);

const CLIENT_ID = process.env.TOODLEDO_CLIENT_ID || '';
const CLIENT_SECRET = process.env.TOODLEDO_CLIENT_SECRET || '';

const REDIRECT_URI =
  process.env.TOODLEDO_REDIRECT_URI ||
  `http://localhost:${PORT}/api/auth/callback`;

const TOKEN_FILE = path.join(
  appRoot,
  '.taskerize-tokens.json'
);

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
  startdate?: number;

  repeat?: string;
  duedatemod?: number;
};

function readTokens(): Tokens | null {
  try {
    return JSON.parse(
      fs.readFileSync(TOKEN_FILE, 'utf8')
    ) as Tokens;
  } catch {
    return null;
  }
}

function writeTokens(
  tokens: Omit<Tokens, 'obtained_at'> | Tokens
): Tokens {
  const withTimestamp = {
    ...tokens,
    obtained_at: Date.now()
  } as Tokens;

  fs.writeFileSync(
    TOKEN_FILE,
    JSON.stringify(withTimestamp, null, 2),
    { mode: 0o600 }
  );

  return withTimestamp;
}

async function exchangeToken(
  params: URLSearchParams
): Promise<Tokens> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      'Missing Toodledo client credentials.'
    );
  }

  const auth = Buffer.from(
    `${CLIENT_ID}:${CLIENT_SECRET}`
  ).toString('base64');

  const response = await fetch(
    'https://api.toodledo.com/3/account/token.php',
    {
      method: 'POST',

      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type':
          'application/x-www-form-urlencoded'
      },

      body: params
    }
  );

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `Token exchange failed (${response.status}): ${text}`
    );
  }

  const data = (await response.json()) as
    Omit<Tokens, 'obtained_at'> & {
      error?: string;
      error_description?: string;
    };

  if (data.error) {
    throw new Error(
      data.error_description ||
        data.error
    );
  }

  return writeTokens(data);
}

async function getAccessToken(): Promise<string> {
  const tokens = readTokens();

  if (!tokens) {
    throw new Error(
      'Not connected to Toodledo.'
    );
  }

  const expiresAt =
    tokens.obtained_at +
    (tokens.expires_in - 60) * 1000;

  if (Date.now() < expiresAt) {
    return tokens.access_token;
  }

  const refreshed = await exchangeToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token:
        tokens.refresh_token
    })
  );

  return refreshed.access_token;
}

async function toodledoGet(
  endpoint: string,
  params: Record<string, string> = {}
) {
  const accessToken =
    await getAccessToken();

  const url = new URL(
    `https://api.toodledo.com/3/${endpoint}`
  );

  url.searchParams.set(
    'access_token',
    accessToken
  );

  Object.entries(params).forEach(
    ([key, value]) => {
      url.searchParams.set(
        key,
        value
      );
    }
  );

  const response =
    await fetch(url);

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `Toodledo request failed (${response.status}): ${text}`
    );
  }

  const data =
    await response.json();

  if (data?.errorCode) {
    throw new Error(
      data.errorDesc ||
        'Toodledo API error'
    );
  }

  return data;
}

async function toodledoPost(
  endpoint: string,
  params: Record<string, string>
) {
  const accessToken =
    await getAccessToken();

  const body =
    new URLSearchParams({
      access_token: accessToken,
      ...params
    });

  const response =
    await fetch(
      `https://api.toodledo.com/3/${endpoint}`,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded'
        },

        body
      }
    );

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `Toodledo request failed (${response.status}): ${text}`
    );
  }

  const data =
    await response.json();

  if (data?.errorCode) {
    throw new Error(
      data.errorDesc ||
        'Toodledo API error'
    );
  }

  return data;
}

/*
 * Authentication
 */

app.get(
  '/api/auth/status',
  (_req, res) => {
    res.json({
      connected:
        Boolean(readTokens()),

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
    if (!CLIENT_ID) {
      return res
        .status(500)
        .send(
          'TOODLEDO_CLIENT_ID is not configured.'
        );
    }

    const state = crypto
      .randomBytes(24)
      .toString('hex');

    res.cookie(
      'toodledo_oauth_state',
      state,
      {
        httpOnly: true,

        secure:
          process.env.NODE_ENV ===
          'production',

        sameSite: 'lax',

        maxAge:
          10 * 60 * 1000
      }
    );

    const url = new URL(
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
  async (req, res) => {
    try {
      const code = String(
        req.query.code || ''
      );

      const returnedState =
        String(
          req.query.state || ''
        );

      const savedState =
        req.cookies
          .toodledo_oauth_state;

      if (
        !code ||
        !returnedState ||
        !savedState ||
        returnedState !== savedState
      ) {
        console.error(
          'OAuth state mismatch',
          {
            hasCode:
              Boolean(code),

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

      res.redirect('/');
    } catch (error) {
      console.error(error);

      res
        .status(500)
        .send(
          error instanceof Error
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
      // No token file exists.
    }

    res.json({
      connected: false
    });
  }
);

/*
 * Bootstrap data
 */

app.get(
  '/api/bootstrap',
  async (_req, res) => {
    try {
      const [
        folders,
        contexts,
        goals,
        locations,
        rawTasks
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

          toodledoGet(
            'tasks/get.php',
            {
              comp: '0',

              num: '1000',

              fields:
                'folder,context,goal,location,tag,status,priority,length,star,duedate,startdate,repeat,duedatemod'
            }
          )
        ]);

      /*
       * The Toodledo response may include
       * metadata along with actual task objects.
       */
      const tasks = (
        rawTasks as unknown[]
      ).filter(
        (item: any) =>
          item &&
          typeof item.id ===
            'number'
      ) as ToodledoTask[];

      /*
       * Tags don't have their own endpoint,
       * so derive the available tags from
       * active tasks.
       */
      const tags = [
        ...new Set(
          tasks.flatMap(task =>
            (task.tag || '')
              .split(',')
              .map(tag =>
                tag.trim()
              )
              .filter(Boolean)
          )
        )
      ].sort((a, b) =>
        a.localeCompare(b)
      );

      res.json({
        folders,
        contexts,
        goals,
        locations,
        tags,
        tasks
      });
    } catch (error) {
      console.error(error);

      res
        .status(500)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not load Toodledo data.'
        });
    }
  }
);

/*
 * Complete a task
 */

app.post(
  '/api/tasks/:id/complete',
  async (req, res) => {
    try {
      const id = Number(
        req.params.id
      );

      if (
        !Number.isFinite(id)
      ) {
        return res
          .status(400)
          .json({
            error:
              'Invalid task id.'
          });
      }

      /*
       * Fetch the task directly from Toodledo
       * immediately before completing it.
       *
       * This gives us current recurrence and
       * due-date information instead of relying
       * on potentially stale frontend data.
       */
      const rawTasks =
        await toodledoGet(
          'tasks/get.php',
          {
            id: String(id),

            fields:
              'folder,context,goal,location,tag,status,priority,length,star,duedate,startdate,repeat,duedatemod'
          }
        );

      const task = (
        rawTasks as unknown[]
      ).find(
        (item: any) =>
          item &&
          Number(item.id) === id
      ) as ToodledoTask | undefined;

      if (!task) {
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

          repeat:
            task.repeat,

          duedatemod:
            task.duedatemod
        }
      );

      const completed =
        Math.floor(
          Date.now() / 1000
        );

      /*
       * IMPORTANT:
       *
       * reschedule belongs inside the task
       * edit object.
       *
       * For a repeating task such as
       * FREQ=DAILY, Toodledo should advance
       * the task to its next occurrence while
       * preserving the completed occurrence
       * in its history.
       */
      const result =
        await toodledoPost(
          'tasks/edit.php',
          {
            tasks:
              JSON.stringify([
                {
                  id,
                  completed,
                  reschedule: 1
                }
              ]),

            fields:
              'folder,context,goal,location,tag,status,priority,length,star,duedate,startdate,repeat,duedatemod'
          }
        );

      console.log(
        'Toodledo completion result',
        JSON.stringify(
          result
        )
      );

      res.json(result);
    } catch (error) {
      console.error(error);

      res
        .status(500)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not complete task.'
        });
    }
  }
);

/*
 * Serve React/Vite
 */

const distPath =
  path.join(
    appRoot,
    'dist'
  );

app.use(
  express.static(distPath)
);

/*
 * Frontend fallback.
 *
 * app.get('*') is deliberately avoided
 * because the newer path-to-regexp used
 * by Express rejects a bare wildcard.
 */
app.use(
  (req, res, next) => {
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
 * Unknown API endpoint
 */

app.use(
  '/api',
  (_req, res) => {
    res
      .status(404)
      .json({
        error:
          'API endpoint not found.'
      });
  }
);

/*
 * Start server
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
