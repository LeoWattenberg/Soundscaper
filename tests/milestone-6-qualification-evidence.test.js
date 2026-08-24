/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
	MILESTONE_6_QUALIFICATION_PROFILE_IDS,
	auditMilestone6QualificationEvidence,
	createMilestone6QualificationCohort,
	isAuditedMilestone6QualificationEvidence,
	readMilestone6QualificationEvidenceRegister,
	validateMilestone6QualificationEvidenceRegister,
} from '../scripts/lib/milestone-6-qualification-evidence.mjs';
import { NATIVE_OS_LAB_PROFILES_V2 } from '../scripts/lib/native-os-lab-schema.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const SOURCE_REVISION = 'a'.repeat(40);
const CONFIG = JSON.parse(await readFile(new URL('../config/quality-budgets.json', import.meta.url), 'utf8'));

test('the pending register reserves the exact fixed RTX and native profile matrix', async () => {
	const register = await readMilestone6QualificationEvidenceRegister(ROOT);
	assert.equal(register.status, 'pending-external');
	assert.deepEqual(
		register.measurements.map(({ profileId }) => profileId),
		MILESTONE_6_QUALIFICATION_PROFILE_IDS,
	);
	assert.equal(register.measurements.length, 19);
});

test('pending admission is closed and the audit does not touch missing external evidence', async () => {
	const register = structuredClone(await readMilestone6QualificationEvidenceRegister(ROOT));
	for (const [mutate, expected] of [
		[(value) => value.measurements.pop(), /exact 19-profile matrix/iu],
		[(value) => value.measurements.reverse(), /order is not exact/iu],
		[(value) => { value.measurements[0].environmentId = 'native-os-lab-matrix'; }, /order is not exact/iu],
		[(value) => { value.status = 'accepted'; }, /source revision\/blocker is invalid/iu],
		[(value) => { value.status = 'complete'; }, /status is unsupported/iu],
		[(value) => { value.cohort.path = 'qualification/milestone-6/invented.json'; },
			/must not claim accepted evidence pins/iu],
		[(value) => { value.extra = true; }, /must contain the exact fields/iu],
	]) {
		const changed = structuredClone(register);
		mutate(changed);
		assert.throws(() => validateMilestone6QualificationEvidenceRegister(changed), expected);
	}
	const audit = await auditMilestone6QualificationEvidence({ repositoryRoot: ROOT }, {
		loadHistoricalQualityBudget: async () => { throw new Error('pending audit loaded history'); },
	});
	assert.equal(audit.passed, true);
	assert.equal(audit.qualificationReady, false);
	assert.equal(audit.auditedMeasurementCount, 0);
	assert.equal(audit.matrix.length, 19);
	assert.deepEqual(
		[audit.collectionContract.timingWarmupTrials, audit.collectionContract.timingTrials,
			audit.collectionContract.retryCount, audit.collectionContract.hostedRunner,
			audit.collectionContract.metricIds.length],
		[1, 5, 0, false, 11],
	);
	assert.equal(isAuditedMilestone6QualificationEvidence(audit), true);
	assert.equal(isAuditedMilestone6QualificationEvidence(structuredClone(audit)), false);
	await assert.rejects(
		auditMilestone6QualificationEvidence({ repositoryRoot: ROOT, register }, {
			loadCurrentQualityBudget: async () => evidenceBytes(finalConfig()),
		}),
		/pending.*qualified|qualified workload claim/iu,
	);
});

test('accepted evidence recomputes all 209 verdicts from the complete bound matrix', async (context) => {
	const fixture = await acceptedFixture(context);
	const audit = await auditMilestone6QualificationEvidence({
		repositoryRoot: fixture.root,
		register: fixture.register,
	}, {
		loadHistoricalQualityBudget: async (revision) => {
			assert.equal(revision, SOURCE_REVISION);
			return fixture.configBytes;
		},
		loadCurrentQualityBudget: async () => fixture.currentConfigBytes,
	});
	assert.equal(audit.passed, true);
	assert.equal(audit.qualificationReady, true);
	assert.equal(audit.auditedMeasurementCount, 19);
	assert.equal(audit.cohort.evaluation.metricCount, 209);
	assert.deepEqual(audit.cohort.profileIds, MILESTONE_6_QUALIFICATION_PROFILE_IDS);
	assert.ok(audit.cohort.profiles.every(({ metrics, rawSampleCounts }) => (
		Object.keys(metrics).length === 11
		&& rawSampleCounts.warmupRuns === 1
		&& rawSampleCounts.audioRenderRuns === 5
		&& rawSampleCounts.videoRenderRuns === 10
	)));
	await assert.rejects(
		auditMilestone6QualificationEvidence({
			repositoryRoot: fixture.root,
			register: fixture.register,
		}, {
			loadHistoricalQualityBudget: async () => fixture.configBytes,
			loadCurrentQualityBudget: async () => fixture.configBytes,
		}),
		/final current qualified workload registration/iu,
	);
});

