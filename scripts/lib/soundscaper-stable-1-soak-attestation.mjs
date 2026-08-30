/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, createPublicKey, verify } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
	boundedString,
	deepFreeze,
	exactRecord,
	nonNegativeInteger,
	positiveInteger,
	requireRecord,
} from './measurement-admission.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';

const AUTHORITY_FIELDS = Object.freeze([
	'kind', 'profileId', 'profileVersion', 'profileSha256', 'statementSchemaVersion',
	'signatureAlgorithm', 'workloadRunner', 'trustedKeyRegistry',
]);
const RUNNER_FIELDS = Object.freeze(['id', 'version']);
const FILE_PIN_FIELDS = Object.freeze(['path', 'byteLength', 'sha256']);
const REGISTRY_FIELDS = Object.freeze([
	'schemaVersion', 'profileId', 'profileVersion', 'status', 'blockedBy', 'keys',
]);
const KEY_FIELDS = Object.freeze([
	'keyId', 'algorithm', 'publicKeyPem', 'publicKeySha256',
]);
const OUTCOME_FIELDS = Object.freeze([
	'eventId', 'operationId', 'kind', 'startedMonotonicMs', 'endedMonotonicMs',
	'status', 'outcomeSha256',
]);
const ATTESTATION_FIELDS = Object.freeze([
	'schemaVersion', 'keyId', 'statement', 'signatureBase64',
]);
const STATEMENT_FIELDS = Object.freeze([
	'schemaVersion', 'profileId', 'profileVersion', 'profileSha256', 'workloadId',
	'fixtureId', 'runId', 'sequence', 'sourceRevision', 'packageInventorySha256',
	'matrixCellId', 'workloadRunnerId', 'workloadRunnerVersion', 'workloadRunnerSha256',
	'rawEvidenceSha256',
]);
const BINDING_FIELDS = Object.freeze([
	'sourceRevision', 'packageInventorySha256', 'matrixCellId', 'workloadRunnerVersion',
	'workloadRunnerSha256', 'runs',
]);
const RUN_BINDING_FIELDS = Object.freeze(['sequence', 'runId']);
const SHA256 = /^[a-f0-9]{64}$/u;
const REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SEMVER = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;

export function validateSoundscaperStable1SoakEvidenceAuthority(value) {
	const row = exactRecord(
		snapshotStrictJsonData(value, 'Soundscaper Stable 1 soak evidence authority'),
		AUTHORITY_FIELDS,
		'Soundscaper Stable 1 soak evidence authority',
	);
	if (row.kind !== 'signed-lab-attestation'
		|| row.profileId !== 'soundscaper-stable-1-soak-lab-attestation'
		|| row.signatureAlgorithm !== 'ed25519') {
		throw new Error('Soundscaper Stable 1 soak evidence authority identity is invalid.');
	}
	positiveInteger(row.profileVersion, 'Soundscaper Stable 1 soak attestation profile version');
	positiveInteger(row.statementSchemaVersion, 'Soundscaper Stable 1 soak statement schema version');
	const workloadRunner = exactRecord(
		row.workloadRunner, RUNNER_FIELDS, 'Soundscaper Stable 1 soak workload runner',
	);
	boundedString(workloadRunner.id, 1, 128, 'Soundscaper Stable 1 soak workload runner id');
	if (!SEMVER.test(workloadRunner.version)) {
		throw new Error('Soundscaper Stable 1 soak workload runner version is invalid.');
	}
	const trustedKeyRegistry = validateFilePin(
		row.trustedKeyRegistry, 'Soundscaper Stable 1 trusted lab key registry',
	);
	if (trustedKeyRegistry.path !== 'config/soundscaper-stable-1-soak-trusted-lab-keys.json') {
		throw new Error('Soundscaper Stable 1 trusted lab key registry path is invalid.');
	}
	const profileSha256 = sha256(canonicalBytes({
		kind: row.kind,
		profileId: row.profileId,
		profileVersion: row.profileVersion,
		statementSchemaVersion: row.statementSchemaVersion,
		signatureAlgorithm: row.signatureAlgorithm,
		workloadRunner,
	}));
	if (row.profileSha256 !== profileSha256) {
		throw new Error('Soundscaper Stable 1 soak attestation profile digest is invalid.');
	}
	return deepFreeze({
		...row,
		workloadRunner: { ...workloadRunner },
		trustedKeyRegistry: { ...trustedKeyRegistry },
	});
}

