# Online Billing – Setup (sirf ek dafa, ~30 minute)

Teen free account chahiye: **Supabase** (database + login), **Brevo** (email), **Netlify** (website hosting).

## 1. Supabase (database + login)
1. https://supabase.com par sign up karein > **New project** (naam: rw-billing, password koi bhi, region: closest).
2. Left menu **SQL Editor** > New query > `supabase/schema.sql` ka poora text paste > **Run**.
3. **Authentication > Users > Add user > Create new user**: har staff ka email + password banayein (2-5 log). "Auto Confirm User" ON rakhein.
4. **Authentication > Sign In / Providers > Email**: "Allow new users to sign up" **OFF** kar dein (taake bahar ka koi account na bana sake).
5. **Project Settings > API**: `Project URL` aur `anon public` key copy karein, `config.js` mein paste karein.

## 2. Brevo (email bhejne ke liye, free 300/din)
1. https://brevo.com par sign up.
2. **Senders & IP > Senders > Add a sender**: apna email dein (jis se customer ko mail jaye), verify karein.
3. **SMTP & API > API Keys > Generate**: key copy kar lein.

## 3. Auto-reminder function (Supabase)
Terminal (PowerShell) mein, `online` folder ke andar:
```
npm i -g supabase
supabase login
supabase link --project-ref PROJECT-REF
supabase secrets set BREVO_API_KEY=xxxx SENDER_EMAIL=aap@email.com CRON_SECRET=koi-lamba-random-text
supabase functions deploy send-reminders --no-verify-jwt
```
(`PROJECT-REF` = Project URL ka pehla hissa: `https://PROJECT-REF.supabase.co`)

Phir `supabase/cron.sql` mein PROJECT-REF aur CRON-SECRET badal kar SQL Editor mein Run karein. Ab roz subah 9 baje overdue bills par email khud jayegi.

## 4. Website online karein (Netlify)
1. https://app.netlify.com/drop kholen.
2. `online` folder (jis mein `index.html`, `config.js`, `logo.svg` hain) drag & drop karein.
3. Link mil jayega, jaise `xxxx.netlify.app`. Ye PC aur mobile dono par khulega. Staff ko link + unka email/password dein.

## Purana data lana
Purani site mein Settings > Download Backup. Nayi site mein Settings > Restore Backup (ye purane bills server par add kar dega).

## Zaroori
- `anon` key public hoti hai, theek hai; data RLS se sirf login walon ke liye khula hai.
- Kabhi `service_role` key `config.js` mein na dalein.
- Auto email sirf un bills par jayegi jin mein customer ka **email** likha ho, jo pending hon aur due date guzar chuki ho.
