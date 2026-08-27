/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	collectCiQualificationMetrics,
	parseCiQualificationMetricsCliOptions,
} from '../scripts/collect-ci-qualification-metrics.mjs';
import {
	HOSTED_CI_ENVIRONMENT_ID,
	HOSTED_CI_FAILURE,
	HOSTED_CI_COLLECTORS,
	SOFTWARE_RENDERER_SKIP,
	createCiQualificationMetricsEvidence,
	hostedCiMetricSpecs,
} from '../scripts/lib/ci-qualification-metrics.mjs';
import { makeM4ProductionParityDiagnostic } from './helpers/m4-production-parity-fixture.ts';
import { makeM4B2KeyframeParityDiagnostic } from './helpers/m4b2-keyframe-parity-fixture.ts';

const configBytes = await readFile(new URL('../config/quality-budgets.json', import.meta.url));
const config = JSON.parse(configBytes.toString('utf8')) as Readonly<Record<string, unknown>>;
const BUDGET_SHA256 = 'a'.repeat(64);
const SOURCE_REVISION = 'b'.repeat(40);
const PASSING_EXIT = { code: 0, signal: null } as const;

function stubCollector(diagnosticKey: string, gate: 'blocking' | 'observational', metricGatePassed: boolean) {
	return {
		diagnosticKey,
		gate,
		rendererRequirement: 'any' as const,
		spec: `tests/browser/${diagnosticKey}.spec.js`,
		parse: () => ({ diagnosticKey }),
		evaluate: () => ({
			workloadId: `${diagnosticKey}-workload`,
			metricGatePassed,
			metrics: { 'stub.value': 1 },
			evaluation: { passed: metricGatePassed, failures: [], verdicts: [] },
		}),
	};
}

type PlaywrightExit = { readonly code: number | null; readonly signal: string | null };

function evidenceFrom(
	collectors: readonly ReturnType<typeof stubCollector>[],
	playwrightExit: PlaywrightExit = PASSING_EXIT,
) {
	return createCiQualificationMetricsEvidence({
		consoleOutput: '',
		config,
		sourceRevision: SOURCE_REVISION,
		budgetSha256: BUDGET_SHA256,
		playwrightExit,
	}, { collectors });
}

test('a failed parity gate fails the run while a failed timing gate is only observed', () => {
	const observedOnly = evidenceFrom([
		stubCollector('parity', 'blocking', true),
		stubCollector('timing', 'observational', false),
	]);
	assert.equal(observedOnly.passed, true);
	assert.deepEqual(observedOnly.summary.failures, []);
	assert.deepEqual(observedOnly.summary.observations, ['timing did not pass its metric thresholds.']);

	const blocked = evidenceFrom([
		stubCollector('parity', 'blocking', false),
		stubCollector('timing', 'observational', true),
	]);
	assert.equal(blocked.passed, false);
	assert.deepEqual(blocked.summary.failures, ['parity did not pass its metric thresholds.']);
	assert.deepEqual(blocked.summary.observations, []);
});

test('hosted evidence records the environment and never publishes qualification', () => {
	const evidence = evidenceFrom([stubCollector('parity', 'blocking', true)]);
	assert.equal(evidence.raw.kind, 'soundscaper-hosted-ci-metrics-raw');
	assert.equal(evidence.summary.kind, 'soundscaper-hosted-ci-metrics');
	assert.equal(evidence.summary.executionSurface, 'hosted-ci');
	assert.equal(evidence.summary.environmentId, HOSTED_CI_ENVIRONMENT_ID);
	assert.equal(evidence.summary.attemptCount, 1);
	assert.equal(evidence.summary.retryCount, 0);
	assert.equal(evidence.summary.workerCount, 1);
	assert.equal(evidence.summary.qualificationEvidencePublished, false);
	for (const workload of evidence.summary.workloads) {
		assert.equal(workload.qualificationEvidencePublished, false);
		assert.equal(workload.evaluation.passed, false);
		assert.equal(workload.evaluation.failures.at(-1), HOSTED_CI_FAILURE);
		assert.equal(workload.status, 'pending-external');
	}
});

test('the hosted environment the evidence names is not qualification eligible', () => {
	const environments = (config as { environments: Array<Record<string, unknown>> }).environments;
	const hosted = environments.find(({ id }) => id === HOSTED_CI_ENVIRONMENT_ID);
	assert.ok(hosted, 'The hosted CI environment descriptor must exist.');
	assert.equal(hosted.qualificationEligible, false);
});

