/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createCiDiagnosticsReport, HOSTED_CI_COLLECTORS } from '../scripts/lib/ci-diagnostics.mjs';
import {
	createPendingLightscaperLargeLibraryResult,
	parseLightscaperLargeLibraryDiagnostic,
} from '../scripts/lib/lightscaper-large-library-diagnostics-v1.ts';
import { PHOTO_LARGE_LIBRARY_SPECIFICATION_V1 as SPEC } from '../src/lightscaper/quality/large-library-workload-v1.ts';

const config: unknown = JSON.parse(await readFile(new URL('../config/quality-budgets.json', import.meta.url), 'utf8'));
function diagnostic() {
	return {
		schemaVersion: 1, profile: 'deterministic-photo-library-20000-v1', workloadId: 'l3-photo-library-large', fixtureId: SPEC.id,
		fixture: { ...SPEC }, environmentId: 'local-runtime-diagnostics', browser: { name: 'chromium', version: '140.0.0' }, rendererClass: 'browser-2d',
		observations: {
			fixture: { photoCount: 20_000, maximumPublishedBatchPhotos: 16, sourceByteLength: 163, originalActualSha256: SPEC.sourceSha256 as string },
			importTrials: Array.from({ length: 6 }, (_, trial) => ({ trial, elapsedMs: trial === 0 ? 99_999 : trial * 10,
				beforeCount: 20_000 + 64 * trial, afterCount: 20_064 + 64 * trial, importedCount: 64 })),
			scrollTrials: Array.from({ length: 6 }, (_, trial) => ({ trial, frameIntervalsMs: Array.from({ length: 32 }, () => trial === 0 ? 99_999 : trial),
				renderedPhotoCount: 64, scrollDistancePx: 1_000 })),
			filterTrials: Array.from({ length: 6 }, (_, trial) => ({ trial, elapsedMs: trial === 0 ? 99_999 : trial * 20,
				resultFirstPhotoId: 'large-photo-00000' as string | null, resultCount: 32 })),
			searchTrials: Array.from({ length: 6 }, (_, trial) => ({ trial, elapsedMs: trial === 0 ? 99_999 : trial * 30,
				resultPhotoId: 'large-photo-19999' as string | null, resultCount: 1 })),
			query: { maximumCandidatePhotos: 64, steps: 319, matches: 1, resultId: 'large-photo-19999' as string | null },
		},
	};
}
function evaluate(value: unknown = diagnostic()) { return createPendingLightscaperLargeLibraryResult(value, config); }
function consoleLine(value: unknown = diagnostic()) { return `[browser] ${JSON.stringify(value)}\n`; }

test('one exact diagnostic recomputes all nine metrics using five measured trials and 160 measured frame intervals', () => {
	const result = evaluate(parseLightscaperLargeLibraryDiagnostic(`Playwright started\n${consoleLine()}finished\n`));
	assert.deepEqual(result.metrics, {
		'photoLibrary.resultMismatchCount': 0, 'photoLibrary.originalDigestMismatchCount': 0,
		'photoLibrary.maximumRenderedPhotos': 64, 'photoLibrary.maximumPublishedBatchPhotos': 16, 'photoLibrary.maximumCandidatePhotos': 64,
		'photoLibrary.importP95Ms': 50, 'photoLibrary.scrollFrameIntervalP95Ms': 5, 'photoLibrary.filterP95Ms': 100, 'photoLibrary.searchP95Ms': 150,
	});
	assert.equal(result.metricGatePassed, true); assert.equal(result.status, 'passed');
	assert.deepEqual(result.rawSampleCounts, { warmupTrials: 1, measuredTrials: 5, scrollFrameIntervals: 160 });
	assert.deepEqual(result.browser, { name: 'chromium', version: '140.0.0' });
	assert.equal(Object.isFrozen(result.metrics), true); assert.equal(Object.isFrozen(result.fixture), true);
	assert.equal(result.attemptCount, 1); assert.equal(result.retryCount, 0);
});

test('nearest-rank scroll p95 is computed over all measured intervals rather than trial medians or warmup', () => {
	const value = diagnostic();
	for (const trial of value.observations.scrollTrials.slice(1)) trial.frameIntervalsMs.fill(1);
	value.observations.scrollTrials[5]!.frameIntervalsMs.fill(50, 23);
	assert.equal(evaluate(value).metrics['photoLibrary.scrollFrameIntervalP95Ms'], 50);
	value.observations.scrollTrials[5]!.frameIntervalsMs[23] = 1;
	assert.equal(evaluate(value).metrics['photoLibrary.scrollFrameIntervalP95Ms'], 1);
});

