/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	mkdtemp, mkdir, readFile, rm, symlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
	MILESTONE_5_QUALIFICATION_EVIDENCE_PATH,
	MILESTONE_5_QUALIFICATION_ROWS,
	auditMilestone5QualificationEvidence,
	isAuditedMilestone5QualificationEvidence,
	readMilestone5QualificationEvidenceRegister,
	validateMilestone5QualificationEvidenceRegister,
} from '../scripts/lib/milestone-5-qualification-evidence.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const QUALITY_BYTES = await readFile(join(ROOT, 'config/quality-budgets.json'));
const SOURCE_REVISION = 'f'.repeat(40);
const execFileAsync = promisify(execFile);

test('the checked-in register owns six ordered pending cohorts and 46 ordered measurements', async () => {
	const register = await readMilestone5QualificationEvidenceRegister(ROOT);
	assert.equal(MILESTONE_5_QUALIFICATION_EVIDENCE_PATH,
		'config/milestone-5-qualification-evidence.json');
	assert.deepEqual(register.rows.map(({ workloadId }) => workloadId),
		MILESTONE_5_QUALIFICATION_ROWS.map(({ workloadId }) => workloadId));
	assert.equal(register.rows.reduce((count, row) => count + row.measurements.length, 0), 46);
	for (const [index, row] of register.rows.entries()) {
		assert.equal(row.status, 'pending-external');
		assert.ok(row.blockedBy.length > 0);
		assert.equal(row.sourceRevision, null);
		assert.equal(row.budgetSha256, null);
		assert.deepEqual(row.measurements.map(({ labProfileId }) => labProfileId),
			MILESTONE_5_QUALIFICATION_ROWS[index].requiredLabProfileIds);
		assert.deepEqual(row.cohort, { path: null, byteLength: null, sha256: null });
		assert.ok(row.measurements.every(({ path, byteLength, sha256 }) =>
			path === null && byteLength === null && sha256 === null));
	}

	const audit = await auditMilestone5QualificationEvidence({ repositoryRoot: ROOT }, {
		loadHistoricalQualityBudget: async () => { throw new Error('pending rows must not load history'); },
		createM5NativeHelperCohort: () => { throw new Error('pending rows must not recompute'); },
		createM5bQualityCohortV2: () => { throw new Error('pending rows must not recompute'); },
	});
	assert.equal(audit.passed, true);
	assert.equal(isAuditedMilestone5QualificationEvidence(audit), true);
	assert.equal(isAuditedMilestone5QualificationEvidence(structuredClone(audit)), false);
	assert.equal(audit.qualificationReady, false);
	assert.equal(audit.status, 'pending-external');
	assert.equal(audit.acceptedCohortCount, 0);
	assert.equal(audit.measurementDescriptorCount, 46);
	assert.equal(audit.auditedMeasurementCount, 0);
	assert.equal(audit.blockers.length, 6);
});

test('register admission rejects reordered, incomplete, and self-contradictory rows', async () => {
	const register = structuredClone(await readMilestone5QualificationEvidenceRegister(ROOT));
	for (const mutate of [
		(value) => value.rows.reverse(),
		(value) => value.rows[0].measurements.pop(),
		(value) => { value.rows[0].measurements[0].labProfileId = value.rows[0].measurements[1].labProfileId; },
		(value) => { value.rows[0].cohort.path = 'qualification/milestone-5/invented.json'; },
		(value) => { value.rows[0].status = 'accepted'; },
		(value) => { value.rows[0].extra = true; },
	]) {
		const changed = structuredClone(register);
		mutate(changed);
		assert.throws(() => validateMilestone5QualificationEvidenceRegister(changed),
			/register|row|measurement|pending|accepted|exact/iu);
	}
});

test('accepted evidence verifies exact files and recomputes all six cohorts from 46 measurements', async (context) => {
	const fixture = await acceptedFixture(context);
	const constructorCalls = [];
	const audit = await auditMilestone5QualificationEvidence({
		repositoryRoot: fixture.root,
		register: fixture.register,
	}, fixture.dependencies(constructorCalls));

	assert.equal(audit.passed, true);
	assert.equal(audit.qualificationReady, true);
	assert.equal(audit.status, 'accepted');
	assert.equal(audit.acceptedCohortCount, 6);
	assert.equal(audit.auditedMeasurementCount, 46);
	assert.equal(audit.sourceRevision, SOURCE_REVISION);
	assert.equal(audit.budgetSha256, sha256(QUALITY_BYTES));
	assert.deepEqual(constructorCalls, MILESTONE_5_QUALIFICATION_ROWS.map(({ pipelineId }) => pipelineId));
	assert.equal(audit.cohorts.length, 6);
	assert.ok(audit.cohorts.every(({ status }) => status === 'accepted'));
});

