/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
	assembleMilestone5ProductHandoff,
	isAssembledMilestone5Handoff,
} from './milestone-5-handoff.mjs';
import {
	MILESTONE_5_TARGETS,
	milestone5MatrixAssemblyOptions,
	milestone5PackageCells,
	milestone5ProductIds,
} from './milestone-5-product-scope.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';

const SOURCE_REVISION = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;
const SHA256 = /^[a-f\d]{64}$/u;
const MAXIMUM_HANDOFF_BYTES = 32 * 1024 * 1024;

export const MILESTONE_5_PACKAGE_CELLS = milestone5PackageCells();

/** Aggregate package audits without making a release or human-review claim. */
export function aggregateMilestone5HandoffMatrix(values, productIdsValue) {
	const productIds = milestone5ProductIds(productIdsValue);
	const expectedCells = milestone5PackageCells(productIds);
	if (!Array.isArray(values) || values.length !== expectedCells.length) {
		throw new Error(`Milestone 5 package matrix must contain exactly ${String(expectedCells.length)} cells.`);
	}
	const inputsAuthenticated = values.every(isAssembledMilestone5Handoff);
	const snapshots = values.map((value, index) => snapshotStrictJsonData(
		value, `Milestone 5 package-audit cell ${String(index)}`,
	));
	const cells = expectedCells.map((identity) => {
		const matches = snapshots.filter(({ assessmentScope }) => sameIdentity(assessmentScope, identity));
		if (matches.length !== 1) {
			throw new Error(`Milestone 5 package matrix needs one unique ${cellId(identity)} cell.`);
		}
		return validateCell(matches[0], identity);
	});
	const first = cells[0];
	for (const cell of cells) {
		if (cell.sourceRevision !== first.sourceRevision
			|| cell.package.applicationVersion !== first.package.applicationVersion) {
			throw new Error('Milestone 5 package matrix cells disagree on revision or application version.');
		}
	}
	const packageNames = cells.flatMap(({ package: packageAudit }) => (
		packageAudit.packages.map(({ name }) => name)
	));
	if (new Set(packageNames).size !== packageNames.length) {
		throw new Error('Milestone 5 package matrix package names must be globally unique.');
	}
	const failures = cells.flatMap((cell) => cell.failures.map((failure) => ({
		...failure,
		cell: cellId(cell.assessmentScope),
	})));
	const passed = inputsAuthenticated && cells.every((cell) => cell.passed) && failures.length === 0;
	const evidence = {
		schemaVersion: 1,
		sourceRevision: first.sourceRevision,
		applicationVersion: first.package.applicationVersion,
		cells: cells.map((cell) => ({
			productId: cell.assessmentScope.productId,
			targetId: cell.assessmentScope.targetId,
			evidenceSha256: cell.evidenceSha256,
		})),
	};
	return deepFreeze({
		schemaVersion: 3,
		kind: 'milestone-5-package-matrix-audit',
		products: [...productIds],
		targets: [...MILESTONE_5_TARGETS],
		cellCount: cells.length,
		sourceRevision: first.sourceRevision,
		applicationVersion: first.package.applicationVersion,
		inputsAuthenticated,
		passed,
		status: passed ? 'passed' : inputsAuthenticated ? 'failed' : 'unattributed',
		evidenceSha256: sha256(Buffer.from(JSON.stringify(evidence))),
		packageCount: cells.reduce((count, cell) => count + cell.package.packageCount, 0),
		totalPackageBytes: cells.reduce((total, cell) => total + cell.package.totalPackageBytes, 0),
		cells: cells.map(cellSummary),
		failures,
	});
}

export async function assembleMilestone5HandoffMatrix(optionsValue) {
	const options = milestone5MatrixAssemblyOptions(snapshotStrictJsonData(
		optionsValue, 'Milestone 5 matrix assembly options',
	));
	if (typeof options.repositoryRoot !== 'string' || options.repositoryRoot.length === 0
		|| typeof options.packageDirectory !== 'string' || options.packageDirectory.length === 0
		|| !SOURCE_REVISION.test(String(options.sourceRevision))) {
		throw new Error('Milestone 5 matrix assembly requires checkout, package, and revision bindings.');
	}
	const packageDirectory = resolve(options.packageDirectory);
	const identities = milestone5PackageCells(options.productIds);
	await validatePackageMatrixDirectory(packageDirectory, identities);
	const handoffs = [];
	for (const identity of identities) {
		handoffs.push(await assembleMilestone5ProductHandoff({
			repositoryRoot: resolve(options.repositoryRoot),
			sourceRevision: options.sourceRevision,
			productIds: options.productIds,
			packageOptions: {
				packageRoot: resolve(packageDirectory, packageDirectoryName(identity)),
				productId: identity.productId,
				targetId: identity.targetId,
			},
		}));
	}
	const matrix = aggregateMilestone5HandoffMatrix(handoffs, options.productIds);
	if (!matrix.inputsAuthenticated) {
		throw new Error('Milestone 5 package matrix lost its in-process audit authority.');
	}
	return matrix;
}