test('each real count, sequence and result mismatch survives as a blocking numerical failure', () => {
	const mutations: Array<(value: ReturnType<typeof diagnostic>) => void> = [
		value => { value.observations.fixture.photoCount--; },
		value => { value.observations.fixture.sourceByteLength++; },
		value => { value.observations.importTrials[0]!.importedCount--; },
		value => { value.observations.importTrials[2]!.beforeCount++; },
		value => { value.observations.importTrials[5]!.afterCount--; },
		value => { value.observations.filterTrials[0]!.resultFirstPhotoId = null; },
		value => { value.observations.filterTrials[3]!.resultCount = 31; },
		value => { value.observations.searchTrials[0]!.resultPhotoId = 'wrong-photo'; },
		value => { value.observations.searchTrials[5]!.resultCount = 0; },
		value => { value.observations.query.matches = 0; },
		value => { value.observations.query.resultId = null; },
		value => { value.observations.query.steps = 300; },
	];
	for (const mutate of mutations) {
		const value = diagnostic(); mutate(value); const result = evaluate(value);
		assert.equal(result.metrics['photoLibrary.resultMismatchCount'], 1);
		assert.equal(result.metricGatePassed, false); assert.equal(result.evaluation.failures.length, 1);
	}
	const value = diagnostic(); for (const mutate of mutations) mutate(value);
	assert.equal(evaluate(value).metrics['photoLibrary.resultMismatchCount'], mutations.length);
});

test('complete fixed-size photo-ID search requires exactly 319 steps; truncated and repeated candidate scans block', () => {
	for (const steps of [0, 300, 301, 318, 320, 321]) {
		const value = diagnostic(); value.observations.query.steps = steps;
		const result = evaluate(value);
		assert.equal(result.metrics['photoLibrary.resultMismatchCount'], 1, String(steps));
		assert.equal(result.metricGatePassed, false);
	}
	assert.equal(evaluate().metrics['photoLibrary.resultMismatchCount'], 0);
});

test('the complete native scan must actually reach its 64-candidate page capacity', () => {
	for (const maximum of [0, 1, 32, 63]) {
		const value = diagnostic(); value.observations.query.maximumCandidatePhotos = maximum;
		const result = evaluate(value);
		assert.equal(result.metrics['photoLibrary.resultMismatchCount'], 1, String(maximum));
		assert.equal(result.metricGatePassed, false); assert.equal(result.evaluation.failures.length, 1);
	}
	const exceeded = diagnostic(); exceeded.observations.query.maximumCandidatePhotos = 65;
	const result = evaluate(exceeded); assert.equal(result.metricGatePassed, false);
	assert.equal(result.metrics['photoLibrary.maximumCandidatePhotos'], 65); assert.equal(result.evaluation.failures.length, 1);
});

test('digest and working-set violations block while all four finite slow timing metrics warn', () => {
	const value = diagnostic(); value.observations.fixture.originalActualSha256 = 'a'.repeat(64);
	value.observations.fixture.maximumPublishedBatchPhotos = 17;
	value.observations.scrollTrials[0]!.renderedPhotoCount = 65;
	value.observations.query.maximumCandidatePhotos = 65;
	const result = evaluate(value);
	assert.equal(result.metrics['photoLibrary.originalDigestMismatchCount'], 1);
	assert.equal(result.metrics['photoLibrary.maximumRenderedPhotos'], 65);
	assert.equal(result.evaluation.failures.length, 4);
	const slow = diagnostic();
	for (const trial of slow.observations.importTrials) trial.elapsedMs = 1_000_000;
	for (const trial of slow.observations.scrollTrials) trial.frameIntervalsMs.fill(1_000_000);
	for (const trial of slow.observations.filterTrials) trial.elapsedMs = 1_000_000;
	for (const trial of slow.observations.searchTrials) trial.elapsedMs = 1_000_000;
	assert.equal(evaluate(slow).metricGatePassed, true); assert.equal(evaluate(slow).evaluation.warnings.length, 4);
});

test('the actual hosted collector retains raw errors and separates blocking failures from finite timing warnings', () => {
	const collector = HOSTED_CI_COLLECTORS.find(value => value.diagnosticKey === 'l3-photo-library-large'); assert.ok(collector);
	const value = diagnostic(); value.environmentId = 'github-ubuntu-playwright-1.62.1';
	for (const trial of value.observations.importTrials) trial.elapsedMs = 1_000_000;
	const run = () => createCiDiagnosticsReport({ consoleOutput: consoleLine(value), config: config as object,
		sourceRevision: 'b'.repeat(40), playwrightExit: { code: 0, signal: null } }, { collectors: [collector] });
	const slow = run(); assert.equal(slow.passed, true); assert.equal(slow.report.workloads[0]?.status, 'warning');
	assert.equal(slow.report.warnings.length, 1); assert.equal(slow.report.failures.length, 0);
	value.observations.searchTrials[2]!.resultPhotoId = null;
	const failed = run(); assert.equal(failed.passed, false); assert.equal(failed.report.workloads[0]?.status, 'failed');
	assert.equal(failed.report.workloads[0]?.metrics['photoLibrary.resultMismatchCount'], 1);
	const raw = failed.raw.diagnostics as Readonly<Record<string, ReturnType<typeof parseLightscaperLargeLibraryDiagnostic>>>;
	assert.equal(raw['l3-photo-library-large']?.observations.searchTrials[2]?.resultPhotoId, null);
});

