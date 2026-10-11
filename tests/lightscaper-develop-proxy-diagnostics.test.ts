/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectCiDiagnostics } from '../scripts/collect-ci-diagnostics.mjs';
import { createCiDiagnosticsReport, HOSTED_CI_COLLECTORS, HOSTED_CI_ENVIRONMENT_ID } from '../scripts/lib/ci-diagnostics.mjs';
import {
	createPendingLightscaperDevelopProxyResult,
	parseLightscaperDevelopProxyDiagnostic,
	summarizeLightscaperDevelopProxyDiagnosticsV1,
} from '../scripts/lib/lightscaper-develop-proxy-diagnostics-v1.ts';

const MARKER = 'LIGHTSCAPER_DEVELOP_PROXY_DIAGNOSTIC ';
const amounts = [25, 50, 75, 100, 125];
const sha = (index: number) => index.toString(16).padStart(64, '0');
const recipe = () => ({ processVersion: 1, maskCount: 0, dehazeAmount: 37.125,
	sharpenAmount: 50, sharpenThreshold: 0, stageOrder: ['dehaze-v1', 'detail-sharpen-v1'] });
function diagnostic(locale = 'en') {
	let sequence = 0;
	return {
		schemaVersion: 1, profile: 'deterministic-photo-develop-proxy-spatial-v1', workloadId: 'l4-photo-develop-proxy-spatial',
		fixtureId: 'lightscaper-develop-proxy-spatial-4096x3072-v1', locale, environmentId: 'local-runtime-diagnostics',
		browser: { name: 'chromium', version: '140.0.0' }, rendererClass: 'unknown', instrumentation: 'none',
		runtime: { platform: 'Linux', userAgent: 'bounded browser user agent', hardwareConcurrency: 4, deviceMemoryGiB: null as number | null,
			viewportWidth: 1280, viewportHeight: 720, deviceScaleFactor: 1, decodePath: 'unknown' },
		protocol: { start: 'trusted-finite-input', end: 'current-ready-plus-one-raf', warmupTrials: 1, measuredTrials: 5,
			workers: 1, retries: 0, caseDeadlineMs: 90_000, p95Method: 'nearest-rank-per-locale-then-worst' },
		fixture: { width: 4096, height: 3072, proxyWidth: 2048, proxyHeight: 1536, sourceRgbaByteLength: 50_331_648,
			proxyRgbaByteLength: 12_582_912, pngSrgbIntent: 0, encodedByteLength: 1000, encodedSha256: sha(1),
			sourceRgbaSha256: sha(2), proxyRgbaSha256: sha(3), dehazeRgbaSha256: sha(4),
			goldens: amounts.map(amount => ({ amount, afterSha256: sha(amount) })) },
		observations: {
			coldOpen: { inputAtMs: 0, readyAtMs: 20, presentedAtMs: 21 }, beforeActualSha256: sha(3), beforePixelMismatchCount: 0,
			initialAfterActualSha256: sha(50), initialAfterPixelMismatchCount: 0,
			serialTrials: [75, 25, 100, 75, 125, 50].map((amount, trial) => {
				const inputAtMs = 100_000 * (trial + 1), elapsed = trial === 0 ? 99_999 : trial * (locale === 'en' ? 10 : 20);
				return { trial, amount, inputSequence: ++sequence, inputTrusted: true, inputAtMs, readyAtMs: inputAtMs + elapsed - 1,
					presentedAtMs: inputAtMs + elapsed, pendingObserved: true, actualAmount: amount,
					expectedAfterSha256: sha(amount), actualAfterSha256: sha(amount), pixelMismatchCount: 0 };
			}),
			burstTrials: Array.from({ length: 6 }, (_, trial) => {
				const inputAtMs = 1_000_000 + 200_000 * trial, elapsed = trial === 0 ? 99_999 : trial * (locale === 'en' ? 30 : 40);
				return { trial, inputs: [25, 100, 50].map((amount, index) => ({ amount, inputSequence: ++sequence,
					inputTrusted: true, inputAtMs: inputAtMs + index })), earlierWorkPending: [true, true], pendingObserved: true,
					readyAtMs: inputAtMs + 2 + elapsed - 1, presentedAtMs: inputAtMs + 2 + elapsed, actualAmount: 50,
					expectedAfterSha256: sha(50), actualAfterSha256: sha(50), pixelMismatchCount: 0 };
			}),
			close: { pendingObserved: true, closedWithoutLatePublication: true, expectedAfterSha256: sha(50), actualAfterSha256: sha(50), pixelMismatchCount: 0 },
			custody: { beforeSha256: sha(1), afterSaveSha256: sha(1), afterReloadSha256: sha(1), savedRecipe: recipe(), reloadedRecipe: recipe() },
		},
	};
}
function pair() { return [diagnostic('en'), diagnostic('de')]; }
function output(values: unknown[] = pair()) { return values.map(value => `[browser] ${MARKER}${JSON.stringify(value)}`).join('\n'); }
function summarize(values: unknown = pair()) { return summarizeLightscaperDevelopProxyDiagnosticsV1(values); }
// Synthetic limits exercise the evaluator. They are not observed production performance thresholds.
function config() {
	const value = diagnostic();
	const ids = ['photoDevelop.proxyPixelMismatchCount', 'photoDevelop.originalDigestMismatchCount', 'photoDevelop.latestFrameMismatchCount',
		'photoDevelop.serialEditP95Ms', 'photoDevelop.burstLatestReadyP95Ms'];
	return { schemaVersion: 2,
		fixtures: [{ id: value.fixtureId, kind: 'test-only-fixture', specification: { fixture: value.fixture, protocol: value.protocol, timingInstrumentation: 'none' } }],
		measurements: ids.map((id, index) => ({ id, behavior: index < 3 ? 'blocking' : 'observational' })),
		thresholds: ids.map((measurementId, index) => ({ measurementId, comparison: index < 3 ? 'eq' : 'lte', unit: index < 3 ? 'count' : 'ms', value: index < 3 ? 0 : 1000 })),
		workloads: [{ id: value.workloadId, behavior: 'blocking', fixtureIds: [value.fixtureId], measurementIds: ids }],
	};
}

