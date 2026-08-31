/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
	createPendingM3LongformEditorialResult,
	parseM3LongformEditorialDiagnostic,
} from '../collect-m3-longform-editorial-quality.mjs';
import {
	createPendingM4ProductionParityResult,
	parseM4ProductionParityDiagnostic,
} from '../collect-m4-production-parity-quality.mjs';
import {
	createPendingM4B2KeyframeParityResult,
	parseM4B2KeyframeParityDiagnostic,
} from '../collect-m4b2-keyframe-parity-quality.mjs';
const DEFAULT_COLLECTORS = Object.freeze([
	collector(
		'm3-longform-editorial',
		parseM3LongformEditorialDiagnostic,
		createPendingM3LongformEditorialResult,
		(result) => result.metricGatePassed === true,
	),
	collector(
		'm1-video-preview-12fx-720p',
		parseM1VideoPreviewDiagnostic,
		createPendingM1VideoPreviewResult,
		(result) => result.metricGatePassed === true,
	),
	collector(
		'm4-production-parity',
		parseM4ProductionParityDiagnostic,
		createPendingM4ProductionParityResult,
		(result) => result.metricGatePassed === true,
	),
	collector(
		'm4b2-keyframe-render-parity',
		parseM4B2KeyframeParityDiagnostic,
		createPendingM4B2KeyframeParityResult,
		(result) => result.metricGatePassed === true,
	),
]);

export function createDesktopNightlyTestsMetricsPlan({
	executablePath,
	payloadRoot,
	runRoot,
	baseURL,
	esbuildBinaryPath = null,
	environment = process.env,
} = {}) {
	for (const [value, label] of [
		[executablePath, 'Desktop nightly metrics executable path'],
		[payloadRoot, 'Desktop nightly metrics payload root'],
		[runRoot, 'Desktop nightly metrics run root'],
	]) assertAbsolutePath(value, label);
	if (esbuildBinaryPath !== null) assertAbsolutePath(esbuildBinaryPath, 'Desktop nightly metrics esbuild binary path');
	assertLoopbackBaseUrl(baseURL);
	return Object.freeze({
		command: executablePath,
		args: Object.freeze([
			join(payloadRoot, 'node_modules/@playwright/test/cli.js'),
			'test',
			'--config',
			join(payloadRoot, 'playwright.nightly-metrics.config.mjs'),
		]),
		cwd: payloadRoot,
		env: Object.freeze({
			...environment,
			ELECTRON_RUN_AS_NODE: '1',
			PLAYWRIGHT_BROWSERS_PATH: join(payloadRoot, '.local-browsers'),
			PLAYWRIGHT_HTML_OPEN: 'never',
			...(esbuildBinaryPath === null ? {} : { ESBUILD_BINARY_PATH: esbuildBinaryPath }),
			SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL: baseURL,
			SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: payloadRoot,
			SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot,
			AUDIO_EDITOR_FFMPEG_BROWSER: '1',
			GITHUB_ACTIONS: 'false',
			SOUNDSCAPER_M3_LONGFORM_BENCHMARK: '1',
			SOUNDSCAPER_M3_OBSERVED_ENVIRONMENT_ID: 'local-browser-correctness',
			SOUNDSCAPER_M1_OBSERVED_ENVIRONMENT_ID: 'local-browser-correctness',
			SOUNDSCAPER_M4B2_KEYFRAME_PARITY: '1',
			SOUNDSCAPER_M4_OBSERVED_ENVIRONMENT_ID: 'local-browser-correctness',
			SOUNDSCAPER_M4_PRODUCTION_PARITY: '1',
			SOUNDSCAPER_VIDEO_PREVIEW_BENCHMARK: '1',
		}),
		logFile: join(runRoot, 'metrics/console.log'),
	});
}