test('accepted records refuse retries, hosted runners, sample drift, and metric-set drift', () => {
	for (const failure of [
		'retry', 'hosted', 'warmup', 'timed', 'metrics', 'threshold',
		'qualification', 'premature-registry',
	]) {
		const config = qualificationReadyConfig();
		const records = acceptedMeasurements(config);
		if (failure === 'retry') records[0].collection.retryCount = 1;
		if (failure === 'hosted') records[0].collection.hostedRunner = true;
		if (failure === 'warmup') records[0].measurement.warmupRenderSeconds.push(101);
		if (failure === 'timed') records[0].measurement.audioRenderSeconds.pop();
		if (failure === 'metrics') config.workloads.find(({ id }) => id === 'm6-reference-master-delivery')
			.thresholds.pop();
		if (failure === 'threshold') records[0].measurement.videoArtifacts[0].frameCountError = 1;
		if (failure === 'qualification') config.workloads.find(
			({ id }) => id === 'm6-reference-master-delivery',
		).status = 'planned';
		if (failure === 'premature-registry') {
			config.qualification.qualifiedWorkloadIds.push('m6-reference-master-delivery');
		}
		if (['qualification', 'premature-registry'].includes(failure)) {
			const changedBudget = budgetDigest(config);
			for (const record of records) record.budgetSha256 = changedBudget;
		}
		const expected = {
			retry: /no retries or hosted runner/iu,
			hosted: /no retries or hosted runner/iu,
			warmup: /must contain exactly .+ timed runs/iu,
			timed: /must contain exactly .+ timed runs/iu,
			metrics: /workload registration is not exact/iu,
			threshold: /profile .+ failed:/iu,
			qualification: /qualification-ready fixtures\/workload/iu,
			'premature-registry': /must not claim final qualified registration/iu,
		}[failure];
		assert.throws(
			() => createMilestone6QualificationCohort(records, config, budgetDigest(config)),
			expected,
			failure,
		);
	}
});

test('accepted records bind one source, exact environment, package, and runtime payloads', () => {
	for (const failure of [
		'source', 'source-cross', 'fingerprint', 'native-host', 'native-fingerprint',
		'native-package', 'cross-package',
	]) {
		const config = qualificationReadyConfig();
		const records = acceptedMeasurements(config);
		if (failure === 'source') records[1].sourceRevision = 'b'.repeat(40);
		// The fixed profile carries no lab binding, so only the cross-record
		// check can catch its drifted revision.
		if (failure === 'source-cross') records[0].sourceRevision = 'b'.repeat(40);
		// Replace, never mutate: the fixture aliases the config's registered
		// fingerprint, and mutating through the alias changes both sides of the
		// comparison (and the budget digest), missing the fingerprint check.
		if (failure === 'fingerprint') {
			records[0].measurement.fingerprint = {
				...records[0].measurement.fingerprint, gpuDeviceId: 'different',
			};
		}
		if (failure === 'native-host') records[1].labBinding.physicalHost.cpuModel = 'different';
		if (failure === 'native-fingerprint') {
			records[1].measurement.fingerprint = {
				...records[1].measurement.fingerprint, cpuModel: 'different',
			};
		}
		if (failure === 'native-package') records[1].packageBindings[0].packageSha256 = digest('different');
		if (failure === 'cross-package') {
			records[2].packageBindings[0].packageSha256 = digest('other-windows-package');
			records[2].labBinding.artifacts.packageSha256 = records[2].packageBindings[0].packageSha256;
		}
		const expected = {
			source: /native host\/package\/source binding is invalid/iu,
			'source-cross': /must bind one source revision/iu,
			fingerprint: /fingerprint\/hardware binding is invalid/iu,
			'native-host': /native environment is not qualified/iu,
			'native-fingerprint': /native host\/package\/source binding is invalid/iu,
			'native-package': /native host\/package\/source binding is invalid/iu,
			'cross-package': /package\/runtime digest binding is inconsistent/iu,
		}[failure];
		assert.throws(
			() => createMilestone6QualificationCohort(records, config, budgetDigest(config)),
			expected,
			failure,
		);
	}
});

