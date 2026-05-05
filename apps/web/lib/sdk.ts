/**
 * Thin client SDK for the dashboard. Wraps the /api/sdk/* route handlers so
 * UI code talks in domain types instead of fetch boilerplate.
 */
export interface TimelineEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  status: string;
  verificationStatus: string;
  notes: string | null;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

async function deleteJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

export const webSdk = {
  today: () => getJson<{ events: TimelineEvent[] }>("/api/sdk/today"),
  week: () => getJson<{ events: TimelineEvent[] }>("/api/sdk/week"),
  history: () => getJson<{ events: TimelineEvent[] }>("/api/sdk/history"),
  memory: () =>
    getJson<{ facts: Array<{ id: string; kind: string; body: string; confidence: number }> }>(
      "/api/sdk/memory",
    ),
  forgetMemory: (id: string) =>
    deleteJson<{ ok: true }>(`/api/sdk/memory/${encodeURIComponent(id)}`),
};
