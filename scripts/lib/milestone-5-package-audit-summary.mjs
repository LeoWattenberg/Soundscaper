/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
	assembleMilestone5ProductPackageAudit,
	isAssembledMilestone5PackageAudit,
} from './milestone-5-package-audit.mjs';
import {
	MILESTONE_5_TARGETS,
	milestone5PackageAuditIdentities,
	milestone5PackageAuditSummaryOptions,
	milestone5ProductIds,
} from './milestone-5-product-scope.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';

const SOURCE_REVISION = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;
const SHA256 = /^[a-f\d]{64}$/u;
const MAXIMUM_AUDIT_BYTES = 32 * 1024 * 1024;

export const MILESTONE_5_PACKAGE_AUDIT_IDENTITIES = milestone5PackageAuditIdentities();

/**
 * Resolve the one complete local or Actions artifact directory convention.
 * Mixed and partial inventories remain invalid.
 */
export function milestone5PackageAuditDirectoryNames(names, productIdsValue) {
	return resolvePackageDirectoryNames(
		names,
		milestone5PackageAuditIdentities(productIdsValue),
	);
}

/** Summarize package audits without granting release or human-review status. */
export function summarizeMilestone5PackageAudits(values, productIdsValue) {
	const productIds = milestone5ProductIds(productIdsValue);
	const expectedAudits = milestone5PackageAuditIdentities(productIds);
	if (!Array.isArray(values) || values.length !== expectedAudits.length) {
		throw new Error(`Milestone 5 package summary must contain exactly ${String(expectedAudits.length)} audits.`);
	}
	const packageFilesRevalidated = values.every(isAssembledMilestone5PackageAudit);
	const snapshots = values.map((value, index) => snapshotStrictJsonData(
		value, `Milestone 5 package audit ${String(index)}`,
	));
	const audits = expectedAudits.map((identity) => {
		const matches = snapshots.filter(({ assessmentScope }) => sameIdentity(assessmentScope, identity));
		if (matches.length !== 1) {
			throw new Error(`Milestone 5 package summary needs one unique ${auditId(identity)} audit.`);
		}
		return validateAudit(matches[0], identity);
	});
	const first = audits[0];
	for (const audit of audits) {
		if (audit.sourceRevision !== first.sourceRevision
			|| audit.package.applicationVersion !== first.package.applicationVersion) {
			throw new Error('Milestone 5 package audits disagree on revision or application version.');
		}
	}
	const packageNames = audits.flatMap(({ package: packageAudit }) => (
		packageAudit.packages.map(({ name }) => name)
	));
	if (new Set(packageNames).size !== packageNames.length) {
		throw new Error('Milestone 5 package names must be globally unique.');
	}
	const failures = audits.flatMap((audit) => audit.failures.map((current) => ({
		...current,
		audit: auditId(audit.assessmentScope),
	})));
	const passed = packageFilesRevalidated
		&& audits.every((audit) => audit.passed)
		&& failures.length === 0;
	return deepFreeze({
		schemaVersion: 1,
		kind: 'milestone-5-package-audit-summary',
		products: [...productIds],
		targets: [...MILESTONE_5_TARGETS],
		auditCount: audits.length,
		sourceRevision: first.sourceRevision,
		applicationVersion: first.package.applicationVersion,
		packageFilesRevalidated,
		passed,
		status: passed ? 'passed' : packageFilesRevalidated ? 'failed' : 'unverified',
		packageCount: audits.reduce((count, audit) => count + audit.package.packageCount, 0),
		totalPackageBytes: audits.reduce(
			(total, audit) => total + audit.package.totalPackageBytes,
			0,
		),
		audits: audits.map(auditSummary),
		failures,
	});
}

