/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

/**
 * Derive only machine-verifiable Milestone 5 readiness. Human licensing,
 * reviewer, qualification, lab, cohort, and release-signature state is
 * deliberately absent from both the verdict and its canonical evidence hash.
 */
export function assessMilestone5AutomatedReadiness(value) {
	assertRecord(value, 'Milestone 5 automated-readiness inputs');
	const sources = sourceEvidence(value.sources);
	const payloads = payloadEvidence(value.payloadRows);
	const packageEvidence = value.packageAudit === null || value.packageAudit === undefined
		? null : packageEvidenceFor(value.packageAudit);
	const automatedEvidence = {
		schemaVersion: 1,
		sources,
		payloads,
		package: packageEvidence,
	};
	const automatedBlockers = authorityBlockers(value);
	for (const source of sources) {
		if (source.authenticationStatus !== 'authenticated'
			|| !sameDescriptor(source.expectedArchive, source.observedArchive)
			|| !sameDescriptor(source.expectedExtractedTree, source.observedExtractedTree)) {
			automatedBlockers.push(blocker(`source-authentication:${source.id}`,
				`Source ${source.id} has no authenticated archive and extracted-tree evidence.`));
		}
	}
	for (const payload of payloads) {
		if (payload.buildStatus !== 'built' || payload.payloadEvidence === null) {
			automatedBlockers.push(blocker(`payload:${payload.product}:${payload.targetId}`,
				`Payload ${payload.identity} has no authenticated built machine closure.`));
		}
	}
	if (packageEvidence !== null && packageEvidence.packages.some(({ content }) => content === null)) {
		automatedBlockers.push(blocker(
			`package-content:${packageEvidence.productId}:${packageEvidence.targetId}`,
			'The package cell has no authenticated installed-content closure.',
		));
	}
	const automatedEvidenceAuthenticated = value.assemblyInputsAuthenticated === true
		&& value.sourceInputsAudited === true
		&& value.payloadsAuthenticated === true
		&& value.sourceRevisionAuthenticated === true
		&& (packageEvidence === null || value.packageAudited === true)
		&& automatedBlockers.length === 0;
	const packageCellAutomatedReady = packageEvidence === null
		? null : automatedEvidenceAuthenticated && automatedBlockers.length === 0;
	const engineeringAutomatedReady = automatedEvidenceAuthenticated
		&& automatedBlockers.length === 0;
	return deepFreeze({
		automatedEvidenceAuthenticated,
		packageCellAutomatedReady,
		automatedStatus: packageEvidence === null
			? (engineeringAutomatedReady ? 'automated-inputs-ready' : 'automated-inputs-blocked')
			: (packageCellAutomatedReady ? 'automated-ready' : 'automated-blocked'),
		automatedEvidenceSha256: digest(automatedEvidence),
		automatedEvidence,
		automatedBlockers,
	});
}

function authorityBlockers(value) {
	const blockers = [];
	if (value.assemblyInputsAuthenticated !== true) blockers.push(blocker(
		'assembly-audit:missing', 'No repository-assembled input authority was supplied.',
	));
	if (value.sourceInputsAudited !== true) blockers.push(blocker(
		'source-audit:missing', 'No exact source archive and extracted-tree audit was supplied.',
	));
	if (value.payloadsAuthenticated !== true) blockers.push(blocker(
		'payload-audit:missing', 'No source-manifest and byte-authenticated payload audit was supplied.',
	));
	if (value.sourceRevisionAuthenticated !== true) blockers.push(blocker(
		'source-revision:unattributed', 'The automated evidence is not bound to one clean HEAD revision.',
	));
	if (value.packageAudit !== null && value.packageAudit !== undefined
		&& value.packageAudited !== true) blockers.push(blocker(
		'package-audit:missing', 'No exact staged-runtime and packaged-content audit was supplied.',
	));
	return blockers;
}

function sourceEvidence(value) {
	if (!Array.isArray(value)) throw new TypeError('Milestone 5 automated sources must be an array.');
	return value.map((source) => {
		assertRecord(source, 'Milestone 5 automated source');
		return {
			id: source.id,
			version: source.version,
			git: clone(source.git),
			expectedArchive: descriptor(source.archive),
			expectedExtractedTree: treeDescriptor(source.extractedTree),
			authenticationStatus: source.authenticationStatus,
			observedArchive: source.archiveEvidence === null || source.archiveEvidence === undefined
				? null : descriptor(source.archiveEvidence),
			observedExtractedTree: source.extractedTreeEvidence === null
				|| source.extractedTreeEvidence === undefined
				? null : treeDescriptor(source.extractedTreeEvidence),
		};
	});
}

function payloadEvidence(value) {
	if (!Array.isArray(value)) throw new TypeError('Milestone 5 automated payload rows must be an array.');
	return value.map((row) => {
		assertRecord(row, 'Milestone 5 automated payload row');
		return {
			identity: row.identity,
			product: row.product,
			targetId: row.targetId,
			buildStatus: row.buildStatus,
			payloadEvidence: row.payloadEvidence === null || row.payloadEvidence === undefined
				? null : clone(row.payloadEvidence),
		};
	});
}

function packageEvidenceFor(value) {
	assertRecord(value, 'Milestone 5 automated package audit');
	if (!Array.isArray(value.packages)) {
		throw new TypeError('Milestone 5 automated package descriptors must be an array.');
	}
	return {
		productId: value.productId,
		targetId: value.targetId,
		applicationVersion: value.applicationVersion,
		sourceRevision: value.sourceRevision,
		runtimeManifest: descriptor(value.runtimeManifest, ['name']),
		packages: value.packages.map((entry) => ({
			label: entry.label,
			...descriptor(entry, ['name']),
			content: entry.content === null || entry.content === undefined ? null : {
				status: entry.content.status,
				closureSha256: entry.content.closureSha256,
				contentManifestSha256: entry.content.contentManifestSha256,
				installedClosureSha256: entry.content.installedClosureSha256,
			},
		})),
	};
}

function descriptor(value, extraFields = []) {
	assertRecord(value, 'Milestone 5 automated byte descriptor');
	return Object.fromEntries([
		...extraFields.map((field) => [field, value[field]]),
		['byteLength', value.byteLength],
		['sha256', value.sha256],
	]);
}

function treeDescriptor(value) {
	assertRecord(value, 'Milestone 5 automated extracted-tree descriptor');
	return {
		algorithm: value.algorithm,
		fileCount: value.fileCount,
		sha256: value.sha256,
	};
}

function digest(value) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sameDescriptor(expected, observed) {
	return observed !== null
		&& Object.keys(expected).every((field) => observed[field] === expected[field]);
}

function blocker(id, reason) { return { id, reason }; }
function clone(value) { return structuredClone(value); }
function assertRecord(value, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object.`);
	}
}
function deepFreeze(value) {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}