test('the auditor rejects pin drift, symbolic files, and a repinned fabricated cohort', async (context) => {
	for (const failure of ['raw-pin', 'symlink', 'cohort']) {
		const fixture = await acceptedFixture(context);
		if (failure === 'raw-pin') fixture.register.measurements[0].sha256 = '0'.repeat(64);
		else if (failure === 'symlink') {
			const path = join(fixture.root, fixture.register.measurements[0].path);
			const target = `${path}.target`;
			await writeFile(target, await readFile(path));
			await rm(path);
			await symlink(target, path);
		}
		else {
			const bytes = evidenceBytes({ invented: true });
			await writeFile(join(fixture.root, fixture.register.cohort.path), bytes);
			Object.assign(fixture.register.cohort, pin(fixture.register.cohort.path, bytes));
		}
		const expected = {
			'raw-pin': /digest does not match its pin/iu,
			symlink: /regular non-symbolic file path/iu,
			cohort: /recomputed canonical cohort/iu,
		}[failure];
		await assert.rejects(
			auditMilestone6QualificationEvidence({
				repositoryRoot: fixture.root,
				register: fixture.register,
			}, {
				loadHistoricalQualityBudget: async () => fixture.configBytes,
				loadCurrentQualityBudget: async () => fixture.currentConfigBytes,
			}),
			expected,
			failure,
		);
	}
});

test('the auditor refuses duplicate paths, budget drift, and traversal pins', async (context) => {
	// A register naming one evidence file twice can fill the 19-row matrix with
	// fewer than 19 measurements; the audit must count paths, not rows.
	const duplicated = await acceptedFixture(context);
	duplicated.register.measurements[1].path = duplicated.register.measurements[0].path;
	duplicated.register.measurements[1].byteLength = duplicated.register.measurements[0].byteLength;
	duplicated.register.measurements[1].sha256 = duplicated.register.measurements[0].sha256;
	await assert.rejects(
		auditMilestone6QualificationEvidence({
			repositoryRoot: duplicated.root,
			register: duplicated.register,
		}, {
			loadHistoricalQualityBudget: async () => duplicated.configBytes,
			loadCurrentQualityBudget: async () => duplicated.currentConfigBytes,
		}),
		/registered twice/iu,
	);

	// The historical budget is digest-pinned; different bytes for the pinned
	// revision must fail the audit, not silently re-anchor the thresholds.
	const drifted = await acceptedFixture(context);
	await assert.rejects(
		auditMilestone6QualificationEvidence({
			repositoryRoot: drifted.root,
			register: drifted.register,
		}, {
			loadHistoricalQualityBudget: async () => Buffer.concat([drifted.configBytes, Buffer.from('\n')]),
			loadCurrentQualityBudget: async () => drifted.currentConfigBytes,
		}),
		/historical budget digest does not match/iu,
	);

	// Pin paths are canonical and rooted; traversal segments refuse at validation.
	const traversal = await acceptedFixture(context);
	traversal.register.measurements[0].path = 'qualification/milestone-6/../../package.json';
	assert.throws(
		() => validateMilestone6QualificationEvidenceRegister(traversal.register),
		/canonical and repo-relative/iu,
	);
});

