/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	M9_SOAK_METRIC_IDS,
	computeM9SoakMetrics,
	createM9SoakCohort,
	createM9SoakResult,
	validateM9SoakRawEvidence,
	writeM9SoakEvidence,
} from '../scripts/lib/m9-soak-evidence.mjs';
import {
	canonicalM9SoakFixtureBytes,
	generateM9SoakFixture,
	m9SoakScheduleSha256,
	validateM9SoakSpec,
} from '../scripts/lib/m9-soak-fixture.mjs';
import { parseM9SoakCollectorArguments } from '../scripts/collect-m9-soak-quality.mjs';

const ROOT = new URL('../', import.meta.url);
const BASE_CONFIG = JSON.parse(await readFile(new URL('config/quality-budgets.json', ROOT), 'utf8'));
const SPEC = validateM9SoakSpec(JSON.parse(
	await readFile(new URL('config/milestone-9-soak-spec.json', ROOT), 'utf8'),
));
const SOURCE_REVISION = 'a'.repeat(40);
const MATRIX_CELL_ID = 'desktop-linux-x64';

test('raw observations recompute the exact twelve registered soak metrics', () => {
	const context = qualificationContext();
	const raw = rawEvidence('qualification', 1, context);
	const computed = computeM9SoakMetrics(raw, SPEC);

	assert.deepEqual(Object.keys(computed.metrics), [...M9_SOAK_METRIC_IDS]);
	assert.equal(computed.metrics['soak.retainedJsHeapDeltaBytes'], 22.5 * 1024 * 1024);
	assert.ok(Math.abs(computed.metrics['soak.postWarmupHeapSlopeMibPerHour'] - 3) < 1e-9);
	assert.equal(computed.metrics['soak.electronRssDeltaBytes'], 90 * 1024 * 1024);
	assert.equal(computed.metrics['soak.audioDropoutFrames'], 0);
	assert.equal(computed.metrics['soak.unreportedDroppedFrames'], 0);
	assert.equal(computed.metrics['soak.avDriftMaximumMs'], 5);
	assert.equal(computed.metrics['soak.failedAutosaves'], 0);
	assert.equal(computed.metrics['soak.unrecoveredJobs'], 0);
	assert.equal(computed.metrics['qualification.browserPassRatio'], 1);
	assert.equal(computed.metrics['qualification.desktopPassRatio'], 1);
	assert.equal(computed.metrics['qualification.migrationPassRatio'], 1);
	assert.equal(computed.metrics['qualification.releaseBlockingDefects'], 0);
	assert.equal(computed.rawSampleCounts.heap, 97);
	assert.equal(computed.rawSampleCounts.executedEvents, computed.rawSampleCounts.plannedEvents);
});

test('qualification evidence is closed, wall-clock, no-retry, and summary-free', () => {
	const context = qualificationContext();
	const raw = rawEvidence('qualification', 1, context);
	assert.doesNotThrow(() => validateM9SoakRawEvidence(raw, SPEC));

	for (const [mutate, expected] of [
		[(value) => { value.collection.retryCount = 1; }, /one attempt and zero retries/iu],
		[(value) => { value.collection.hostedRunner = true; }, /hosted runner/iu],
		[(value) => { value.collection.monotonicDurationMs -= 1; }, /wall-clock duration/iu],
		[(value) => { value.fixture.executedEventIds.pop(); }, /complete deterministic schedule/iu],
		[(value) => { value.metrics = {}; }, /exact fields/iu],
		[(value) => { value.samples.heap[3].retainedJsHeapBytes = Number.NaN; }, /finite/iu],
	]) {
		const changed = structuredClone(raw);
		mutate(changed);
		assert.throws(() => validateM9SoakRawEvidence(changed, SPEC), expected);
	}
});

test('matrix cell identifiers cannot escape the evidence output directory', () => {
	const context = qualificationContext();
	const raw = rawEvidence('contract', null, context);
	raw.matrixCellId = '../outside';
	assert.throws(
		() => validateM9SoakRawEvidence(raw, SPEC),
		/matrixCellId/iu,
	);
});

