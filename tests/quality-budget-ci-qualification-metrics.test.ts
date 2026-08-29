/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	collectCiQualificationMetrics,
	parseCiQualificationMetricsCliOptions,
} from '../scripts/collect-ci-qualification-metrics.mjs';
import { createHostedQualificationArtifacts } from '../scripts/lib/ci-qualification-artifacts.mjs';
import { evaluateQualityBudgetResult } from '../scripts/quality-budget-result.mjs';
import {
	HOSTED_CI_ENVIRONMENT_ID,
	HOSTED_CI_LOWER_BOUND_BASIS,
	HOSTED_CI_MISS,
	HOSTED_CI_UNREGISTERED,
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

function stubCollector(
	diagnosticKey: string,
	gate: 'blocking' | 'observational',
	metricGatePassed: boolean,
	workloadId = `${diagnosticKey}-workload`,
) {
	return {
		diagnosticKey,
		gate,
		rendererRequirement: 'any' as const,
		spec: `tests/browser/${diagnosticKey}.spec.js`,
		parse: () => ({ diagnosticKey }),
		evaluate: () => ({
			workloadId,
			metricGatePassed,
			rendererClass: 'software',
			metrics: { 'stub.value': 1 },
			evaluation: {
				passed: metricGatePassed,
				failures: [],
				verdicts: [{ metricId: 'stub.value', passed: metricGatePassed }],
			},
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

test('hosted evidence records the environment and leaves an unregistered workload unpublished', () => {
	const evidence = evidenceFrom([stubCollector('parity', 'blocking', true)]);
	assert.equal(evidence.raw.kind, 'soundscaper-hosted-ci-metrics-raw');
	assert.equal(evidence.summary.kind, 'soundscaper-hosted-ci-metrics');
	assert.equal(evidence.summary.executionSurface, 'hosted-ci');
	assert.equal(evidence.summary.environmentId, HOSTED_CI_ENVIRONMENT_ID);
	assert.equal(evidence.summary.attemptCount, 1);
	assert.equal(evidence.summary.retryCount, 0);
	assert.equal(evidence.summary.workerCount, 1);
	assert.equal(evidence.summary.qualificationEvidencePublished, false);
	assert.deepEqual(evidence.summary.qualifiedWorkloadIds, []);
	for (const workload of evidence.summary.workloads) {
		assert.equal(workload.qualificationEvidencePublished, false);
		assert.equal(workload.evaluation.passed, false);
		assert.deepEqual(workload.evaluation.failures, [HOSTED_CI_UNREGISTERED]);
		assert.equal(workload.status, 'pending-external');
	}
});

test('the hosted environment is a registered lower bound for the workloads it may qualify', () => {
	const environments = (config as { environments: Array<Record<string, unknown>> }).environments;
	const hosted = environments.find(({ id }) => id === HOSTED_CI_ENVIRONMENT_ID);
	assert.ok(hosted, 'The hosted CI environment descriptor must exist.');
	assert.equal(hosted.status, 'active');
	assert.equal(hosted.qualificationEligible, true);
	assert.equal(hosted.qualificationBasis, HOSTED_CI_LOWER_BOUND_BASIS);
	assert.equal(hosted.lowerBoundOf, 'owner-qualified-windows-x64-rtx3090-01');
	assert.deepEqual(hosted.eligibleWorkloadIds, [
		'm3-longform-editorial',
		'm4-production-render-parity',
		'm4b2-keyframe-render-parity',
	]);
});

test('a registered workload qualifies when it passes and is observed when it misses', () => {
	const qualified = evidenceFrom([
		stubCollector('keyframes', 'blocking', true, 'm4b2-keyframe-render-parity'),
	]);
	const [passing] = qualified.summary.workloads;
	assert.equal(passing.status, 'qualified');
	assert.equal(passing.qualificationEvidencePublished, true);
	assert.equal(passing.evaluation.passed, true);
	assert.equal(passing.evaluation.basis, HOSTED_CI_LOWER_BOUND_BASIS);
	assert.deepEqual(passing.evaluation.failures, []);
	assert.equal(qualified.summary.qualificationEvidencePublished, true);
	assert.deepEqual(qualified.summary.qualifiedWorkloadIds, ['m4b2-keyframe-render-parity']);

	// The weaker runner is expected to miss a timing budget; that says nothing
	// about the stronger host, so it must not read as a qualification verdict.
	const missed = evidenceFrom([
		stubCollector('editorial', 'observational', false, 'm3-longform-editorial'),
	]);
	const [missing] = missed.summary.workloads;
	assert.equal(missing.status, 'observed');
	assert.equal(missing.qualificationEvidencePublished, false);
	assert.equal(missing.evaluation.passed, false);
	assert.equal(missing.evaluation.basis, null);
	assert.deepEqual(missing.evaluation.failures, ['stub.value did not pass.', HOSTED_CI_MISS]);
	assert.equal(missed.passed, true, 'an observational miss cannot fail the hosted run');
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

// The five numbers the 2026-08-29 hosted run measured for the keyed compositor.
const KEYFRAME_METRICS = Object.freeze({
	'keyframes.videoMinimumSsim': 0.999855387171781,
	'keyframes.videoMaximumChannelMae': 0.0006510416666666666,
	'keyframes.omittedOperations': 0,
	'keyframes.substitutedOperations': 0,
	'keyframes.fallbackOperations': 0,
});

type BudgetEnvironment = {
	readonly id: string;
	readonly status: 'active' | 'unprovisioned';
	readonly qualificationEligible: boolean;
	readonly rendererRequirement: 'any' | 'hardware';
	readonly fingerprint: Record<string, string>;
};

type BudgetWorkload = {
	readonly id: string;
	readonly fixtureIds: readonly string[];
	readonly environmentIds: readonly string[];
	readonly thresholds: readonly {
		readonly metricId: string;
		readonly comparison: 'eq' | 'gte' | 'lte';
		readonly value: number;
		readonly unit: string;
	}[];
};

function hostedEnvironmentDescriptor(): BudgetEnvironment {
	const environments = (config as unknown as { environments: BudgetEnvironment[] }).environments;
	const hosted = environments.find(({ id }) => id === HOSTED_CI_ENVIRONMENT_ID);
	assert.ok(hosted, 'The hosted CI environment descriptor must exist.');
	return hosted;
}

function keyframeWorkloadDescriptor(): BudgetWorkload {
	const workloads = (config as unknown as { workloads: BudgetWorkload[] }).workloads;
	const workload = workloads.find(({ id }) => id === 'm4b2-keyframe-render-parity');
	assert.ok(workload, 'The keyed parity workload descriptor must exist.');
	return workload;
}

function qualifiedKeyframeWorkload() {
	return {
		workloadId: 'm4b2-keyframe-render-parity',
		diagnosticKey: 'm4b2-keyframe-render-parity',
		gate: 'blocking',
		status: 'qualified',
		rendererClass: 'software',
		metricGatePassed: true,
		qualificationEvidencePublished: true,
		metrics: KEYFRAME_METRICS,
	};
}

test('a qualifying hosted workload writes evidence the formal result verifier accepts', () => {
	const environment = hostedEnvironmentDescriptor();
	const budgetSha256 = createHash('sha256').update(configBytes).digest('hex');
	const artifacts = createHostedQualificationArtifacts({
		workloads: [qualifiedKeyframeWorkload()],
		config,
		environment,
		sourceRevision: SOURCE_REVISION,
		budgetSha256,
		nodeVersion: environment.fingerprint.nodeVersion,
	});
	assert.equal(artifacts.length, 1);
	const [artifact] = artifacts;
	assert.equal(artifact.resultFileName, 'm4b2-keyframe-render-parity.accepted.json');
	assert.equal(artifact.rawFileName, 'm4b2-keyframe-render-parity.raw.json');

	const result = JSON.parse(artifact.resultBytes.toString('utf8')) as {
		readonly rawEvidence: { readonly byteLength: number; readonly sha256: string };
		readonly metrics: Readonly<Record<string, number>>;
	};
	assert.equal(result.rawEvidence.byteLength, artifact.rawBytes.byteLength);
	assert.equal(result.rawEvidence.sha256, createHash('sha256').update(artifact.rawBytes).digest('hex'));
	// The cohort auditor compares the raw and accepted metric objects as text.
	const raw = JSON.parse(artifact.rawBytes.toString('utf8')) as { readonly metrics: unknown };
	assert.equal(JSON.stringify(raw.metrics), JSON.stringify(result.metrics));

	const evaluation = evaluateQualityBudgetResult({
		workload: keyframeWorkloadDescriptor(),
		expectedEnvironment: environment,
		expectedBudgetSha256: budgetSha256,
		measurementPolicy: (config as { measurementPolicy: { benchmarkRetries: number } }).measurementPolicy,
	}, result);
	assert.deepEqual(evaluation.failures, []);
	assert.equal(evaluation.passed, true);
});

test('a rehearsal without a revision or on an unpinned runtime publishes no evidence', () => {
	const environment = hostedEnvironmentDescriptor();
	const context = {
		workloads: [qualifiedKeyframeWorkload()],
		config,
		environment,
		sourceRevision: SOURCE_REVISION,
		budgetSha256: createHash('sha256').update(configBytes).digest('hex'),
		nodeVersion: environment.fingerprint.nodeVersion,
	};
	assert.deepEqual(createHostedQualificationArtifacts({ ...context, sourceRevision: null }), []);
	assert.deepEqual(createHostedQualificationArtifacts({ ...context, nodeVersion: '1.2.3' }), []);
	assert.deepEqual(
		createHostedQualificationArtifacts({
			...context,
			workloads: [{ ...qualifiedKeyframeWorkload(), qualificationEvidencePublished: false }],
		}),
		[],
	);
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