test('exact EN and DE records retain every trial and use worst per-locale nearest-rank p95 without warmup pooling', () => {
	const parsed = parseLightscaperDevelopProxyDiagnostic(`unrelated output\n${output(pair().reverse())}\nfinished`);
	const result = summarize(parsed);
	assert.deepEqual(result.diagnostics.map(value => value.locale), ['en', 'de']);
	assert.deepEqual(result.metrics, { 'photoDevelop.proxyPixelMismatchCount': 0, 'photoDevelop.originalDigestMismatchCount': 0,
		'photoDevelop.latestFrameMismatchCount': 0, 'photoDevelop.serialEditP95Ms': 100, 'photoDevelop.burstLatestReadyP95Ms': 200 });
	assert.deepEqual(result.localeMetrics, [{ locale: 'en', serialEditP95Ms: 50, burstLatestReadyP95Ms: 150 },
		{ locale: 'de', serialEditP95Ms: 100, burstLatestReadyP95Ms: 200 }]);
	assert.equal(result.diagnostics[0]!.observations.serialTrials[0]!.presentedAtMs - result.diagnostics[0]!.observations.serialTrials[0]!.inputAtMs, 99_999);
	assert.equal(result.diagnostics[1]!.observations.burstTrials.length, 6);
	assert.equal(result.rendererClass, 'unknown'); assert.equal(Object.isFrozen(result.diagnostics[0]!.observations.coldOpen), true);
	assert.equal(Object.isFrozen(result.diagnostics[1]!.fixture.goldens), true);
});