export async function assembleMilestone5PackageAuditSummary(optionsValue) {
	const options = milestone5PackageAuditSummaryOptions(snapshotStrictJsonData(
		optionsValue, 'Milestone 5 package-audit summary options',
	));
	if (typeof options.repositoryRoot !== 'string' || options.repositoryRoot.length === 0
		|| typeof options.packageDirectory !== 'string' || options.packageDirectory.length === 0
		|| !SOURCE_REVISION.test(String(options.sourceRevision))) {
		throw new Error('Milestone 5 package-audit summary requires checkout, package, and revision bindings.');
	}
	const packageDirectory = resolve(options.packageDirectory);
	const identities = milestone5PackageAuditIdentities(options.productIds);
	const packageDirectoryNames = await validatePackageDirectory(packageDirectory, identities);
	const audits = [];
	for (const [index, identity] of identities.entries()) {
		audits.push(await assembleMilestone5ProductPackageAudit({
			repositoryRoot: resolve(options.repositoryRoot),
			sourceRevision: options.sourceRevision,
			productIds: options.productIds,
			packageOptions: {
				packageRoot: resolve(packageDirectory, packageDirectoryNames[index]),
				productId: identity.productId,
				targetId: identity.targetId,
			},
		}));
	}
	const summary = summarizeMilestone5PackageAudits(audits, options.productIds);
	if (!summary.packageFilesRevalidated) {
		throw new Error('Milestone 5 package summary lost its in-process file checks.');
	}
	return summary;
}

export async function readMilestone5PackageAuditDirectory(directoryValue, productIdsValue) {
	const productIds = milestone5ProductIds(productIdsValue);
	const identities = milestone5PackageAuditIdentities(productIds);
	const directory = resolve(String(directoryValue));
	const rootStats = await lstat(directory);
	if (!rootStats.isDirectory() || rootStats.isSymbolicLink() || await realpath(directory) !== directory) {
		throw new Error('Milestone 5 package-audit root must be one canonical regular directory.');
	}
	const entries = await readdir(directory, { withFileTypes: true });
	const expectedNames = identities.map(packageAuditFileName).sort();
	const actualNames = entries.map(({ name }) => name).sort();
	if (!isDeepStrictEqual(actualNames, expectedNames)) {
		throw new Error('Milestone 5 package-audit directory has missing or unexpected entries.');
	}
	const values = [];
	const fileDescriptors = [];
	for (const identity of identities) {
		const name = packageAuditFileName(identity);
		const path = resolve(directory, name);
		if (basename(path) !== name) throw new Error('Milestone 5 package-audit filename is not direct.');
		const before = await lstat(path);
		if (!before.isFile() || before.isSymbolicLink() || before.size < 1
			|| before.size > MAXIMUM_AUDIT_BYTES) {
			throw new Error(`Milestone 5 package audit ${name} must be a bounded regular file.`);
		}
		const bytes = await readFile(path);
		const after = await lstat(path);
		if (bytes.byteLength !== before.size || before.size !== after.size
			|| before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
			throw new Error(`Milestone 5 package audit ${name} changed while it was read.`);
		}
		let value;
		try { value = snapshotStrictJsonData(JSON.parse(bytes.toString('utf8')), name); }
		catch (error) { throw new Error(`Milestone 5 package audit ${name} is invalid JSON.`, { cause: error }); }
		if (!bytes.equals(Buffer.from(`${JSON.stringify(value, null, '\t')}\n`, 'utf8'))) {
			throw new Error(`Milestone 5 package audit ${name} is not canonical JSON.`);
		}
		values.push(value);
		fileDescriptors.push({ name, byteLength: bytes.byteLength, sha256: sha256(bytes) });
	}
	return deepFreeze({
		...summarizeMilestone5PackageAudits(values, productIds),
		fileDescriptors,
	});
}

async function validatePackageDirectory(directory, identities) {
	const rootStats = await lstat(directory);
	if (!rootStats.isDirectory() || rootStats.isSymbolicLink() || await realpath(directory) !== directory) {
		throw new Error('Milestone 5 package root must be one canonical regular directory.');
	}
	const entries = await readdir(directory, { withFileTypes: true });
	const directoryNames = resolvePackageDirectoryNames(
		entries.map(({ name }) => name), identities,
	);
	for (const entry of entries) {
		const path = resolve(directory, entry.name);
		const stats = await lstat(path);
		if (!entry.isDirectory() || entry.isSymbolicLink() || !stats.isDirectory()
			|| stats.isSymbolicLink() || await realpath(path) !== path) {
			throw new Error(`Milestone 5 package root ${entry.name} is not canonical and regular.`);
		}
	}
	return directoryNames;
}