export function parseM1VideoPreviewDiagnostic(output) {
	if (typeof output !== 'string') throw new TypeError('M1 preview diagnostic output must be a string.');
	const marker = 'SOUNDSCAPER_VIDEO_PREVIEW_BENCHMARK ';
	const matches = [];
	for (const line of output.split(/\r?\n/u)) {
		const at = line.indexOf(marker);
		if (at < 0) continue;
		try { matches.push(JSON.parse(line.slice(at + marker.length))); }
		catch (error) { throw new Error('M1 preview diagnostic marker has malformed JSON.', { cause: error }); }
	}
	if (matches.length !== 1) {
		throw new Error(`Expected exactly one M1 video preview diagnostic; received ${String(matches.length)}.`);
	}
	return matches[0];
}

export function createPendingM1VideoPreviewResult(diagnosticValue, configValue) {
	const diagnostic = requireRecord(diagnosticValue, 'M1 preview diagnostic');
	const config = requireRecord(configValue, 'quality config');
	const fixture = exactDescriptor(config.fixtures, 'video-preview-12fx-720p-v1', 'fixture');
	const workload = exactDescriptor(config.workloads, 'm1-video-preview-12fx-720p', 'workload');
	const specification = requireRecord(fixture.specification, 'M1 preview fixture specification');
	const expectedIdentity = {
		schemaVersion: 1,
		profile: 'deterministic-video-preview-12fx-v2',
		observationClass: 'fresh-context-presentation-cadence-and-retained-js-heap-v1',
		workloadId: 'm1-video-preview-12fx-720p',
		fixtureId: 'video-preview-12fx-720p-v1',
	};
	for (const [field, expected] of Object.entries(expectedIdentity)) {
		if (diagnostic[field] !== expected) throw new Error(`M1 preview diagnostic ${field} is invalid.`);
	}
	if (!isDeepStrictEqual(diagnostic.fixture, specification)) {
		throw new Error('M1 preview diagnostic fixture does not match the registered specification.');
	}
	const expectedSampling = {
		warmupTrials: 1,
		measuredTrials: 5,
		measuredFramesPerTrial: 121,
		measuredIntervalsPerTrial: 120,
		forcedCollectionsPerSnapshot: 3,
	};
	if (!isDeepStrictEqual(diagnostic.sampling, expectedSampling)) {
		throw new Error('M1 preview diagnostic does not use one warmup and five measured fresh-context trials.');
	}
	if (!Array.isArray(diagnostic.trials) || diagnostic.trials.length !== 5) {
		throw new Error('M1 preview diagnostic must retain five measured trials.');
	}
	const environmentFingerprint = packagedRuntimeFingerprint(diagnostic.environmentFingerprint);
	const observedRendererClass = rendererClass(environmentFingerprint);
	if (diagnostic.rendererClass !== observedRendererClass) {
		throw new Error('M1 preview diagnostic renderer class does not match its packaged-runtime fingerprint.');
	}
	if (typeof diagnostic.environmentId !== 'string' || diagnostic.environmentId.length < 1) {
		throw new Error('M1 preview diagnostic environment ID is unavailable.');
	}
	const frameIntervals = [];
	const retainedHeapDeltas = [];
	for (let trialIndex = 0; trialIndex < diagnostic.trials.length; trialIndex += 1) {
		const trial = requireRecord(diagnostic.trials[trialIndex], `M1 preview trial ${String(trialIndex + 1)}`);
		if (trial.trial !== trialIndex + 1) throw new Error('M1 preview trial ordinals are invalid.');
		if (!Array.isArray(trial.frameTimestampsMs) || trial.frameTimestampsMs.length !== 121
			|| trial.frameTimestampsMs.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
			throw new Error('Every M1 preview trial must retain 121 finite frame timestamps.');
		}
		for (let frameIndex = 1; frameIndex < trial.frameTimestampsMs.length; frameIndex += 1) {
			const interval = trial.frameTimestampsMs[frameIndex] - trial.frameTimestampsMs[frameIndex - 1];
			if (!Number.isFinite(interval) || interval <= 0) {
				throw new Error('M1 preview frame timestamps must be strictly increasing.');
			}
			frameIntervals.push(interval);
		}
		if (trial.forcedCollectionsBefore !== 3 || trial.forcedCollectionsAfter !== 3) {
			throw new Error('Every M1 preview heap snapshot must follow three forced collections.');
		}
		const heapBefore = heapSnapshot(trial.heapBefore, 'M1 preview heap-before snapshot');
		const heapAfter = heapSnapshot(trial.heapAfter, 'M1 preview heap-after snapshot');
		retainedHeapDeltas.push(heapAfter.usedSize - heapBefore.usedSize);
	}
	const metrics = Object.freeze({
		'preview.frameIntervalP95Ms': roundedMetric(nearestRankP95(frameIntervals)),
		'preview.retainedJsHeapDeltaBytes': roundedMetric(nearestRankP95(retainedHeapDeltas)),
	});
	if (!Array.isArray(workload.thresholds) || workload.thresholds.length !== 2) {
		throw new Error('M1 preview workload must register exactly two thresholds.');
	}
	const verdicts = workload.thresholds.map((thresholdValue) => {
		const threshold = requireRecord(thresholdValue, 'M1 preview threshold');
		const actual = metrics[threshold.metricId];
		if (typeof actual !== 'number' || threshold.comparison !== 'lte'
			|| typeof threshold.value !== 'number' || !Number.isFinite(threshold.value)) {
			throw new Error('M1 preview threshold registration is invalid.');
		}
		return Object.freeze({
			metricId: threshold.metricId,
			comparison: threshold.comparison,
			expected: threshold.value,
			actual,
			passed: actual <= threshold.value,
		});
	});
	const metricGatePassed = verdicts.every(({ passed }) => passed);
	return Object.freeze({
		schemaVersion: 1,
		status: metricGatePassed ? 'passed' : 'failed',
		workloadId: 'm1-video-preview-12fx-720p',
		fixtureId: 'video-preview-12fx-720p-v1',
		profile: expectedIdentity.profile,
		observationClass: expectedIdentity.observationClass,
		environmentId: diagnostic.environmentId,
		attemptCount: 1,
		retryCount: 0,
		rendererClass: observedRendererClass,
		environmentFingerprint,
		fixture: Object.freeze({ ...specification }),
		metrics,
		rawSampleCounts: Object.freeze({
			warmupTrials: 1,
			measuredTrials: diagnostic.trials.length,
			measuredFrames: diagnostic.trials.length * 121,
			measuredIntervals: frameIntervals.length,
			forcedCollectionsBefore: diagnostic.trials.length * 3,
			forcedCollectionsAfter: diagnostic.trials.length * 3,
			heapSnapshotsBefore: diagnostic.trials.length,
			heapSnapshotsAfter: diagnostic.trials.length,
		}),
		metricGatePassed,
		evaluation: Object.freeze({
			passed: metricGatePassed,
			failures: Object.freeze(metricGatePassed ? [] : verdicts
				.filter(({ passed }) => !passed)
				.map(({ metricId }) => `${metricId} did not pass.`)),
			verdicts: Object.freeze(verdicts),
		}),
	});
}

