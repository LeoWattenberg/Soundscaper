/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

// A hosted workload that met every threshold qualifies through the registered
// `hardware-lower-bound` rule, so the run has to leave behind evidence in the
// exact shape `scripts/verify-quality-budget-result.mjs` and
// `scripts/audit-quality-result-cohorts.mjs` read: one accepted result naming
// one raw artifact beside it, bound by byte length and SHA-256.
const RESULT_SCHEMA_VERSION = 1;

/** Serialize one qualifying hosted workload as an accepted result and its raw pair. */
export function createHostedQualificationArtifacts(context) {
	const { workloads, config, environment, sourceRevision, budgetSha256, nodeVersion } = context;
	if (!Array.isArray(workloads)) throw new TypeError('Hosted qualification workloads must be an array.');
	if (!isRecord(environment)) return Object.freeze([]);
	// A rehearsal without a Git revision, or a runtime that is not the pinned
	// image, cannot stand behind a formal row; the run still keeps its summary.
	if (typeof sourceRevision !== 'string' || !/^[a-f\d]{40}$/u.test(sourceRevision)) return Object.freeze([]);
	if (typeof nodeVersion === 'string' && environment.fingerprint?.nodeVersion !== nodeVersion) {
		return Object.freeze([]);
	}
	const artifacts = [];
	for (const workload of workloads) {
		if (!isRecord(workload) || workload.qualificationEvidencePublished !== true) continue;
		const descriptor = findDescriptor(config?.workloads, workload.workloadId);
		if (!descriptor || !Array.isArray(descriptor.fixtureIds)) continue;
		artifacts.push(createArtifact({
			workload, descriptor, environment, sourceRevision, budgetSha256,
		}));
	}
	return Object.freeze(artifacts);
}

function createArtifact({ workload, descriptor, environment, sourceRevision, budgetSha256 }) {
	const rawFileName = `${workload.workloadId}.raw.json`;
	const rawBytes = serialize(workload);
	const result = {
		attemptCount: 1,
		budgetSha256,
		environmentFingerprint: { ...environment.fingerprint },
		environmentId: environment.id,
		fixtureIds: [...descriptor.fixtureIds],
		metrics: { ...workload.metrics },
		rawEvidence: Object.freeze({
			artifactName: rawFileName,
			byteLength: rawBytes.byteLength,
			sha256: sha256(rawBytes),
		}),
		rendererClass: workload.rendererClass,
		retryCount: 0,
		schemaVersion: RESULT_SCHEMA_VERSION,
		sourceRevision,
		workloadId: workload.workloadId,
	};
	return Object.freeze({
		workloadId: workload.workloadId,
		resultFileName: `${workload.workloadId}.accepted.json`,
		resultBytes: serialize(result),
		rawFileName,
		rawBytes,
	});
}

// The auditor compares the raw and accepted metric objects by their serialized
// text, so both files must be written from the same insertion order.
function serialize(value) {
	return Buffer.from(`${JSON.stringify(value, null, '\t')}\n`, 'utf8');
}

function findDescriptor(descriptors, id) {
	if (!Array.isArray(descriptors)) return null;
	const matches = descriptors.filter((candidate) => isRecord(candidate) && candidate.id === id);
	return matches.length === 1 ? matches[0] : null;
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
