/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Audit only machine-verifiable Milestone 5 inputs. This is a package check,
 * not a human review or release decision.
 */
export function assessMilestone5PackageAuditResult(value) {
	assertRecord(value, 'Milestone 5 package-audit result inputs');
	const sources = sourceChecks(value.sources);
	const payloads = payloadChecks(value.payloadRows);
	const packageChecks = value.packageAudit === null || value.packageAudit === undefined
		? null : packageChecksFor(value.packageAudit);
	const checks = {
		schemaVersion: 1,
		sources,
		payloads,
		package: packageChecks,
	};
	const failures = inputFailures(value);
	for (const source of sources) {
		if (source.authenticationStatus !== 'authenticated'
			|| !sameDescriptor(source.expectedArchive, source.observedArchive)
			|| !sameDescriptor(source.expectedExtractedTree, source.observedExtractedTree)) {
			failures.push(failure(`source-authentication:${source.id}`,
				`Source ${source.id} has no verified archive and extracted-tree match.`));
		}
	}
	for (const payload of payloads) {
		if (payload.buildStatus !== 'built' || payload.payload === null) {
			failures.push(failure(`payload:${payload.product}:${payload.targetId}`,
				`Payload ${payload.identity} has no verified built file closure.`));
		}
	}
	if (packageChecks !== null && packageChecks.packages.some(({ content }) => content === null)) {
		failures.push(failure(
			`package-content:${packageChecks.productId}:${packageChecks.targetId}`,
			'The package has no verified installed-content closure.',
		));
	}
	const passed = value.repositoryInputsVerified === true
		&& value.sourceInputsAudited === true
		&& value.payloadsAuthenticated === true
		&& value.sourceRevisionVerified === true
		&& (packageChecks === null || value.packageAudited === true)
		&& failures.length === 0;
	return deepFreeze({
		passed,
		status: passed ? 'passed' : 'failed',
		checks,
		failures,
	});
}

function inputFailures(value) {
	const failures = [];
	if (value.repositoryInputsVerified !== true) failures.push(failure(
		'input-verification:missing', 'The repository inputs were not verified in this process.',
	));
	if (value.sourceInputsAudited !== true) failures.push(failure(
		'source-audit:missing', 'No exact source archive and extracted-tree audit was supplied.',
	));
	if (value.payloadsAuthenticated !== true) failures.push(failure(
		'payload-audit:missing', 'No source-manifest and byte-authenticated payload audit was supplied.',
	));
	if (value.sourceRevisionVerified !== true) failures.push(failure(
		'source-revision:unattributed', 'The audit is not bound to one clean HEAD revision.',
	));
	if (value.packageAudit !== null && value.packageAudit !== undefined
		&& value.packageAudited !== true) failures.push(failure(
		'package-audit:missing', 'No exact staged-runtime and packaged-content audit was supplied.',
	));
	return failures;
}

function sourceChecks(value) {
	if (!Array.isArray(value)) throw new TypeError('Milestone 5 package-audit sources must be an array.');
	return value.map((source) => {
		assertRecord(source, 'Milestone 5 package-audit source');
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

function payloadChecks(value) {
	if (!Array.isArray(value)) throw new TypeError('Milestone 5 package-audit payload rows must be an array.');
	return value.map((row) => {
		assertRecord(row, 'Milestone 5 package-audit payload row');
		return {
			identity: row.identity,
			product: row.product,
			targetId: row.targetId,
			buildStatus: row.buildStatus,
			payload: row.payload === null || row.payload === undefined
				? null : clone(row.payload),
		};
	});
}

function packageChecksFor(value) {
	assertRecord(value, 'Milestone 5 package-content audit');
	if (!Array.isArray(value.packages)) {
		throw new TypeError('Milestone 5 package descriptors must be an array.');
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
	assertRecord(value, 'Milestone 5 package-audit byte descriptor');
	return Object.fromEntries([
		...extraFields.map((field) => [field, value[field]]),
		['byteLength', value.byteLength],
		['sha256', value.sha256],
	]);
}

function treeDescriptor(value) {
	assertRecord(value, 'Milestone 5 package-audit extracted-tree descriptor');
	return {
		algorithm: value.algorithm,
		fileCount: value.fileCount,
		sha256: value.sha256,
	};
}

function sameDescriptor(expected, observed) {
	return observed !== null
		&& Object.keys(expected).every((field) => observed[field] === expected[field]);
}

function failure(id, reason) { return { id, reason }; }
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
