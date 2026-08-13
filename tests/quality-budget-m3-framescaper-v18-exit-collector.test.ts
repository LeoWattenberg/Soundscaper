/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	collectM3FramescaperV18ExitDiagnostic,
	createPendingM3FramescaperV18ExitResult,
	parseM3FramescaperV18ExitDiagnostic,
} from '../scripts/collect-m3-framescaper-v18-exit-quality.mjs';

const config = JSON.parse(await readFile(
	new URL('../config/quality-budgets.json', import.meta.url),
	'utf8',
)) as unknown;
const packageMetadata = JSON.parse(await readFile(
	new URL('../package.json', import.meta.url),
	'utf8',
)) as { readonly scripts: Readonly<Record<string, string>> };

const fixture = Object.freeze({
	schemaVersion: 18,
	durationSeconds: 7_200,
	sampleRate: 48_000,
	contains: Object.freeze([
		'attached-proxy',
		'nested-sequence',
		'multicamera',
		'verified-vfr',
		'source-timecode',
	]),
});

function makeDiagnostic() {
	return {
		schemaVersion: 1,
		profile: 'deterministic-framescaper-v18-browser-observation-v1',
		observationClass: 'framescaper-v18-maintained-projections-v1',
		workloadId: 'm3-framescaper-v18-exit',
		fixtureId: 'm3-framescaper-v18-exit-2h-v1',
		environmentId: 'reference-linux-gpu-01',
		rendererClass: 'hardware',
		environmentFingerprint: {
			browserVersion: 'Chromium 149.0.7827.55',
			gpuModel: 'diagnostic-gpu',
			logicalCpuCount: 8,
		},
		fixture,
		browserWorkflow: {
			productId: 'framescaper',
			projectSchemaVersion: 18,
			coldReopenCount: 1,
			exactTimingSourceCount: 3,
			nestedPlacementCount: 1,
			multicameraGroupCount: 1,
			multicameraMemberCount: 2,
			activeMemberSwitchCount: 1,
		},
		projectionTrials: [
			trial('audio-start', 'audio', 0, 0, null, null, 0.5),
			trial('integer-video', 'video', 48_000, 48_000, 30, 30, 0.75),
			trial('ntsc-video', 'video', 48_048, 48_048, 30, 30, 0.8),
			trial('verified-vfr', 'video', 144_000, 144_000, 2, 2, 0.9),
			trial('nested-root', 'nested', 480_000, 480_000, 300, 300, 1.25),
			trial('multicamera-active', 'multicamera', 96_000, 96_000, 60, 60, 1.5),
		],
	};
}

function trial(
	id: string,
	kind: string,
	expectedSample: number,
	observedSample: number,
	expectedVideoFrame: number | null,
	observedVideoFrame: number | null,
	elapsedMs: number,
) {
	return {
		id,
		kind,
		expectedSample,
		observedSample,
		expectedVideoFrame,
		observedVideoFrame,
		elapsedMs,
	};
}

function reporterOutput(value: unknown): string {
	return `✔ local V18 observation\nℹ ${JSON.stringify(value)}\nℹ tests 1\n`;
}

test('the V18 exit collector recomputes all maintained projection metrics', () => {
	const result = createPendingM3FramescaperV18ExitResult(makeDiagnostic(), config);

	assert.equal(result.status, 'pending-external');
	assert.equal(result.qualificationEvidencePublished, false);
	assert.equal(result.attemptCount, 1);
	assert.equal(result.retryCount, 0);
	assert.deepEqual(result.metrics, {
		'framescaperV18.audioPositionErrorSamples': 0,
		'framescaperV18.videoPositionErrorFrames': 0,
		'framescaperV18.nestedPositionErrorFrames': 0,
		'framescaperV18.multicameraSyncErrorSamples': 0,
	});
	assert.deepEqual(result.rawSampleCounts, {
		projectionTrials: 6,
		audioTrials: 1,
		videoTrials: 3,
		nestedTrials: 1,
		multicameraTrials: 1,
	});
	assert.match(result.externalQualification.required.join('\n'), /provisioned/iu);
	assert.match(result.externalQualification.required.join('\n'), /reviewed external verifier/iu);
	assert.equal(Object.hasOwn(result, 'rawEvidence'), false);
	assert.equal(Object.hasOwn(result, 'budgetSha256'), false);
});

test('the diagnostic parser admits exactly one matching V18 browser observation', () => {
	const diagnostic = makeDiagnostic();
	assert.deepEqual(parseM3FramescaperV18ExitDiagnostic(reporterOutput(diagnostic)), diagnostic);
	assert.throws(() => parseM3FramescaperV18ExitDiagnostic('ℹ tests 1\n'), /exactly one/iu);
	assert.throws(
		() => parseM3FramescaperV18ExitDiagnostic(
			`${reporterOutput(diagnostic)}${reporterOutput(diagnostic)}`,
		),
		/exactly one/iu,
	);
	assert.throws(
		() => parseM3FramescaperV18ExitDiagnostic(reporterOutput({
			...diagnostic,
			fixtureId: 'wrong-fixture',
		})),
		/exactly one/iu,
	);
});

