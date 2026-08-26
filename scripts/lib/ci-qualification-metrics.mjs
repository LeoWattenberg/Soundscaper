/* SPDX-License-Identifier: AGPL-3.0-only */

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
import {
	createPendingM1VideoPreviewResult,
	parseM1VideoPreviewDiagnostic,
} from './desktop-nightly-tests-metrics.mjs';

export const HOSTED_CI_ENVIRONMENT_ID = 'github-ubuntu-playwright-1.62.1';

// The environment descriptor sets `qualificationEligible: false`, so a hosted
// run publishes numbers and never acceptance. Saying so in every workload's
// failure list keeps the artifact honest wherever it is read.
export const HOSTED_CI_FAILURE = 'A hosted CI runner is diagnostic-only and not a qualified environment.';

export const SOFTWARE_RENDERER_SKIP = 'A hosted CI runner has no hardware renderer, so this workload is not attempted here.';

// `docs/quality-budgets.md` admits correctness counters and exact media
// comparisons in ordinary CI, and holds timing, heap and device budgets to a
// fixed environment. The two parity collectors are therefore blocking here —
// their SSIM, MAE and omitted-operation counters are deterministic — while the
// long-form collector is recorded as an observation, since a shared hosted
// runner cannot hold a timing budget steady.
//
// The M1 preview cadence is not attempted at all. It measures presented frames
// through a twelve-effect 1280x720 WebGL stack, and llvmpipe delivers a frame
// roughly every eleven seconds, so the run spends eight minutes to time out
// short of its 121 frames without ever producing a number worth reading.
export const HOSTED_CI_COLLECTORS = Object.freeze([
	collector('m4-production-parity', 'blocking', 'any',
		'tests/browser/audio-editor-m4-production-parity.spec.js',
		parseM4ProductionParityDiagnostic, createPendingM4ProductionParityResult),
	collector('m4b2-keyframe-render-parity', 'blocking', 'any',
		'tests/browser/audio-editor-m4b2-keyframe-parity.spec.js',
		parseM4B2KeyframeParityDiagnostic, createPendingM4B2KeyframeParityResult),
	collector('m3-longform-editorial', 'observational', 'any',
		'tests/browser/audio-editor-longform-editorial-benchmark.spec.js',
		parseM3LongformEditorialDiagnostic, createPendingM3LongformEditorialResult),
	collector('m1-video-preview-12fx-720p', 'observational', 'hardware',
		'tests/browser/audio-editor-video-preview-benchmark.spec.js',
		parseM1VideoPreviewDiagnostic, createPendingM1VideoPreviewResult),
]);

/** The specs a hosted runner can actually measure, in run order. */
export function hostedCiMetricSpecs(collectors = HOSTED_CI_COLLECTORS) {
	return Object.freeze(collectors
		.filter(({ rendererRequirement }) => rendererRequirement === 'any')
		.map(({ spec }) => spec));
}

