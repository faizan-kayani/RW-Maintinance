-- Edge Function deploy karne ke BAAD SQL Editor mein run karein.
-- Neeche 3 jagah apni values likhein: PROJECT-REF, CRON-SECRET (wahi jo function ke secret mein hai)
-- Roz subah 9 baje (Pakistan time) = 04:00 UTC

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'daily-bill-reminders',
  '0 4 * * *',
  $$
  select net.http_post(
    url := 'https://PROJECT-REF.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('x-cron-secret', 'CRON-SECRET', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);

-- Band karne ke liye:  select cron.unschedule('daily-bill-reminders');
