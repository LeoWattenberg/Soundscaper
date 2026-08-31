/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	createSoundscaperSoakSchedule,
	soundscaperSoakWatchdogSeconds,
	validateSoundscaperSoakConfig,
} from '../scripts/lib/soundscaper-soak-debug-config.mjs';
import {
	createSoundscaperSoakReport,
	readSoundscaperSoakJournal,
} from '../scripts/lib/soundscaper-soak-debug-report.mjs';
import {
	parseSoundscaperSoakArguments,
	runSoundscaperSoak,
} from '../scripts/run-soundscaper-soak.mjs';

const ROOT = new URL('../', import.meta.url);
const CONFIG = validateSoundscaperSoakConfig(JSON.parse(
	await readFile(new URL('config/soundscaper-soak-debug.json', ROOT), 'utf8'),
));

test('quick and extended schedules are deterministic and exercise only truthful operations', () => {
	const quick = createSoundscaperSoakSchedule(CONFIG, 'quick', 'browser');
	const repeated = createSoundscaperSoakSchedule(CONFIG, 'quick', 'browser');
	const extended = createSoundscaperSoakSchedule(CONFIG, 'extended', 'browser');

	assert.deepEqual(quick, repeated);
	assert.equal(CONFIG.profiles.quick.maximumDurationSeconds, 600);
	assert.equal(CONFIG.profiles.quick.warmupSeconds, 60);
	assert.equal(CONFIG.profiles.quick.sampleIntervalSeconds, 30);
	assert.equal(CONFIG.profiles.extended.durationSeconds, 28_800);
	assert.equal(CONFIG.profiles.extended.warmupSeconds, 1_800);
	assert.equal(CONFIG.profiles.extended.sampleIntervalSeconds, 300);
	assert.deepEqual(
		quick.filter(({ kind }) => kind === 'operation').map(({ operationId }) => operationId).sort(),
		CONFIG.operations.filter(({ targets }) => targets.includes('browser')).map(({ id }) => id).sort(),
	);
	assert.ok(quick.every(({ elapsedSeconds }) => elapsedSeconds >= 0
		&& elapsedSeconds <= CONFIG.profiles.quick.maximumDurationSeconds));
	assert.ok(quick.filter(({ kind }) => kind === 'operation')
		.every(({ elapsedSeconds }) => elapsedSeconds >= CONFIG.profiles.quick.warmupSeconds));
	assert.ok(quick.filter(({ kind }) => kind === 'sample')
		.every(({ elapsedSeconds }) => elapsedSeconds % CONFIG.profiles.quick.sampleIntervalSeconds === 0));
	assert.ok(extended.filter(({ kind }) => kind === 'operation').length
		> quick.filter(({ kind }) => kind === 'operation').length);
	assert.equal(extended.at(-1).kind, 'sample');
	assert.equal(extended.at(-1).elapsedSeconds, CONFIG.profiles.extended.durationSeconds);
	assert.equal(soundscaperSoakWatchdogSeconds(CONFIG, 'extended'), 28_860);
	assert.equal(soundscaperSoakWatchdogSeconds(CONFIG, 'quick'), 600);
	assert.deepEqual(CONFIG.operations.map(({ id }) => id), [
		'media-import', 'edit-history', 'simulated-record-playback', 'autosave-reload',
		'wav-render', 'foreign-project-custody',
		'decoded-media-probe', 'streamed-playback-diagnostics',
		'desktop-persistent-delivery-recovery', 'interrupted-take-recovery',
	]);
	assert.ok(['streamUnderrunFrames', 'streamedPlaybackObserved'].every((metricId) => (
		!CONFIG.unavailableMeasurements.some((measurement) => measurement.metricId === metricId)
	)));
	assert.ok(CONFIG.unavailableMeasurements.every(({ reason }) => reason.length >= 24));
	assert.doesNotMatch(JSON.stringify(CONFIG), /qualification|attestation|signature|trusted.?key/iu);
});