/** Turn one hosted-CI console log into the raw and summary evidence pair. */
export function createCiQualificationMetricsEvidence({
	consoleOutput,
	config,
	sourceRevision,
	budgetSha256,
	playwrightExit,
}, dependencies = {}) {
	if (typeof consoleOutput !== 'string') throw new TypeError('Hosted CI console output must be a string.');
	if (!isRecord(config)) throw new TypeError('Hosted CI quality config must be a plain record.');
	if (sourceRevision !== null && !/^[a-f\d]{40}$/u.test(sourceRevision)) {
		throw new TypeError('Hosted CI source revision must be a lowercase 40-character Git SHA.');
	}
	if (typeof budgetSha256 !== 'string' || !/^[a-f\d]{64}$/u.test(budgetSha256)) {
		throw new TypeError('Hosted CI budget digest must be SHA-256.');
	}
	const collectors = dependencies.collectors ?? HOSTED_CI_COLLECTORS;
	const environmentId = dependencies.environmentId ?? HOSTED_CI_ENVIRONMENT_ID;
	const runFailures = playwrightFailures(playwrightExit);
	const diagnostics = {};
	const workloads = [];
	const observations = [];
	const blockingFailures = [...runFailures];
	const notAttempted = [];
	for (const current of collectors) {
		if (current.rendererRequirement === 'hardware') {
			notAttempted.push(Object.freeze({ diagnosticKey: current.diagnosticKey, reason: SOFTWARE_RENDERER_SKIP }));
			continue;
		}
		try {
			const diagnostic = current.parse(consoleOutput);
			diagnostics[current.diagnosticKey] = diagnostic;
			const evaluated = current.evaluate(diagnostic, config);
			const metricGatePassed = evaluated.metricGatePassed === true;
			const workload = normalizeHostedResult(evaluated, current, metricGatePassed);
			workloads.push(workload);
			if (metricGatePassed) continue;
			const failure = `${current.diagnosticKey} did not pass its metric thresholds.`;
			if (current.gate === 'blocking') blockingFailures.push(failure);
			else observations.push(failure);
		} catch (error) {
			const failure = `${current.diagnosticKey}: ${message(error)}`;
			if (current.gate === 'blocking') blockingFailures.push(failure);
			else observations.push(failure);
		}
	}
	// An observational collector that produced nothing is an observation, not a
	// reason to fail the job; only a missing blocking result is fatal.
	const blockingExpected = collectors.filter(({ gate }) => gate === 'blocking').length;
	const blockingCollected = workloads.filter(({ gate }) => gate === 'blocking').length;
	if (blockingCollected !== blockingExpected && blockingFailures.length === runFailures.length) {
		blockingFailures.push('A blocking hosted CI collector produced no result.');
	}
	const raw = Object.freeze({
		schemaVersion: 1,
		kind: 'soundscaper-hosted-ci-metrics-raw',
		executionSurface: 'hosted-ci',
		environmentId,
		sourceRevision,
		budgetSha256,
		diagnostics: Object.freeze(diagnostics),
	});
	const summary = Object.freeze({
		schemaVersion: 1,
		kind: 'soundscaper-hosted-ci-metrics',
		executionSurface: 'hosted-ci',
		environmentId,
		sourceRevision,
		budgetSha256,
		attemptCount: 1,
		retryCount: 0,
		workerCount: 1,
		collectionPassed: blockingFailures.length === 0,
		blockingWorkloadCount: blockingExpected,
		qualificationEvidencePublished: false,
		workloads: Object.freeze(workloads),
		failures: Object.freeze(blockingFailures),
		observations: Object.freeze(observations),
		notAttempted: Object.freeze(notAttempted),
	});
	return Object.freeze({ passed: blockingFailures.length === 0, raw, summary });
}

function collector(diagnosticKey, gate, rendererRequirement, spec, parse, evaluate) {
	if (!['blocking', 'observational'].includes(gate)) throw new TypeError('Collector gate is invalid.');
	if (!['any', 'hardware'].includes(rendererRequirement)) {
		throw new TypeError('Collector renderer requirement is invalid.');
	}
	if (rendererRequirement === 'hardware' && gate === 'blocking') {
		throw new TypeError('A hosted CI runner cannot block on a hardware-renderer workload.');
	}
	return Object.freeze({ diagnosticKey, gate, rendererRequirement, spec, parse, evaluate });
}

// A hosted result keeps the collector's own verdicts and adds the ineligibility
// note, exactly as the downloadable nightly host does for its own surface.
function normalizeHostedResult(resultValue, current, metricGatePassed) {
	if (!isRecord(resultValue)) throw new TypeError('Hosted CI collector result must be a plain record.');
	const evaluation = isRecord(resultValue.evaluation) ? resultValue.evaluation : {};
	const failures = Array.isArray(evaluation.failures)
		? evaluation.failures.filter((failure) => typeof failure === 'string') : [];
	return Object.freeze({
		...resultValue,
		workloadId: typeof resultValue.workloadId === 'string' ? resultValue.workloadId : current.diagnosticKey,
		diagnosticKey: current.diagnosticKey,
		gate: current.gate,
		status: metricGatePassed ? 'pending-external' : 'failed',
		metricGatePassed,
		qualificationEvidencePublished: false,
		evaluation: Object.freeze({
			...evaluation,
			passed: false,
			failures: Object.freeze([...failures, HOSTED_CI_FAILURE]),
		}),
	});
}

function playwrightFailures(playwrightExit) {
	if (!isRecord(playwrightExit)) throw new TypeError('Hosted CI Playwright exit must be a plain record.');
	const { code, signal } = playwrightExit;
	if (signal !== null && signal !== undefined) return [`Playwright terminated with ${String(signal)}.`];
	if (code === 0) return [];
	return [`Playwright exited with ${String(code)}.`];
}

function message(error) {
	return error instanceof Error ? error.message : String(error);
}

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
