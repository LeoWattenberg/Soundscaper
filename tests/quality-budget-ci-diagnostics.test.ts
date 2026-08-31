/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	collectCiDiagnostics,
	parseCiDiagnosticsCliOptions,
} from '../scripts/collect-ci-diagnostics.mjs';
import {
	HOSTED_CI_COLLECTORS,
	SOFTWARE_RENDERER_SKIP,
	createCiDiagnosticsReport,
	hostedCiDiagnosticSpecs,
} from '../scripts/lib/ci-diagnostics.mjs';

const PASSING_EXIT = { code: 0, signal: null } as const;

function stubCollector(
	diagnosticKey: string,
	gate: 'blocking' | 'observational',
	metricGatePassed: boolean,
) {
	return {
		diagnosticKey,
		gate,
		rendererRequirement: 'any' as const,
		spec: `tests/browser/${diagnosticKey}.spec.js`,
		parse: () => ({ diagnosticKey }),
		evaluate: () => ({
			workloadId: `${diagnosticKey}-workload`,
			metricGatePassed,
			rendererClass: 'software',
			metrics: { 'stub.value': metricGatePassed ? 1 : 0 },
			evaluation: {
				passed: metricGatePassed,
				failures: metricGatePassed ? [] : ['stub.value missed its threshold.'],
				verdicts: [{ metricId: 'stub.value', passed: metricGatePassed }],
			},
		}),
	};
}

function reportFrom(collectors: readonly ReturnType<typeof stubCollector>[]) {
	return createCiDiagnosticsReport({
		consoleOutput: '',
		sourceRevision: 'b'.repeat(40),
		playwrightExit: PASSING_EXIT,
	}, { collectors });
}

test('hosted diagnostics block on correctness and warn on observational budgets', () => {
	const warning = reportFrom([
		stubCollector('parity', 'blocking', true),
		stubCollector('timing', 'observational', false),
	]);
	assert.equal(warning.passed, true);
	assert.deepEqual(warning.report.failures, []);
	assert.deepEqual(warning.report.warnings, ['timing did not pass its metric thresholds.']);
	assert.equal(warning.report.workloads[0]?.status, 'passed');
	assert.equal(warning.report.workloads[1]?.status, 'warning');
	assert.doesNotMatch(JSON.stringify(warning), /qualif|evidencePublished|lower.bound/iu);

	const failed = reportFrom([
		stubCollector('parity', 'blocking', false),
		stubCollector('timing', 'observational', true),
	]);
	assert.equal(failed.passed, false);
	assert.deepEqual(failed.report.failures, ['parity did not pass its metric thresholds.']);
});

test('hardware-only diagnostics are reported as unavailable on hosted software renderers', () => {
	const report = createCiDiagnosticsReport({
		consoleOutput: '', sourceRevision: null, playwrightExit: PASSING_EXIT,
	}, {
		collectors: [{
			diagnosticKey: 'cadence', gate: 'observational', rendererRequirement: 'hardware',
			spec: 'tests/browser/cadence.spec.js',
			parse: () => { throw new Error('must not execute'); }, evaluate: () => ({}),
		}],
	});
	assert.equal(report.passed, true);
	assert.deepEqual(report.report.notAttempted, [
		{ diagnosticKey: 'cadence', reason: SOFTWARE_RENDERER_SKIP },
	]);
});

test('the diagnostic collector table retains parity, timing, and GPU observations', () => {
	assert.deepEqual(
		HOSTED_CI_COLLECTORS.map(({ diagnosticKey, gate, rendererRequirement }) => (
			[diagnosticKey, gate, rendererRequirement]
		)),
		[
			['m4-production-parity', 'blocking', 'any'],
			['m4b2-keyframe-render-parity', 'blocking', 'any'],
			['m3-longform-editorial', 'observational', 'any'],
			['m1-video-preview-12fx-720p', 'observational', 'hardware'],
		],
	);
	assert.deepEqual(hostedCiDiagnosticSpecs(), [
		'tests/browser/audio-editor-m4-production-parity.spec.js',
		'tests/browser/audio-editor-m4b2-keyframe-parity.spec.js',
		'tests/browser/audio-editor-longform-editorial-benchmark.spec.js',
	]);
});

test('collection writes a raw diagnostic log and report without accepted evidence artifacts', async () => {
	const root = await mkdtemp(join(tmpdir(), 'ci-diagnostics-'));
	const outputDirectory = join(root, 'run');
	const result = await collectCiDiagnostics({ outputDirectory, allowLocal: false }, {
		processEnvironment: { GITHUB_ACTIONS: 'true', GITHUB_SHA: 'c'.repeat(40) },
		runPlaywright: async () => ({ consoleOutput: '', exit: PASSING_EXIT }),
		collectors: [stubCollector('parity', 'blocking', true)],
	});
	assert.equal(result.passed, true);
	assert.equal(await readFile(join(outputDirectory, 'console.log'), 'utf8'), '');
	const report = JSON.parse(await readFile(join(outputDirectory, 'report.json'), 'utf8')) as {
		readonly kind: string;
	};
	assert.equal(report.kind, 'soundscaper-hosted-ci-diagnostics');
	await assert.rejects(readFile(join(outputDirectory, 'parity.accepted.json')), /ENOENT/u);
});

test('the diagnostics CLI has an ignored generated output default', () => {
	assert.deepEqual({ ...parseCiDiagnosticsCliOptions([]) }, {
		outputDirectory: 'test-results/ci-diagnostics', allowLocal: false,
	});
	assert.deepEqual({ ...parseCiDiagnosticsCliOptions(['out', '--allow-local']) }, {
		outputDirectory: 'out', allowLocal: true,
	});
	assert.throws(() => parseCiDiagnosticsCliOptions(['--qualify']), /Unknown hosted CI diagnostics option/u);
});
