/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	createDesktopNightlyTestsLocalAssistancePlan,
	runDesktopNightlyTestsLocalAssistancePhase,
} from '../scripts/lib/desktop-nightly-tests-local-assistance.mjs';
import { runDesktopNightlyTests } from '../scripts/lib/desktop-nightly-tests-runtime.mjs';
import { listNodeTestFiles } from '../scripts/lib/node-test-shards.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const OPTIONS = Object.freeze({
	executablePath: '/opt/nightly-tests', payloadRoot: '/opt/payload',
	runRoot: '/tmp/nightly-run', platform: 'linux', arch: 'x64',
	environment: { PATH: '/usr/bin' },
});

test('the model plan explicitly enables real downloads and isolates their cache and reports', () => {
	const plan = createDesktopNightlyTestsLocalAssistancePlan(OPTIONS);
	assert.equal(plan.command, OPTIONS.executablePath);
	assert.equal(plan.cwd, OPTIONS.payloadRoot);
	assert.match(plan.args.at(-1), /playwright\.nightly-local-assistance\.config\.mjs$/u);
	assert.equal(plan.env.ELECTRON_RUN_AS_NODE, '1');
	assert.equal(plan.env.SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS, '1');
	assert.equal(plan.env.SOUNDSCAPER_PACKAGED_PRODUCT_ROOT, '/opt/payload/products');
	assert.equal(plan.env.SOUNDSCAPER_PACKAGED_RUNTIME_PLATFORM, 'linux');
	assert.equal(plan.env.SOUNDSCAPER_PACKAGED_RUNTIME_ARCH, 'x64');
	assert.equal(plan.env.SOUNDSCAPER_LOCAL_ASSISTANCE_MODEL_CACHE, '/tmp/nightly-run/local-assistance/models');
	assert.equal(plan.logFile, '/tmp/nightly-run/local-assistance/console.log');
	assert.deepEqual(OPTIONS.environment, { PATH: '/usr/bin' });
	assert.throws(() => createDesktopNightlyTestsLocalAssistancePlan({ ...OPTIONS, runRoot: 'relative' }), /absolute/u);
	assert.throws(() => createDesktopNightlyTestsLocalAssistancePlan({ ...OPTIONS, platform: 'unsupported' }), /platform/u);
	const reused = createDesktopNightlyTestsLocalAssistancePlan({
		...OPTIONS, environment: { SOUNDSCAPER_LOCAL_ASSISTANCE_MODEL_CACHE: '/tmp/verified-model-cache' },
	});
	assert.equal(reused.env.SOUNDSCAPER_LOCAL_ASSISTANCE_MODEL_CACHE, '/tmp/verified-model-cache');
});

test('an interrupted diagnostic phase does not start model downloads afterwards', async (context) => {
	const outputRoot = await mkdtemp(join(tmpdir(), 'nightly-model-interrupted-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	let childCalls = 0;
	let serverPort = 44100;
	const result = await runDesktopNightlyTests({
		...OPTIONS, outputRoot, product: { id: 'soundscaper-nightly-tests', name: 'Nightly tests', version: '1.0.0' },
	}, {
		startStaticServer: async () => ({ baseURL: `http://127.0.0.1:${serverPort++}`, close: async () => undefined }),
		runPlaywright: async () => (++childCalls === 1 ? { code: 0, signal: null } : { code: null, signal: 'SIGINT' }),
		writeMetricsDiagnostics: async () => ({ passed: false }),
	});
	assert.equal(childCalls, 2);
	assert.equal(result.exitCode, 130);
	assert.equal(result.result.status, 'interrupted');
});

test('the real-model phase preserves a failing child result for the nightly verdict', async (context) => {
	const runRoot = await mkdtemp(join(tmpdir(), 'nightly-model-phase-'));
	context.after(() => rm(runRoot, { recursive: true, force: true }));
	let calls = 0;
	const result = await runDesktopNightlyTestsLocalAssistancePhase({ ...OPTIONS, runRoot }, {
		runPlaywright: async (plan) => {
			calls += 1;
			assert.equal(plan.logFile, join(runRoot, 'local-assistance/console.log'));
			return { code: 1, signal: null };
		},
	});
	assert.equal(calls, 1);
	assert.deepEqual(result.child, { code: 1, signal: null });
	assert.equal(result.diagnostics.passed, false);
});

test('nightly model failures fail the overall run after the three earlier phases finish', async (context) => {
	const outputRoot = await mkdtemp(join(tmpdir(), 'nightly-model-run-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	const phases = [];
	let active = 0;
	let serverPort = 44000;
	const result = await runDesktopNightlyTests({
		...OPTIONS, outputRoot, product: { id: 'soundscaper-nightly-tests', name: 'Nightly tests', version: '1.0.0' },
	}, {
		startStaticServer: async () => ({ baseURL: `http://127.0.0.1:${serverPort++}`, close: async () => undefined }),
		runPlaywright: async (plan) => {
			assert.equal(active++, 0, 'the model phase must not overlap another test process');
			phases.push(plan.args.at(-1));
			await Promise.resolve();
			active -= 1;
			return { code: plan.env.SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS === '1' ? 1 : 0, signal: null };
		},
		writeMetricsDiagnostics: async () => ({ passed: true }),
		writePackagedMetricsDiagnostics: async () => ({ passed: true }),
	});
	assert.equal(phases.length, 4);
	assert.match(phases[3], /nightly-local-assistance/u);
	assert.equal(result.exitCode, 1);
	assert.equal(result.result.status, 'failed');
	assert.equal(result.result.artifacts.localAssistanceJsonReport, 'local-assistance/results.json');
});

test('real-model configuration is serial and excluded from normal Node and browser discovery', async () => {
	const keys = ['SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT', 'SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT', 'SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS'];
	const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
	try {
		process.env.SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT = ROOT;
		process.env.SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT = '/tmp/nightly-model-config';
		process.env.SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS = '1';
		const { default: config, createNightlyLocalAssistanceConfig } = await import('../playwright.nightly-local-assistance.config.mjs');
		assert.equal(config.testDir, join(ROOT, 'tests/electron/local-assistance-models'));
		assert.equal(config.workers, 1);
		assert.equal(config.fullyParallel, false);
		assert.equal(config.retries, 0);
		assert.equal(config.timeout, 1_800_000);
		assert.equal(config.webServer, undefined);
		assert.equal(config.outputDir, '/tmp/nightly-model-config/local-assistance/test-results');
		assert.throws(() => createNightlyLocalAssistanceConfig({ ...process.env, SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS: '0' }), /downloads/u);
		assert.equal(listNodeTestFiles(ROOT).some((path) => path.includes('/tests/electron/')), false);
		const browserConfig = await readFile(join(ROOT, 'playwright.config.mjs'), 'utf8');
		assert.match(browserConfig, /testDir: '\.\/tests\/browser'/u);
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});
