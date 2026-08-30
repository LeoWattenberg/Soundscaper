/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	canonicalM9SoakFixtureBytes,
	generateM9SoakFixture,
	m9SoakScheduleSha256,
	validateM9SoakSpec,
} from '../scripts/lib/m9-soak-fixture.mjs';
import { createM9SoakCohort } from '../scripts/lib/m9-soak-evidence.mjs';
import {
	canonicalSoundscaperStable1SoakAttestationStatementBytes,
	soundscaperStable1SoakRawEvidenceSha256,
} from '../scripts/lib/soundscaper-stable-1-soak-attestation.mjs';

const ROOT = new URL('../', import.meta.url);
const SOURCE_REVISION = '0123456789abcdef0123456789abcdef01234567';
const PACKAGE_INVENTORY_SHA256 = 'a'.repeat(64);
const MATRIX_CELL_ID = 'soundscaper-desktop-linux-x64';
const RUNNER_SHA256 = 'b'.repeat(64);
const RUNNER_VERSION = '1.0.0';
const BASE_CONFIG = JSON.parse(await readFile(new URL('config/quality-budgets.json', ROOT), 'utf8'));
const SPEC_VALUE = JSON.parse(await readFile(
	new URL('config/soundscaper-stable-1-soak-spec.json', ROOT), 'utf8',
));
const PRODUCTION_KEYS = await readFile(
	new URL('config/soundscaper-stable-1-soak-trusted-lab-keys.json', ROOT),
);
const TEST_KEY = generateKeyPairSync('ed25519');
const TEST_KEY_ID = 'soundscaper-stable-1-test-lab';
const TEST_KEYS = registryBytes(TEST_KEY_ID, TEST_KEY.publicKey);
const SPEC = activeSpec(TEST_KEYS);

test('the Soundscaper soak spec pins its signed-attestation profile and pending real lab trust', () => {
	const productionSpec = validateM9SoakSpec(SPEC_VALUE);
	assert.equal(productionSpec.schemaVersion, 2);
	assert.equal(productionSpec.evidenceAuthority.kind, 'signed-lab-attestation');
	assert.equal(productionSpec.evidenceAuthority.profileVersion, 1);
	assert.equal(productionSpec.evidenceAuthority.workloadRunner.version, RUNNER_VERSION);
	assert.equal(
		productionSpec.evidenceAuthority.trustedKeyRegistry.sha256,
		sha256(PRODUCTION_KEYS),
	);
	assert.equal(JSON.parse(PRODUCTION_KEYS).status, 'pending-external');
});

test('two trusted signed runs retain every exact per-operation outcome', () => {
	const context = qualificationContext();
	const raws = [signedRaw(1, context), signedRaw(2, context)];
	const cohort = createM9SoakCohort(raws, context);

	assert.equal(cohort.status, 'accepted');
	assert.equal(cohort.runs.length, 2);
	for (const run of cohort.runs) {
		assert.equal(run.operationOutcomes.length, SPEC.generatedArtifacts.qualification.eventCount);
		assert.ok(run.operationOutcomes.every(({ status }) => status === 'passed'));
		assert.equal(run.evidenceAuthority.workloadRunnerSha256, RUNNER_SHA256);
		assert.equal(run.evidenceAuthority.attestationKeyId, TEST_KEY_ID);
	}
});

test('signed evidence is candidate, package inventory, cell, run, and runner bound', () => {
	for (const [name, mutate, expected] of [
		['source', (raw) => { raw.sourceRevision = 'f'.repeat(40); }, /source revision/iu],
		['package', (raw) => { raw.collection.packageSha256 = 'f'.repeat(64); }, /package inventory/iu],
		['cell', (raw) => { raw.matrixCellId = 'soundscaper-desktop-linux-arm64'; }, /matrix cell/iu],
		['run', (raw) => { raw.runId = 'invented-run'; }, /run identity/iu],
		['runner digest', (raw) => { raw.collection.workloadRunnerSha256 = 'e'.repeat(64); }, /runner digest/iu],
		['runner version', (raw) => { raw.collection.workloadRunnerVersion = '9.9.9'; }, /runner identity/iu],
	]) {
		const context = qualificationContext();
		const raws = [signedRaw(1, context), signedRaw(2, context)];
		mutate(raws[0]);
		resign(raws[0], TEST_KEY.privateKey);
		assert.throws(() => createM9SoakCohort(raws, context), expected, name);
	}
});