test('the CLI accepts the two targets and profiles without hidden qualification options', () => {
	assert.deepEqual(parseSoundscaperSoakArguments([
		'--target', 'both', '--profile', 'extended',
		'--output-directory', '/tmp/soak-output',
		'--desktop-executable', '/opt/Soundscaper',
		'--keep-profile-on-failure',
	]), {
		target: 'both',
		profile: 'extended',
		outputDirectory: '/tmp/soak-output',
		desktopExecutable: '/opt/Soundscaper',
		keepProfileOnFailure: true,
	});
	assert.deepEqual(parseSoundscaperSoakArguments([]), {
		target: 'browser',
		profile: 'quick',
		outputDirectory: 'test-results/soak',
		desktopExecutable: null,
		keepProfileOnFailure: false,
	});
	assert.throws(() => parseSoundscaperSoakArguments(['--target', 'lab']), /target/iu);
	assert.throws(() => parseSoundscaperSoakArguments(['--profile', 'qualification']), /profile/iu);
	assert.throws(() => parseSoundscaperSoakArguments(['--measurement', 'invented.json']), /unknown/iu);
});

test('reports retain measured values and explain every unavailable value', () => {
	const events = successfulEvents('browser', 'quick');
	const report = createSoundscaperSoakReport(CONFIG, events);

	assert.equal(report.status, 'warnings');
	assert.equal(report.exitCode, 0);
	assert.deepEqual(report.metrics.retainedJsHeapDeltaBytes, { value: 8_388_608, unit: 'bytes' });
	assert.equal(report.metrics.postWarmupHeapSlopeMibPerHour.value, null);
	assert.match(report.metrics.postWarmupHeapSlopeMibPerHour.reason, /extended/iu);
	assert.equal(report.metrics.electronWorkingSetDeltaBytes.value, null);
	assert.match(report.metrics.electronWorkingSetDeltaBytes.reason, /browser/iu);
	assert.equal(report.metrics.decodedMediaAvDriftMaximumMs.value, 4);
	assert.equal(report.metrics.decodedVideoDroppedFrames.value, 1);
	assert.equal(report.metrics.failedAutosaves.value, 0);
	assert.deepEqual(report.metrics.streamUnderrunFrames, { value: 0, unit: 'frames' });
	assert.deepEqual(report.metrics.streamedPlaybackObserved, { value: true, unit: 'boolean' });
	assert.deepEqual(report.samples.map(({ usedJsHeapBytes }) => usedJsHeapBytes), [
		100 * 1024 * 1024,
		108 * 1024 * 1024,
	]);
	assert.deepEqual(report.operations.results.map(({ operationId, status }) => ({ operationId, status })), [
		{ operationId: 'decoded-media-probe', status: 'passed' },
		{ operationId: 'autosave-reload', status: 'passed' },
		{ operationId: 'streamed-playback-diagnostics', status: 'passed' },
	]);
	assert.deepEqual(report.runtimeErrors, {
		pageCount: 0, consoleCount: 0, page: [], console: [], entriesTruncated: false,
	});
	for (const metric of Object.values(report.metrics)) {
		assert.equal(metric.value === null, typeof metric.reason === 'string');
	}
	assert.doesNotMatch(JSON.stringify(report), /qualified|accepted|evidencePublished/iu);
});

test('unsupported decoded-media counters stay null and retain their concrete reasons', () => {
	const events = successfulEvents('browser', 'quick');
	const probe = events.find(({ operationId }) => operationId === 'decoded-media-probe');
	probe.measurements = {
		decodedMediaAvDriftMaximumMs: null,
		decodedMediaAvDriftUnavailableReason: 'Video frame callbacks are unavailable.',
		decodedVideoDroppedFrames: null,
		decodedVideoDroppedFramesUnavailableReason: 'Playback quality counters are unavailable.',
	};
	const report = createSoundscaperSoakReport(CONFIG, events);
	assert.deepEqual(report.metrics.decodedMediaAvDriftMaximumMs, {
		value: null, reason: 'Video frame callbacks are unavailable.',
	});
	assert.deepEqual(report.metrics.decodedVideoDroppedFrames, {
		value: null, reason: 'Playback quality counters are unavailable.',
	});
	assert.deepEqual(report.operations.results[0].measurements, probe.measurements);
});