export function createDesktopNightlyTestsMetricsEvidence({
	consoleOutput,
	config,
	sourceRevision,
	budgetSha256,
	playwrightExit,
}, dependencies = {}) {
	if (typeof consoleOutput !== 'string') throw new TypeError('Nightly metrics console output must be a string.');
	if (!isRecord(config)) throw new TypeError('Nightly metrics quality config must be a plain record.');
	if (sourceRevision !== null && !/^[a-f\d]{40}$/u.test(sourceRevision)) {
		throw new TypeError('Nightly metrics source revision must be a lowercase 40-character Git SHA.');
	}
	if (typeof budgetSha256 !== 'string' || !/^[a-f\d]{64}$/u.test(budgetSha256)) {
		throw new TypeError('Nightly metrics budget digest must be SHA-256.');
	}
	const collectors = dependencies.collectors ?? DEFAULT_COLLECTORS;
	const evidenceKind = dependencies.evidenceKind ?? 'browser';
	if (!['browser', 'packaged-runtime'].includes(evidenceKind)) {
		throw new TypeError('Nightly metrics evidence kind is invalid.');
	}
	const kindSuffix = evidenceKind === 'browser' ? '' : '-packaged-runtime';
	const failures = playwrightFailures(playwrightExit);
	const diagnostics = {};
	const workloads = [];
	for (const current of collectors) {
		try {
			const diagnostic = current.parse(consoleOutput);
			diagnostics[current.workloadId] = diagnostic;
			const evaluated = current.evaluate(diagnostic, config);
			const metricGatePassed = current.metricGatePassed(evaluated);
			if (!metricGatePassed) failures.push(`${current.workloadId} did not pass its metric thresholds.`);
			workloads.push(normalizeDiagnosticResult(evaluated, metricGatePassed));
		} catch (error) {
			failures.push(`${current.workloadId}: ${message(error)}`);
		}
	}
	const collectionPassed = failures.length === 0 && workloads.length === collectors.length;
	const raw = Object.freeze({
		schemaVersion: 1,
		kind: `soundscaper-desktop-nightly${kindSuffix}-metrics-raw`,
		executionSurface: evidenceKind,
		sourceRevision,
		budgetSha256,
		diagnostics: Object.freeze(diagnostics),
	});
	const summary = Object.freeze({
		schemaVersion: 1,
		kind: `soundscaper-desktop-nightly${kindSuffix}-metrics`,
		executionSurface: evidenceKind,
		sourceRevision,
		budgetSha256,
		attemptCount: 1,
		retryCount: 0,
		workerCount: 1,
		collectionPassed,
		workloads: Object.freeze(workloads),
		failures: Object.freeze(failures),
	});
	return Object.freeze({
		passed: collectionPassed,
		raw,
		summary,
	});
}

