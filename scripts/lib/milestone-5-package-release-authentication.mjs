/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, createPublicKey, verify } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const MILESTONE_5_PACKAGE_RELEASE_AUTHENTICATION_POLICY =
	'config/milestone-5-package-release-authentication-policy.json';
export const MILESTONE_5_PACKAGE_RELEASE_STATEMENT_TYPE =
	'soundscaper-milestone-5-package-release-authentication-v1';
const MAXIMUM_EVIDENCE_BYTES = 1024 * 1024;
const SHA256 = /^[a-f\d]{64}$/u;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const STATEMENT_FIELDS = Object.freeze([
	'applicationVersion', 'controls', 'keyId', 'packages', 'productId', 'reviewedAt',
	'reviewer', 'schemaVersion', 'sourceRevision', 'statementType', 'targetId',
]);

export function milestone5PackageReleaseAuthenticationEvidenceName(productId, targetId) {
	if (!['soundscaper', 'framescaper'].includes(productId)
		|| !['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'].includes(targetId)) {
		throw new TypeError('Milestone 5 package release-authentication identity is invalid.');
	}
	return `release-authentication-${productId}-${targetId}.json`;
}

export async function auditMilestone5PackageReleaseAuthentication({
	repositoryRoot,
	packageRoot,
	productId,
	targetId,
	applicationVersion,
	sourceRevision,
	packages,
	policyPath = resolve(repositoryRoot, MILESTONE_5_PACKAGE_RELEASE_AUTHENTICATION_POLICY),
}) {
	const policy = validatePolicy(parseJson(
		await readFile(policyPath),
		'Milestone 5 package release-authentication policy',
	));
	const name = milestone5PackageReleaseAuthenticationEvidenceName(productId, targetId);
	const path = resolve(packageRoot, name);
	if (dirname(path) !== packageRoot || basename(path) !== name) {
		throw new Error('Milestone 5 package release-authentication path is not direct.');
	}
	const metadata = await lstat(path).catch((error) => {
		if (error.code === 'ENOENT') return null;
		throw error;
	});
	if (metadata === null) return deepFreeze({
		status: 'pending-external',
		blockedBy: policy.blockedBy,
		evidence: null,
	});
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1
		|| metadata.size > MAXIMUM_EVIDENCE_BYTES || await realpath(path) !== path) {
		throw new Error('Milestone 5 package release-authentication evidence must be one bounded canonical file.');
	}
	const bytes = await readFile(path);
	const envelope = parseCanonicalJson(bytes, name);
	validateEnvelope(envelope);
	const key = policy.trustedKeys.find(({ id }) => id === envelope.statement.keyId);
	if (!key) throw new Error('Milestone 5 package release-authentication evidence uses an untrusted key.');
	const expectedPackages = packages.map(({ label, name: packageName, byteLength, sha256, content }) => ({
		label,
		name: packageName,
		byteLength,
		sha256,
		content,
	}));
	const statement = envelope.statement;
	if (statement.statementType !== policy.statementType
		|| statement.productId !== productId || statement.targetId !== targetId
		|| statement.applicationVersion !== applicationVersion
		|| statement.sourceRevision !== sourceRevision
		|| !isDeepStrictEqual(statement.packages, expectedPackages)
		|| !isDeepStrictEqual(statement.controls, {
			artifactSignatures: 'accepted',
			platformTrust: 'accepted',
			installerSemantics: 'accepted',
		})) {
		throw new Error('Milestone 5 package release-authentication statement is not bound to this package cell.');
	}
	const signature = canonicalBase64(envelope.signature);
	const signedBytes = Buffer.from(JSON.stringify(statement), 'utf8');
	if (!verify(null, signedBytes, key.publicKey, signature)) {
		throw new Error('Milestone 5 package release-authentication signature is invalid.');
	}
	return deepFreeze({
		status: 'authenticated',
		blockedBy: null,
		keyId: statement.keyId,
		reviewer: statement.reviewer,
		reviewedAt: statement.reviewedAt,
		controls: { ...statement.controls },
		evidence: {
			name,
			byteLength: bytes.byteLength,
			sha256: createHash('sha256').update(bytes).digest('hex'),
		},
	});
}