test('stream counters are never invented when streamed playback was not observed', () => {
	const events = successfulEvents('browser', 'quick').filter(({ operationId }) => (
		operationId !== 'streamed-playback-diagnostics'
	));
	const report = createSoundscaperSoakReport(CONFIG, events);
	assert.deepEqual(report.metrics.streamedPlaybackObserved, {
		value: null,
		reason: 'No Local Diagnostics streamed-playback observation completed in this run.',
	});
	assert.deepEqual(report.metrics.streamUnderrunFrames, {
		value: null,
		reason: 'No observed streamed-playback run exposed a Web Core underrun count.',
	});
});

test('threshold misses warn, operation failures fail, and interrupted journals stay incomplete', () => {
	const warnedConfig = structuredClone(CONFIG);
	warnedConfig.thresholds.find(({ metricId }) => metricId === 'retainedJsHeapDeltaBytes').value = 1;
	const warned = createSoundscaperSoakReport(
		validateSoundscaperSoakConfig(warnedConfig), successfulEvents('browser', 'quick'),
	);
	assert.equal(warned.status, 'warnings');
	assert.equal(warned.exitCode, 0);

	const failedEvents = successfulEvents('browser', 'quick');
	failedEvents.splice(-1, 0, event('operation', {
		operationId: 'edit-history', status: 'failed', durationMs: 20, reason: 'timed out',
	}));
	const failed = createSoundscaperSoakReport(CONFIG, failedEvents);
	assert.equal(failed.status, 'failed');
	assert.equal(failed.exitCode, 1);

	const incomplete = createSoundscaperSoakReport(CONFIG, successfulEvents('browser', 'quick').slice(0, -1));
	assert.equal(incomplete.status, 'incomplete');
	assert.equal(incomplete.exitCode, 2);
});

test('the append-only journal recovers complete rows and reports a torn final append', async (context) => {
	const directory = await temporaryDirectory(context);
	const path = join(directory, 'events.jsonl');
	await import('node:fs/promises').then(({ writeFile }) => writeFile(path,
		`${JSON.stringify({ ...event('run-start', { target: 'browser', profile: 'quick' }), sequence: 1 })}\n`
		+ `${JSON.stringify({ ...event('sample', sample(100)), sequence: 2 })}\n`
		+ '{"schemaVersion":1,"sequence":3',
	));
	const journal = await readSoundscaperSoakJournal(path);
	assert.equal(journal.events.length, 2);
	assert.equal(journal.truncatedFinalLine, true);
	assert.equal(journal.events[1].sequence, 2);
});