export async function writeDesktopNightlyTestsMetricsDiagnostics({
	payloadRoot,
	runRoot,
	sourceRevision,
	playwrightExit,
	consoleLogPath = join(runRoot, 'metrics/console.log'),
	artifactDirectory = 'metrics',
	evidenceKind = 'browser',
}, dependencies = {}) {
	assertAbsolutePath(payloadRoot, 'Desktop nightly metrics payload root');
	assertAbsolutePath(runRoot, 'Desktop nightly metrics run root');
	const configPath = join(payloadRoot, 'config/quality-budgets.json');
	const [consoleOutput, configBytes] = await Promise.all([
		readFile(consoleLogPath, 'utf8'),
		readFile(configPath),
	]);
	const diagnostics = createDesktopNightlyTestsMetricsEvidence({
		consoleOutput,
		config: JSON.parse(configBytes.toString('utf8')),
		sourceRevision,
		budgetSha256: createHash('sha256').update(configBytes).digest('hex'),
		playwrightExit,
	}, { ...dependencies, evidenceKind });
	if (!['metrics', 'packaged-runtime'].includes(artifactDirectory)) {
		throw new TypeError('Nightly metrics artifact directory is invalid.');
	}
	const metricsRoot = join(runRoot, artifactDirectory);
	await mkdir(metricsRoot, { recursive: true });
	await Promise.all([
		writeFile(join(metricsRoot, 'raw.json'), `${JSON.stringify(diagnostics.raw, null, '\t')}\n`, { flag: 'wx' }),
		writeFile(join(metricsRoot, 'summary.json'), `${JSON.stringify(diagnostics.summary, null, '\t')}\n`, { flag: 'wx' }),
	]);
	return diagnostics;
}

export async function runDesktopNightlyTestsMetricsPhase({
	executablePath,
	payloadRoot,
	runRoot,
	baseURL,
	esbuildBinaryPath,
	environment,
	sourceRevision,
}, dependencies = {}) {
	const metricsRoot = join(runRoot, 'metrics');
	await mkdir(metricsRoot, { recursive: false });
	const plan = createDesktopNightlyTestsMetricsPlan({
		executablePath, payloadRoot, runRoot, baseURL, esbuildBinaryPath, environment,
	});
	const child = await dependencies.runPlaywright(plan);
	const writeDiagnostics = dependencies.writeDiagnostics ?? writeDesktopNightlyTestsMetricsDiagnostics;
	const diagnostics = await writeDiagnostics({
		payloadRoot, runRoot, sourceRevision, playwrightExit: child,
	});
	return Object.freeze({ child, diagnostics });
}

function collector(workloadId, parse, evaluate, metricGatePassed) {
	return Object.freeze({ workloadId, parse, evaluate, metricGatePassed });
}