test('all frozen fixture and environment identities are checked and no precomputed metrics are admitted', () => {
	for (const key of Object.keys(SPEC)) {
		const value = diagnostic(); Object.defineProperty(value.fixture, key, { value: 'forged' });
		assert.throws(() => evaluate(value), /fixture/iu, key);
	}
	for (const [key, value] of [['schemaVersion', 2], ['profile', 'future'], ['workloadId', 'other'], ['fixtureId', 'other'],
		['environmentId', 'unknown'], ['rendererClass', 'hardware']] as const) {
		assert.throws(() => evaluate({ ...diagnostic(), [key]: value }));
	}
	assert.throws(() => evaluate({ ...diagnostic(), metrics: {} }), /unsupported/iu);
	for (const name of ['chromium', 'firefox']) {
		const value = diagnostic(); value.browser.name = name; value.environmentId = 'github-ubuntu-playwright-1.62.1';
		assert.equal(evaluate(value).metricGatePassed, true);
	}
	for (const browser of [{ name: 'webkit', version: '1' }, { name: 'chromium', version: '' },
		{ name: 'chromium', version: 'v'.repeat(129) }]) assert.throws(() => evaluate({ ...diagnostic(), browser }));
});

test('unknown, missing, sparse, reordered, duplicate, nonfinite and oversized records fail closed', () => {
	const mutations: Array<(value: ReturnType<typeof diagnostic>) => void> = [
		value => { Object.assign(value.observations, { extra: 1 }); },
		value => { Reflect.deleteProperty(value.observations, 'query'); },
		value => { value.observations.importTrials.pop(); },
		value => { value.observations.importTrials.push(value.observations.importTrials[0]!); },
		value => { Reflect.deleteProperty(value.observations.importTrials, '2'); },
		value => { value.observations.importTrials[2]!.trial = 1; },
		value => { value.observations.importTrials[2]!.elapsedMs = NaN; },
		value => { value.observations.filterTrials[0]!.elapsedMs = Infinity; },
		value => { value.observations.searchTrials[4]!.elapsedMs = -1; },
		value => { value.observations.scrollTrials[0]!.scrollDistancePx = 0; },
		value => { value.observations.scrollTrials[0]!.frameIntervalsMs.pop(); },
		value => { value.observations.scrollTrials[3]!.frameIntervalsMs[1] = 0; },
		value => { value.observations.scrollTrials[3]!.frameIntervalsMs[1] = Infinity; },
		value => { value.observations.query.steps = 322; },
		value => { value.observations.query.matches = 1.5; },
		value => { value.observations.query.resultId = 'x'.repeat(129); },
		value => { value.observations.fixture.originalActualSha256 = 'invalid'; },
	];
	for (const mutate of mutations) { const value = diagnostic(); mutate(value); assert.throws(() => evaluate(value)); }
	const future = diagnostic(); Object.defineProperty(future, 'schemaVersion', { value: 2 });
	Object.defineProperty(future, 'observations', { get: () => { assert.fail('future observations traversed'); } });
	assert.throws(() => evaluate(future));
});

test('descriptor-safe records, array entries and config snapshots never invoke caller get traps', () => {
	let getters = 0;
	const trap = { get: () => { getters++; throw new Error('Hostile get trap'); } };
	const value = diagnostic(); value.observations.importTrials = new Proxy(value.observations.importTrials, trap);
	value.observations = new Proxy(value.observations, trap);
	assert.equal(evaluate(new Proxy(value, trap)).metricGatePassed, true);
	assert.equal(createPendingLightscaperLargeLibraryResult(diagnostic(), new Proxy(config as object, trap)).metricGatePassed, true);
	const accessor = diagnostic(); Object.defineProperty(accessor.observations.importTrials[0], 'elapsedMs', {
		enumerable: true, get: () => { getters++; return 0; },
	});
	assert.throws(() => evaluate(accessor));
	const array = diagnostic(); Object.defineProperty(array.observations.searchTrials, '0', {
		enumerable: true, get: () => { getters++; return {}; },
	});
	assert.throws(() => evaluate(array)); assert.equal(getters, 0);
});