function validateAudit(audit, identity) {
	if (audit.schemaVersion !== 3 || audit.kind !== 'milestone-5-package-audit'
		|| audit.assessmentScope?.kind !== 'package'
		|| !sameIdentity(audit.assessmentScope, identity)) {
		throw new Error(`Milestone 5 package audit ${auditId(identity)} has an invalid identity.`);
	}
	if (!SOURCE_REVISION.test(String(audit.sourceRevision))
		|| audit.observedHeadRevision !== audit.sourceRevision
		|| audit.sourceRevisionBinding?.status !== 'verified-clean-head'
		|| audit.sourceRevisionBinding.sourceRevision !== audit.sourceRevision) {
		throw new Error(`Milestone 5 package audit ${auditId(identity)} has an invalid source binding.`);
	}
	if (typeof audit.repositoryInputsVerified !== 'boolean'
		|| typeof audit.sourceInputsVerified !== 'boolean'
		|| typeof audit.passed !== 'boolean'
		|| audit.status !== (audit.passed ? 'passed' : 'failed')
		|| !audit.checks || typeof audit.checks !== 'object' || Array.isArray(audit.checks)
		|| !Array.isArray(audit.failures)
		|| ['evidenceAuthenticated', 'evidenceSha256', 'evidence'].some((field) => (
			Object.hasOwn(audit, field)
		))) {
		throw new Error(`Milestone 5 package audit ${auditId(identity)} has invalid result state.`);
	}
	validatePackage(audit.package, identity, audit.sourceRevision);
	return audit;
}

function validatePackage(packageAudit, identity, sourceRevision) {
	if (!packageAudit || packageAudit.productId !== identity.productId
		|| packageAudit.targetId !== identity.targetId
		|| packageAudit.sourceRevision !== sourceRevision
		|| packageAudit.status !== 'installed-application-closure-audited'
		|| !Array.isArray(packageAudit.packages) || packageAudit.packages.length < 1
		|| packageAudit.packageCount !== packageAudit.packages.length
		|| packageAudit.totalPackageBytes !== packageAudit.packages.reduce(
			(total, descriptor) => total + descriptor.byteLength, 0,
		)
		|| ['evidenceSha256', 'automatedEvidenceSha256'].some((field) => (
			Object.hasOwn(packageAudit, field)
		))) {
		throw new Error(`Milestone 5 package audit ${auditId(identity)} has invalid package checks.`);
	}
	for (const descriptor of [packageAudit.runtimeManifest, ...packageAudit.packages]) {
		if (typeof descriptor?.name !== 'string' || !Number.isSafeInteger(descriptor.byteLength)
			|| descriptor.byteLength < 1 || !SHA256.test(String(descriptor.sha256))) {
			throw new Error(`Milestone 5 package audit ${auditId(identity)} has an invalid file descriptor.`);
		}
	}
}

function auditSummary(audit) {
	return {
		productId: audit.assessmentScope.productId,
		targetId: audit.assessmentScope.targetId,
		passed: audit.passed,
		status: audit.status,
		packageCount: audit.package.packageCount,
		totalPackageBytes: audit.package.totalPackageBytes,
		failures: audit.failures,
	};
}

function packageDirectoryName({ productId, targetId }) { return `${productId}-${targetId}`; }
function resolvePackageDirectoryNames(names, identities) {
	if (!Array.isArray(names) || names.some((name) => typeof name !== 'string')) {
		throw new Error('Milestone 5 package root has missing or unexpected product-target directories.');
	}
	const actualNames = [...names].sort();
	const conventions = [
		identities.map(packageDirectoryName),
		identities.map((identity) => `nightly-${packageDirectoryName(identity)}`),
	];
	const resolved = conventions.find((candidate) => (
		isDeepStrictEqual([...candidate].sort(), actualNames)
	));
	if (resolved === undefined) {
		throw new Error('Milestone 5 package root has missing or unexpected product-target directories.');
	}
	return Object.freeze(resolved);
}
function packageAuditFileName(identity) {
	return `milestone-5-package-audit-${auditId(identity)}.json`;
}
function auditId({ productId, targetId }) { return `${productId}-${targetId}`; }
function sameIdentity(left, right) {
	return left?.productId === right.productId && left?.targetId === right.targetId;
}
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function deepFreeze(value) {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}
