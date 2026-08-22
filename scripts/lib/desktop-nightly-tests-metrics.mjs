/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

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
import { createPackagedRuntimeQualification } from './desktop-nightly-tests-qualification.mjs';

const DOWNLOADABLE_HOST_FAILURE = 'A downloadable nightly host is diagnostic-only and not a qualified environment.';
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
	if (!Array.isArray(diagnostic.resolution)
		|| diagnostic.resolution[0] !== specification.width
		|| diagnostic.resolution[1] !== specification.height) {
		throw new Error('M1 preview diagnostic does not use the registered resolution.');
	}
	if (!Array.isArray(diagnostic.effects) || diagnostic.effects.length !== specification.effectCount
		|| diagnostic.measuredIntervals !== specification.measuredIntervals
		|| diagnostic.measuredFrames !== specification.measuredIntervals + 1
		|| !Number.isSafeInteger(diagnostic.warmupFrames) || diagnostic.warmupFrames < 1) {
		throw new Error('M1 preview diagnostic does not use the registered sampling shape.');
	}
	const metrics = Object.freeze({
		'preview.frameIntervalP95Ms': finiteNumber(diagnostic.p95Ms, 'M1 preview p95 interval'),
		'preview.retainedJsHeapDeltaBytes': finiteNumber(
			diagnostic.retainedJsHeapDeltaBytes,
			'M1 preview retained heap delta',
		),
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
		status: metricGatePassed ? 'pending-external' : 'failed',
		workloadId: 'm1-video-preview-12fx-720p',
		fixtureId: 'video-preview-12fx-720p-v1',
		environmentId: 'local-browser-correctness',
		attemptCount: 1,
		retryCount: 0,
		rendererClass: rendererClass(diagnostic.renderer),
		environmentFingerprint: Object.freeze({
			browserVersion: String(diagnostic.browserVersion ?? ''),
			browserEnvironment: diagnostic.browserEnvironment,
			renderer: diagnostic.renderer,
		}),
		fixture: Object.freeze({
			width: specification.width,
			height: specification.height,
			effectCount: specification.effectCount,
			measuredIntervals: specification.measuredIntervals,
		}),
		metrics,
		rawSampleCounts: Object.freeze({
			warmupFrames: diagnostic.warmupFrames,
			measuredFrames: diagnostic.measuredFrames,
			measuredIntervals: diagnostic.measuredIntervals,
		}),
		metricGatePassed,
		qualificationEvidencePublished: false,
		evaluation: Object.freeze({
			passed: false,
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
	const pendingSummary = Object.freeze({
		schemaVersion: 1,
		kind: `soundscaper-desktop-nightly${kindSuffix}-metrics`,
		executionSurface: evidenceKind,
		sourceRevision,
		budgetSha256,
		attemptCount: 1,
		retryCount: 0,
		workerCount: 1,
		collectionPassed,
		qualificationEvidencePublished: false,
		workloads: Object.freeze(workloads),
		failures: Object.freeze(failures),
	});
	const qualification = evidenceKind === 'packaged-runtime'
		? createPackagedRuntimeQualification({ config, raw, summary: pendingSummary })
		: null;
	const workloadQualifications = Array.isArray(qualification?.workloadQualifications)
		? qualification.workloadQualifications
		: qualification === null ? [] : [qualification];
	const acceptedQualifications = new Map(workloadQualifications
		.filter(({ status }) => status === 'accepted')
		.map((value) => [value.workloadId, value]));
	const qualifiedWorkloads = workloads.map((workload) => {
		const accepted = acceptedQualifications.get(workload.workloadId);
		return accepted === undefined ? workload : acceptedWorkload(workload, accepted.environmentId);
	});
	const summary = acceptedQualifications.size > 0 ? Object.freeze({
		...pendingSummary,
		qualificationEvidencePublished: true,
		workloads: Object.freeze(qualifiedWorkloads),
	}) : pendingSummary;
	return Object.freeze({
		passed: collectionPassed,
		raw,
		summary,
		qualification,
	});
}

export async function writeDesktopNightlyTestsMetricsEvidence({
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
	const evidence = createDesktopNightlyTestsMetricsEvidence({
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
		writeFile(join(metricsRoot, 'raw.json'), `${JSON.stringify(evidence.raw, null, '\t')}\n`, { flag: 'wx' }),
		writeFile(join(metricsRoot, 'summary.json'), `${JSON.stringify(evidence.summary, null, '\t')}\n`, { flag: 'wx' }),
		...(evidence.qualification === null ? [] : [
			writeFile(join(metricsRoot, 'qualification.json'), `${JSON.stringify(evidence.qualification, null, '\t')}\n`, { flag: 'wx' }),
		]),
	]);
	return evidence;
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
	const writeEvidence = dependencies.writeEvidence ?? writeDesktopNightlyTestsMetricsEvidence;
	const evidence = await writeEvidence({
		payloadRoot, runRoot, sourceRevision, playwrightExit: child,
	});
	return Object.freeze({ child, evidence });
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
		status: metricGatePassed ? 'pending-external' : 'failed',
		metricGatePassed,
		qualificationEvidencePublished: false,
		evaluation: Object.freeze({
			...originalEvaluation,
			passed: false,
			failures: Object.freeze([...originalFailures, DOWNLOADABLE_HOST_FAILURE]),
		}),
	});
}

function acceptedWorkload(workload, environmentId) {
	return Object.freeze({
		...workload,
		status: 'accepted',
		qualificationEnvironmentId: environmentId,
		qualificationEvidencePublished: true,
		evaluation: Object.freeze({
			...(isRecord(workload.evaluation) ? workload.evaluation : {}),
			passed: true,
			failures: Object.freeze([]),
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

function finiteNumber(value, label) {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite.`);
	return value;
}

function rendererClass(value) {
	const renderer = requireRecord(value, 'M1 preview renderer');
	const description = `${String(renderer.vendor ?? '')} ${String(renderer.renderer ?? '')}`;
	return /swiftshader|llvmpipe|software|offscreen/iu.test(description) ? 'software' : 'hardware';
}

function message(error) {
	return error instanceof Error ? error.message : String(error);
}
