#!/usr/bin/env node
/** Safe public, credential-free connectivity check: no account data or paid chat requests. */
const site = 'https://personal-tracker-merged.vercel.app';
const models = 'https://openrouter.ai/api/v1/models';
const timeout = () => AbortSignal.timeout(25_000);

async function probe(label, url, init) {
  try {
    const res = await fetch(url, { ...init, signal: timeout(), redirect: 'manual', cache: 'no-store' });
    let count = null;
    if (res.ok && init.method !== 'OPTIONS') {
      const json = await res.json();
      count = Array.isArray(json?.data) ? json.data.length : null;
    }
    const origin = res.headers.get('access-control-allow-origin');
    const allowedHeaders = res.headers.get('access-control-allow-headers');
    console.log(`::notice::${label}: HTTP ${res.status}; proxy=${res.headers.get('x-ai-proxy') ?? 'absent'}; models=${count ?? 'n/a'}; CORS origin=${origin ?? 'absent'}; allowed headers=${allowedHeaders ?? 'absent'}`);
    return { status: res.status, count, origin, allowedHeaders };
  } catch (err) {
    console.log(`::notice::${label}: network error (${err?.name ?? 'unknown'})`);
    return null;
  }
}

const origin = { origin: site };
const direct = await probe('OpenRouter public models', models, { method: 'GET', headers: origin });
const cors = await probe('OpenRouter browser preflight', models, { method: 'OPTIONS', headers: { ...origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
const relay = await probe('Production JSON relay', `${site}/api/llm-proxy`, { method: 'POST', headers: { ...origin, 'content-type': 'application/json' }, body: JSON.stringify({ url: models, method: 'GET' }) });
if (!direct || direct.status !== 200 || !(direct.count > 0) || !cors || cors.status < 200 || cors.status >= 300 || !['*', site].includes(cors.origin) || !cors.allowedHeaders?.toLowerCase().includes('authorization') || !relay || relay.status !== 200 || !(relay.count > 0)) {
  console.error('Public OpenRouter discovery or relay connectivity failed; see check annotations. No API key was used.');
  process.exitCode = 1;
}
