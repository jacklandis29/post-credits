# Post Credits production auth setup

The application uses passwordless email links and Google OAuth through a
browser-side Supabase client. Both flows use PKCE. User-owned data is enforced
at the database boundary with RLS and explicit RPC grants; the browser never
receives a secret or service-role key.

## Required before public launch

### URL configuration

- Set **Site URL** to the single canonical HTTPS production origin.
- Add `https://postcredits.club/**` to **Redirect URLs**.
- Add only the localhost origins actively used for development. Do not allow
  unrelated preview or third-party domains.
- Add the Supabase callback URL shown in the Google provider panel to the Google
  OAuth client's authorized redirect URIs.
- Exercise email and Google sign-in from the production hostname after every
  URL or provider change.

The production client uses `https://postcredits.club/` as its callback. Local
development uses the current localhost origin and pathname. Neither flow
accepts a caller-supplied external redirect.

### Confirmation and magic-link emails

- Set **Confirm signup** to subject `Finish creating your Post Credits account`
  and copy `supabase/templates/confirmation.html` into its body.
- Set **Magic Link** to subject `Your Post Credits sign-in link` and copy
  `supabase/templates/magic_link.html` into its body.
- Keep `{{ .ConfirmationURL }}` in the template. Supabase generates the PKCE
  confirmation URL and the browser client exchanges the returned code.
- Set the email OTP/magic-link expiry to **3600 seconds or less**.

### Custom SMTP

Supabase's built-in sender is development-only and heavily rate limited. Before
launch, configure **Authentication > Emails > SMTP Settings**:

- Sender name: `Post Credits`
- Sender address: `noreply@auth.postcredits.club`
- SMTP provider: Resend
- Host: `smtp.resend.com`
- Port: `465`
- Username: `resend`
- Password: a restricted, current Resend sending key

Verify `auth.postcredits.club` in Resend first. Confirm SPF and DKIM pass, publish a
DMARC policy, and never reuse a leaked or general-purpose API key.

### Bot and abuse protection

1. Create a Cloudflare Turnstile **Managed** widget for every production and
   development hostname that will request email links.
2. Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` to its public site key in each runtime.
3. In **Authentication > Bot and Abuse Protection**, enable Turnstile and enter
   the matching secret key.
4. Deploy the client and Supabase setting together. Enabling Supabase CAPTCHA
   before the public site key is deployed will block email-link requests.

The widget uses the always-visible appearance so the security check never leaves
an unexplained clickable blank area. Google sign-in remains available if
Turnstile cannot load.

Review **Authentication > Rate Limits** after custom SMTP is active. Keep the
per-address resend cooldown at 60 seconds or longer and choose project-wide
email/OTP limits that cover expected launch traffic without allowing abuse.

### Session and provider policy

- Keep JWT expiry short (the Supabase default one-hour range is appropriate for
  this app). Revoked access tokens remain valid until their JWT expires.
- If the plan supports it, use a reasonable inactivity timeout and maximum
  session lifetime. Do not force single-session mode for this consumer diary.
- Leave anonymous sign-ins disabled.
- Disable every unused external provider.
- Enable Google and email only after both production flows pass end to end.
- The ordinary **Sign out** action terminates only the current device. Account
  settings also provide **Sign out everywhere** for lost-device response.

Password sign-in is not exposed by Post Credits. If password auth is ever
added, first enable leaked-password protection, require at least 12 characters,
and add a reauthentication flow for password changes. The live Security Advisor
currently reports leaked-password protection as disabled, so password UI must
not be introduced until that is corrected.

### Security notifications and administrator access

- Enable available security notification emails for identity linked/unlinked,
  email changed, password changed, and MFA factor changed events.
- Protect every Supabase organization owner with MFA and enforce organization
  MFA when the plan permits it.
- Keep at least two recovery-capable organization owners for production.
- Never put `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in a
  `NEXT_PUBLIC_` variable, client bundle, log, or browser request.

## Release verification

Run these checks against the canonical production hostname:

1. Request a magic link, receive it through custom SMTP, click once, and land in
   the app with the URL auth parameters removed.
2. Reuse the same link and confirm it fails with a safe, actionable message.
3. Complete Google sign-in and cancel Google sign-in once; both should return to
   a usable state.
4. Sign out on one device and confirm another device remains signed in.
5. Use **Sign out everywhere** and confirm every refresh token is revoked.
6. Confirm an anonymous client cannot read owner tables or execute privileged
   RPCs; confirm two test users cannot read or mutate one another's rows.
7. Run Supabase Security Advisor and review every remaining item. The public
   projection views and authenticated ranking RPCs are intentional exceptions;
   they use narrow projections or explicit `auth.uid()` ownership checks.
8. Review Auth logs for unexpected 4xx/5xx responses, redirect failures, and
   bursts of email requests.