test('missing, duplicate, extra or partial locale records cannot silently pool or replace failed samples', () => {
	for (const values of [[], [diagnostic()], [diagnostic(), diagnostic()], [...pair(), diagnostic('de')], [diagnostic(), diagnostic('fr')],
		[diagnostic(), { ...diagnostic('de'), observations: null }]]) assert.throws(() => parseLightscaperDevelopProxyDiagnostic(output(values)));
	assert.throws(() => parseLightscaperDevelopProxyDiagnostic(output().replace('"locale":"en"', '"locale":"en","locale":"en"')), /duplicate/iu);
	assert.throws(() => parseLightscaperDevelopProxyDiagnostic(output().replace('"locale":"en"', '"locale":"en","loc\\u0061le":"en"')), /duplicate/iu);
	assert.throws(() => parseLightscaperDevelopProxyDiagnostic(null));
	assert.throws(() => parseLightscaperDevelopProxyDiagnostic('x'.repeat(16 * 1024 * 1024 + 1)), /bound/iu);
});

test('shared fixture, browser, runtime, protocol, environment and instrumentation must agree across locales', () => {
	const mutations: Array<(value: ReturnType<typeof diagnostic>) => void> = [
		value => { value.fixture.encodedSha256 = sha(99); }, value => { value.fixture.goldens[1]!.afterSha256 = sha(99); },
		value => { value.browser.version = '141'; }, value => { value.browser.name = 'firefox'; },
		value => { value.runtime.hardwareConcurrency = 8; }, value => { value.runtime.deviceScaleFactor = 2; },
		value => { value.instrumentation = 'v8-browser'; }, value => { value.environmentId = 'github-ubuntu-playwright-1.62.1'; },
		value => { value.protocol.caseDeadlineMs = 90_001; },
	];
	for (const mutate of mutations) { const values = pair(); mutate(values[1]!); assert.throws(() => summarize(values)); }
	const firefox = pair(); for (const value of firefox) value.browser.name = 'firefox';
	assert.equal(summarize(firefox).diagnostics[0]!.browser.name, 'firefox');
	for (const value of firefox) value.environmentId = 'github-ubuntu-playwright-1.62.1';
	assert.throws(() => summarize(firefox), /hosted/iu);
});

test('closed admission refuses unknown fields, getters, missing trials, untrusted input and forged timing endpoints', () => {
	const mutations: Array<(value: ReturnType<typeof diagnostic>) => void> = [
		value => { Object.assign(value, { metrics: {} }); }, value => { Object.assign(value.fixture, { iccProfile: true }); },
		value => { value.fixture.pngSrgbIntent = 1; }, value => { value.fixture.width = 2048; },
		value => { value.rendererClass = 'browser-2d'; }, value => { value.runtime.decodePath = 'guessed-native'; },
		value => { value.protocol.retries = 1; }, value => { value.protocol.end = 'ready-before-paint'; },
		value => { value.observations.serialTrials.pop(); }, value => { value.observations.serialTrials[0]!.amount = 50; },
		value => { value.observations.serialTrials[1]!.inputTrusted = false; }, value => { value.observations.serialTrials[2]!.inputSequence = 1; },
		value => { value.observations.serialTrials[2]!.readyAtMs = Number.NaN; }, value => { value.observations.serialTrials[2]!.readyAtMs = 0; },
		value => { value.observations.serialTrials[2]!.pendingObserved = false; }, value => { value.observations.burstTrials[1]!.inputs.reverse(); },
		value => { value.observations.burstTrials[1]!.earlierWorkPending[0] = false; },
		value => { value.observations.close.expectedAfterSha256 = sha(25); },
	];
	for (const mutate of mutations) { const values = pair(); mutate(values[0]!); assert.throws(() => summarize(values)); }
	let invoked = 0;
	const values = pair(); Object.defineProperty(values[0]!.observations.custody, 'beforeSha256', { enumerable: true, get() { invoked++; return sha(1); } });
	assert.throws(() => summarize(values), /data/iu); assert.equal(invoked, 0);
	const extra = pair(); Object.defineProperty(extra[0]!.observations.serialTrials, 'extra', { value: 1 }); assert.throws(() => summarize(extra));
});

