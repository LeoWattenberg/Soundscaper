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
export const SOFTWARE_RENDERER_SKIP =
	'A hosted CI runner has no hardware renderer, so this diagnostic was not attempted.';

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

export function hostedCiDiagnosticSpecs(collectors = HOSTED_CI_COLLECTORS) {
	return Object.freeze(collectors
		.filter(({ rendererRequirement }) => rendererRequirement === 'any')
		.map(({ spec }) => spec));
}

export function createCiDiagnosticsReport({
	consoleOutput,
	config = {},
	sourceRevision,
	playwrightExit,
}, dependencies = {}) {
	if (typeof consoleOutput !== 'string') throw new TypeError('Hosted CI diagnostic output must be text.');
	if (sourceRevision !== null && !/^[a-f\d]{40}$/u.test(String(sourceRevision))) {
		throw new TypeError('Hosted CI source revision must be null or a lowercase Git SHA.');
	}
	const collectors = dependencies.collectors ?? HOSTED_CI_COLLECTORS;
	const runFailures = playwrightFailures(playwrightExit);
	const failures = [...runFailures];
	const warnings = [];
	const notAttempted = [];
	const diagnostics = {};
	const workloads = [];
	for (const current of collectors) {
		if (current.rendererRequirement === 'hardware') {
			notAttempted.push(Object.freeze({
				diagnosticKey: current.diagnosticKey,
				reason: SOFTWARE_RENDERER_SKIP,
			}));
			continue;
		}
		try {
			const diagnostic = current.parse(consoleOutput);
			diagnostics[current.diagnosticKey] = diagnostic;
			const evaluated = current.evaluate(diagnostic, config);
			const passed = evaluated?.metricGatePassed === true;
			const status = passed ? 'passed' : current.gate === 'blocking' ? 'failed' : 'warning';
			workloads.push(Object.freeze({
				...evaluated,
				diagnosticKey: current.diagnosticKey,
				gate: current.gate,
				status,
			}));
			if (passed) continue;
			const message = `${current.diagnosticKey} did not pass its metric thresholds.`;
			if (current.gate === 'blocking') failures.push(message);
			else warnings.push(message);
		} catch (error) {
			const diagnosticFailure = `${current.diagnosticKey}: ${messageOf(error)}`;
			if (current.gate === 'blocking') failures.push(diagnosticFailure);
			else warnings.push(diagnosticFailure);
		}
	}
	const raw = Object.freeze({
		schemaVersion: 1,
		kind: 'soundscaper-hosted-ci-diagnostics-raw',
		executionSurface: 'hosted-ci',
		environmentId: HOSTED_CI_ENVIRONMENT_ID,
		sourceRevision,
		diagnostics: Object.freeze(diagnostics),
	});
	const report = Object.freeze({
		schemaVersion: 1,
		kind: 'soundscaper-hosted-ci-diagnostics',
		executionSurface: 'hosted-ci',
		environmentId: HOSTED_CI_ENVIRONMENT_ID,
		sourceRevision,
		passed: failures.length === 0,
		blockingWorkloadCount: collectors.filter(({ gate, rendererRequirement }) => (
			gate === 'blocking' && rendererRequirement === 'any'
		)).length,
		workloads: Object.freeze(workloads),
		failures: Object.freeze(failures),
		warnings: Object.freeze(warnings),
		notAttempted: Object.freeze(notAttempted),
	});
	return Object.freeze({ passed: report.passed, raw, report });
}

function collector(diagnosticKey, gate, rendererRequirement, spec, parse, evaluate) {
	if (!['blocking', 'observational'].includes(gate)) throw new TypeError('Diagnostic gate is invalid.');
	if (!['any', 'hardware'].includes(rendererRequirement)) {
		throw new TypeError('Diagnostic renderer requirement is invalid.');
	}
	if (rendererRequirement === 'hardware' && gate === 'blocking') {
		throw new TypeError('Hosted hardware diagnostics must be observational.');
	}
	return Object.freeze({ diagnosticKey, gate, rendererRequirement, spec, parse, evaluate });
}

function playwrightFailures(value) {
	if (value?.code === 0 && value?.signal === null) return [];
	if (typeof value?.signal === 'string' && value.signal) return [`Playwright ended with ${value.signal}.`];
	return [`Playwright exited with ${String(value?.code ?? 'an unknown status')}.`];
}

function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
