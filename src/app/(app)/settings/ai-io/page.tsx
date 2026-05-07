'use client';

import { useEffect, useState } from 'react';

type LogResponse = { enabled: boolean; entries: any[] };

export default function AiIoPage() {
  const [data, setData] = useState<LogResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetch('/api/dev/ai-io', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!mounted) return;
        if (j) setData(j as LogResponse);
        else setFailed(true);
      })
      .catch(() => {
        if (!mounted) return;
        setFailed(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <h1 className="text-xl font-semibold">AI I/O (Dev)</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {failed ? (
            <>
              Not available. Enable with <code>AI_IO_LOG=1</code> and run in <code>NODE_ENV=development</code>.
            </>
          ) : (
            'Loading…'
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">AI I/O (Dev)</h1>
        <a className="text-sm underline" href="/api/dev/ai-io?clear=1">
          Clear
        </a>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Shows the last {data.entries.length} AI calls (requests + responses) recorded in this server process.
      </p>

      <div className="mt-4 space-y-4">
        {data.entries.map((e) => (
          <div key={e.id} className="rounded-lg border bg-background p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="font-mono">{new Date(e.ts).toISOString()}</span>
              <span className="font-medium text-foreground">{e.scope}</span>
              {e.model ? <span className="font-mono">{e.model}</span> : null}
              {typeof e.ms === 'number' ? <span>{e.ms}ms</span> : null}
              <span className="font-mono">{e.id}</span>
            </div>

            {e.error ? (
              <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(e.error, null, 2)}</pre>
            ) : null}

            <details className="mt-2">
              <summary className="cursor-pointer text-sm">Request</summary>
              <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(e.request, null, 2)}</pre>
            </details>

            <details className="mt-2">
              <summary className="cursor-pointer text-sm">Response</summary>
              <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-xs">
                {JSON.stringify(e.response ?? null, null, 2)}
              </pre>
            </details>
          </div>
        ))}
      </div>
    </div>
  );
}