test('the default historical loader reads the exact budget bytes from the pinned Git revision', async (context) => {
	const fixture = await acceptedFixture(context, { gitHistory: true });
	const dependencies = fixture.dependencies([]);
	delete dependencies.loadHistoricalQualityBudget;
	const audit = await auditMilestone5QualificationEvidence({
		repositoryRoot: fixture.root,
		register: fixture.register,
	}, dependencies);
	assert.equal(audit.qualificationReady, true);
	assert.equal(audit.sourceRevision, fixture.sourceRevision);
	assert.equal(audit.budgetSha256, sha256(QUALITY_BYTES));
});

test('accepted evidence rejects byte drift, symlinks, profile relabelling, and cohort fabrication', async (context) => {
	for (const failure of ['raw-digest', 'cohort-bytes', 'profile', 'symlink']) {
		const fixture = await acceptedFixture(context);
		const first = fixture.register.rows[0];
		if (failure === 'raw-digest') first.measurements[0].sha256 = '0'.repeat(64);
		if (failure === 'cohort-bytes') {
			const path = join(fixture.root, first.cohort.path);
			const bytes = Buffer.from('{"invented":true}\n');
			await writeFile(path, bytes);
			first.cohort.byteLength = bytes.byteLength;
			first.cohort.sha256 = sha256(bytes);
		}
		if (failure === 'profile') {
			const descriptor = first.measurements[0];
			const path = join(fixture.root, descriptor.path);
			const value = JSON.parse(await readFile(path, 'utf8'));
			value.labBinding.profileId = first.measurements[1].labProfileId;
			const bytes = evidenceBytes(value);
			await writeFile(path, bytes);
			descriptor.byteLength = bytes.byteLength;
			descriptor.sha256 = sha256(bytes);
		}
		if (failure === 'symlink') {
			const descriptor = first.measurements[0];
			const path = join(fixture.root, descriptor.path);
			const target = `${path}.target`;
			await writeFile(target, await readFile(path));
			await rm(path);
			await symlink(target, path);
		}
		await assert.rejects(
			auditMilestone5QualificationEvidence({
				repositoryRoot: fixture.root,
				register: fixture.register,
			}, fixture.dependencies([])),
			/digest|byte|profile|regular non-symbolic|recomputed/iu,
			failure,
		);
	}
});

test('accepted evidence enforces one historical budget, host identity, and product payload per platform', async (context) => {
	for (const failure of ['budget', 'host', 'payload']) {
		const fixture = await acceptedFixture(context);
		const row = fixture.register.rows[2];
		if (failure === 'budget') row.budgetSha256 = '0'.repeat(64);
		if (failure === 'host' || failure === 'payload') {
			const descriptor = row.measurements[0];
			const path = join(fixture.root, descriptor.path);
			const value = JSON.parse(await readFile(path, 'utf8'));
			if (failure === 'host') value.labBinding.physicalHost.cpuModel = 'Different CPU';
			else value.labBinding.artifacts.packageSha256 = 'e'.repeat(64);
			const bytes = evidenceBytes(value);
			await writeFile(path, bytes);
			descriptor.byteLength = bytes.byteLength;
			descriptor.sha256 = sha256(bytes);
			await repinCohort(fixture, row);
		}
		await assert.rejects(
			auditMilestone5QualificationEvidence({
				repositoryRoot: fixture.root,
				register: fixture.register,
			}, fixture.dependencies([])),
			/historical budget|one source revision and budget|physical host|payload digest/iu,
			failure,
		);
	}
});

async function acceptedFixture(context, { gitHistory = false } = {}) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-m5-qualification-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	let sourceRevision = SOURCE_REVISION;
	if (gitHistory) {
		await writeEvidence(root, 'config/quality-budgets.json', QUALITY_BYTES);
		await execFileAsync('git', ['init', '--quiet'], { cwd: root });
		await execFileAsync('git', ['add', 'config/quality-budgets.json'], { cwd: root });
		await execFileAsync('git', [
			'-c', 'user.name=Soundscaper Test', '-c', 'user.email=test@soundscaper.invalid',
			'commit', '--quiet', '-m', 'fixture quality budget',
		], { cwd: root });
		const revision = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
		sourceRevision = revision.stdout.trim();
	}
	const register = structuredClone(await readMilestone5QualificationEvidenceRegister(ROOT));
	for (const row of register.rows) {
		row.status = 'accepted';
		row.blockedBy = null;
		row.sourceRevision = sourceRevision;
		row.budgetSha256 = sha256(QUALITY_BYTES);
		for (const descriptor of row.measurements) {
			const measurement = measurementFor(row, descriptor.labProfileId);
			const path = `qualification/milestone-5/${row.workloadId}/${descriptor.labProfileId}.raw.json`;
			const bytes = evidenceBytes(measurement);
			await writeEvidence(root, path, bytes);
			Object.assign(descriptor, { path, byteLength: bytes.byteLength, sha256: sha256(bytes) });
		}
		await repinCohort({ root, register }, row);
	}
	return {
		root,
		register,
		sourceRevision,
		dependencies(calls) {
			return {
				loadHistoricalQualityBudget: async (revision) => {
					assert.equal(revision, sourceRevision);
					return QUALITY_BYTES;
				},
				createM5NativeHelperCohort(measurements, _config, budgetSha256) {
					assert.equal(budgetSha256, sha256(QUALITY_BYTES));
					calls.push(null);
					return fakeCohort(measurements, null);
				},
				createM5bQualityCohortV2(pipelineId, measurements, _config, budgetSha256) {
					assert.equal(budgetSha256, sha256(QUALITY_BYTES));
					calls.push(pipelineId);
					return fakeCohort(measurements, pipelineId);
				},
			};
		},
	};
}