test('actual wrong pixels, digests, latest amount, close publication and saved recipes remain numerical failures', () => {
	const values = pair(), first = values[0]!.observations, second = values[1]!.observations;
	first.beforePixelMismatchCount = 7; second.initialAfterActualSha256 = sha(99);
	first.serialTrials[1]!.actualAmount = 100; first.burstTrials[2]!.actualAfterSha256 = sha(25);
	first.close.closedWithoutLatePublication = false; second.custody.afterReloadSha256 = sha(99);
	second.custody.reloadedRecipe.sharpenAmount = 75;
	const result = summarize(values);
	assert.equal(result.metrics['photoDevelop.proxyPixelMismatchCount'], 9);
	assert.equal(result.metrics['photoDevelop.originalDigestMismatchCount'], 1);
	assert.equal(result.metrics['photoDevelop.latestFrameMismatchCount'], 5);
	assert.equal(result.diagnostics[0]!.observations.beforePixelMismatchCount, 7);
	assert.equal(createPendingLightscaperDevelopProxyResult(values, config()).metricGatePassed, false);
});

test('instrumented epochs retain honest correctness diagnostics but cannot qualify the registered uninstrumented timing profile', () => {
	const values = pair(); for (const value of values) {
		value.instrumentation = 'v8-browser'; value.protocol.caseDeadlineMs = 180_000;
	}
	const summary = summarize(values); assert.equal(summary.instrumentation, 'v8-browser');
	assert.equal(summary.protocol.caseDeadlineMs, 180_000);
	assert.equal(summary.metrics['photoDevelop.proxyPixelMismatchCount'], 0);
	const uninstrumented = pair(); for (const value of uninstrumented) value.protocol.caseDeadlineMs = 180_000;
	assert.throws(() => summarize(uninstrumented));
	for (const deadline of [0, 90_000, 90_001, 179_999, 180_001, Number.NaN, Number.POSITIVE_INFINITY]) {
		const invalid = pair(); for (const value of invalid) {
			value.instrumentation = 'v8-browser'; value.protocol.caseDeadlineMs = deadline;
		}
		assert.throws(() => summarize(invalid));
	}
	const mixed = pair(); mixed[1]!.instrumentation = 'v8-browser'; mixed[1]!.protocol.caseDeadlineMs = 180_000;
	assert.throws(() => summarize(mixed));
	assert.throws(() => createPendingLightscaperDevelopProxyResult(values, config()), /instrumentation/iu);
	assert.equal(createPendingLightscaperDevelopProxyResult(pair(), config()).metricGatePassed, true);
});

test('registered evaluation binds actual fixture and protocol and refuses missing or substituted measurements', () => {
	const value = config(); value.fixtures[0]!.specification.fixture.encodedSha256 = sha(99);
	assert.throws(() => createPendingLightscaperDevelopProxyResult(pair(), value), /fixture/iu);
	const missing = config(); missing.workloads[0]!.id = 'unregistered';
	assert.throws(() => createPendingLightscaperDevelopProxyResult(pair(), missing), /descriptor/iu);
	const swapped = config(), prior = swapped.measurements[0]!.id;
	swapped.measurements[0]!.id = 'unrelated'; swapped.thresholds[0]!.measurementId = 'unrelated';
	swapped.workloads[0]!.measurementIds = swapped.workloads[0]!.measurementIds.map(id => id === prior ? 'unrelated' : id);
	assert.throws(() => createPendingLightscaperDevelopProxyResult(pair(), swapped), /measurement/iu);
	let invoked = 0; const accessor = config(); Object.defineProperty(accessor, 'fixtures', { enumerable: true, get() { invoked++; return []; } });
	assert.throws(() => createPendingLightscaperDevelopProxyResult(pair(), accessor), /data/iu); assert.equal(invoked, 0);
});

