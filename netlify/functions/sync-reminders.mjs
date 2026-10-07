import { getStore } from "@netlify/blobs";

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

export default async (req) => {
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const body = await req.json().catch(() => ({}));
  const expected = process.env.NUDGE_OWNER_TOKEN;
  if (!expected || body.token !== expected) return reply({ error: "Unauthorized" }, 401);
  if (!Array.isArray(body.items)) return reply({ error: "Invalid items" }, 400);

  const payload = {
    items: body.items.map(i => ({
      id: String(i.id || ""),
      title: String(i.title || "Nudge").slice(0, 160),
      date: i.date || "",
      time: i.time || "",
      kind: i.kind === "routine" ? "routine" : "task",
      repeat: i.repeat || null,
      start: i.start || "",
      done: i.done || 0,
      doneDates: Array.isArray(i.doneDates) ? i.doneDates : []
    })),
    timeZone: String(body.timeZone || "Europe/Bucharest"),
    syncedAt: Date.now()
  };

  const store = getStore({ name: "nudge-push", consistency: "strong" });
  await store.setJSON("reminder-state", payload);
  return reply({ ok: true, count: payload.items.length });
};

export const config = { path: "/api/nudge-sync" };
