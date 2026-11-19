// One function, two jobs (emails go through Brevo, free 300/day):
//  mode "new"   -> called by the website right after a bill is saved: emails the bill to the customer
//  default      -> called by the hourly schedule: at the chosen hour (Settings) it
//                  1) emails customers with overdue bills (repeat every N days)
//                  2) emails the owner ONE summary of all overdue bills
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "content-type": "application/json" } });
const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let body: any = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: s } = await sb.from("settings").select("*").eq("id", 1).single();
  if (!s) return json({ error: "no settings" }, 500);

  const tz = s.timezone || "Asia/Karachi";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date()); // YYYY-MM-DD in local time
  const hourNow = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date())) % 24;

  const senderName = s.sender_name || s.name;
  const senderEmail = Deno.env.get("SENDER_EMAIL")!;
  const apiKey = Deno.env.get("BREVO_API_KEY")!;
  const money = (n: number) => `${s.cur} ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const totalOf = (b: any) => {
    const sub = (b.items ?? []).reduce((a: number, i: any) => a + i.qty * i.price, 0);
    const after = sub - Math.min(sub, b.disc || 0);
    return after + (after * (b.tax || 0)) / 100;
  };
  const send = (to: { email: string; name?: string }, subject: string, htmlContent: string) =>
    fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({ sender: { name: senderName, email: senderEmail }, to: [to], subject, htmlContent }),
    });

  // ---------------- mode "new": email the bill right after it is saved ----------------
  if (body.mode === "new") {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer /i, "");
    const { data: u, error: ue } = await sb.auth.getUser(jwt);
    if (ue || !u?.user) return json({ error: "not logged in" }, 401);

    const { data: b } = await sb.from("bills").select("*").eq("id", body.id).maybeSingle();
    if (!b) return json({ error: "bill not found" }, 404);
    if (!b.cemail) return json({ skipped: "no customer email" });
    if (b.status !== "pending") return json({ skipped: "bill is not pending" });
    if (b.notified_at) return json({ skipped: "already emailed" });

    const total = totalOf(b);
    const rowsHtml = (b.items ?? []).map((i: any) =>
      `<tr><td style="padding:6px 10px;border-bottom:1px solid #ddd">${esc(i.desc)}</td><td style="padding:6px 10px;border-bottom:1px solid #ddd">${i.qty}</td><td style="padding:6px 10px;border-bottom:1px solid #ddd">${esc(money(i.price))}</td><td style="padding:6px 10px;border-bottom:1px solid #ddd;text-align:right">${esc(money(i.qty * i.price))}</td></tr>`).join("");
    const html = `<p>Hello ${esc(b.cname)},</p>
      <p>Thank you for your business. Here is your bill <b>${esc(b.no)}</b> dated ${b.bill_date}.</p>
      <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">
      <tr style="background:#f3f4f8;text-align:left"><th style="padding:6px 10px">Detail</th><th style="padding:6px 10px">Qty</th><th style="padding:6px 10px">Price</th><th style="padding:6px 10px;text-align:right">Total</th></tr>
      ${rowsHtml}</table>
      <p style="font-size:16px"><b>Amount due: ${esc(money(total))}</b>${b.due ? `<br>Please pay by <b>${b.due}</b>.` : ""}</p>
      ${b.notes ? `<p>${esc(b.notes)}</p>` : ""}
      <p>Thank you,<br><b>${esc(senderName)}</b><br>${esc(s.phone || "")}</p>`;

    const r = await send({ email: b.cemail, name: b.cname }, `Bill ${b.no} from ${senderName} - ${money(total)}`, html);
    if (!r.ok) return json({ error: await r.text() }, 502);

    // if the bill is already overdue, don't send a reminder straight away as well
    const overdue = b.due && b.due < today;
    await sb.from("bills").update({ notified_at: new Date().toISOString(), ...(overdue ? { last_reminded: new Date().toISOString() } : {}) }).eq("id", b.id);
    return json({ emailed: b.cemail });
  }

  // ---------------- default: scheduled reminders ----------------
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return json({ error: "forbidden" }, 403);
  if (!s.auto_remind) return json({ sent: 0, note: "auto reminder off" });
  const wantHour = s.remind_hour ?? 9;
  if (!body.force && hourNow !== wantHour) return json({ skipped: `not reminder time (now ${hourNow}:00, set ${wantHour}:00 ${tz})` });

  const { data: bills, error } = await sb.from("bills").select("*")
    .eq("status", "pending").lt("due", today).order("due", { ascending: true });
  if (error) return json({ error: error.message }, 500);

  const every = Math.max(1, s.remind_every || 3) * 86400000;
  let sent = 0, ownerSent = 0;
  const errors: string[] = [];
  const rows: { b: any; total: number; days: number; note: string }[] = [];

  for (const b of bills ?? []) {
    const total = totalOf(b);
    const days = Math.floor((Date.parse(today) - Date.parse(b.due)) / 86400000);
    let note = "No customer email";

    if (b.cemail) {
      const dueNow = !b.last_reminded || Date.now() - new Date(b.last_reminded).getTime() >= every - 3600000; // 1h tolerance
      if (dueNow) {
        const html = `<p>Hello ${esc(b.cname)},</p>
      <p>This is a reminder that your bill <b>${esc(b.no)}</b> (<b>${esc(money(total))}</b>) is pending. The due date was <b>${b.due}</b>.</p>
      <p>Please make the payment at your earliest convenience. If you have already paid, please ignore this email.</p>
      <p>Thank you,<br><b>${esc(senderName)}</b><br>${esc(s.phone || "")}</p>`;
        const r = await send({ email: b.cemail, name: b.cname }, `Payment Reminder - Bill ${b.no}`, html);
        if (r.ok) {
          sent++;
          note = "Reminder emailed to customer today";
          await sb.from("bills").update({ last_reminded: new Date().toISOString(), remind_count: (b.remind_count || 0) + 1 }).eq("id", b.id);
        } else {
          note = "Customer email FAILED";
          errors.push(`${b.no}: ${await r.text()}`);
        }
      } else {
        note = `Customer reminded ${b.last_reminded.slice(0, 10)}`;
      }
    }
    rows.push({ b, total, days, note });
  }

  if (s.owner_email && rows.length) {
    const sum = rows.reduce((a, r) => a + r.total, 0);
    const tr = rows.map((r) => `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #ddd">${esc(r.b.cname)}${r.b.cphone ? `<br><small>${esc(r.b.cphone)}</small>` : ""}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #ddd">${esc(r.b.no)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #ddd"><b>${esc(money(r.total))}</b></td>
      <td style="padding:6px 10px;border-bottom:1px solid #ddd">${r.b.due}<br><small>${r.days} day(s) overdue</small></td>
      <td style="padding:6px 10px;border-bottom:1px solid #ddd"><small>${esc(r.note)}</small></td></tr>`).join("");
    const html = `<p>These customers have <b>not paid</b> by their due date:</p>
      <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">
      <tr style="background:#f3f4f8;text-align:left"><th style="padding:6px 10px">Customer</th><th style="padding:6px 10px">Bill</th><th style="padding:6px 10px">Amount</th><th style="padding:6px 10px">Was due</th><th style="padding:6px 10px">Status</th></tr>
      ${tr}</table>
      <p><b>Total unpaid (overdue): ${esc(money(sum))}</b></p>
      <p style="color:#666;font-size:12px">Open the billing site and tap "Mark Paid" once a customer pays; reminders then stop.</p>`;
    const r = await send({ email: s.owner_email }, `Overdue payments: ${rows.length} bill(s), ${money(sum)}`, html);
    if (r.ok) ownerSent = 1; else errors.push(`owner summary: ${await r.text()}`);
  }

  return json({ overdue: rows.length, sent, ownerSent, errors });
});