test('the Lightscaper collector requires both locales and blocks correctness while observed slow timings only warn', () => {
	const collector = HOSTED_CI_COLLECTORS.find(value => value.diagnosticKey === 'l4-photo-develop-proxy-spatial');
	assert.ok(collector, 'The complete Lightscaper Develop proxy diagnostic must be registered.');
	assert.equal(collector.spec, 'tests/browser/lightscaper-develop-proxy-interaction.spec.js');
	assert.equal(collector.gate, 'blocking'); assert.equal(collector.rendererRequirement, 'any');
	assert.equal(collector.parse, parseLightscaperDevelopProxyDiagnostic); assert.equal(collector.evaluate, createPendingLightscaperDevelopProxyResult);
	const values = pair(); for (const value of values) {
		value.environmentId = HOSTED_CI_ENVIRONMENT_ID;
		for (const trial of value.observations.serialTrials.slice(1)) { trial.readyAtMs = trial.inputAtMs + 1999; trial.presentedAtMs = trial.inputAtMs + 2000; }
		for (const trial of value.observations.burstTrials.slice(1)) { trial.readyAtMs = trial.inputs[2]!.inputAtMs + 2999; trial.presentedAtMs = trial.inputs[2]!.inputAtMs + 3000; }
	}
	const run = (records: unknown[] = values) => createCiDiagnosticsReport({ consoleOutput: output(records), config: config(),
		sourceRevision: 'a'.repeat(40), playwrightExit: { code: 0, signal: null } }, { collectors: [collector] });
	const slow = run(); assert.equal(slow.passed, true); assert.equal(slow.report.workloads[0]?.status, 'warning');
	assert.equal(slow.report.warnings.length, 2); assert.equal(slow.report.failures.length, 0);
	assert.equal(slow.report.workloads[0]?.rendererClass, 'unknown'); assert.equal(slow.report.workloads[0]?.instrumentation, 'none');
	const raw = slow.raw.diagnostics as Readonly<Record<string, ReturnType<typeof parseLightscaperDevelopProxyDiagnostic>>>;
	assert.deepEqual(raw['l4-photo-develop-proxy-spatial']?.map(value => value.locale), ['en', 'de']);
	assert.equal(raw['l4-photo-develop-proxy-spatial']?.[1]?.observations.serialTrials.length, 6);
	values[1]!.observations.initialAfterActualSha256 = sha(99);
	const failed = run(); assert.equal(failed.passed, false); assert.equal(failed.report.workloads[0]?.status, 'failed');
	assert.equal(failed.report.workloads[0]?.metrics['photoDevelop.proxyPixelMismatchCount'], 1);
	assert.equal(failed.report.failures.length, 1); assert.equal(run(values.slice(0, 1)).passed, false);
});

test('the hosted runner injects the actual Light L4 environment label through its existing dependency seam', async () => {
	const collector = HOSTED_CI_COLLECTORS.find(value => value.diagnosticKey === 'l4-photo-develop-proxy-spatial'); assert.ok(collector);
	const directory = await mkdtemp(join(tmpdir(), 'lightscaper-develop-proxy-ci-'));
	const environments: Readonly<Record<string, string | undefined>>[] = [];
	try {
		const result = await collectCiDiagnostics({ outputDirectory: join(directory, 'run'), allowLocal: false }, {
			processEnvironment: { GITHUB_ACTIONS: 'true', GITHUB_SHA: 'a'.repeat(40), LIGHTSCAPER_L4_OBSERVED_ENVIRONMENT_ID: 'forged', preserved: 'unchanged' },
			collectors: [collector], config: config(),
			runPlaywright: (environment: Readonly<Record<string, string | undefined>>) => {
				environments.push(environment); const values = pair(); for (const value of values) value.environmentId = environment.LIGHTSCAPER_L4_OBSERVED_ENVIRONMENT_ID!;
				return Promise.resolve({ consoleOutput: output(values), exit: { code: 0, signal: null } });
			},
		});
		assert.equal(result.passed, true); assert.equal(environments.length, 1);
		assert.equal(environments[0]!.LIGHTSCAPER_L4_OBSERVED_ENVIRONMENT_ID, HOSTED_CI_ENVIRONMENT_ID);
		assert.equal(environments[0]!.preserved, 'unchanged'); assert.equal(environments[0]!.SCAPE_BROWSER_COVERAGE, undefined);
		const raw: unknown = JSON.parse(await readFile(join(directory, 'run', 'raw.json'), 'utf8'));
		assert.deepEqual(raw, result.raw);
	} finally { await rm(directory, { recursive: true, force: true }); }
});