async function acceptedFixture(context) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-m6-qualification-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const config = qualificationReadyConfig();
	const configBytes = evidenceBytes(config);
	const currentConfigBytes = evidenceBytes(finalConfig(config));
	const budgetSha256 = sha256(configBytes);
	const register = structuredClone(await readMilestone6QualificationEvidenceRegister(ROOT));
	register.status = 'accepted';
	register.blockedBy = null;
	register.sourceRevision = SOURCE_REVISION;
	register.budgetSha256 = budgetSha256;
	const measurements = acceptedMeasurements(config, budgetSha256);
	for (const [index, value] of measurements.entries()) {
		const descriptor = register.measurements[index];
		const path = `qualification/milestone-6/${descriptor.profileId}.raw.json`;
		const bytes = evidenceBytes(value);
		await writeEvidence(root, path, bytes);
		Object.assign(descriptor, pin(path, bytes));
	}
	const cohort = createMilestone6QualificationCohort(measurements, config, budgetSha256);
	const cohortPath = 'qualification/milestone-6/m6-reference-master-delivery.cohort.json';
	const cohortBytes = evidenceBytes(cohort);
	await writeEvidence(root, cohortPath, cohortBytes);
	Object.assign(register.cohort, pin(cohortPath, cohortBytes));
	return { root, configBytes, currentConfigBytes, register };
}

function qualificationReadyConfig() {
	const config = structuredClone(CONFIG);
	const workloadId = 'm6-reference-master-delivery';
	config.workloads.find(({ id }) => id === workloadId).status = 'qualification-ready';
	for (const fixtureId of ['m6-reference-master-suite-v1', 'm6-reference-master-vertical-v1']) {
		config.fixtures.find(({ id }) => id === fixtureId).status = 'qualification-ready';
	}
	const fixed = config.environments.find(({ id }) => id === 'owner-qualified-windows-x64-rtx3090-01');
	fixed.status = 'active';
	fixed.qualificationEligible = true;
	fixed.eligibleWorkloadIds.push(workloadId);
	fixed.fingerprint = {
		...fixed.fingerprint,
		gpuDriverVersion: '599.1',
		powerMode: 'high-performance',
		displayMode: '1280x720@60',
	};
	const native = config.environments.find(({ id }) => id === 'native-os-lab-matrix');
	native.status = 'active';
	native.qualificationEligible = true;
	native.eligibleWorkloadIds.push(workloadId);
	for (const field of Object.keys(native.handoffGates)) native.handoffGates[field] = 'accepted';
	for (const platformId of Object.keys(native.physicalHosts)) {
		native.physicalHosts[platformId] = physicalHost(platformId);
		native.fingerprint[platformId] = physicalHost(platformId);
	}
	return config;
}

function finalConfig(candidate = qualificationReadyConfig()) {
	const config = structuredClone(candidate);
	const workloadId = 'm6-reference-master-delivery';
	config.workloads.find(({ id }) => id === workloadId).status = 'qualified';
	for (const fixtureId of ['m6-reference-master-suite-v1', 'm6-reference-master-vertical-v1']) {
		config.fixtures.find(({ id }) => id === fixtureId).status = 'qualified';
	}
	config.qualification.qualifiedWorkloadIds.push(workloadId);
	return config;
}

function acceptedMeasurements(config, budgetSha256 = budgetDigest(config)) {
	const fixed = config.environments.find(({ id }) => id === 'owner-qualified-windows-x64-rtx3090-01');
	return MILESTONE_6_QUALIFICATION_PROFILE_IDS.map((profileId, index) => {
		const profile = index === 0 ? null : NATIVE_OS_LAB_PROFILES_V2[index - 1];
		const environmentId = index === 0
			? 'owner-qualified-windows-x64-rtx3090-01'
			: 'native-os-lab-matrix';
		const platformId = index === 0 ? 'win32-x64' : profile.platformId;
		const runner = digest(`runner:${platformId}`);
		const packageBindings = index === 0
			? ['soundscaper', 'framescaper'].map((productId) => packageBinding(productId, 'win-x64'))
			: [packageBinding(profile.productId, targetId(profile.platformId))];
		const host = index === 0 ? fixed.fingerprint : physicalHost(profile.platformId);
		return {
			schemaVersion: 2,
			workloadId: 'm6-reference-master-delivery',
			profileId,
			environmentId,
			sourceRevision: SOURCE_REVISION,
			budgetSha256,
			rendererClass: 'hardware',
			collection: {
				attemptCount: 1,
				retryCount: 0,
				hostedRunner: false,
				workloadRunnerSha256: runner,
			},
			packageBindings,
			labBinding: index === 0 ? null : {
				schemaVersion: 2,
				environmentId: 'native-os-lab-matrix',
				platformId: profile.platformId,
				profileId,
				physicalHost: host,
				artifacts: {
					sourceRevision: SOURCE_REVISION,
					packageSha256: packageBindings[0].packageSha256,
					helperBinarySha256: null,
					nativeAddonSha256: null,
					mediaHostSha256: null,
					workloadRunnerSha256: runner,
					ofxScannerSha256: null,
					ofxRuntimeHostSha256: null,
				},
			},
			measurement: rawMeasurement(environmentId, platformId, host),
		};
	});
}