test('the short mode exercises the contract without publishing qualification', () => {
	const context = qualificationContext();
	const raw = rawEvidence('contract', null, context);
	const result = createM9SoakResult(raw, context);

	assert.equal(result.status, 'contract-only');
	assert.equal(result.metricGatePassed, true);
	assert.equal(result.qualificationEvidencePublished, false);
	assert.equal(result.durationSeconds, 120);
	assert.throws(
		() => createM9SoakCohort([raw, structuredClone(raw)], context),
		/qualification-mode/iu,
	);

	const relabelled = structuredClone(raw);
	relabelled.mode = 'qualification';
	relabelled.sequence = 1;
	assert.throws(
		() => validateM9SoakRawEvidence(relabelled, SPEC),
		/wall-clock duration|fixture binding|sample schedule/iu,
	);
});

test('two consecutive passing runs form one repeatable qualification cohort', () => {
	const context = qualificationContext();
	const first = rawEvidence('qualification', 1, context);
	const second = rawEvidence('qualification', 2, context);
	const cohort = createM9SoakCohort([second, first], context);

	assert.equal(cohort.status, 'accepted');
	assert.equal(cohort.qualificationEvidencePublished, true);
	assert.equal(cohort.runs.length, 2);
	assert.deepEqual(cohort.runs.map(({ sequence }) => sequence), [1, 2]);
	assert.equal(cohort.repeatability.passed, true);
	assert.equal(cohort.repeatability.verdicts.length, M9_SOAK_METRIC_IDS.length);
	assert.ok(cohort.runs.every(({ evaluation }) => evaluation.passed));
});

test('cohorts reject threshold drift, identity drift, retries, and out-of-band repeats', () => {
	for (const failure of ['thresholds', 'source', 'fingerprint', 'run-id', 'repeatability']) {
		const context = qualificationContext();
		const first = rawEvidence('qualification', 1, context);
		const second = rawEvidence('qualification', 2, context);
		if (failure === 'thresholds') {
			context.config.workloads.find(({ id }) => id === SPEC.workloadId).thresholds[0].value += 1;
			context.budgetSha256 = digestJson(context.config);
			first.budgetSha256 = context.budgetSha256;
			second.budgetSha256 = context.budgetSha256;
		}
		if (failure === 'source') second.sourceRevision = 'b'.repeat(40);
		if (failure === 'fingerprint') second.environmentFingerprint.desktopMatrixRevision = 'other';
		if (failure === 'run-id') second.runId = first.runId;
		if (failure === 'repeatability') {
			second.samples.heap.at(-1).retainedJsHeapBytes += 50 * 1024 * 1024;
		}
		const expected = {
			thresholds: /threshold registration is not exact/iu,
			source: /one source revision/iu,
			fingerprint: /one environment fingerprint/iu,
			'run-id': /unique run IDs/iu,
			repeatability: /repeatability band/iu,
		}[failure];
		assert.throws(() => createM9SoakCohort([first, second], context), expected, failure);
	}
});

test('the writer recomputes before exclusive contract/cohort publication', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-m9-soak-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const qualification = qualificationContext();
	const raws = [
		rawEvidence('qualification', 1, qualification),
		rawEvidence('qualification', 2, qualification),
	];
	const written = await writeM9SoakEvidence(directory, raws, qualification);
	assert.equal(written.evidence.status, 'accepted');
	assert.match(written.path, /\.cohort\.accepted\.json$/u);
	assert.equal(written.sha256, sha256(await readFile(written.path)));
	await assert.rejects(
		writeM9SoakEvidence(directory, raws, qualification),
		/already exists|EEXIST/iu,
	);
});

test('the collector CLI accepts one contract or two qualification inputs only', async () => {
	assert.deepEqual(parseM9SoakCollectorArguments([
		'--measurement', 'first.json', '--measurement', 'second.json',
		'--output-directory', 'evidence',
	]), {
		measurementPaths: ['first.json', 'second.json'],
		outputDirectory: 'evidence',
	});
	assert.throws(
		() => parseM9SoakCollectorArguments(['--measurement', 'one', '--measurement', 'two', '--measurement', 'three']),
		/one contract measurement or two qualification measurements/iu,
	);
	assert.throws(
		() => parseM9SoakCollectorArguments(['--accept']),
		/unknown/iu,
	);
	const packageJson = JSON.parse(await readFile(new URL('package.json', ROOT), 'utf8'));
	assert.equal(
		packageJson.scripts['quality:collect:m9-soak'],
		'node scripts/collect-m9-soak-quality.mjs',
	);
});

