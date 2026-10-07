// Plain error pages for a received frontend that has none. No styling beyond
// the basics: the frontend's designer can restyle them. Next 16 hands error
// boundaries `{ error, retry }`. The message shows only in development, so a
// shopper never sees a stack of internals.

export const ERROR_PAGE = `"use client";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main style={{ padding: "4rem 1.5rem", textAlign: "center" }}>
      <h1>Something went wrong</h1>
      {process.env.NODE_ENV !== "production" && <p>{error.message}</p>}
      <button type="button" onClick={() => retry()}>
        Try again
      </button>
    </main>
  );
}
`;

// Replaces the whole page when the root layout itself fails, so it needs its own <html> and <body>.
export const GLOBAL_ERROR_PAGE = `"use client";

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <main style={{ padding: "4rem 1.5rem", textAlign: "center" }}>
          <h1>Something went wrong</h1>
          {process.env.NODE_ENV !== "production" && <p>{error.message}</p>}
          <button type="button" onClick={() => retry()}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
`;