test('a non-zero Playwright exit and a lost blocking diagnostic both fail the run', () => {
	const exited = evidenceFrom([stubCollector('parity', 'blocking', true)], { code: 1, signal: null });
	assert.equal(exited.passed, false);
	assert.deepEqual(exited.summary.failures, ['Playwright exited with 1.']);

	const lost = createCiQualificationMetricsEvidence({
		consoleOutput: '',
		config,
		sourceRevision: null,
		budgetSha256: BUDGET_SHA256,
		playwrightExit: PASSING_EXIT,
	}, {
		collectors: [{
			diagnosticKey: 'parity',
			gate: 'blocking',
			rendererRequirement: 'any' as const,
			spec: 'tests/browser/parity.spec.js',
			parse: () => { throw new Error('no diagnostic marker'); },
			evaluate: () => ({}),
		}],
	});
	assert.equal(lost.passed, false);
	assert.deepEqual(lost.summary.failures, ['parity: no diagnostic marker']);
});

test('a missing observational diagnostic never fails the run', () => {
	const evidence = createCiQualificationMetricsEvidence({
		consoleOutput: '',
		config,
		sourceRevision: null,
		budgetSha256: BUDGET_SHA256,
		playwrightExit: PASSING_EXIT,
	}, {
		collectors: [
			stubCollector('parity', 'blocking', true),
			{
				diagnosticKey: 'timing',
				gate: 'observational',
				rendererRequirement: 'any' as const,
				spec: 'tests/browser/timing.spec.js',
				parse: () => { throw new Error('no diagnostic marker'); },
				evaluate: () => ({}),
			},
		],
	});
	assert.equal(evidence.passed, true);
	assert.deepEqual(evidence.summary.failures, []);
	assert.deepEqual(evidence.summary.observations, ['timing: no diagnostic marker']);
	assert.equal(evidence.summary.blockingWorkloadCount, 1);
});

test('the registered collector table splits parity from timing and skips the GPU workload', () => {
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
	assert.deepEqual(hostedCiMetricSpecs(), [
		'tests/browser/audio-editor-m4-production-parity.spec.js',
		'tests/browser/audio-editor-m4b2-keyframe-parity.spec.js',
		'tests/browser/audio-editor-longform-editorial-benchmark.spec.js',
	]);
});

test('a hardware-renderer workload is recorded as not attempted rather than run', () => {
	const evidence = createCiQualificationMetricsEvidence({
		consoleOutput: '',
		config,
		sourceRevision: null,
		budgetSha256: BUDGET_SHA256,
		playwrightExit: PASSING_EXIT,
	}, {
		collectors: [
			stubCollector('parity', 'blocking', true),
			{
				diagnosticKey: 'cadence',
				gate: 'observational' as const,
				rendererRequirement: 'hardware' as const,
				spec: 'tests/browser/cadence.spec.js',
				parse: () => { throw new Error('the spec must never run'); },
				evaluate: () => ({}),
			},
		],
	});
	assert.equal(evidence.passed, true);
	assert.deepEqual(evidence.summary.notAttempted, [
		{ diagnosticKey: 'cadence', reason: SOFTWARE_RENDERER_SKIP },
	]);
	assert.deepEqual(evidence.summary.workloads.map(({ diagnosticKey }) => diagnosticKey), ['parity']);
});

test('a real console log with both parity markers passes without the timing diagnostics', () => {
	const consoleOutput = [
		'Running 1 test using 1 worker',
		`SOUNDSCAPER_M4_PRODUCTION_PARITY ${JSON.stringify(makeM4ProductionParityDiagnostic())}`,
		`SOUNDSCAPER_M4B2_KEYFRAME_PARITY ${JSON.stringify(makeM4B2KeyframeParityDiagnostic())}`,
	].join('\n');
	const evidence = createCiQualificationMetricsEvidence({
		consoleOutput,
		config,
		sourceRevision: SOURCE_REVISION,
		budgetSha256: BUDGET_SHA256,
		playwrightExit: PASSING_EXIT,
	});
	assert.equal(evidence.passed, true);
	assert.deepEqual(Object.keys(evidence.raw.diagnostics).sort(), [
		'm4-production-parity',
		'm4b2-keyframe-render-parity',
	]);
	assert.equal(evidence.summary.observations.length, 1);
	assert.deepEqual(evidence.summary.notAttempted.map(({ diagnosticKey }) => diagnosticKey), [
		'm1-video-preview-12fx-720p',
	]);
	assert.deepEqual(evidence.summary.workloads.map(({ workloadId }) => workloadId), [
		'm4-production-render-parity',
		'm4b2-keyframe-render-parity',
	]);
});

test('collection refuses a host that is not a GitHub runner unless it is rehearsing', async () => {
	const outputDirectory = join(await mkdtemp(join(tmpdir(), 'ci-metrics-')), 'run');
	await assert.rejects(
		collectCiQualificationMetrics({ outputDirectory, allowLocal: false }, { processEnvironment: {} }),
		/GitHub runner/u,
	);
});

