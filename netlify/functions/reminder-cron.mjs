import { getStore } from "@netlify/blobs";
import webpush from "web-push";

const PUBLIC_KEY = "BI-mI_3I8SVNeF_L8jRx4ARkh_Yc-67XXwtiLQuKjlD-BQjrGibj65wjpFFaHFxbDQ55xmOZKE12teHEPmIrHQ0";

function localParts(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    weekday: "short"
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  const wd = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 }[p.weekday];
  return { date: p.year + "-" + p.month + "-" + p.day, time: p.hour + ":" + p.minute, weekday: wd };
}

function parseDate(s) {
  const [y,m,d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function diffDays(a,b) { return Math.round((parseDate(b)-parseDate(a))/86400000); }
function monthDiff(a,b) {
  const [ay,am] = a.split("-").map(Number), [by,bm] = b.split("-").map(Number);
  return (by-ay)*12 + (bm-am);
}
function dayOfMonth(s) { return +s.slice(8,10); }

function dueOn(i, d, weekday) {
  if (i.kind !== "routine") return i.date === d && !i.done;
  if ((i.doneDates || []).includes(d)) return false;
  const start = i.start || i.date || d;
  if (d < start) return false;
  const r = i.repeat || { type:"daily", every:1 };
  const every = Math.max(1, +r.every || 1);
  const delta = diffDays(start,d);
  if (delta < 0) return false;
  if (r.type === "daily" || r.type === "intervalDays") return delta % every === 0;
  if (r.type === "weekdays") {
    const days = Array.isArray(r.days) && r.days.length ? r.days.map(Number) : [];
    return days.includes(weekday) && Math.floor(delta/7) % every === 0;
  }
  if (r.type === "weekly") {
    const startWd = new Date(parseDate(start)).getUTCDay();
    return weekday === startWd && Math.floor(delta/7) % every === 0;
  }
  if (r.type === "monthly") return dayOfMonth(start) === dayOfMonth(d) && monthDiff(start,d) % every === 0;
  return false;
}

export default async () => {
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!privateKey) return;
  const store = getStore({ name: "nudge-push", consistency: "strong" });
  const [state, sub] = await Promise.all([
    store.get("reminder-state", { type:"json", consistency:"strong" }),
    store.get("primary-subscription", { type:"json", consistency:"strong" })
  ]);
  if (!state || !sub) return;

  const now = localParts(state.timeZone || "Europe/Bucharest");
  const due = (state.items || []).filter(i => i.time && i.time === now.time && dueOn(i, now.date, now.weekday));
  if (!due.length) return;

  webpush.setVapidDetails("https://gilded-syrniki-da98ed.netlify.app", PUBLIC_KEY, privateKey);

  for (const item of due) {
    const claimKey = "sent-" + item.id + "-" + now.date + "-" + now.time.replace(":","");
    const claim = await store.set(claimKey, String(Date.now()), { onlyIfNew:true });
    if (!claim.modified) continue;
    try {
      await webpush.sendNotification(sub, JSON.stringify({
        title: item.title || "Nudge",
        body: item.kind === "routine" ? "Routine due now" : "Task due now",
        tag: "nudge-" + item.id + "-" + now.date,
        url: "/"
      }), { TTL: 300, urgency:"high" });
    } catch (err) {
      await store.delete(claimKey);
      if (err?.statusCode === 404 || err?.statusCode === 410) await store.delete("primary-subscription");
      console.error("Reminder push failed", err);
    }
  }
};
