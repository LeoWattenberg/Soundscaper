/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
	auditMilestone9QualificationEvidence,
	readMilestone9QualificationEvidenceRegister,
	validateMilestone9QualificationEvidenceRegister,
} from '../scripts/lib/milestone-9-qualification-evidence.mjs';
import { createM9SoakCohort } from '../scripts/lib/m9-soak-evidence.mjs';
import {
	canonicalM9SoakFixtureBytes,
	generateM9SoakFixture,
	m9SoakScheduleSha256,
	validateM9SoakSpec,
} from '../scripts/lib/m9-soak-fixture.mjs';
import {
	expandMilestone9BehaviorEnvironmentRequirements,
	validateMilestone9BehaviorEnvironmentMatrix,
} from '../scripts/lib/milestone-9-behavior-environments.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const CONFIG = JSON.parse(await readFile(new URL('../config/quality-budgets.json', import.meta.url), 'utf8'));
const SPEC_BYTES = await readFile(new URL('../config/milestone-9-soak-spec.json', import.meta.url));
const SPEC = validateM9SoakSpec(JSON.parse(SPEC_BYTES));
const MATRIX = validateMilestone9BehaviorEnvironmentMatrix(JSON.parse(
	await readFile(new URL('../config/milestone-9-behavior-environments.json', import.meta.url), 'utf8'),
));
const SOURCE_REVISION = 'a'.repeat(40);

test('the pending register reserves two runs and one cohort for every release cell', async () => {
	const register = await readMilestone9QualificationEvidenceRegister(ROOT);
	const releaseCells = MATRIX.cellSets.find(({ id }) => id === MATRIX.soakCellSetId).cellIds;
	assert.equal(register.status, 'pending-external');
	assert.deepEqual(register.cells.map(({ cellId }) => cellId), releaseCells);
	assert.equal(register.cells.length, 11);
	assert.ok(register.cells.every(({ runs, cohort }) => (
		runs.length === 2
		&& runs[0].sequence === 1
		&& runs[1].sequence === 2
		&& runs.every(({ path, byteLength, sha256 }) => path === null && byteLength === null && sha256 === null)
		&& Object.values(cohort).every((value) => value === null)
	)));
	assert.equal(register.soakSpecSha256, sha256(SPEC_BYTES));
	assert.equal(expandMilestone9BehaviorEnvironmentRequirements(MATRIX).size, 152);

	const audit = await auditMilestone9QualificationEvidence({ repositoryRoot: ROOT }, {
		loadHistoricalQualityBudget: async () => { throw new Error('pending audit loaded history'); },
	});
	assert.equal(audit.passed, true);
	assert.equal(audit.qualificationReady, false);
	assert.equal(audit.requiredRunCount, 22);
	assert.equal(audit.auditedRunCount, 0);
});

test('the register is closed over exact release cells and cannot preclaim evidence', async () => {
	const register = structuredClone(await readMilestone9QualificationEvidenceRegister(ROOT));
	for (const [mutate, expected] of [
		[(value) => value.cells.pop(), /exact release-runtime cell matrix/iu],
		[(value) => value.cells.reverse(), /exact release-runtime cell matrix/iu],
		[(value) => { value.status = 'accepted'; }, /accepted identity|source revision/iu],
		[(value) => { value.cells[0].runs[0].path = 'qualification/milestone-9/invented.json'; }, /must not claim evidence pins/iu],
		[(value) => { value.extra = true; }, /exact fields/iu],
	]) {
		const changed = structuredClone(register);
		mutate(changed);
		assert.throws(
			() => validateMilestone9QualificationEvidenceRegister(changed, MATRIX),
			expected,
		);
	}
});

test('accepted evidence reopens every raw run and recomputes all eleven cohorts', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-m9-qualification-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const historical = qualificationReadyConfig();
	const historicalBytes = jsonBytes(historical);
	const budgetSha256 = sha256(historicalBytes);
	const currentBytes = jsonBytes(finalConfig(historical));
	const register = structuredClone(await readMilestone9QualificationEvidenceRegister(ROOT));
	register.status = 'accepted';
	register.blockedBy = null;
	register.sourceRevision = SOURCE_REVISION;
	register.budgetSha256 = budgetSha256;

	for (const cell of register.cells) {
		const raws = [1, 2].map((sequence) => rawEvidence(cell.cellId, sequence, historical, budgetSha256));
		for (const [index, raw] of raws.entries()) {
			const path = `qualification/milestone-9/${cell.cellId}.run-${String(index + 1)}.raw.json`;
			const bytes = jsonBytes(raw);
			await writeEvidence(directory, path, bytes);
			Object.assign(cell.runs[index], pin(path, bytes));
		}
		const cohort = createM9SoakCohort(raws, { config: historical, spec: SPEC, budgetSha256 });
		const path = `qualification/milestone-9/${cell.cellId}.cohort.json`;
		const bytes = jsonBytes(cohort);
		await writeEvidence(directory, path, bytes);
		Object.assign(cell.cohort, pin(path, bytes));
		cell.status = 'accepted';
	}

	const audit = await auditMilestone9QualificationEvidence({
		repositoryRoot: directory,
		register,
		behaviorEnvironmentMatrix: MATRIX,
		soakSpec: SPEC,
		soakSpecBytes: SPEC_BYTES,
	}, {
		loadHistoricalQualityBudget: async (revision) => {
			assert.equal(revision, SOURCE_REVISION);
			return historicalBytes;
		},
		loadCurrentQualityBudget: async () => currentBytes,
	});
	assert.equal(audit.passed, true);
	assert.equal(audit.qualificationReady, true);
	assert.equal(audit.auditedRunCount, 22);
	assert.equal(audit.cohorts.length, 11);
	assert.ok(audit.cohorts.every(({ status }) => status === 'accepted'));
});