export function soundscaperStable1SoakRawFields(baseFields, spec) {
	return spec.evidenceAuthority === undefined
		? baseFields
		: [...baseFields, 'operationOutcomes', 'attestation'];
}

export function soundscaperStable1SoakCollectionFields(baseFields, spec) {
	return spec.evidenceAuthority === undefined
		? baseFields
		: [...baseFields, 'workloadRunnerId', 'workloadRunnerVersion'];
}

export function soundscaperStable1SoakRawEvidenceSha256(rawValue) {
	const raw = snapshotStrictJsonData(rawValue, 'Soundscaper Stable 1 soak raw evidence');
	const { attestation: _attestation, ...unsigned } = raw;
	return sha256(canonicalBytes(unsigned));
}

export function canonicalSoundscaperStable1SoakAttestationStatementBytes(value) {
	const statement = validateStatement(value);
	return canonicalBytes(statement);
}

export function validateSoundscaperStable1SoakRawAuthority(rawValue, specValue, fixtureValue, contextValue) {
	const raw = requireRecord(rawValue, 'Soundscaper Stable 1 soak raw evidence');
	const spec = requireRecord(specValue, 'Soundscaper Stable 1 soak specification');
	const fixture = requireRecord(fixtureValue, 'Soundscaper Stable 1 soak fixture');
	const authority = validateSoundscaperStable1SoakEvidenceAuthority(spec.evidenceAuthority);
	if (raw.schemaVersion !== 2) {
		throw new Error('Soundscaper Stable 1 signed soak raw evidence schemaVersion must be 2.');
	}
	const context = exactRecord(
		contextValue, ['trustedKeyRegistryBytes', 'evidenceBinding'],
		'Soundscaper Stable 1 soak authority context',
	);
	const registry = validateTrustedKeyRegistry(context.trustedKeyRegistryBytes, authority, true);
	const binding = validateEvidenceBinding(context.evidenceBinding, authority);
	validateRawBinding(raw, authority, binding);
	const operationOutcomes = validateOperationOutcomes(raw.operationOutcomes, fixture);
	const attestation = validateAttestation(raw, authority, registry);
	return deepFreeze({ operationOutcomes, attestation });
}

export function validateSoundscaperStable1SoakTrustedKeyRegistry(
	bytesValue, authorityValue, requireActive = false,
) {
	return validateTrustedKeyRegistry(
		bytesValue, validateSoundscaperStable1SoakEvidenceAuthority(authorityValue), requireActive,
	);
}

function validateOperationOutcomes(value, fixture) {
	if (!Array.isArray(value) || Reflect.ownKeys(value).length !== value.length + 1
		|| value.length !== fixture.schedule.length) {
		throw new Error('Soundscaper Stable 1 operation outcomes must cover the exact scheduled events.');
	}
	const durationMs = fixture.durationSeconds * 1_000;
	return value.map((entry, index) => {
		const outcome = exactRecord(entry, OUTCOME_FIELDS, `Soundscaper operationOutcomes[${index}]`);
		const scheduled = fixture.schedule[index];
		if (outcome.eventId !== scheduled.eventId || outcome.operationId !== scheduled.operationId
			|| outcome.kind !== scheduled.kind) {
			throw new Error('Soundscaper Stable 1 operation outcomes are not schedule-bound in exact order.');
		}
		nonNegativeInteger(outcome.startedMonotonicMs, 'Soundscaper operation start');
		nonNegativeInteger(outcome.endedMonotonicMs, 'Soundscaper operation end');
		if (outcome.startedMonotonicMs < scheduled.elapsedSeconds * 1_000
			|| outcome.endedMonotonicMs < outcome.startedMonotonicMs
			|| outcome.endedMonotonicMs > durationMs
			|| !['passed', 'failed'].includes(outcome.status)
			|| !SHA256.test(outcome.outcomeSha256)) {
			throw new Error(`Soundscaper Stable 1 operation outcome ${outcome.eventId} is invalid.`);
		}
		return { ...outcome };
	});
}

