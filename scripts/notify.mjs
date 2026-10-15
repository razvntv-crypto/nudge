// Sends the daily summary push. The phone itself counts the tasks (see sw.js);
// this script only says which summary to show: morning, afternoon or evening.
import webpush from "web-push";

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_SUBSCRIPTION, MANUAL_SLOT } = process.env;
const TZ = "Europe/Bucharest";
const SLOTS = [["morning", 8 * 60], ["afternoon", 15 * 60], ["evening", 20 * 60]];

function localMinutes() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const get = t => +parts.find(p => p.type === t).value;
  return get("hour") * 60 + get("minute");
}

// Two cron entries exist per slot (summer and winter time). Only the one that lands
// between 10 minutes early and 45 minutes late, local time, sends anything.
function pickSlot() {
  if (MANUAL_SLOT) return MANUAL_SLOT;
  const now = localMinutes();
  const hit = SLOTS.find(([, m]) => now - m >= -10 && now - m <= 45);
  return hit ? hit[0] : null;
}

const slot = pickSlot();
const m = localMinutes();
console.log(`Local time ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")} (${TZ}) -> ${slot || "not a notification time"}`);
if (!slot) process.exit(0);

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !PUSH_SUBSCRIPTION) {
  console.log("Notifications are not set up yet: add VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and PUSH_SUBSCRIPTION in Settings > Secrets and variables > Actions.");
  process.exit(0);
}

let subs;
try { subs = JSON.parse(PUSH_SUBSCRIPTION); } catch { console.error("PUSH_SUBSCRIPTION is not valid JSON. Copy the setup code from Remindery again."); process.exit(1); }
if (!Array.isArray(subs)) subs = [subs];

webpush.setVapidDetails("mailto:noreply@remindery.app", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

let ok = 0;
for (const sub of subs) {
  try {
    await webpush.sendNotification(sub, JSON.stringify({ slot }), { TTL: 3600, urgency: "high" });
    ok++;
    console.log("Sent to", new URL(sub.endpoint).host);
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) console.error("This phone's subscription expired. Turn notifications on again in Remindery and update PUSH_SUBSCRIPTION.");
    else console.error("Push failed:", e.statusCode || "", e.body || e.message);
  }
}
if (!ok) process.exit(1);