test('collection writes its console log, raw and summary once and refuses to overwrite', async () => {
	const root = await mkdtemp(join(tmpdir(), 'ci-metrics-'));
	const outputDirectory = join(root, 'run');
	const consoleOutput = [
		`SOUNDSCAPER_M4_PRODUCTION_PARITY ${JSON.stringify(makeM4ProductionParityDiagnostic())}`,
		`SOUNDSCAPER_M4B2_KEYFRAME_PARITY ${JSON.stringify(makeM4B2KeyframeParityDiagnostic())}`,
	].join('\n');
	const dependencies = {
		processEnvironment: { GITHUB_ACTIONS: 'true', GITHUB_SHA: SOURCE_REVISION },
		runPlaywright: async () => ({ consoleOutput, exit: PASSING_EXIT }),
		configBytes,
	};
	const evidence = await collectCiQualificationMetrics(
		{ outputDirectory, allowLocal: false },
		dependencies,
	);
	assert.equal(evidence.passed, true);
	assert.equal(evidence.summary.sourceRevision, SOURCE_REVISION);
	assert.equal(await readFile(join(outputDirectory, 'console.log'), 'utf8'), consoleOutput);
	const summary = JSON.parse(await readFile(join(outputDirectory, 'summary.json'), 'utf8')) as {
		readonly kind: string;
		readonly workloads: readonly { readonly workloadId: string }[];
	};
	assert.equal(summary.kind, 'soundscaper-hosted-ci-metrics');
	assert.deepEqual(summary.workloads.map(({ workloadId }) => workloadId), [
		'm4-production-render-parity',
		'm4b2-keyframe-render-parity',
	]);
	const raw = JSON.parse(await readFile(join(outputDirectory, 'raw.json'), 'utf8')) as {
		readonly budgetSha256: string;
	};
	assert.match(raw.budgetSha256, /^[a-f\d]{64}$/u);

	await assert.rejects(
		collectCiQualificationMetrics({ outputDirectory, allowLocal: false }, dependencies),
		/EEXIST/u,
		'a second run must not overwrite retained evidence',
	);
});

test('collection rebuilds a run root that Playwright cleared while the specs ran', async () => {
	const root = await mkdtemp(join(tmpdir(), 'ci-metrics-'));
	const playwrightOutputDirectory = join(root, 'test-results');
	const outputDirectory = join(playwrightOutputDirectory, 'ci-qualification-metrics');
	const consoleOutput = [
		`SOUNDSCAPER_M4_PRODUCTION_PARITY ${JSON.stringify(makeM4ProductionParityDiagnostic())}`,
		`SOUNDSCAPER_M4B2_KEYFRAME_PARITY ${JSON.stringify(makeM4B2KeyframeParityDiagnostic())}`,
	].join('\n');
	const evidence = await collectCiQualificationMetrics({ outputDirectory, allowLocal: false }, {
		processEnvironment: { GITHUB_ACTIONS: 'true', GITHUB_SHA: SOURCE_REVISION },
		// Playwright empties its own `outputDir` before the first spec starts, and
		// the hosted run root lives inside it.
		runPlaywright: async () => {
			await rm(playwrightOutputDirectory, { recursive: true, force: true });
			return { consoleOutput, exit: PASSING_EXIT };
		},
		configBytes,
	});
	assert.equal(evidence.passed, true);
	assert.equal(await readFile(join(outputDirectory, 'console.log'), 'utf8'), consoleOutput);
	const summary = JSON.parse(await readFile(join(outputDirectory, 'summary.json'), 'utf8')) as {
		readonly kind: string;
	};
	assert.equal(summary.kind, 'soundscaper-hosted-ci-metrics');
});

test('the CLI defaults its output directory and accepts only one', () => {
	assert.deepEqual({ ...parseCiQualificationMetricsCliOptions([]) }, {
		outputDirectory: 'test-results/ci-qualification-metrics',
		allowLocal: false,
	});
	assert.deepEqual({ ...parseCiQualificationMetricsCliOptions(['out', '--allow-local']) }, {
		outputDirectory: 'out',
		allowLocal: true,
	});
	assert.throws(() => parseCiQualificationMetricsCliOptions(['--qualify']), /Unknown hosted CI metrics option/u);
	assert.throws(() => parseCiQualificationMetricsCliOptions(['a', 'b']), /one output directory/u);
	assert.throws(() => parseCiQualificationMetricsCliOptions(['--allow-local', '--allow-local']), /Repeated/u);
});
