/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const SOURCE_REVISION = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;

/**
 * Read package-audit inputs from immutable Git blobs for a revision-bound
 * audit, or from the explicitly unattributed working tree for development.
 */
export function readMilestone5PackageAuditInputSnapshot(repositoryRoot, paths, sourceRevision) {
	if (sourceRevision !== null && !SOURCE_REVISION.test(sourceRevision)) {
		throw new TypeError('Milestone 5 package-audit input snapshot requires one Git revision or null.');
	}
	const inputs = {};
	const bytes = {};
	const inputDigests = {};
	for (const [key, path] of Object.entries(paths)) {
		const value = sourceRevision === null
			? readFileSync(resolve(repositoryRoot, path))
			: gitBlob(repositoryRoot, sourceRevision, path);
		bytes[path] = value;
		inputDigests[path] = describe(value);
		try {
			inputs[key] = JSON.parse(value.toString('utf8'));
		} catch (error) {
			throw new Error(`Milestone 5 package-audit input ${path} is invalid JSON.`, { cause: error });
		}
	}
	return { inputs, bytes, inputDigests };
}

/** Bind independently executing auditors back to the exact initial authority. */
export function verifyMilestone5PackageAuditInputs({
	inputs,
	inputBytes,
	inputDigests,
}) {
	for (const [path, observed] of Object.entries(inputs.payloadAudit.inputDigests)) {
		assertDescriptor(observed, inputDigests[path],
			`Milestone 5 payload auditor input ${path} drifted from the package-audit input.`);
	}
	authenticateSourceRegister(inputs.sourceAcquisitions, inputs.sourceAcquisitionRegister);
	for (const [path, observed] of Object.entries(inputs.sourceAcquisitions.inputDigests ?? {})) {
		assertDescriptor(observed, inputDigests[path],
			`Milestone 5 native-source auditor input ${path} drifted from the package-audit input.`);
	}
	if (!inputBytes || typeof inputBytes !== 'object') {
		throw new Error('Milestone 5 package-audit input bytes are unavailable.');
	}
}

export function describeMilestone5PackageAuditBytes(bytes) {
	return describe(bytes);
}

export function readMilestone5PackageAuditGitBlob(repositoryRoot, sourceRevision, path) {
	if (!SOURCE_REVISION.test(sourceRevision)) {
		throw new TypeError('Milestone 5 Git-blob read requires one exact revision.');
	}
	return gitBlob(repositoryRoot, sourceRevision, path);
}

export function readMilestone5PackageAuditInputBytes(repositoryRoot, sourceRevision, path) {
	return sourceRevision === null
		? readFileSync(resolve(repositoryRoot, path))
		: readMilestone5PackageAuditGitBlob(repositoryRoot, sourceRevision, path);
}

function authenticateSourceRegister(audited, expected) {
	for (const field of ['schemaVersion', 'groundedAt', 'purpose']) {
		if (!isDeepStrictEqual(audited[field], expected[field])) {
			throw new Error(`Milestone 5 native-source auditor changed register field ${field}.`);
		}
	}
	if (!Array.isArray(expected.sources) || !Array.isArray(audited.sources)
		|| audited.sources.length < 1 || audited.sources.length > expected.sources.length) {
		throw new Error('Milestone 5 native-source auditor changed the source inventory.');
	}
	if (!isDeepStrictEqual(audited.delegatedSources, expected.delegatedSources)
		&& !isDeepStrictEqual(audited.delegatedSources, [])) {
		throw new Error('Milestone 5 native-source auditor changed register field delegatedSources.');
	}
	const auditedIds = audited.sources.map(({ id }) => id);
	const expectedOrder = expected.sources.filter(({ id }) => auditedIds.includes(id)).map(({ id }) => id);
	if (!isDeepStrictEqual(auditedIds, expectedOrder) || new Set(auditedIds).size !== auditedIds.length) {
		throw new Error('Milestone 5 native-source auditor changed the source inventory.');
	}
	for (const auditedSource of audited.sources) {
		const source = expected.sources.find(({ id }) => id === auditedSource.id);
		for (const [field, value] of Object.entries(source)) {
			if (field === 'authenticationStatus') {
				if (value !== 'pinned-metadata'
					|| !['authenticated', 'pending-external'].includes(
						auditedSource.authenticationStatus,
					)) {
					throw new Error(`Milestone 5 native-source auditor changed ${source.id}.${field}.`);
				}
				continue;
			}
			if (!isDeepStrictEqual(auditedSource[field], value)) {
				throw new Error(`Milestone 5 native-source auditor changed ${source.id}.${field}.`);
			}
		}
	}
}

function assertDescriptor(actual, expected, message) {
	if (actual === null || expected === undefined) throw new Error(message);
	for (const field of ['byteLength', 'sha256']) {
		if (actual[field] !== expected[field]) throw new Error(message);
	}
}

function gitBlob(repositoryRoot, sourceRevision, path) {
	return execFileSync('git', ['show', `${sourceRevision}:${path}`], {
		cwd: repositoryRoot,
		encoding: 'buffer',
		maxBuffer: 64 * 1024 * 1024,
	});
}

function describe(bytes) {
	return {
		byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
	};
}