function normalizeDiagnosticResult(resultValue, metricGatePassed) {
	if (!isRecord(resultValue)) throw new TypeError('Metric collector result must be a plain record.');
	const originalEvaluation = isRecord(resultValue.evaluation) ? resultValue.evaluation : {};
	const originalFailures = Array.isArray(originalEvaluation.failures)
		? originalEvaluation.failures.filter((failure) => typeof failure === 'string') : [];
	return Object.freeze({
		...resultValue,
		status: metricGatePassed ? 'passed' : 'failed',
		metricGatePassed,
		evaluation: Object.freeze({
			...originalEvaluation,
			passed: metricGatePassed,
			failures: Object.freeze(originalFailures),
		}),
	});
}

function playwrightFailures(value) {
	if (!isRecord(value)) throw new TypeError('Nightly metrics Playwright exit is required.');
	if (value.signal !== null && value.signal !== undefined) {
		return [`Playwright metrics exited on signal ${String(value.signal)}.`];
	}
	return value.code === 0 ? [] : [`Playwright metrics exited with code ${String(value.code)}.`];
}

function assertAbsolutePath(value, label) {
	if (typeof value !== 'string' || !value || !isAbsolute(value)) throw new TypeError(`${label} must be absolute.`);
}

function assertLoopbackBaseUrl(value) {
	let url;
	try { url = new URL(value); } catch { throw new TypeError('Desktop nightly metrics base URL is invalid.'); }
	if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
		|| url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
		throw new TypeError('Desktop nightly metrics base URL must be an HTTP 127.0.0.1 origin.');
	}
}

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function requireRecord(value, label) {
	if (!isRecord(value)) throw new TypeError(`${label} must be a plain record.`);
	return value;
}

function exactDescriptor(collection, id, label) {
	if (!Array.isArray(collection)) throw new Error(`Quality config has no ${label} descriptors.`);
	const matches = collection.filter((value) => isRecord(value) && value.id === id);
	if (matches.length !== 1) throw new Error(`Quality config must contain exactly one ${label} ${id}.`);
	return matches[0];
}

function rendererClass(value) {
	const fingerprint = requireRecord(value, 'M1 preview packaged-runtime environment fingerprint');
	const description = `${fingerprint.webglVendor} ${fingerprint.webglRenderer}`;
	return /swiftshader|llvmpipe|software|offscreen/iu.test(description) ? 'software' : 'hardware';
}

function packagedRuntimeFingerprint(value) {
	const fingerprint = requireRecord(value, 'M1 preview packaged-runtime environment fingerprint');
	for (const field of [
		'browserVersion', 'platform', 'architecture', 'webglVendor', 'webglRenderer',
		'gpuDriverVersion', 'gpuDeviceId', 'powerMode', 'displayMode',
	]) {
		if (typeof fingerprint[field] !== 'string' || fingerprint[field].length < 1) {
			throw new Error('M1 preview packaged-runtime environment fingerprint is incomplete.');
		}
	}
	if (!['win32', 'linux', 'darwin'].includes(fingerprint.platform)
		|| !['x64', 'arm64'].includes(fingerprint.architecture)) {
		throw new Error('M1 preview packaged-runtime environment fingerprint is invalid.');
	}
	return Object.freeze({ ...fingerprint });
}

function heapSnapshot(value, label) {
	const snapshot = requireRecord(value, label);
	if (typeof snapshot.usedSize !== 'number' || !Number.isFinite(snapshot.usedSize) || snapshot.usedSize < 0
		|| typeof snapshot.totalSize !== 'number' || !Number.isFinite(snapshot.totalSize)
		|| snapshot.totalSize < snapshot.usedSize) {
		throw new Error(`${label} is invalid.`);
	}
	return snapshot;
}

function nearestRankP95(samples) {
	if (!Array.isArray(samples) || samples.length < 1) throw new TypeError('M1 preview percentile samples are unavailable.');
	const sorted = samples.toSorted((left, right) => left - right);
	return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function roundedMetric(value) {
	return Number(value.toFixed(9));
}

function message(error) {
	return error instanceof Error ? error.message : String(error);
}