export async function auditMilestone5HandoffMatrixDirectory(directoryValue, productIdsValue) {
	const productIds = milestone5ProductIds(productIdsValue);
	const identities = milestone5PackageCells(productIds);
	const directory = resolve(String(directoryValue));
	const rootStats = await lstat(directory);
	if (!rootStats.isDirectory() || rootStats.isSymbolicLink() || await realpath(directory) !== directory) {
		throw new Error('Milestone 5 package-audit matrix root must be one canonical regular directory.');
	}
	const entries = await readdir(directory, { withFileTypes: true });
	const expectedNames = identities.map(handoffFileName).sort();
	const actualNames = entries.map(({ name }) => name).sort();
	if (!isDeepStrictEqual(actualNames, expectedNames)) {
		throw new Error('Milestone 5 package-audit matrix has missing or unexpected entries.');
	}
	const values = [];
	const fileDescriptors = [];
	for (const identity of identities) {
		const name = handoffFileName(identity);
		const path = resolve(directory, name);
		if (basename(path) !== name) throw new Error('Milestone 5 package-audit filename is not direct.');
		const before = await lstat(path);
		if (!before.isFile() || before.isSymbolicLink() || before.size < 1
			|| before.size > MAXIMUM_HANDOFF_BYTES) {
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
		...aggregateMilestone5HandoffMatrix(values, productIds),
		fileDescriptors,
	});
}

async function validatePackageMatrixDirectory(directory, identities) {
	const rootStats = await lstat(directory);
	if (!rootStats.isDirectory() || rootStats.isSymbolicLink() || await realpath(directory) !== directory) {
		throw new Error('Milestone 5 package matrix root must be one canonical regular directory.');
	}
	const entries = await readdir(directory, { withFileTypes: true });
	const expectedNames = identities.map(packageDirectoryName).sort();
	const actualNames = entries.map(({ name }) => name).sort();
	if (!isDeepStrictEqual(actualNames, expectedNames)) {
		throw new Error('Milestone 5 package matrix has missing or unexpected package roots.');
	}
	for (const entry of entries) {
		const path = resolve(directory, entry.name);
		const stats = await lstat(path);
		if (!entry.isDirectory() || entry.isSymbolicLink() || !stats.isDirectory()
			|| stats.isSymbolicLink() || await realpath(path) !== path) {
			throw new Error(`Milestone 5 package root ${entry.name} is not canonical and regular.`);
		}
	}
}

function validateCell(cell, identity) {
	if (cell.schemaVersion !== 3 || cell.kind !== 'milestone-5-package-audit'
		|| cell.assessmentScope?.kind !== 'package-cell'
		|| !sameIdentity(cell.assessmentScope, identity)) {
		throw new Error(`Milestone 5 package audit ${cellId(identity)} has an invalid identity.`);
	}
	if (!SOURCE_REVISION.test(String(cell.sourceRevision))
		|| cell.observedHeadRevision !== cell.sourceRevision
		|| cell.sourceRevisionBinding?.status !== 'authenticated-clean-head'
		|| cell.sourceRevisionBinding.sourceRevision !== cell.sourceRevision) {
		throw new Error(`Milestone 5 package audit ${cellId(identity)} has an invalid source binding.`);
	}
	if (typeof cell.evidenceAuthenticated !== 'boolean' || typeof cell.passed !== 'boolean'
		|| cell.status !== (cell.passed ? 'passed' : 'failed')
		|| !Array.isArray(cell.failures)
		|| !SHA256.test(String(cell.evidenceSha256))
		|| sha256(Buffer.from(JSON.stringify(cell.evidence))) !== cell.evidenceSha256) {
		throw new Error(`Milestone 5 package audit ${cellId(identity)} has invalid result state.`);
	}
	validatePackage(cell.package, identity, cell.sourceRevision);
	return cell;
}

function validatePackage(packageAudit, identity, sourceRevision) {
	if (!packageAudit || packageAudit.productId !== identity.productId
		|| packageAudit.targetId !== identity.targetId
		|| packageAudit.sourceRevision !== sourceRevision
		|| !SHA256.test(String(packageAudit.evidenceSha256))
		|| !Array.isArray(packageAudit.packages) || packageAudit.packages.length < 1
		|| packageAudit.packageCount !== packageAudit.packages.length
		|| packageAudit.totalPackageBytes !== packageAudit.packages.reduce(
			(total, descriptor) => total + descriptor.byteLength, 0,
		)) {
		throw new Error(`Milestone 5 package audit ${cellId(identity)} has invalid package evidence.`);
	}
	for (const descriptor of [packageAudit.runtimeManifest, ...packageAudit.packages]) {
		if (typeof descriptor?.name !== 'string' || !Number.isSafeInteger(descriptor.byteLength)
			|| descriptor.byteLength < 1 || !SHA256.test(String(descriptor.sha256))) {
			throw new Error(`Milestone 5 package audit ${cellId(identity)} has an invalid file descriptor.`);
		}
	}
}

function cellSummary(cell) {
	return {
		productId: cell.assessmentScope.productId,
		targetId: cell.assessmentScope.targetId,
		passed: cell.passed,
		status: cell.status,
		evidenceSha256: cell.evidenceSha256,
		packageCount: cell.package.packageCount,
		totalPackageBytes: cell.package.totalPackageBytes,
		failures: cell.failures,
	};
}

function packageDirectoryName({ productId, targetId }) { return `${productId}-${targetId}`; }
function handoffFileName(identity) { return `milestone-5-${cellId(identity)}.json`; }
function cellId({ productId, targetId }) { return `${productId}-${targetId}`; }
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