function validateAttestation(raw, authority, registry) {
	const envelope = exactRecord(raw.attestation, ATTESTATION_FIELDS, 'Soundscaper soak attestation');
	if (envelope.schemaVersion !== 1) throw new Error('Soundscaper soak attestation schema is invalid.');
	boundedString(envelope.keyId, 1, 128, 'Soundscaper soak attestation keyId');
	const statement = validateStatement(envelope.statement);
	const expected = {
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
	if (!isDeepStrictEqual(statement, expected)) {
		throw new Error('Soundscaper soak attestation does not bind the exact raw evidence.');
	}
	const key = registry.keys.find(({ keyId }) => keyId === envelope.keyId);
	if (key === undefined) throw new Error('Soundscaper soak attestation key is not trusted.');
	const signature = canonicalSignature(envelope.signatureBase64);
	if (!verify(null, canonicalBytes(statement), key.publicKey, signature)) {
		throw new Error('Soundscaper soak attestation signature is invalid.');
	}
	return {
		schemaVersion: 1,
		keyId: envelope.keyId,
		statement: { ...statement },
		signatureBase64: envelope.signatureBase64,
	};
}

function validateStatement(value) {
	const row = exactRecord(
		snapshotStrictJsonData(value, 'Soundscaper soak attestation statement'),
		STATEMENT_FIELDS,
		'Soundscaper soak attestation statement',
	);
	for (const field of [
		'profileSha256', 'packageInventorySha256', 'workloadRunnerSha256', 'rawEvidenceSha256',
	]) if (!SHA256.test(row[field])) throw new Error(`Soundscaper soak attestation ${field} is invalid.`);
	if (!REVISION.test(row.sourceRevision) || ![null, 1, 2].includes(row.sequence)) {
		throw new Error('Soundscaper soak attestation source/run identity is invalid.');
	}
	for (const field of [
		'profileId', 'workloadId', 'fixtureId', 'runId', 'matrixCellId', 'workloadRunnerId',
		'workloadRunnerVersion',
	]) boundedString(row[field], 1, 128, `Soundscaper soak attestation ${field}`);
	positiveInteger(row.schemaVersion, 'Soundscaper soak attestation statement schemaVersion');
	positiveInteger(row.profileVersion, 'Soundscaper soak attestation profileVersion');
	return row;
}

function validateEvidenceBinding(value, authority) {
	const row = exactRecord(value, BINDING_FIELDS, 'Soundscaper Stable 1 soak evidence binding');
	if (!REVISION.test(row.sourceRevision) || !SHA256.test(row.packageInventorySha256)
		|| !SHA256.test(row.workloadRunnerSha256)
		|| row.workloadRunnerVersion !== authority.workloadRunner.version) {
		throw new Error('Soundscaper Stable 1 soak evidence binding identity is invalid.');
	}
	boundedString(row.matrixCellId, 1, 128, 'Soundscaper Stable 1 soak evidence binding matrixCellId');
	if (!Array.isArray(row.runs) || ![1, 2].includes(row.runs.length)) {
		throw new Error('Soundscaper Stable 1 soak evidence binding requires a contract run or two qualification runs.');
	}
	const runs = row.runs.map((value, index) => {
		const run = exactRecord(value, RUN_BINDING_FIELDS, `Soundscaper soak run binding ${index}`);
		const expectedSequence = row.runs.length === 1 ? null : index + 1;
		if (run.sequence !== expectedSequence) throw new Error('Soundscaper soak run binding sequence is invalid.');
		boundedString(run.runId, 1, 128, 'Soundscaper soak run binding runId');
		return { ...run };
	});
	return { ...row, runs };
}

function validateRawBinding(raw, authority, binding) {
	if (raw.sourceRevision !== binding.sourceRevision) {
		throw new Error('Soundscaper signed soak source revision is not candidate-bound.');
	}
	if (raw.collection.packageSha256 !== binding.packageInventorySha256) {
		throw new Error('Soundscaper signed soak package inventory is not candidate-bound.');
	}
	if (raw.matrixCellId !== binding.matrixCellId) {
		throw new Error('Soundscaper signed soak matrix cell is not register-bound.');
	}
	const run = binding.runs.find(({ sequence }) => sequence === raw.sequence);
	if (run?.runId !== raw.runId) throw new Error('Soundscaper signed soak run identity is not register-bound.');
	if (raw.collection.workloadRunnerId !== authority.workloadRunner.id
		|| raw.collection.workloadRunnerVersion !== binding.workloadRunnerVersion) {
		throw new Error('Soundscaper signed soak workload runner identity is invalid.');
	}
	if (raw.collection.workloadRunnerSha256 !== binding.workloadRunnerSha256) {
		throw new Error('Soundscaper signed soak workload runner digest is not register-bound.');
	}
}

function validateTrustedKeyRegistry(bytesValue, authority, requireActive) {
	const bytes = Buffer.from(bytesValue);
	if (bytes.byteLength !== authority.trustedKeyRegistry.byteLength
		|| sha256(bytes) !== authority.trustedKeyRegistry.sha256) {
		throw new Error('Soundscaper Stable 1 trusted lab key registry does not match its specification pin.');
	}
	let parsed;
	try {
		parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch (error) {
		throw new Error('Soundscaper Stable 1 trusted lab key registry is invalid JSON.', { cause: error });
	}
	const row = exactRecord(parsed, REGISTRY_FIELDS, 'Soundscaper Stable 1 trusted lab key registry');
	if (row.schemaVersion !== 1 || row.profileId !== authority.profileId
		|| row.profileVersion !== authority.profileVersion
		|| !['pending-external', 'active'].includes(row.status)) {
		throw new Error('Soundscaper Stable 1 trusted lab key registry identity is invalid.');
	}
	if (!Array.isArray(row.keys) || Reflect.ownKeys(row.keys).length !== row.keys.length + 1) {
		throw new Error('Soundscaper Stable 1 trusted lab keys must be a dense array.');
	}
	if (row.status === 'pending-external') {
		if (typeof row.blockedBy !== 'string' || row.blockedBy.length === 0 || row.keys.length !== 0) {
			throw new Error('Pending Soundscaper trusted lab registry must not claim keys.');
		}
		if (requireActive) throw new Error('Soundscaper trusted lab key registry is not active.');
	} else if (row.blockedBy !== null || row.keys.length === 0) {
		throw new Error('Active Soundscaper trusted lab registry must contain trusted keys.');
	}
	const keys = row.keys.map((value, index) => validateKey(value, index));
	if (new Set(keys.map(({ keyId }) => keyId)).size !== keys.length) {
		throw new Error('Soundscaper trusted lab key IDs must be unique.');
	}
	return { ...row, keys };
}

function validateKey(value, index) {
	const row = exactRecord(value, KEY_FIELDS, `Soundscaper trusted lab keys[${index}]`);
	boundedString(row.keyId, 1, 128, 'Soundscaper trusted lab keyId');
	if (row.algorithm !== 'ed25519' || typeof row.publicKeyPem !== 'string'
		|| !SHA256.test(row.publicKeySha256)) {
		throw new Error('Soundscaper trusted lab key descriptor is invalid.');
	}
	const publicKey = createPublicKey(row.publicKeyPem);
	if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519'
		|| sha256(publicKey.export({ type: 'spki', format: 'der' })) !== row.publicKeySha256) {
		throw new Error('Soundscaper trusted lab public key does not match its descriptor.');
	}
	return { ...row, publicKey };
}

function validateFilePin(value, path) {
	const row = exactRecord(value, FILE_PIN_FIELDS, path);
	boundedString(row.path, 1, 256, `${path} path`);
	positiveInteger(row.byteLength, `${path} byteLength`);
	if (!SHA256.test(row.sha256)) throw new Error(`${path} digest is invalid.`);
	return row;
}

function canonicalSignature(value) {
	if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{86}==$/u.test(value)) {
		throw new Error('Soundscaper soak attestation signature is not canonical base64.');
	}
	const bytes = Buffer.from(value, 'base64');
	if (bytes.byteLength !== 64 || bytes.toString('base64') !== value) {
		throw new Error('Soundscaper soak attestation signature is invalid.');
	}
	return bytes;
}

function canonicalBytes(value) {
	return Buffer.from(`${JSON.stringify(sortJson(value), null, '\t')}\n`, 'utf8');
}

function sortJson(value) {
	if (Array.isArray(value)) return value.map(sortJson);
	if (value !== null && typeof value === 'object') return Object.fromEntries(
		Object.keys(value).sort().map((key) => [key, sortJson(value[key])]),
	);
	return value;
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
