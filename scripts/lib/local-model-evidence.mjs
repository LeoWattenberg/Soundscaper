/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Validates the local model evidence records that satisfy the `local-models`
 * future distribution gate in `config/production-licensing-matrix.json`.
 *
 * The gate names four enablement requirements. This module makes those four
 * slugs the mandatory key set of every record's `requirements` object, and
 * derives whether a model may be distributed from the recorded statuses, so an
 * incomplete record cannot be authored into a distributable state. It records
 * consistency between checked-in evidence and the gate; it is not a review.
 */

export const LOCAL_MODEL_REQUIREMENT_IDS = Object.freeze([
	'weights-and-code-license-review',
	'training-data-provenance-record',
	'model-card-and-use-restrictions',
	'versioned-download-notices-and-hashes',
]);

/** Only `recorded` satisfies a requirement; both other statuses block. */
export const LOCAL_MODEL_REQUIREMENT_STATUSES = Object.freeze(['recorded', 'pending', 'unresolved']);

export const LOCAL_MODEL_DISTRIBUTION_STATUSES = Object.freeze(['permitted', 'blocked']);

const RECORD_KEYS = Object.freeze([
	'id',
	'purpose',
	'runtimeFormat',
	'codeLicense',
	'weightsLicense',
	'attributionRequired',
	'distributionStatus',
	'blockedBy',
	'requirements',
	'provenanceSources',
	'evidence',
]);

const REQUIREMENT_KEYS = Object.freeze(['status', 'summary']);

const REFUSAL_KEYS = Object.freeze(['id', 'license', 'reason']);

const RUNTIME_FORMATS = Object.freeze(['onnx', 'ggml', 'gguf', 'native']);

const IDENTIFIER_PATTERN = /^[a-z\d][a-z\d.-]*[a-z\d]$/u;

/**
 * Licence markers that forbid redistribution in a commercial product. The
 * check is deliberately coarse and refuses on suspicion: a licence it cannot
 * recognise as redistributable is a licence a reviewer must name explicitly.
 */
const NON_REDISTRIBUTABLE_PATTERN = /non[- ]?commercial|\bnc\b|-nc-|research[- ](?:use[- ])?only|no[- ]derivatives|\bnd\b/iu;

function fail(message) {
	throw new Error(message);
}

function assertNonEmptyString(value, label) {
	if (typeof value !== 'string' || value.trim() === '') {
		fail(`${label} must be a non-empty string`);
	}
}

function assertExactKeys(value, expected, label) {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		fail(`${label} must be an object`);
	}
	const actual = Object.keys(value);
	const unexpected = actual.filter((key) => !expected.includes(key)).sort();
	const missing = expected.filter((key) => !actual.includes(key)).sort();
	if (unexpected.length > 0 || missing.length > 0) {
		fail(`${label}: unexpected record keys [${unexpected.join(', ')}], missing [${missing.join(', ')}]`);
	}
}

function assertRedistributable(value, label) {
	assertNonEmptyString(value, label);
	if (NON_REDISTRIBUTABLE_PATTERN.test(value)) {
		fail(`${label} is not redistributable: ${value}`);
	}
}

/** Requirement ids whose status is anything other than `recorded`, sorted. */
export function deriveBlockedBy(record) {
	const requirements = record?.requirements ?? {};
	return Object.entries(requirements)
		.filter(([, entry]) => entry?.status !== 'recorded')
		.map(([id]) => id)
		.sort();
}

export function deriveDistributionStatus(record) {
	return deriveBlockedBy(record).length === 0 ? 'permitted' : 'blocked';
}

function validateRequirements(record, requirementIds) {
	const { id, requirements } = record;
	const expected = [...requirementIds].sort();
	const actual = Object.keys(requirements ?? {}).sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
		fail(`${id}: requirements must answer exactly [${expected.join(', ')}], found [${actual.join(', ')}]`);
	}

	for (const requirementId of expected) {
		const entry = requirements[requirementId];
		const label = `${id}.${requirementId}`;
		assertExactKeys(entry, REQUIREMENT_KEYS, label);
		if (!LOCAL_MODEL_REQUIREMENT_STATUSES.includes(entry.status)) {
			fail(`${label}: status must be one of [${LOCAL_MODEL_REQUIREMENT_STATUSES.join(', ')}], found ${String(entry.status)}`);
		}
		assertNonEmptyString(entry.summary, `${label}: summary`);
	}
}

