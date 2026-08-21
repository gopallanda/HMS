#!/usr/bin/env node
/**
 * Database CLI wrapper — hosted Supabase, no Docker.
 *
 * Reads SUPABASE_DB_URL from .env.local and passes it to the Supabase CLI as
 * --db-url, so no `supabase login` and no `supabase link` are needed.
 *
 *   node scripts/db.mjs push [--dry-run]   apply supabase/migrations
 *   node scripts/db.mjs types              regenerate types/database.ts
 *   node scripts/db.mjs seed               run supabase/seed.sql
 *   node scripts/db.mjs repair <version>  mark migrations already applied
 *
 * A Node wrapper rather than raw npm scripts because `$VAR` does not expand in
 * cmd.exe and `>` redirection differs per shell.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const TYPES_PATH = resolve(ROOT, 'types/database.ts');

/**
 * The Supabase CLI is launched as a plain JS entrypoint under this same Node,
 * never as `npx supabase`. Since Node 20.12 spawning a `.cmd` shim without a
 * shell fails with EINVAL on Windows, and spawning it *with* a shell would put
 * the connection string -- which contains `?`, `&` and `@` -- through cmd.exe.
 * The package's own bin is neither, so both problems go away.
 */
const CLI_ENTRY = resolve(ROOT, 'node_modules/supabase/dist/supabase.js');

function loadEnvLocal() {
  const path = resolve(ROOT, '.env.local');
  if (!existsSync(path)) {
    fail('.env.local not found. Copy .env.example to .env.local and fill it in.');
  }

  const env = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    // strip surrounding quotes, keep everything else verbatim
    env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

function dbUrl() {
  const url = loadEnvLocal().SUPABASE_DB_URL;
  if (!url) {
    fail(
      'SUPABASE_DB_URL is not set in .env.local.\n' +
        '  Supabase Dashboard -> Connect -> Direct connection (or Session pooler).\n' +
        '  Percent-encode any special characters in the password.',
    );
  }
  return url;
}

/**
 * The project ref (the `qcskq...` in the API URL), for the commands that go
 * through the Management API rather than a Postgres connection.
 */
function projectRef() {
  const env = loadEnvLocal();
  if (env.SUPABASE_PROJECT_ID) return env.SUPABASE_PROJECT_ID;

  const apiUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const match = /^https?:\/\/([a-z0-9]+)\.supabase\.(co|in)/i.exec(apiUrl);
  return match ? match[1] : null;
}

/** Run the Supabase CLI, streaming output. */
function cli(args, { capture = false, env = {} } = {}) {
  if (!existsSync(CLI_ENTRY)) {
    fail('Supabase CLI not found. Run `npm install` first.');
  }

  const result = spawnSync(process.execPath, [CLI_ENTRY, ...args], {
    cwd: ROOT,
    stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

  // A process that never started has status null. Reporting that as a bare
  // exit 1 is how a broken launcher looks exactly like a rejected migration.
  if (result.error) {
    fail(`Could not run the Supabase CLI: ${result.error.message}`);
  }

  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout;
}

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case 'push': {
    // --include-all: this project has never used `supabase link`, so the
    // remote migration history table is the only source of truth for what has
    // already run. Nothing is re-applied.
    cli(['db', 'push', '--db-url', dbUrl(), '--include-all', '--yes', ...rest]);
    break;
  }

  case 'repair': {
    // Records migrations as already applied, without running them.
    //
    // Needed when the objects exist on the hosted project but
    // supabase_migrations.schema_migrations does not know it -- an early
    // migration applied by hand, or a history table lost with a restore.
    // Without this, a push replays migration 1 and dies on a type that is
    // already there.
    //
    // This writes migration history only. It never touches a table.
    if (rest.length === 0) {
      fail('Usage: node scripts/db.mjs repair <version> [<version> ...]');
    }
    cli(['migration', 'repair', '--status', 'applied', ...rest, '--db-url', dbUrl()]);
    break;
  }

  case 'types': {
    // Generated through the Management API (--project-id), not --db-url.
    //
    // The CLI runs pg-meta in a container to serve --db-url, and this project
    // does not have Docker and is not getting it (CLAUDE.md 2). --project-id
    // is plain HTTPS against the hosted project, which is the same database
    // every other command here talks to.
    //
    // It authenticates with a personal access token: Dashboard -> Account ->
    // Access Tokens. Put it in .env.local as SUPABASE_ACCESS_TOKEN.
    const env = loadEnvLocal();
    const token = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;
    const ref = projectRef();

    if (!token) {
      fail(
        'SUPABASE_ACCESS_TOKEN is not set in .env.local.\n' +
          '  Dashboard -> Account -> Access Tokens -> Generate new token.\n' +
          '  Then: npm run db:types\n\n' +
          '  (--db-url is not used here: the CLI serves it out of a Docker\n' +
          '  container, and this project has no Docker.)',
      );
    }
    if (!ref) {
      fail('Could not work out the project ref. Set SUPABASE_PROJECT_ID in .env.local.');
    }

    const out = cli(['gen', 'types', 'typescript', '--project-id', ref], {
      capture: true,
      env: { SUPABASE_ACCESS_TOKEN: token },
    });
    if (!out || !out.includes('export type Database')) {
      fail('Type generation returned nothing usable. types/database.ts left untouched.');
    }
    writeFileSync(TYPES_PATH, out, 'utf8');
    console.log(`\n  Wrote types/database.ts (${out.split('\n').length} lines). Commit it.\n`);
    break;
  }

  case 'seed': {
    // Every seeded row has a fixed UUID and an ON CONFLICT guard, so this is
    // safe to re-run -- which is the point: the login step in seed.sql may
    // need a second pass after the auth user exists.
    cli(['db', 'push', '--db-url', dbUrl(), '--include-all', '--include-seed', '--yes', ...rest]);
    break;
  }

  default:
    fail(
      'Usage:\n' +
        '    node scripts/db.mjs push [--dry-run]\n' +
        '    node scripts/db.mjs types\n' +
        '    node scripts/db.mjs seed\n' +
        '    node scripts/db.mjs repair <version> [<version> ...]',
    );
}
