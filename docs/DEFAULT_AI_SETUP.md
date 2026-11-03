# Authenticated default AI (Supabase Edge Function)

Default AI is optional. Signed-out chat keeps the on-device rule-based assistant. A signed-in user with BYOK enabled continues to use their own provider/key; default AI is used only when BYOK is off. The relay does not replace local-first record writes.

## Architecture and limits

`supabase/functions/ai-chat/` and `_shared/ai-core.ts` implement an OpenAI-compatible generation relay:

- Platform JWT verification is enabled in `supabase/config.toml`; the function also resolves the user with `admin.auth.getUser(jwt)`.
- The browser sends the current conversation/tool results, limited tracker context, and standing notes. It cannot select the provider, model, base URL, system prompt, or tool list.
- The server builds the same fixed budgeting/bulking instructions as BYOK and exposes only the existing eight tools. It **returns** model tool calls; the existing client validates and executes them through `TrackerService`. The function never writes tracker records.
- The provider key exists only in Function secrets. Prompts, responses, keys, and provider payloads are not logged or stored in usage tables.
- Defaults: 100 KB request body, 48 messages, 1,500 output tokens, 12 returned tool calls, and a 45-second provider timeout. Existing client limits remain six rounds, 12 executed calls, eight writes, 12 history messages, validated arguments, duplicate-write suppression, and `clientMessageId` idempotency.
- Before every provider call, one SQL transaction reserves per-minute, per-user daily, and global daily capacity. Missing/broken usage controls fail closed. Actual token/cost usage settles the reservation; uncertain network outcomes retain the conservative upper bound.
- Optional price-based spending enforcement fails closed if a dollar cap is set without both token prices. Also set a hard spending limit in the provider dashboard; application quotas are not a substitute for provider-side controls.

## 1. Apply the usage migration

Link the intended project, then include `20261103000000_default_ai_usage.sql` in the reviewed `db push` described in [SUPABASE_SETUP.md](./SUPABASE_SETUP.md). Its tables/RPCs have RLS enabled, no client policies, client grants revoked, and execute permission only for `service_role`.

## 2. Configure Function secrets

Use Supabase dashboard **Edge Functions → Secrets**, or run these commands locally with real values (never in chat/Git/frontend env):

```bash
npx supabase@2.122.0 secrets set \
  AI_PROVIDER=openai-compatible \
  AI_BASE_URL=https://openrouter.ai/api/v1 \
  AI_MODEL='<SERVER_CHOSEN_TOOL_CAPABLE_MODEL>' \
  AI_API_KEY='<SERVER_ONLY_PROVIDER_KEY>' \
  APP_ALLOWED_ORIGINS='https://<PRIMARY_WEB_ORIGIN>'
```

`AI_BASE_URL` must be HTTPS without embedded credentials/query/fragment. OpenRouter's default is shown; another operator-controlled OpenAI-compatible endpoint requires a deliberate configuration change and compatibility testing. The model must support chat completions and function/tools.

Optional quota overrides (defaults shown):

```bash
npx supabase@2.122.0 secrets set \
  AI_RATE_PER_MINUTE=6 \
  AI_USER_DAILY_REQUESTS=80 \
  AI_USER_DAILY_TOKENS=120000 \
  AI_GLOBAL_DAILY_REQUESTS=2000 \
  AI_GLOBAL_DAILY_TOKENS=5000000 \
  AI_PROVIDER_TIMEOUT_MS=45000
```

Optional global daily spending cap (USD) and exact provider prices (USD per million tokens):

```bash
npx supabase@2.122.0 secrets set \
  AI_GLOBAL_DAILY_SPEND_USD='<DAILY_CAP>' \
  AI_INPUT_USD_PER_MILLION='<INPUT_PRICE>' \
  AI_OUTPUT_USD_PER_MILLION='<OUTPUT_PRICE>'
```

Keep prices current when changing models. With the cap unset, token/request quotas still apply and recorded price cost is zero unless prices are supplied. `https://localhost` is allowed in code for the Android WebView; do not add wildcards or untrusted origins.

## 3. Deploy and check configuration

```bash
npx supabase@2.122.0 functions deploy ai-chat
```

Do **not** pass `--no-verify-jwt`. In the dashboard confirm `ai-chat` is ACTIVE, JWT verification is on, all required secret names exist, and the migration is applied. The authenticated `status` action reports `configured` only when required provider settings are present; it does not prove provider connectivity, model compatibility, remaining quota, or spending-cap correctness.

## 4. Real verification still required

With a test account and non-production provider key/quota:

1. Confirm signed-out/other-user JWTs cannot call generation and ordinary `authenticated` roles cannot read usage tables or call usage RPCs.
2. Send a normal chat and a tool-using chat; verify records appear through the service layer, a retry with the same `clientMessageId` does not duplicate them, and BYOK still uses the user's selected provider/model.
3. Exercise per-minute, per-user daily, global daily, and spending limits with small test-only values. Confirm rejected calls do not contact the provider and failed reservations do not increment counters.
4. Test an incompatible model, bad server key, provider 429/500, timeout, restart/reconnect, and a large history. The UI must show a truthful error rather than claiming a record was saved.
5. Inspect Function/provider logs and usage rows: no prompt/response bodies, provider keys, service-role keys, or refresh tokens. Usage rows should contain only counters/reservations.

No live default-AI configuration or provider test should be inferred from unit tests, a deployed function shell, or a successful Android build.