function validateRecord(record, { requirementIds, refusedIds, seen }) {
	if (typeof record !== 'object' || record === null || Array.isArray(record)) {
		fail('local model evidence records must be objects');
	}
	const id = record.id;
	assertNonEmptyString(id, 'record id');
	if (!IDENTIFIER_PATTERN.test(id)) {
		fail(`${id}: id must be lowercase, dot or dash separated`);
	}
	if (seen.has(id)) {
		fail(`${id}: duplicate record id`);
	}
	seen.add(id);

	assertExactKeys(record, RECORD_KEYS, id);

	if (refusedIds.includes(id)) {
		fail(`${id}: model is recorded as refused and cannot also be an evidence record`);
	}

	assertNonEmptyString(record.purpose, `${id}: purpose`);
	if (!RUNTIME_FORMATS.includes(record.runtimeFormat)) {
		fail(`${id}: runtimeFormat must be one of [${RUNTIME_FORMATS.join(', ')}], found ${String(record.runtimeFormat)}`);
	}
	assertRedistributable(record.codeLicense, `${id}: codeLicense`);
	assertRedistributable(record.weightsLicense, `${id}: weightsLicense`);
	if (typeof record.attributionRequired !== 'boolean') {
		fail(`${id}: attributionRequired must be a boolean`);
	}

	validateRequirements(record, requirementIds);

	if (!Array.isArray(record.provenanceSources) || record.provenanceSources.length === 0) {
		fail(`${id}: provenanceSources must list at least one upstream source`);
	}
	for (const source of record.provenanceSources) {
		if (typeof source !== 'string' || !source.startsWith('https://')) {
			fail(`${id}: provenanceSources must be https URLs, found ${String(source)}`);
		}
	}

	if (!Array.isArray(record.evidence) || record.evidence.length === 0) {
		fail(`${id}: evidence must cite at least one repository path`);
	}
	for (const reference of record.evidence) {
		if (typeof reference !== 'string' || /^[a-z][a-z\d+.-]*:/iu.test(reference) || reference.startsWith('/')) {
			fail(`${id}: evidence must be repository paths, found ${String(reference)}`);
		}
	}

	const blockedBy = deriveBlockedBy(record);
	if (!Array.isArray(record.blockedBy)) {
		fail(`${id}: blockedBy must be an array`);
	}
	const authored = [...record.blockedBy].sort();
	if (authored.length !== blockedBy.length || authored.some((value, index) => value !== blockedBy[index])) {
		fail(`${id}: blockedBy must list [${blockedBy.join(', ')}], found [${authored.join(', ')}]`);
	}

	const distributionStatus = deriveDistributionStatus(record);
	if (!LOCAL_MODEL_DISTRIBUTION_STATUSES.includes(record.distributionStatus)) {
		fail(`${id}: distributionStatus must be one of [${LOCAL_MODEL_DISTRIBUTION_STATUSES.join(', ')}]`);
	}
	if (record.distributionStatus !== distributionStatus) {
		fail(`${id}: distributionStatus must be ${distributionStatus} while blockedBy lists [${blockedBy.join(', ')}]`);
	}
	if (record.attributionRequired && !/\bCC-BY\b/iu.test(record.weightsLicense) && !/\bCC-BY\b/iu.test(record.codeLicense)) {
		fail(`${id}: attributionRequired must name the attribution licence in codeLicense or weightsLicense`);
	}

	return record;
}

/**
 * Validates every record against the requirement ids the gate names.
 * Throws on the first inconsistency; returns the records unchanged.
 */
export function validateLocalModelEvidence(records, { requirementIds, refusedIds = [] } = {}) {
	if (!Array.isArray(records)) {
		fail('local model evidence must be an array');
	}
	if (!Array.isArray(requirementIds) || requirementIds.length === 0) {
		fail('local model evidence needs the gate requirement ids');
	}
	const seen = new Set();
	for (const record of records) {
		validateRecord(record, { requirementIds, refusedIds, seen });
	}
	return records;
}

/** Validates the refusal list that keeps excluded weights excluded. */
export function validateRefusedLocalModels(entries) {
	if (!Array.isArray(entries)) {
		fail('refused local models must be an array');
	}
	const seen = new Set();
	for (const entry of entries) {
		if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
			fail('refused local models must be objects');
		}
		const id = entry.id;
		assertNonEmptyString(id, 'refused id');
		if (seen.has(id)) {
			fail(`${id}: duplicate refused id`);
		}
		seen.add(id);
		const actual = Object.keys(entry);
		const unexpected = actual.filter((key) => !REFUSAL_KEYS.includes(key)).sort();
		const missing = REFUSAL_KEYS.filter((key) => !actual.includes(key)).sort();
		if (unexpected.length > 0 || missing.length > 0) {
			fail(`${id}: unexpected refusal keys [${unexpected.join(', ')}], missing [${missing.join(', ')}]`);
		}
		assertNonEmptyString(entry.license, `${id}: license`);
		assertNonEmptyString(entry.reason, `${id}: reason`);
	}
	return entries;
}