export function milestone5PackageReleaseStatementBytes(statement) {
	validateStatement(statement);
	return Buffer.from(JSON.stringify(statement), 'utf8');
}

function validatePolicy(value) {
	if (!plainRecord(value) || value.schemaVersion !== 1
		|| value.statementType !== MILESTONE_5_PACKAGE_RELEASE_STATEMENT_TYPE
		|| value.algorithm !== 'Ed25519' || !Array.isArray(value.trustedKeys)
		|| typeof value.blockedBy !== 'string' || value.blockedBy.length < 32) {
		throw new TypeError('Milestone 5 package release-authentication policy is invalid.');
	}
	const keys = value.trustedKeys.map((row) => {
		if (!plainRecord(row) || !KEY_ID.test(String(row.id)) || row.status !== 'accepted'
			|| typeof row.publicKeyPem !== 'string') {
			throw new TypeError('Milestone 5 package release-authentication key is invalid.');
		}
		const publicKey = createPublicKey(row.publicKeyPem);
		if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') {
			throw new TypeError('Milestone 5 package release-authentication key must be Ed25519.');
		}
		return { id: row.id, publicKey };
	});
	if (new Set(keys.map(({ id }) => id)).size !== keys.length) {
		throw new TypeError('Milestone 5 package release-authentication key IDs must be unique.');
	}
	return { ...value, trustedKeys: keys };
}

function validateEnvelope(value) {
	if (!plainRecord(value) || value.schemaVersion !== 1
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
			'schemaVersion', 'signature', 'statement',
		].sort()) || typeof value.signature !== 'string') {
		throw new TypeError('Milestone 5 package release-authentication envelope is invalid.');
	}
	validateStatement(value.statement);
}

function validateStatement(value) {
	if (!plainRecord(value) || value.schemaVersion !== 1
		|| !exactKeys(value, STATEMENT_FIELDS)
		|| value.statementType !== MILESTONE_5_PACKAGE_RELEASE_STATEMENT_TYPE
		|| !['soundscaper', 'framescaper'].includes(value.productId)
		|| typeof value.targetId !== 'string' || typeof value.applicationVersion !== 'string'
		|| (value.sourceRevision !== null && !/^(?:[a-f\d]{40}|[a-f\d]{64})$/u.test(value.sourceRevision))
		|| !KEY_ID.test(String(value.keyId)) || typeof value.reviewer !== 'string'
		|| value.reviewer.length < 3 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value.reviewedAt)
		|| !Array.isArray(value.packages) || value.packages.length < 1
		|| !plainRecord(value.controls)) {
		throw new TypeError('Milestone 5 package release-authentication statement is invalid.');
	}
	for (const descriptor of value.packages) {
		if (!plainRecord(descriptor) || typeof descriptor.name !== 'string'
			|| !Number.isSafeInteger(descriptor.byteLength) || descriptor.byteLength < 1
			|| !SHA256.test(String(descriptor.sha256)) || !plainRecord(descriptor.content)) {
			throw new TypeError('Milestone 5 package release-authentication package descriptor is invalid.');
		}
	}
}

function canonicalBase64(value) {
	if (!/^[A-Za-z\d+/]+={0,2}$/u.test(value)) {
		throw new TypeError('Milestone 5 package release-authentication signature is not canonical base64.');
	}
	const bytes = Buffer.from(value, 'base64');
	if (bytes.byteLength !== 64 || bytes.toString('base64') !== value) {
		throw new TypeError('Milestone 5 package release-authentication signature has invalid length.');
	}
	return bytes;
}

function parseCanonicalJson(bytes, label) {
	const value = parseJson(bytes, label);
	if (!bytes.equals(Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'))) {
		throw new Error(`${label} is not canonical JSON.`);
	}
	return value;
}

function parseJson(bytes, label) {
	try { return JSON.parse(bytes.toString('utf8')); } catch (error) {
		throw new Error(`${label} is not valid JSON.`, { cause: error });
	}
}

function plainRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value, fields) {
	return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
}
function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
