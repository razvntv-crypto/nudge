import { getStore } from "@netlify/blobs";

const PUBLIC_KEY = "BI-mI_3I8SVNeF_L8jRx4ARkh_Yc-67XXwtiLQuKjlD-BQjrGibj65wjpFFaHFxbDQ55xmOZKE12teHEPmIrHQ0";

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

export default async (req) => {
  if (req.method === "GET") return reply({ publicKey: PUBLIC_KEY });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => ({}));
  const expected = process.env.NUDGE_OWNER_TOKEN;
  if (!expected || body.token !== expected) return reply({ error: "Unauthorized" }, 401);

  const sub = body.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return reply({ error: "Invalid push subscription" }, 400);
  }

  const store = getStore({ name: "nudge-push", consistency: "strong" });
  await store.setJSON("primary-subscription", sub);
  return reply({ ok: true });
};

export const config = { path: "/api/nudge-subscribe" };