test('unsigned, untrusted, edited, incomplete, and failed operation claims cannot qualify', () => {
	for (const [name, mutate, expected] of [
		['unsigned', (raw) => { raw.attestation.signatureBase64 = ''; }, /signature/iu],
		['edited after signing', (raw) => { raw.operationOutcomes[0].outcomeSha256 = 'f'.repeat(64); },
			/attestation.*raw evidence|signature/iu],
		['missing outcome', (raw) => { raw.operationOutcomes.pop(); }, /operation outcomes/iu],
		['failed outcome', (raw) => { raw.operationOutcomes[0].status = 'failed'; }, /failed operation/iu],
	]) {
		const context = qualificationContext();
		const raws = [signedRaw(1, context), signedRaw(2, context)];
		mutate(raws[0]);
		if (name === 'failed outcome') resign(raws[0], TEST_KEY.privateKey);
		assert.throws(() => createM9SoakCohort(raws, context), expected, name);
	}

	const rogue = generateKeyPairSync('ed25519');
	const context = qualificationContext();
	const raws = [signedRaw(1, context), signedRaw(2, context)];
	resign(raws[0], rogue.privateKey);
	assert.throws(() => createM9SoakCohort(raws, context), /signature/iu);
});

test('the checked-in pending lab registry cannot be promoted by a caller-supplied signature', () => {
	const spec = validateM9SoakSpec(SPEC_VALUE);
	const context = qualificationContext({ spec, trustedKeyRegistryBytes: PRODUCTION_KEYS });
	const raws = [signedRaw(1, context), signedRaw(2, context)];
	assert.throws(() => createM9SoakCohort(raws, context), /trusted lab key registry is not active/iu);
});

function activeSpec(registry) {
	const value = structuredClone(SPEC_VALUE);
	value.evidenceAuthority.trustedKeyRegistry.byteLength = registry.byteLength;
	value.evidenceAuthority.trustedKeyRegistry.sha256 = sha256(registry);
	return validateM9SoakSpec(value);
}

function qualificationContext(overrides = {}) {
	const config = structuredClone(BASE_CONFIG);
	const environment = config.environments.find(({ id }) => id === SPEC_VALUE.environmentId);
	environment.status = 'active';
	environment.qualificationEligible = true;
	environment.fingerprint = {
		browserMatrixRevision: 'browser-v1',
		desktopMatrixRevision: 'desktop-v1',
		deviceMatrixRevision: 'device-v1',
	};
	const budgetSha256 = sha256(Buffer.from(JSON.stringify(config), 'utf8'));
	return {
		config,
		spec: SPEC,
		budgetSha256,
		trustedKeyRegistryBytes: TEST_KEYS,
		evidenceBinding: {
			sourceRevision: SOURCE_REVISION,
			packageInventorySha256: PACKAGE_INVENTORY_SHA256,
			matrixCellId: MATRIX_CELL_ID,
			workloadRunnerVersion: RUNNER_VERSION,
			workloadRunnerSha256: RUNNER_SHA256,
			runs: [
				{ sequence: 1, runId: 'SOUNDSCAPER-SOAK-1' },
				{ sequence: 2, runId: 'SOUNDSCAPER-SOAK-2' },
			],
		},
		...overrides,
	};
}