test('all nested observation records detach through inert descriptors, and foreign behavior is refused', () => {
	let getters = 0;
	function wrap(value: unknown): unknown {
		if (!value || typeof value !== 'object') return value;
		const detached = Array.isArray(value) ? value.map(wrap) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, wrap(item)]));
		return new Proxy(detached, { get: () => { getters++; throw new Error('Nested get trap'); } });
	}
	assert.equal(evaluate(wrap(diagnostic())).metricGatePassed, true); assert.equal(getters, 0);
	const value = diagnostic(); Object.defineProperty(value.observations.scrollTrials[0]!.frameIntervalsMs, Symbol.iterator, {
		get: () => { getters++; throw new Error('Iterator getter'); },
	});
	assert.throws(() => evaluate(value), /unsupported/iu); assert.equal(getters, 0);
	assert.throws(() => evaluate(Object.assign(Object.create({ inherited: true }) as object, diagnostic())), /plain/iu);
	assert.throws(() => createPendingLightscaperLargeLibraryResult(diagnostic(), { oversized: Array.from({ length: 4_097 }, () => 1) }), /bound/iu);
	assert.throws(() => createPendingLightscaperLargeLibraryResult(diagnostic(), { oversized: 'x'.repeat(8 * 1024 * 1024 + 1) }), /bound/iu);
});

test('deterministic raw-duration variations independently qualify all nearest-rank computations', () => {
	let seed = 26_510;
	const next = () => { seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0; return seed % 50_000 + 1; };
	const percentile = (values: number[]) => [...values].sort((left, right) => left - right)[Math.ceil(values.length * 0.95) - 1];
	for (let iteration = 0; iteration < 32; iteration++) {
		const value = diagnostic();
		for (const trial of value.observations.importTrials) trial.elapsedMs = next();
		for (const trial of value.observations.filterTrials) trial.elapsedMs = next();
		for (const trial of value.observations.searchTrials) trial.elapsedMs = next();
		for (const trial of value.observations.scrollTrials) trial.frameIntervalsMs = Array.from({ length: 32 }, next);
		const result = evaluate(parseLightscaperLargeLibraryDiagnostic(consoleLine(value)));
		assert.equal(result.metrics['photoLibrary.importP95Ms'], percentile(value.observations.importTrials.slice(1).map(trial => trial.elapsedMs)));
		assert.equal(result.metrics['photoLibrary.filterP95Ms'], percentile(value.observations.filterTrials.slice(1).map(trial => trial.elapsedMs)));
		assert.equal(result.metrics['photoLibrary.searchP95Ms'], percentile(value.observations.searchTrials.slice(1).map(trial => trial.elapsedMs)));
		assert.equal(result.metrics['photoLibrary.scrollFrameIntervalP95Ms'], percentile(value.observations.scrollTrials.slice(1).flatMap(trial => trial.frameIntervalsMs)));
		assert.equal(result.metrics['photoLibrary.resultMismatchCount'], 0);
	}
});

test('console parsing rejects missing, duplicate, malformed, duplicate-key and excessive diagnostics', () => {
	assert.throws(() => parseLightscaperLargeLibraryDiagnostic('no diagnostic'), /exactly one/iu);
	assert.throws(() => parseLightscaperLargeLibraryDiagnostic(consoleLine() + consoleLine()), /exactly one/iu);
	assert.throws(() => parseLightscaperLargeLibraryDiagnostic('{"workloadId":"l3-photo-library-large",bad}'));
	const line = consoleLine().replace('"schemaVersion":1', '"schemaVersion":2,"schemaVersion":1');
	assert.throws(() => parseLightscaperLargeLibraryDiagnostic(line), /duplicate/iu);
	const escaped = consoleLine().replace('"trial":0', '"tr\\u0069al":9,"trial":0');
	assert.throws(() => parseLightscaperLargeLibraryDiagnostic(escaped), /duplicate/iu);
	assert.throws(() => parseLightscaperLargeLibraryDiagnostic('x'.repeat(16 * 1024 * 1024 + 1)), /bound/iu);
	assert.throws(() => parseLightscaperLargeLibraryDiagnostic(consoleLine().trimEnd() + ' '.repeat(65_536)), /bound/iu);
});

test('admitted diagnostics detach and freeze all caller-owned observations', () => {
	const value = diagnostic(); const admitted = parseLightscaperLargeLibraryDiagnostic(consoleLine(value));
	value.observations.importTrials[1]!.elapsedMs = 500_000;
	assert.equal(evaluate(admitted).metrics['photoLibrary.importP95Ms'], 50);
	assert.equal(Object.isFrozen(admitted.observations.importTrials), true);
	assert.equal(Object.isFrozen(admitted.observations.importTrials[0]), true);
	const cyclic: Record<string, unknown> = {}; cyclic.config = cyclic;
	assert.throws(() => createPendingLightscaperLargeLibraryResult(diagnostic(), cyclic), /bound/iu);
});