function qualificationReadyConfig() {
	const config = structuredClone(CONFIG);
	const environment = config.environments.find(({ id }) => id === 'release-qualification-matrix');
	environment.status = 'active';
	environment.qualificationEligible = true;
	environment.eligibleWorkloadIds = [SPEC.workloadId];
	environment.fingerprint = {
		browserMatrixRevision: 'browser-v1',
		desktopMatrixRevision: 'desktop-v1',
		deviceMatrixRevision: 'device-v1',
	};
	return config;
}

function finalConfig(source) {
	const config = structuredClone(source);
	config.fixtures.find(({ id }) => id === SPEC.fixtureId).status = 'qualified';
	config.workloads.find(({ id }) => id === SPEC.workloadId).status = 'qualified';
	config.qualification.qualifiedWorkloadIds.push(SPEC.workloadId);
	return config;
}

function rawEvidence(matrixCellId, sequence, config, budgetSha256) {
	const fixture = generateM9SoakFixture(SPEC, 'qualification');
	const sampleTimes = Array.from({ length: 97 }, (_, index) => index * 300_000);
	const start = new Date(sequence === 1 ? '2026-09-01T00:00:00Z' : '2026-09-02T00:00:00Z');
	return {
		schemaVersion: 1,
		mode: 'qualification',
		workloadId: SPEC.workloadId,
		fixtureId: SPEC.fixtureId,
		runId: `M9-SOAK-${matrixCellId}-${String(sequence)}`,
		sequence,
		sourceRevision: SOURCE_REVISION,
		budgetSha256,
		matrixCellId,
		environmentId: 'release-qualification-matrix',
		rendererClass: 'hardware',
		environmentFingerprint: structuredClone(
			config.environments.find(({ id }) => id === 'release-qualification-matrix').fingerprint,
		),
		collection: {
			attemptCount: 1,
			retryCount: 0,
			hostedRunner: false,
			startedAt: start.toISOString(),
			endedAt: new Date(start.getTime() + 28_800_000).toISOString(),
			elapsedTimeSource: 'monotonic',
			monotonicDurationMs: 28_800_000,
			workloadRunnerSha256: '1'.repeat(64),
			packageSha256: sha256(Buffer.from(matrixCellId)),
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
			heap: sampleTimes.map((elapsedMs) => ({
				elapsedMs, retainedJsHeapBytes: 100 * 1024 * 1024, forcedCollections: 3,
			})),
			electronRss: sampleTimes.map((elapsedMs) => ({
				elapsedMs, rssBytes: 500 * 1024 * 1024,
			})),
			avDrift: sampleTimes.map((elapsedMs) => ({ elapsedMs, driftMs: 0 })),
			audioDropouts: [],
			droppedFrames: [],
			autosaves: fixture.schedule.filter(({ kind }) => kind === 'autosave')
				.map(({ eventId }) => ({ eventId, status: 'succeeded' })),
			jobs: [{ jobId: 'durable-job', terminalState: 'completed', recovered: true }],
		},
		qualification: {
			browserChecks: [{ id: 'browser', passed: true }],
			desktopChecks: [{ id: 'desktop', passed: true }],
			migrationChecks: [{ id: 'migration', passed: true }],
			defects: [],
		},
	};
}

async function writeEvidence(root, path, bytes) {
	const absolute = join(root, path);
	await mkdir(dirname(absolute), { recursive: true });
	await writeFile(absolute, bytes);
}

function pin(path, bytes) {
	return { path, byteLength: bytes.byteLength, sha256: sha256(bytes) };
}

function jsonBytes(value) {
	return Buffer.from(`${JSON.stringify(value, null, '\t')}\n`, 'utf8');
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