function signedRaw(sequence, context) {
	const spec = context.spec;
	const fixture = generateM9SoakFixture(spec, 'qualification');
	const sampleTimes = Array.from({ length: 97 }, (_, index) => index * 300_000);
	const start = new Date(sequence === 1 ? '2026-09-01T00:00:00Z' : '2026-09-02T00:00:00Z');
	const raw = {
		schemaVersion: 2,
		mode: 'qualification',
		workloadId: spec.workloadId,
		fixtureId: spec.fixtureId,
		runId: `SOUNDSCAPER-SOAK-${String(sequence)}`,
		sequence,
		sourceRevision: SOURCE_REVISION,
		budgetSha256: context.budgetSha256,
		matrixCellId: MATRIX_CELL_ID,
		environmentId: spec.environmentId,
		rendererClass: 'hardware',
		environmentFingerprint: structuredClone(
			context.config.environments.find(({ id }) => id === spec.environmentId).fingerprint,
		),
		collection: {
			attemptCount: 1,
			retryCount: 0,
			hostedRunner: false,
			startedAt: start.toISOString(),
			endedAt: new Date(start.getTime() + 28_800_000).toISOString(),
			elapsedTimeSource: 'monotonic',
			monotonicDurationMs: 28_800_000,
			workloadRunnerId: spec.evidenceAuthority.workloadRunner.id,
			workloadRunnerVersion: RUNNER_VERSION,
			workloadRunnerSha256: RUNNER_SHA256,
			packageSha256: PACKAGE_INVENTORY_SHA256,
		},
		fixture: {
			generatorRevision: spec.generator.revision,
			seed: spec.generator.seed,
			artifactSha256: sha256(canonicalM9SoakFixtureBytes(fixture)),
			scheduleSha256: m9SoakScheduleSha256(fixture),
			eventCount: fixture.schedule.length,
			executedEventIds: fixture.schedule.map(({ eventId }) => eventId),
		},
		operationOutcomes: fixture.schedule.map((event) => ({
			eventId: event.eventId,
			operationId: event.operationId,
			kind: event.kind,
			startedMonotonicMs: event.elapsedSeconds * 1_000,
			endedMonotonicMs: (event.elapsedSeconds * 1_000) + 1,
			status: 'passed',
			outcomeSha256: sha256(Buffer.from(`outcome:${event.eventId}`, 'utf8')),
		})),
		samples: {
			heap: sampleTimes.map((elapsedMs) => ({
				elapsedMs, retainedJsHeapBytes: 100 * 1024 * 1024, forcedCollections: 3,
			})),
			electronRss: sampleTimes.map((elapsedMs) => ({ elapsedMs, rssBytes: 500 * 1024 * 1024 })),
			avDrift: sampleTimes.map((elapsedMs) => ({ elapsedMs, driftMs: 0 })),
			audioDropouts: [],
			droppedFrames: [],
			autosaves: fixture.schedule.filter(({ kind }) => kind === 'autosave')
				.map(({ eventId }) => ({ eventId, status: 'succeeded' })),
			jobs: [{ jobId: `delivery-${String(sequence)}`, terminalState: 'completed', recovered: true }],
		},
		qualification: {
			browserChecks: [{ id: 'browser', passed: true }],
			desktopChecks: [{ id: 'desktop', passed: true }],
			migrationChecks: [{ id: 'family-v1', passed: true }],
			defects: [],
		},
		attestation: null,
	};
	resign(raw, TEST_KEY.privateKey);
	return raw;
}

function resign(raw, privateKey) {
	const authority = SPEC.evidenceAuthority;
	const statement = {
		schemaVersion: authority.statementSchemaVersion,
		profileId: authority.profileId,
		profileVersion: authority.profileVersion,
		profileSha256: authority.profileSha256,
		workloadId: raw.workloadId,
		fixtureId: raw.fixtureId,
		runId: raw.runId,
		sequence: raw.sequence,
		sourceRevision: raw.sourceRevision,
		packageInventorySha256: raw.collection.packageSha256,
		matrixCellId: raw.matrixCellId,
		workloadRunnerId: raw.collection.workloadRunnerId,
		workloadRunnerVersion: raw.collection.workloadRunnerVersion,
		workloadRunnerSha256: raw.collection.workloadRunnerSha256,
		rawEvidenceSha256: soundscaperStable1SoakRawEvidenceSha256(raw),
	};
	raw.attestation = {
		schemaVersion: 1,
		keyId: TEST_KEY_ID,
		statement,
		signatureBase64: sign(
			null,
			canonicalSoundscaperStable1SoakAttestationStatementBytes(statement),
			privateKey,
		).toString('base64'),
	};
}

function registryBytes(keyId, publicKey) {
	const der = publicKey.export({ type: 'spki', format: 'der' });
	return Buffer.from(`${JSON.stringify({
		schemaVersion: 1,
		profileId: 'soundscaper-stable-1-soak-lab-attestation',
		profileVersion: 1,
		status: 'active',
		blockedBy: null,
		keys: [{
			keyId,
			algorithm: 'ed25519',
			publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
			publicKeySha256: sha256(der),
		}],
	}, null, '\t')}\n`, 'utf8');
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
