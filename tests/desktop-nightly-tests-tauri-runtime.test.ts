/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runDesktopNightlyTests } from '../scripts/lib/desktop-nightly-tests-runtime.mjs';
import type { DesktopNightlyTestsProgress } from '../scripts/lib/desktop-nightly-tests-runtime.mjs';
import { runDualOriginPhaseFixture } from './helpers/nightly-tests-dual-origin-phase.ts';
import { nightlyProductSitesFixture } from './helpers/nightly-tests-product-sites.ts';

const REVISION = '1'.repeat(40);

async function fixture(context: { after(callback: () => Promise<void>): void }) {
	const root = await mkdtemp(join(tmpdir(), 'nightly-tauri-runtime-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const payloadRoot = join(root, 'payload');
	const outputRoot = join(root, 'output');
	await mkdir(join(payloadRoot, 'tauri-prototype'), { recursive: true });
	await mkdir(outputRoot);
	const bytes = Buffer.from('admitted native payload');
	const executable = 'tauri-prototype/soundscaper-tauri-prototype';
	await writeFile(join(payloadRoot, executable), bytes);
	await writeFile(join(payloadRoot, 'stage-manifest.json'), JSON.stringify({ tauriPrototype: {
		executable, sourceRevision: REVISION, target: { platform: 'linux', arch: 'x64' },
		byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
	} }));
	return { executablePath: '/opt/nightly-tests', payloadRoot, outputRoot, sourceRevision: REVISION,
		platform: 'linux', arch: 'x64', environment: {},
		product: { id: 'soundscaper-nightly-tests', name: 'Nightly tests', version: '1.0.0' } };
}

const dependencies = {
	runDualOriginPhase: runDualOriginPhaseFixture,
	startProductSites: nightlyProductSitesFixture(49_920),
	writeMetricsDiagnostics: async () => ({ passed: true }),
	writePackagedMetricsDiagnostics: async () => ({ passed: true }),
	preserveCoverageEvidence: async () => '/tmp/coverage-evidence',
};

test('admitted nightly payloads run their Tauri smoke immediately after browsers and register its artifacts', async (context) => {
	const options = await fixture(context);
	const updates: DesktopNightlyTestsProgress[] = [];
	const events: string[] = [];
	const result = await runDesktopNightlyTests({ ...options, onProgress: (value) => { updates.push(value); } }, {
		...dependencies,
		runPlaywright: async () => { events.push('playwright'); return { code: 0, signal: null }; },
		runTauriPhase: async (phaseOptions) => {
			events.push('tauri');
			assert.equal(phaseOptions.tauriPrototype.sourceRevision, REVISION);
			return { child: { code: 0, signal: null }, diagnostics: { passed: true } };
		},
	});
	assert.equal(result.exitCode, 0);
	assert.deepEqual(events.slice(0, 2), ['playwright', 'tauri']);
	assert.deepEqual(updates.map(({ total, label }) => [total, label]), [
		[7, 'Browser tests'], [7, 'Tauri native smoke test'], [7, 'Dual-origin browser coverage'],
		[7, 'Performance diagnostics'], [7, 'Packaged app diagnostics'],
		[7, 'Packaged app coverage'], [7, 'Local model tests'],
	]);
	assert.equal(result.result.artifacts.tauriSmokeReport, 'tauri/smoke-report.json');
	assert.equal(result.result.artifacts.tauriConsoleLog, 'tauri/console.log');
	assert.equal(result.result.artifacts.tauriSummary, 'tauri/summary.json');
});

test('browser and Tauri failures aggregate while later independent phases still run', async (context) => {
	const options = await fixture(context);
	let children = 0;
	const result = await runDesktopNightlyTests(options, {
		...dependencies,
		runPlaywright: async () => ({ code: ++children === 1 ? 1 : 0, signal: null }),
		runTauriPhase: async () => ({ child: { code: 0, signal: null }, diagnostics: { passed: false } }),
	});
	assert.equal(result.exitCode, 1);
	assert.equal(result.result.failure, 'Failed phases:\n- Browser tests\n- Tauri native smoke test');
	assert.equal(children, 6);
});

test('interrupted Tauri smoke prevents later diagnostics and retains the interruption verdict', async (context) => {
	const options = await fixture(context);
	let children = 0;
	const result = await runDesktopNightlyTests(options, {
		...dependencies,
		runPlaywright: async () => { children += 1; return { code: 0, signal: null }; },
		runTauriPhase: async () => ({ child: { code: null, signal: 'SIGINT' }, diagnostics: { passed: false } }),
	});
	assert.equal(children, 1);
	assert.equal(result.exitCode, 130);
	assert.equal(result.result.status, 'interrupted');
	assert.equal(result.result.signal, 'SIGINT');
});

test('declared missing native bytes fail before browser work starts', async (context) => {
	const options = await fixture(context);
	await rm(join(options.payloadRoot, 'tauri-prototype/soundscaper-tauri-prototype'));
	let started = false;
	const result = await runDesktopNightlyTests(options, {
		...dependencies,
		runPlaywright: async () => { started = true; return { code: 0, signal: null }; },
	});
	assert.equal(started, false);
	assert.equal(result.exitCode, 2);
	assert.match(result.result.failure ?? '', /Tauri prototype executable/u);
});
