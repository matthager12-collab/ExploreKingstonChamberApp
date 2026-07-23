import "server-only";

// Files a GitHub issue for a "request a permanent change" from /admin/content.
//
// WHY: the DEFAULT wording for every block lives in code (site-copy-registry.ts).
// An admin override is temporary; making a change permanent means editing that
// file — a developer task. This turns the non-technical editor's request into a
// tracked issue in one click, instead of an email nobody can find later.
//
// Mirrors the token pattern in src/lib/wsf.ts: read a secret from the env and
// degrade gracefully when it's absent. With no GITHUB_TOKEN, githubConfigured()
// is false — the admin UI hides the button and the API returns a clean 503 — so
// the feature ships dark and lights up the moment the secret is set in Render.
// Server-only: never import from a client component.

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPO || "matthager12-collab/ExploreKingstonChamberApp";

/** True when a token is present, so callers can hide the feature otherwise. */
export function githubConfigured(): boolean {
  return Boolean(TOKEN && REPO);
}

export interface NewIssue {
  title: string;
  body: string;
  /** Best-effort: if a label doesn't exist on the repo we retry without it
   *  rather than fail the request (see createGithubIssue). */
  labels?: string[];
}

async function postIssue(payload: Record<string, unknown>): Promise<Response> {
  return fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "explore-kingston-admin",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
}

/** Create an issue, returning its web URL and number. Throws on missing config
 *  or a non-2xx response (the API route maps those to 503 / 502). */
export async function createGithubIssue(issue: NewIssue): Promise<{ url: string; number: number }> {
  if (!githubConfigured()) throw new Error("GitHub not configured");

  let res = await postIssue({ title: issue.title, body: issue.body, labels: issue.labels });
  // 422 usually means a label doesn't exist on the repo — retry without labels
  // so a missing label never blocks the request.
  if (res.status === 422 && issue.labels?.length) {
    res = await postIssue({ title: issue.title, body: issue.body });
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`GitHub issue create failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }

  const data = (await res.json()) as { html_url?: string; number?: number };
  if (!data.html_url || typeof data.number !== "number") {
    throw new Error("GitHub returned an unexpected response");
  }
  return { url: data.html_url, number: data.number };
}