test('workflow drift and malformed projection observations fail closed', () => {
	const diagnostic = makeDiagnostic();
	assert.throws(
		() => createPendingM3FramescaperV18ExitResult({
			...diagnostic,
			browserWorkflow: { ...diagnostic.browserWorkflow, projectSchemaVersion: 17 },
		}, config),
		/schemaVersion 18|schema 18/iu,
	);
	assert.throws(
		() => createPendingM3FramescaperV18ExitResult({
			...diagnostic,
			projectionTrials: diagnostic.projectionTrials.slice(0, 5),
		}, config),
		/exactly 6 projection trials/iu,
	);
	assert.throws(
		() => createPendingM3FramescaperV18ExitResult({
			...diagnostic,
			projectionTrials: diagnostic.projectionTrials.map((entry, index) => (
				index === 4 ? { ...entry, observedVideoFrame: 301 } : entry
			)),
		}, config),
		/nonzero/iu,
	);
	assert.throws(
		() => createPendingM3FramescaperV18ExitResult({
			...diagnostic,
			projectionTrials: diagnostic.projectionTrials.map((entry, index) => (
				index === 0 ? { ...entry, elapsedMs: Number.NaN } : entry
			)),
		}, config),
		/finite/iu,
	);
});

test('even a hypothetically activated environment remains pending external', () => {
	const activated = structuredClone(config) as {
		qualification: { qualifiedWorkloadIds: string[] };
		environments: Array<{
			id: string;
			status: string;
			qualificationEligible: boolean;
			fingerprint: Record<string, unknown>;
		}>;
	};
	const diagnostic = makeDiagnostic();
	const environment = activated.environments.find(({ id }) => id === 'reference-linux-gpu-01');
	assert.ok(environment);
	environment.status = 'active';
	environment.qualificationEligible = true;
	environment.fingerprint = structuredClone(diagnostic.environmentFingerprint);
	activated.qualification.qualifiedWorkloadIds.push('m3-framescaper-v18-exit');

	const result = createPendingM3FramescaperV18ExitResult(diagnostic, activated);
	assert.equal(result.status, 'pending-external');
	assert.equal(result.qualificationEvidencePublished, false);
	assert.equal(Object.hasOwn(result, 'rawEvidence'), false);
	assert.equal(Object.hasOwn(result, 'sourceRevision'), false);
});

test('the no-retry command writes only one pending-external artifact', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-m3-v18-exit-'));
	let browserRuns = 0;
	const collected = await collectM3FramescaperV18ExitDiagnostic(
		{ outputDirectory: directory },
		{
			runBrowser: async () => {
				browserRuns += 1;
				return { stdout: reporterOutput(makeDiagnostic()), stderr: '' };
			},
		},
	);
	assert.equal(browserRuns, 1);
	assert.equal(collected.result.status, 'pending-external');
	assert.equal(collected.resultPath,
		join(directory, 'm3-framescaper-v18-exit.pending-external.json'));
	const written = JSON.parse(await readFile(collected.resultPath, 'utf8'));
	assert.equal(written.status, 'pending-external');
	assert.equal(written.qualificationEvidencePublished, false);
	assert.equal(Object.hasOwn(written, 'rawEvidence'), false);
});

test('the quality register exposes the opt-in collector without granting qualification', () => {
	const quality = config as {
		qualification: { qualifiedWorkloadIds: string[] };
		fixtures: Array<{ id: string; specification: Record<string, unknown>; evidence: string[] }>;
		workloads: Array<{ id: string; evidence: string[] }>;
	};
	const registeredFixture = quality.fixtures.find(({ id }) => id === 'm3-framescaper-v18-exit-2h-v1');
	const workload = quality.workloads.find(({ id }) => id === 'm3-framescaper-v18-exit');
	assert.equal(registeredFixture?.specification.localDiagnosticCommand,
		'npm run quality:collect:m3-framescaper-v18-exit');
	assert.equal(registeredFixture?.specification.qualificationPublication, 'pending-external-only');
	assert.deepEqual(registeredFixture?.evidence.slice(-2), [
		'tests/browser/framescaper-v18-exit-observation.spec.js',
		'tests/quality-budget-m3-framescaper-v18-exit-collector.test.ts',
	]);
	assert.deepEqual(workload?.evidence.slice(-2), [
		'tests/browser/framescaper-v18-exit-observation.spec.js',
		'tests/quality-budget-m3-framescaper-v18-exit-collector.test.ts',
	]);
	assert.equal(packageMetadata.scripts['quality:collect:m3-framescaper-v18-exit'],
		'node scripts/collect-m3-framescaper-v18-exit-quality.mjs');
	assert.equal(quality.qualification.qualifiedWorkloadIds.includes('m3-framescaper-v18-exit'), false);
});