function qualificationContext() {
	const config = structuredClone(BASE_CONFIG);
	const fixture = config.fixtures.find(({ id }) => id === SPEC.fixtureId);
	const workload = config.workloads.find(({ id }) => id === SPEC.workloadId);
	const environment = config.environments.find(({ id }) => id === 'release-qualification-matrix');
	fixture.status = 'provisional';
	workload.status = 'provisional';
	environment.status = 'active';
	environment.qualificationEligible = true;
	environment.eligibleWorkloadIds = [SPEC.workloadId];
	environment.fingerprint = {
		browserMatrixRevision: 'browser-v1',
		desktopMatrixRevision: 'desktop-v1',
		deviceMatrixRevision: 'device-v1',
	};
	return {
		config,
		spec: SPEC,
		budgetSha256: digestJson(config),
	};
}

function rawEvidence(mode, sequence, context) {
	const fixture = generateM9SoakFixture(SPEC, mode);
	const contract = mode === 'qualification' ? SPEC.qualification : SPEC.contract;
	const sampleCount = (contract.durationSeconds / contract.sampleIntervalSeconds) + 1;
	const start = new Date(sequence === 2 ? '2026-09-02T00:00:00Z' : '2026-09-01T00:00:00Z');
	const end = new Date(start.getTime() + (contract.durationSeconds * 1_000));
	const heapStep = mode === 'qualification' ? 0.25 * 1024 * 1024 : 16 * 1024;
	const sampleTimes = Array.from(
		{ length: sampleCount }, (_, index) => index * contract.sampleIntervalSeconds * 1_000,
	);
	return {
		schemaVersion: 1,
		mode,
		workloadId: SPEC.workloadId,
		fixtureId: SPEC.fixtureId,
		runId: `M9-SOAK-${mode}-${sequence ?? 'contract'}`,
		sequence,
		sourceRevision: SOURCE_REVISION,
		budgetSha256: context.budgetSha256,
		matrixCellId: MATRIX_CELL_ID,
		environmentId: 'release-qualification-matrix',
		rendererClass: 'hardware',
		environmentFingerprint: structuredClone(
			context.config.environments.find(({ id }) => id === 'release-qualification-matrix').fingerprint,
		),
		collection: {
			attemptCount: 1,
			retryCount: 0,
			hostedRunner: false,
			startedAt: start.toISOString(),
			endedAt: end.toISOString(),
			elapsedTimeSource: 'monotonic',
			monotonicDurationMs: contract.durationSeconds * 1_000,
			workloadRunnerSha256: '1'.repeat(64),
			packageSha256: '2'.repeat(64),
		},
		fixture: {
			generatorRevision: SPEC.generator.revision,
			seed: SPEC.generator.seed,
			artifactSha256: sha256(canonicalM9SoakFixtureBytes(fixture)),
			scheduleSha256: m9SoakScheduleSha256(fixture),
			eventCount: fixture.schedule.length,
			executedEventIds: fixture.schedule.map(({ eventId }) => eventId),
		},
		samples: {
			heap: sampleTimes.map((elapsedMs, index) => ({
				elapsedMs,
				retainedJsHeapBytes: (100 * 1024 * 1024) + (index * heapStep),
				forcedCollections: 3,
			})),
			electronRss: sampleTimes.map((elapsedMs, index) => ({
				elapsedMs,
				rssBytes: (500 * 1024 * 1024) + (index * 1024 * 1024),
			})),
			avDrift: sampleTimes.map((elapsedMs) => ({ elapsedMs, driftMs: 5 })),
			audioDropouts: [],
			droppedFrames: [],
			autosaves: fixture.schedule
				.filter(({ operationId }) => operationId.endsWith('autosave'))
				.map(({ eventId }) => ({ eventId, status: 'succeeded' })),
			jobs: [{ jobId: `${mode}-job`, terminalState: 'completed', recovered: true }],
		},
		qualification: {
			browserChecks: [{ id: 'browser-suite', passed: true }],
			desktopChecks: [{ id: 'desktop-suite', passed: true }],
			migrationChecks: [{ id: 'family-v1', passed: true }],
			defects: [{ id: 'low-1', severity: 'low', status: 'open' }],
		},
	};
}

function digestJson(value) {
	return sha256(Buffer.from(JSON.stringify(value), 'utf8'));
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