function measurementFor(row, labProfileId) {
	const profile = profileById(labProfileId);
	const platformId = profile.platformId;
	const productByte = row.productId === 'soundscaper' ? 'a' : 'b';
	const platformByte = String('12345'[platformIndex(platformId)]);
	return {
		schemaVersion: 2,
		workloadId: row.workloadId,
		fixtureId: fixtureId(row),
		environmentId: 'native-os-lab-matrix',
		platformId,
		sourceRevision: row.sourceRevision,
		budgetSha256: sha256(QUALITY_BYTES),
		...(row.pipelineId === null ? {} : {
			profileId: row.pipelineId,
		}),
		labBinding: {
			schemaVersion: 2,
			environmentId: 'native-os-lab-matrix',
			platformId,
			profileId: labProfileId,
			physicalHost: physicalHost(platformId),
			artifacts: {
				sourceRevision: row.sourceRevision,
				packageSha256: `${productByte}${platformByte}`.padEnd(64, productByte),
				helperBinarySha256: row.productId === 'soundscaper' ? 'c'.repeat(64) : null,
				nativeAddonSha256: row.productId === 'soundscaper' ? 'd'.repeat(64) : null,
				mediaHostSha256: row.productId === 'framescaper' ? 'e'.repeat(64) : null,
				workloadRunnerSha256: sha256(row.workloadId),
				ofxScannerSha256: row.pipelineId === 'openfx' ? '8'.repeat(64) : null,
				ofxRuntimeHostSha256: row.pipelineId === 'openfx' ? '9'.repeat(64) : null,
			},
		},
	};
}

function fakeCohort(measurements, pipelineId) {
	return {
		schemaVersion: 2,
		status: 'accepted',
		workloadId: measurements[0].workloadId,
		environmentId: 'native-os-lab-matrix',
		sourceRevision: measurements[0].sourceRevision,
		budgetSha256: measurements[0].budgetSha256,
		...(pipelineId === null ? {} : { profileId: pipelineId }),
		labProfileIds: measurements.map(({ labBinding }) => labBinding.profileId),
		qualificationEvidencePublished: true,
		evaluation: { passed: true, failures: [] },
	};
}

async function repinCohort(fixture, row) {
	const measurements = await Promise.all(row.measurements.map(async ({ path }) =>
		JSON.parse(await readFile(join(fixture.root, path), 'utf8'))));
	const cohort = fakeCohort(measurements, row.pipelineId);
	const bytes = evidenceBytes(cohort);
	const path = `qualification/milestone-5/${row.workloadId}.complete-profile.accepted.json`;
	await writeEvidence(fixture.root, path, bytes);
	Object.assign(row.cohort, { path, byteLength: bytes.byteLength, sha256: sha256(bytes) });
}

async function writeEvidence(root, path, bytes) {
	await mkdir(dirname(join(root, path)), { recursive: true });
	await writeFile(join(root, path), bytes);
}

function physicalHost(platformId) {
	return {
		hostId: `host-${platformId}`,
		platformId,
		architecture: platformId.endsWith('X64') ? 'x64' : 'arm64',
		osImage: 'fixed-image', osVersion: '1', cpuModel: 'fixed-cpu', logicalCpuCount: 8,
		memoryBytes: 16 * 1024 * 1024 * 1024, gpuModel: 'fixed-gpu', driverVersion: '1',
		audioInterfaceModel: 'fixed-audio', audioDriverVersion: '1', displayIdentity: 'fixed-display',
	};
}

function profileById(id) {
	for (const row of MILESTONE_5_QUALIFICATION_ROWS) {
		const profile = row.profiles.find((candidate) => candidate.id === id);
		if (profile) return profile;
	}
	throw new Error(`Unknown fixture profile ${id}`);
}

function fixtureId(row) {
	return {
		'm5-native-helper-and-audio': 'm5-helper-fault-and-loopback-v1',
		'm5b-native-media-plan-parity-and-decode': 'm5b-native-media-parity-and-longform-v1',
		'm5b-professional-media-tier': 'm5b-professional-format-row-suite-v1',
		'm5b-persistent-services-recovery': 'm5b-persistent-services-fault-v1',
		'm5b-clean-external-display': 'm5b-clean-display-30m-v1',
		'm5b-openfx-isolation-and-packaging': 'm5b-openfx-conformance-and-hostile-v1',
	}[row.workloadId];
}

function platformIndex(platformId) {
	return ['windowsX64', 'windowsArm64', 'macosArm64', 'linuxX64', 'linuxArm64'].indexOf(platformId);
}

function evidenceBytes(value) {
	return Buffer.from(`${JSON.stringify(value, null, '\t')}\n`);
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}