test('the runner writes real journals/reports, continues after a timed-out operation, and cleans up', async (context) => {
	const executed = [];
	const closed = [];
	const resets = [];
	let heap = 100 * 1024 * 1024;
	const directory = await temporaryDirectory(context);
	const result = await runSoundscaperSoak({
		target: 'both', profile: 'quick', outputDirectory: directory,
		desktopExecutable: '/fake/Soundscaper', keepProfileOnFailure: false,
	}, {
		config: CONFIG,
		clock: virtualClock(),
		openSession: async ({ target }) => ({
			async sample() {
				heap += 1024;
				return {
					usedJsHeapBytes: heap,
					forcedCollections: 3,
					electronWorkingSetBytes: target === 'desktop' ? 500 * 1024 * 1024 : null,
					electronWorkingSetUnavailableReason: target === 'desktop' ? null : 'Not an Electron target.',
				};
			},
			async execute(operationId) {
				executed.push(`${target}:${operationId}`);
				if (target === 'browser' && operationId === 'edit-history') {
					const error = new Error('operation exceeded its timeout');
					error.code = 'SOAK_OPERATION_TIMEOUT';
					throw error;
				}
				return operationId === 'decoded-media-probe'
					? { decodedMediaAvDriftMaximumMs: 3, decodedVideoDroppedFrames: 0 }
					: {};
			},
			async captureFailure() { return Buffer.from('bounded failure'); },
			async reset({ reason }) { resets.push({ target, reason }); },
			async close({ failed }) { closed.push({ target, failed }); },
		}),
	});

	assert.equal(result.exitCode, 1);
	assert.equal(result.runs.length, 2);
	assert.deepEqual(closed, [
		{ target: 'browser', failed: true },
		{ target: 'desktop', failed: false },
	]);
	assert.deepEqual(resets, [{ target: 'browser', reason: 'operation-timeout' }]);
	assert.ok(executed.some((value) => value.startsWith('desktop:')),
		'the desktop leg must still run after a browser operation times out');
	for (const run of result.runs) {
		const events = await readSoundscaperSoakJournal(join(run.outputDirectory, 'events.jsonl'));
		const report = JSON.parse(await readFile(join(run.outputDirectory, 'report.json'), 'utf8'));
		assert.equal(events.truncatedFinalLine, false);
		assert.equal(report.target, run.target);
		assert.ok(events.events.some(({ type }) => type === 'run-end'));
	}
	assert.ok(result.runs[0].failureArtifactCount <= CONFIG.artifacts.maximumFailureArtifacts);
});

test('bootstrap failures still produce an incomplete report and exit two', async (context) => {
	const directory = await temporaryDirectory(context);
	const result = await runSoundscaperSoak({
		target: 'desktop', profile: 'quick', outputDirectory: directory,
		desktopExecutable: '/missing/Soundscaper', keepProfileOnFailure: true,
	}, {
		config: CONFIG,
		clock: virtualClock(),
		openSession: async () => { throw Object.assign(new Error('cannot start app'), { code: 'ENOENT' }); },
	});
	assert.equal(result.exitCode, 2);
	assert.equal(result.runs[0].report.status, 'incomplete');
	assert.match(result.runs[0].report.incompleteReason, /cannot start app/iu);
});

test('interruptions are terminal incomplete events and renderer crashes are failed events', async (context) => {
	const interruptedDirectory = await temporaryDirectory(context);
	const controller = new AbortController();
	controller.abort(new Error('owner stopped the debugger'));
	const interrupted = await runSoundscaperSoak({
		target: 'browser', profile: 'quick', outputDirectory: interruptedDirectory,
		desktopExecutable: null, keepProfileOnFailure: false,
	}, {
		config: CONFIG,
		clock: virtualClock(),
		signal: controller.signal,
		openSession: async () => inertSession(),
	});
	assert.equal(interrupted.exitCode, 2);
	const interruptedJournal = await readSoundscaperSoakJournal(join(
		interrupted.runs[0].outputDirectory, 'events.jsonl',
	));
	assert.equal(interruptedJournal.events.at(-1).type, 'run-end');
	assert.equal(interruptedJournal.events.at(-1).outcome, 'interrupted');

	const crashedDirectory = await temporaryDirectory(context);
	const crashed = await runSoundscaperSoak({
		target: 'browser', profile: 'quick', outputDirectory: crashedDirectory,
		desktopExecutable: null, keepProfileOnFailure: false,
	}, {
		config: CONFIG,
		clock: virtualClock(),
		openSession: async () => ({
			...inertSession(),
			async sample() {
				throw Object.assign(new Error('renderer crashed'), { code: 'SOAK_RUNTIME_CRASH' });
			},
		}),
	});
	assert.equal(crashed.exitCode, 1);
	assert.equal(crashed.runs[0].report.status, 'failed');
	const crashedJournal = await readSoundscaperSoakJournal(join(
		crashed.runs[0].outputDirectory, 'events.jsonl',
	));
	assert.equal(crashedJournal.events.at(-1).outcome, 'crashed');
});

