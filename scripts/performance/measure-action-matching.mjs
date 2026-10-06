/* SPDX-License-Identifier: AGPL-3.0-only */
// Run: node --import tsx scripts/performance/measure-action-matching.mjs [output.json]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE_PATH = 'src/common/editor/audacity-action-parity.js';
const SOURCE_URL = new URL(`../../${SOURCE_PATH}`, import.meta.url);
const BASE_REVISION = '25d7cbdb4';
const outputArguments = process.argv.slice(2);
if (outputArguments.length > 1) throw new TypeError('Pass at most one output JSON path.');
const outputPath = resolve(ROOT, outputArguments[0] ?? 'test-results/editing-performance/action-matching.json');
const before = execFileSync('git', ['show', `${BASE_REVISION}:${SOURCE_PATH}`], { cwd: ROOT, encoding: 'utf8' });
const after = readFileSync(SOURCE_URL, 'utf8');
const baseline = await load(before);
const current = await load(after);
assert.deepEqual(current.AUDACITY_ACTION_MANIFEST, baseline.AUDACITY_ACTION_MANIFEST);
const dynamic = Object.values(baseline.AUDACITY_ACTION_MANIFEST).filter((entry) => entry.id.includes('%1'));
const rawValues = ['', '%', '%E0%A4%A', '0', '-0', '-1', '1.5', '44100', '4.41e4', '9007199254740992',
	'%2B44100', 'hello+world', 'hello%2Bworld', 'caf%C3%A9%2Ftest%3Fa%3D1', '%20'];
const fixtures = [null, undefined, 0, {}, '', ...Object.keys(baseline.AUDACITY_ACTION_MANIFEST),
	...Object.keys(baseline.AUDACITY_ACTION_ALIASES), ...dynamic.flatMap((entry) => rawValues.map((value) => entry.id.replace('%1', value))),
	...Array.from({ length: 1000 }, (_value, index) => `unknown-${index}`), 'constructor', '__proto__', 'toString'];
for (const id of fixtures) assert.deepEqual(current.matchAudacityAction(id), baseline.matchAudacityAction(id), String(id));
const workloads = { unknown: Array.from({ length: 1000 }, (_value, index) => `unknown-${index}`),
	dynamic: dynamic.map((entry) => entry.id.replace('%1', '44100')), static: ['file-new', 'generator://tone', 'new-project'] };
const measurements = {};
for (const [name, ids] of Object.entries(workloads)) {
	for (let warm = 0; warm < 3; warm++) { measure(baseline, ids, 2000); measure(current, ids, 2000); }
	const old = []; const next = [];
	for (let trial = 0; trial < 9; trial++) {
		if (trial % 2) { next.push(measure(current, ids, 10000).ms); old.push(measure(baseline, ids, 10000).ms); }
		else { old.push(measure(baseline, ids, 10000).ms); next.push(measure(current, ids, 10000).ms); }
	}
	measurements[name] = { iterations: 10000, trials: 9, baselineMedianMs: median(old), currentMedianMs: median(next),
		baselineTrialsMs: old, currentTrialsMs: next };
}
const evidence = { classification: 'supplemental renderer publication optimization; audit 100 count unchanged',
	nodeVersion: process.version, baselineRevision: BASE_REVISION,
	beforeSourceSha256: createHash('sha256').update(before).digest('hex'), afterSourceSha256: createHash('sha256').update(after).digest('hex'),
	parity: { fixtures: fixtures.length, exactPrivateResultParity: true, manifestDefinitions: Object.keys(baseline.AUDACITY_ACTION_MANIFEST).length, dynamicMatchers: dynamic.length },
	operationCount: { lookups: 2000, baselineRepeatedManifestEnumerations: countEnumerations(baseline), currentRepeatedManifestEnumerations: countEnumerations(current) },
	measurements, limits: 'Isolated warm JavaScript matcher timings; run on an idle host. These do not estimate Electron end-to-end responsiveness or explain every Tone latency regression. The index contains immutable manifest-derived templates only, never caller runtime, results, parameters, handlers or menu arrays.' };
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ outputPath, ...evidence }, null, 2)}\n`);

async function load(source) {
	const absolute = source.replace(/from\s+(['"])(\.[^'"]+)\1/g, (_match, quote, path) => `from ${quote}${new URL(path, SOURCE_URL).href}${quote}`);
	return import(`data:text/javascript;base64,${Buffer.from(`${absolute}\nexport { matchAudacityAction };`).toString('base64')}`);
}
function median(values) { return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]; }
function measure(module, ids, iterations) {
	let found = 0; const start = performance.now();
	for (let index = 0; index < iterations; index++) found += module.matchAudacityAction(ids[index % ids.length]) !== null;
	return { ms: performance.now() - start, found };
}
function countEnumerations(module) {
	const values = Object.values; let scans = 0;
	Object.values = (value) => { if (value === module.AUDACITY_ACTION_MANIFEST) scans++; return values(value); };
	try {
		for (let index = 0; index < 1000; index++) { module.matchAudacityAction(`unknown-${index}`); module.matchAudacityAction(dynamic[0].id.replace('%1', '44100')); }
	} finally { Object.values = values; }
	return scans;
}
