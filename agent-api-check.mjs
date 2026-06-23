import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const agent = read('./js/agent-api.js');
const api = read('./js/api.js');
const app = read('./js/app.js');
const spec = JSON.parse(read('./agent-api.json'));

const listed = Object.keys(spec.javascript_api.functions);
const exposed = agent.match(/const TempMailAPI = \{([\s\S]*?)\n\};/)?.[1] || '';
for (const fn of listed) assert.match(exposed, new RegExp(`\\b${fn}\\b`), `${fn} is not exposed`);

const switchBody = agent.match(/switch \(apiAction\) \{([\s\S]*?)\n      default:/)?.[1] || '';
const cases = [...switchBody.matchAll(/case '([^']+)'/g)].map((m) => m[1]);
assert.equal(new Set(cases).size, cases.length, 'duplicate URL API case');

assert.match(agent, /async function ensureDomainsLoaded\(\)[\s\S]*setDomains\(await fetchDomains\(\)\)/, 'automation creation paths must lazy-load domains');
assert.match(api, /const targetDomain = domain \|\| CROWN_DOMAINS\[0\] \|\| getEffDomain\(\)/, 'VIP API must default to credential-capable domain');
assert.doesNotMatch(app, /server\.smtp\.(altPort|altEncryption)/, 'CSV export uses wrong SMTP field names');

console.log('Agent API check passed');
