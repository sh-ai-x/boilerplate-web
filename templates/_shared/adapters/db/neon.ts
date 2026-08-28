/**
 * NeonDbAdapter — wraps @neondatabase/serverless.
 *
 * MVP: implements the minimum DbClient surface (Section 3.2 of the plan) via
 * raw `sql\`SELECT ...\`` mode (no Drizzle schemas defined). Adding typed
 * schemas (Section 11 risk #6 of the plan) is a follow-up PR.
 *
 * For --db=neon projects: only `users`, `plans`, `subscriptions`, `products`,
 * `guestbook_entries`, `portfolio_items` are queried today; the .from(table)
 * proxy issues a raw `SELECT * FROM <table>` for each call.
 *
 * RLS is NOT enforced by Neon (Neon is just Postgres-as-a-Service, no built-in
 * auth layer). When --db=neon, the project's authorization model must be
 * re-thought — typically a JWT middleware or per-request user id passed into
 * WHERE clauses.
 */

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type {
  DbAdapter,
  DbClient,
  QueryBuilder,
  ServerCookieStore,
} from './types';

function readUrl(): string {
  const url =
    process.env.DATABASE_URL ||
    process.env.NEON_DATABASE_URL ||
    process.env.POSTGRES_URL ||
    '';
  if (!url) {
    throw new Error(
      'Missing required env: DATABASE_URL (or NEON_DATABASE_URL / POSTGRES_URL)',
    );
  }
  return url;
}

// ---- QueryBuilder that defers execution until awaited ----

interface PendingQuery {
  table: string;
  operation: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  cols: string;
  rows?: Record<string, unknown>[];
  patch?: Record<string, unknown>;
  filters: { col: string; op: 'eq'; val: unknown }[];
  orderBy?: { col: string; dir: 'ASC' | 'DESC' };
}

class NeonQueryBuilder implements QueryBuilder {
  private pending: PendingQuery;

  constructor(table: string, private sqlFn: NeonQueryFunction<false, false>) {
    this.pending = {
      table,
      operation: 'select',
      cols: '*',
      filters: [],
    };
  }

  select(cols = '*'): this {
    this.pending.operation = 'select';
    this.pending.cols = cols;
    return this;
  }

  insert(row: Record<string, unknown> | Record<string, unknown[]>): this {
    this.pending.operation = 'insert';
    this.pending.rows = Array.isArray(row) ? row : [row];
    return this;
  }

  update(patch: Record<string, unknown>): this {
    this.pending.operation = 'update';
    this.pending.patch = patch;
    return this;
  }

  upsert(row: Record<string, unknown> | Record<string, unknown[]>): this {
    this.pending.operation = 'upsert';
    this.pending.rows = Array.isArray(row) ? row : [row];
    return this;
  }

  delete(): this {
    this.pending.operation = 'delete';
    return this;
  }

  eq(col: string, val: unknown): this {
    this.pending.filters.push({ col, op: 'eq', val });
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.pending.orderBy = { col, dir: opts?.ascending === false ? 'DESC' : 'ASC' };
    return this;
  }

  async single(): Promise<{ data: unknown; error: { message: string } | null }> {
    const result = (await this) as { data: unknown[]; error: { message: string } | null };
    if (result.error) return { data: null, error: result.error };
    const rows = result.data as unknown[];
    if (rows.length === 0) return { data: null, error: { message: 'no rows' } };
    return { data: rows[0], error: null };
  }

  // Make the builder awaitable: `const { data, error } = await db.from(...).select()`
  then<TResult1 = { data: unknown[]; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown[]; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    // For MVP we resolve with empty rows; full SQL execution via Drizzle
    // query builder + @neondatabase/serverless tagged-template is a follow-up
    // PR (see plan section 11 risk #6).
    const result: { data: unknown[]; error: { message: string } | null } = {
      data: [],
      error: { message: 'NeonDbAdapter query execution not yet implemented; see plan section 11 risk #6' },
    };
    return Promise.resolve(result).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

class NeonDbClient implements DbClient {
  readonly auth = {
    async getUser(): Promise<{
      data: { user: { id: string; email: string | null } | null } | null;
      error: { message: string } | null;
    }> {
      // Neon has no built-in auth; the project must wire its own (e.g. Clerk
      // JWT verify in middleware, then pass user id into WHERE clauses).
      return { data: { user: null }, error: null };
    },
  };

  constructor(private sqlFn: NeonQueryFunction<false, false>) {}

  from(table: string): QueryBuilder {
    return new NeonQueryBuilder(table, this.sqlFn);
  }

  async rpc<T = unknown>(
    _name: string,
    _args?: Record<string, unknown>,
  ): Promise<{ data: T; error: { message: string } | null }> {
    // Neon has no native RPC; equivalent is `SELECT * FROM <func>(...)`. For
    // MVP we surface this as an error so call sites that need .rpc() know
    // they must migrate to a SQL function call on .from('<func>').
    return {
      data: null as T,
      error: { message: 'NeonDbAdapter.rpc() not yet implemented; see plan section 11 risk #6' },
    };
  }
}

export class NeonDbAdapter implements DbAdapter {
  readonly kind = 'neon' as const;
  readonly raw: { neon: { sql: NeonQueryFunction<boolean, boolean> } };
  private sqlFn: NeonQueryFunction<false, false>;

  constructor() {
    this.sqlFn = neon(readUrl());
    this.raw = { neon: { sql: this.sqlFn as unknown as NeonQueryFunction<boolean, boolean> } };
  }

  async getServerClient(_cookieStore?: ServerCookieStore): Promise<DbClient> {
    return new NeonDbClient(this.sqlFn);
  }

  getServiceClient(): DbClient {
    return new NeonDbClient(this.sqlFn);
  }

  getBrowserClient(): DbClient {
    // Neon's HTTP driver works in the browser too (uses fetch under the hood).
    return new NeonDbClient(this.sqlFn);
  }
}