test('an actual operation timeout is journaled and later operations still execute', async (context) => {
	const timeoutConfig = structuredClone(CONFIG);
	timeoutConfig.operations.find(({ id }) => id === 'edit-history').timeoutSeconds = 1;
	const config = validateSoundscaperSoakConfig(timeoutConfig);
	const executed = [];
	let timedOutWorkAborted = false;
	let resetCount = 0;
	const directory = await temporaryDirectory(context);
	const result = await runSoundscaperSoak({
		target: 'browser', profile: 'quick', outputDirectory: directory,
		desktopExecutable: null, keepProfileOnFailure: false,
	}, {
		config,
		clock: virtualClock(),
		openSession: async () => ({
			async sample() { return sample(100 * 1024 * 1024); },
			async execute(operationId, { signal }) {
				executed.push(operationId);
				if (operationId === 'edit-history') return new Promise((resolvePromise, reject) => {
					signal.addEventListener('abort', () => {
						timedOutWorkAborted = true;
						reject(signal.reason);
					}, { once: true });
					void resolvePromise;
				});
				return operationId === 'decoded-media-probe'
					? { decodedMediaAvDriftMaximumMs: 1, decodedVideoDroppedFrames: 0 } : {};
			},
			async captureFailure() { return null; },
			async reset() { resetCount += 1; },
			async close() {},
		}),
	});
	assert.equal(result.exitCode, 1);
	assert.equal(timedOutWorkAborted, true);
	assert.equal(resetCount, 1);
	assert.ok(executed.indexOf('simulated-record-playback') > executed.indexOf('edit-history'));
	const timeout = result.runs[0].report.operations.results
		.find(({ operationId }) => operationId === 'edit-history');
	assert.equal(timeout.status, 'failed');
	assert.equal(timeout.code, 'SOAK_OPERATION_TIMEOUT');
});

function successfulEvents(target, profile) {
	return [
		event('run-start', { target, profile }),
		event('sample', sample(100 * 1024 * 1024)),
		event('sample', sample(108 * 1024 * 1024)),
		event('operation', {
			operationId: 'decoded-media-probe', status: 'passed', durationMs: 50,
			measurements: { decodedMediaAvDriftMaximumMs: 4, decodedVideoDroppedFrames: 1 },
		}),
		event('operation', {
			operationId: 'autosave-reload', status: 'passed', durationMs: 80, measurements: {},
		}),
		event('operation', {
			operationId: 'streamed-playback-diagnostics', status: 'passed', durationMs: 60,
			measurements: { streamUnderrunFrames: 0, streamedPlaybackObserved: true },
		}),
		event('run-end', { outcome: 'completed', durationMs: 90_000 }),
	];
}

function event(type, values) {
	return { schemaVersion: 1, sequence: 0, occurredAt: '2026-08-31T10:00:00.000Z',
		monotonicMs: 0, type, ...values };
}

function sample(usedJsHeapBytes) {
	return {
		usedJsHeapBytes, forcedCollections: 3,
		electronWorkingSetBytes: null,
		electronWorkingSetUnavailableReason: 'Browser runs have no Electron process.',
	};
}

function virtualClock() {
	let elapsedMs = 0;
	let wallMs = Date.parse('2026-08-31T10:00:00.000Z');
	return {
		now: () => new Date(wallMs),
		monotonicNow: () => elapsedMs,
		async sleep(milliseconds) { elapsedMs += milliseconds; wallMs += milliseconds; },
	};
}

function inertSession() {
	return {
		async sample() { return sample(100 * 1024 * 1024); },
		async execute() { return {}; },
		async captureFailure() { return null; },
		async reset() {},
		async close() {},
	};
}

async function temporaryDirectory(context) {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-soak-debug-test-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	return directory;
}