function rawMeasurement(environmentId, platformId, fingerprint) {
	const audioReport = {
		schemaVersion: 1,
		items: [
			{ code: 'delivery.conformance-duration', disposition: 'preserved', data: { errorSamples: 0 } },
			{ code: 'delivery.conformance-channel-map', disposition: 'preserved', data: { channelMapErrors: 0 } },
			{
				code: 'delivery.loudness-normalized',
				disposition: 'converted',
				data: {
					deliveredLoudnessLufs: -23,
					projectedLoudnessLufs: -23,
					deliveredTruePeakDb: -1,
					projectedTruePeakDb: -1,
				},
			},
		],
		counts: { preserved: 2, converted: 1, missing: 0, omitted: 0 },
	};
	const video = (artifactId, width, height) => ({
		artifactId,
		avDriftMs: 0,
		canvas: { width, height },
		captionCueErrorFrames: 0,
		frameCountError: 0,
		plannedConversions: [],
		publishedByteLength: 1,
		publishedComplete: true,
		report: { schemaVersion: 1, items: [], counts: {} },
	});
	return {
		schemaVersion: 1,
		workloadId: 'm6-reference-master-delivery',
		profile: 'reference-master-delivery-v1',
		environmentId,
		platformId,
		fingerprint,
		audioArtifacts: [{
			artifactId: 'audio-master',
			plannedConversions: audioReport.items.map(({ code, disposition }) => ({ code, disposition })),
			publishedByteLength: 1,
			publishedComplete: true,
			report: audioReport,
		}],
		videoArtifacts: [video('landscape', 1_280, 720), video('vertical', 1_080, 1_920)],
		audioRenderSeconds: [100, 100, 100, 100, 100],
		videoRenderSeconds: {
			'1280x720': [100, 100, 100, 100, 100],
			'1080x1920': [100, 100, 100, 100, 100],
		},
		warmupRenderSeconds: [100],
	};
}

function physicalHost(platformId) {
	const arm64 = platformId.includes('Arm64');
	return {
		hostId: `owner-${platformId}`,
		platformId,
		architecture: arm64 ? 'arm64' : 'x64',
		osImage: `qualified-${platformId}`,
		osVersion: '1',
		cpuModel: `CPU ${platformId}`,
		logicalCpuCount: 8,
		memoryBytes: 16_000_000_000,
		gpuModel: `GPU ${platformId}`,
		driverVersion: '1',
		audioInterfaceModel: 'Owner Interface',
		audioDriverVersion: '1',
		displayIdentity: 'Owner Display',
	};
}

function packageBinding(productId, target) {
	return {
		productId,
		targetId: target,
		packageSha256: digest(`package:${productId}:${target}`),
		runtimeManifestSha256: digest(`runtime:${productId}:${target}`),
	};
}

function targetId(platformId) {
	return ({
		windowsX64: 'win-x64', windowsArm64: 'win-arm64', macosArm64: 'mac-arm64',
		linuxX64: 'linux-x64', linuxArm64: 'linux-arm64',
	})[platformId];
}

function budgetDigest(config) {
	return sha256(evidenceBytes(config));
}

function digest(label) {
	return sha256(Buffer.from(label));
}

function evidenceBytes(value) {
	return Buffer.from(`${JSON.stringify(value, null, '\t')}\n`);
}

function pin(path, bytes) {
	return { path, byteLength: bytes.byteLength, sha256: sha256(bytes) };
}

async function writeEvidence(root, path, bytes) {
	const absolute = join(root, path);
	await mkdir(dirname(absolute), { recursive: true });
	await writeFile(absolute, bytes);
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}
