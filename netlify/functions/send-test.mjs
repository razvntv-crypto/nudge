import { getStore } from "@netlify/blobs";
import webpush from "web-push";

const PUBLIC_KEY = "BI-mI_3I8SVNeF_L8jRx4ARkh_Yc-67XXwtiLQuKjlD-BQjrGibj65wjpFFaHFxbDQ55xmOZKE12teHEPmIrHQ0";

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

  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!privateKey) return reply({ error: "VAPID_PRIVATE_KEY is not configured" }, 500);

  const store = getStore({ name: "nudge-push", consistency: "strong" });
  const sub = await store.get("primary-subscription", { type: "json", consistency: "strong" });
  if (!sub) return reply({ error: "No device subscribed yet" }, 409);

  webpush.setVapidDetails("mailto:nudge@localhost.invalid", PUBLIC_KEY, privateKey);
  try {
    await webpush.sendNotification(sub, JSON.stringify({
      title: "Nudge test ✓",
      body: "Push notifications work. Next step: real reminder times.",
      tag: "nudge-test",
      url: "/"
    }), { TTL: 60, urgency: "high" });
    return reply({ ok: true });
  } catch (err) {
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      await store.delete("primary-subscription");
      return reply({ error: "Subscription expired. Enable notifications again." }, 410);
    }
    console.error("Push test failed", err);
    return reply({ error: "Push provider rejected the notification" }, 502);
  }
};

export const config = { path: "/api/nudge-test-push" };
