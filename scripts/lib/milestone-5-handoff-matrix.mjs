/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { desktopReleaseTargetPackageInventory } from '../desktop-release-assets.mjs';
import { assertDesktopCodecPolicy } from './desktop-codec-policy.mjs';
import {
	assembleMilestone5ProductHandoff,
	isAssembledMilestone5Handoff,
	MILESTONE_5_HANDOFF_INPUT_PATHS,
} from './milestone-5-handoff.mjs';
import { milestone5RequiredHandoffInputPaths } from './milestone-5-handoff-scope-inputs.mjs';
import {
	MILESTONE_5_TARGETS,
	milestone5MatrixAssemblyOptions,
	milestone5EngineeringScope,
	milestone5PackageCells,
	milestone5ProductIds,
} from './milestone-5-product-scope.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';

const SOURCE_REVISION = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;
const SHA256 = /^[a-f\d]{64}$/u;
const MAXIMUM_HANDOFF_BYTES = 32 * 1024 * 1024;
const MAXIMUM_PACKAGE_BYTES = 8 * 1024 * 1024 * 1024;
const HANDOFF_GATE_IDS = Object.freeze([
	'legalAndTrademarkReview',
	'nativeIsolationSecurityReview',
	'productionSigningAndNotarization',
]);

export const MILESTONE_5_PACKAGE_CELLS = milestone5PackageCells();

/** The first authority allowed to make a whole-Milestone-5 readiness claim. */
export function aggregateMilestone5HandoffMatrix(values, productIdsValue) {
	const productIds = milestone5ProductIds(productIdsValue);
	const engineeringScope = milestone5EngineeringScope(productIds);
	const packageCells = milestone5PackageCells(productIds);
	if (!Array.isArray(values) || values.length !== packageCells.length) {
		throw new Error(`Milestone 5 handoff matrix must contain the exact ${numberWord(packageCells.length)} package cells.`);
	}
	const matrixInputsAuthenticated = values.every(isAssembledMilestone5Handoff);
	const snapshots = values.map((value, index) => snapshotStrictJsonData(
		value, `Milestone 5 handoff matrix cell ${String(index)}`,
	));
	const cells = packageCells.map((identity) => {
		const matches = snapshots.filter((candidate) => sameIdentity(candidate.assessmentScope, identity));
		if (matches.length !== 1) {
			throw new Error(`Milestone 5 handoff matrix needs one unique ${cellId(identity)} cell.`);
		}
			return validateCell(matches[0], identity, engineeringScope);
	});
	validateCommonEvidence(cells);
	const packageNames = cells.flatMap(({ packageEvidence }) => (
		packageEvidence.packages.map(({ name }) => name)
	));
	if (new Set(packageNames).size !== packageNames.length) {
		throw new Error('Milestone 5 handoff matrix package names must be globally unique.');
	}
	const groupedBlockers = groupBlockers(cells);
	const milestoneAutomatedReady = matrixInputsAuthenticated
		? cells.every(({ packageCellAutomatedReady }) => packageCellAutomatedReady)
		: null;
	const first = cells[0];
	const automatedEvidenceSha256 = sha256(Buffer.from(JSON.stringify({
		schemaVersion: 1,
		sourceRevision: first.sourceRevision,
		applicationVersion: first.packageEvidence.applicationVersion,
		cells: cells.map((cell) => ({
			productId: cell.assessmentScope.productId,
			targetId: cell.assessmentScope.targetId,
			automatedEvidenceSha256: cell.automatedEvidenceSha256,
		})),
	})));
	return deepFreeze({
		schemaVersion: 2,
		assessmentScope: {
			kind: 'milestone-5-package-matrix',
			products: [...productIds],
			targets: [...MILESTONE_5_TARGETS],
			cellCount: cells.length,
		},
		engineeringScope,
		sourceRevision: first.sourceRevision,
		qualificationSourceRevision: first.qualification.sourceRevision,
		applicationVersion: first.packageEvidence.applicationVersion,
		matrixInputsAuthenticated,
		milestoneAutomatedReady,
		automatedEvidenceSha256,
		engineeringEvidenceAuthenticated: matrixInputsAuthenticated
			&& cells.every(({ engineeringEvidenceAuthenticated }) => (
			engineeringEvidenceAuthenticated
		)),
		milestoneReleaseReady: null,
		status: matrixInputsAuthenticated
			? (milestoneAutomatedReady ? 'automated-ready' : 'automated-blocked')
			: 'unattributed-serialized-cells',
		packageCount: cells.reduce((count, cell) => count + cell.packageEvidence.packageCount, 0),
		totalPackageBytes: cells.reduce((total, cell) => (
			total + cell.packageEvidence.totalPackageBytes
		), 0),
		cells: cells.map((cell) => cellSummary(cell, matrixInputsAuthenticated)),
		automatedBlockers: groupedBlockers,
		blockers: groupedBlockers,
	});
}

/** Re-audit one clean checkout and all ten package roots before claiming readiness. */
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
	const packageCells = milestone5PackageCells(options.productIds);
	await validatePackageMatrixDirectory(packageDirectory, packageCells);
	const handoffs = [];
	for (const identity of packageCells) {
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
	if (!matrix.matrixInputsAuthenticated || matrix.milestoneAutomatedReady === null) {
		throw new Error('Milestone 5 matrix assembly lost its in-process audit authority.');
	}
	return matrix;
}

export async function auditMilestone5HandoffMatrixDirectory(directoryValue, productIdsValue) {
	const productIds = milestone5ProductIds(productIdsValue);
	const packageCells = milestone5PackageCells(productIds);
	const directory = resolve(String(directoryValue));
	const rootStats = await lstat(directory);
	if (!rootStats.isDirectory() || rootStats.isSymbolicLink() || await realpath(directory) !== directory) {
		throw new Error('Milestone 5 handoff matrix root must be one canonical regular directory.');
	}
	const entries = await readdir(directory, { withFileTypes: true });
	const expectedNames = packageCells.map(handoffFileName).sort();
	const actualNames = entries.map(({ name }) => name).sort();
	if (!isDeepStrictEqual(actualNames, expectedNames)) {
		throw new Error('Milestone 5 handoff matrix directory has missing or unexpected entries.');
	}
	const values = [];
	const cellEvidence = [];
	for (const identity of packageCells) {
		const name = handoffFileName(identity);
		const path = resolve(directory, name);
		if (basename(path) !== name) throw new Error('Milestone 5 handoff filename is not direct.');
		const before = await lstat(path);
		if (!before.isFile() || before.isSymbolicLink() || before.size < 1
			|| before.size > MAXIMUM_HANDOFF_BYTES) {
			throw new Error(`Milestone 5 handoff ${name} must be one bounded regular non-symbolic file.`);
		}
		const bytes = await readFile(path);
		const after = await lstat(path);
		if (bytes.byteLength !== before.size || before.size !== after.size
			|| before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
			throw new Error(`Milestone 5 handoff ${name} changed while it was read.`);
		}
		let value;
		try {
			value = snapshotStrictJsonData(JSON.parse(bytes.toString('utf8')), name);
		} catch (error) {
			throw new Error(`Milestone 5 handoff ${name} is invalid JSON.`, { cause: error });
		}
		const canonical = Buffer.from(`${JSON.stringify(value, null, '\t')}\n`, 'utf8');
		if (!bytes.equals(canonical)) {
			throw new Error(`Milestone 5 handoff ${name} is not canonical JSON.`);
		}
		values.push(value);
		cellEvidence.push({ name, byteLength: bytes.byteLength, sha256: sha256(bytes) });
	}
	return deepFreeze({ ...aggregateMilestone5HandoffMatrix(values, productIds), cellEvidence });
}

async function validatePackageMatrixDirectory(directory, packageCells) {
	const rootStats = await lstat(directory);
	if (!rootStats.isDirectory() || rootStats.isSymbolicLink() || await realpath(directory) !== directory) {
		throw new Error('Milestone 5 package matrix root must be one canonical regular directory.');
	}
	const entries = await readdir(directory, { withFileTypes: true });
	const expectedNames = packageCells.map(packageDirectoryName).sort();
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

function validateCell(cell, identity, engineeringScope) {
	if (cell.schemaVersion !== 2 || cell.assessmentScope?.kind !== 'package-cell'
		|| !sameIdentity(cell.assessmentScope, identity)) {
		throw new Error(`Milestone 5 handoff ${cellId(identity)} has an invalid cell identity.`);
	}
	if (cell.assemblyInputsAuthenticated !== true || cell.sourceInputsAudited !== true
		|| typeof cell.engineeringEvidenceAuthenticated !== 'boolean'
		|| typeof cell.automatedEvidenceAuthenticated !== 'boolean'
		|| cell.engineeringEvidenceAuthenticated !== cell.automatedEvidenceAuthenticated
		|| typeof cell.packageCellAutomatedReady !== 'boolean'
		|| cell.packageCellReady !== null) {
		throw new Error(`Milestone 5 handoff ${cellId(identity)} is not authenticated.`);
	}
	if (!SOURCE_REVISION.test(String(cell.sourceRevision))
		|| cell.observedHeadRevision !== cell.sourceRevision
		|| cell.sourceRevisionBinding?.status !== 'authenticated-clean-head'
		|| cell.sourceRevisionBinding.sourceRevision !== cell.sourceRevision) {
		throw new Error(`Milestone 5 handoff ${cellId(identity)} has an invalid source binding.`);
	}
	if (cell.milestoneReleaseReady !== null || !Array.isArray(cell.automatedBlockers)
		|| !isDeepStrictEqual(cell.blockers, cell.automatedBlockers)
		|| cell.automatedBlockers.some((item) => typeof item?.id !== 'string' || item.id.length === 0
			|| typeof item?.reason !== 'string' || item.reason.length === 0)
		|| new Set(cell.automatedBlockers.map(({ id }) => id)).size
			!== cell.automatedBlockers.length
		|| !SHA256.test(String(cell.automatedEvidenceSha256))
		|| sha256(Buffer.from(JSON.stringify(cell.automatedEvidence)))
			!== cell.automatedEvidenceSha256) {
		throw new Error(`Milestone 5 handoff ${cellId(identity)} has invalid blocker state.`);
	}
	const prerequisitesReady = validateReadinessSummary(cell, identity, engineeringScope);
	validateInputDigests(cell, identity, engineeringScope);
	const expectedReady = prerequisitesReady && cell.automatedEvidenceAuthenticated
		&& cell.automatedBlockers.length === 0;
	if (cell.packageCellAutomatedReady !== expectedReady
		|| cell.automatedStatus !== (expectedReady ? 'automated-ready' : 'automated-blocked')
		|| cell.status !== cell.automatedStatus) {
		throw new Error(`Milestone 5 handoff ${cellId(identity)} has inconsistent cell readiness.`);
	}
	validateQualification(cell, identity, engineeringScope);
	validatePackageEvidence(cell, identity);
	return cell;
}

function validateQualification(cell, identity, engineeringScope) {
	const qualification = cell.qualification;
	if (!qualification
		|| !isDeepStrictEqual(qualification.workloadIds, engineeringScope.workloadIds)
		|| qualification.profileCount !== engineeringScope.labProfileCount
		|| !integerInRange(qualification.provisionedProfileCount, 0,
			engineeringScope.labProfileCount)
		|| !integerInRange(qualification.acceptedCohortCount, 0,
			engineeringScope.workloadIds.length)
		|| !closedUniqueStrings(qualification.pendingHandoffGates, HANDOFF_GATE_IDS)) {
		throw new Error(`Milestone 5 handoff ${cellId(identity)} has an invalid qualification source binding.`);
	}
	if (qualification.sourceRevision === null) {
		if (qualification.revisionBinding !== null || qualification.acceptedCohortCount !== 0) {
			throw new Error(`Milestone 5 handoff ${cellId(identity)} has an invalid null qualification binding.`);
		}
		return;
	}
	const binding = qualification.revisionBinding;
	if (!SOURCE_REVISION.test(String(qualification.sourceRevision))
		|| binding?.qualificationSourceRevision !== qualification.sourceRevision
		|| binding?.handoffSourceRevision !== cell.sourceRevision
		|| !['same-revision', 'qualification-evidence-only-descendant'].includes(binding.kind)
		|| !Number.isSafeInteger(binding.changedPathCount) || binding.changedPathCount < 0
		|| !SHA256.test(String(binding.changedPathsSha256))
		|| (binding.kind === 'same-revision'
			&& (qualification.sourceRevision !== cell.sourceRevision || binding.changedPathCount !== 0))
		|| (binding.kind === 'qualification-evidence-only-descendant'
			&& (qualification.sourceRevision === cell.sourceRevision || binding.changedPathCount < 1))) {
		throw new Error(`Milestone 5 handoff ${cellId(identity)} has an invalid qualification revision binding.`);
	}
}

function validatePackageEvidence(cell, identity) {
	const evidence = cell.packageEvidence;
	const releaseAuthentication = evidence?.releaseAuthentication;
	const policyPath = MILESTONE_5_HANDOFF_INPUT_PATHS.releaseAuthenticationPolicy;
	const policyEvidence = releaseAuthentication?.policyEvidence;
	const expectedAuthenticationName =
		`release-authentication-${identity.productId}-${identity.targetId}.json`;
	const releaseObservationValid = releaseAuthentication?.status === 'authenticated'
		? evidence?.status === 'installed-application-closure-audited'
			&& releaseAuthentication.blockedBy === null
			&& releaseAuthentication.evidence?.name === expectedAuthenticationName
		: releaseAuthentication?.status === 'pending-external'
			? evidence?.status === 'release-authentication-pending'
				&& typeof releaseAuthentication.blockedBy === 'string'
				&& releaseAuthentication.blockedBy.length >= 16
				&& releaseAuthentication.evidence === null
			: releaseAuthentication?.status === 'invalid-report-only'
				&& evidence?.status === 'release-authentication-invalid-report-only'
				&& typeof releaseAuthentication.blockedBy === 'string'
				&& releaseAuthentication.blockedBy.length > 0
				&& [null, expectedAuthenticationName].includes(
					releaseAuthentication.evidence?.name ?? null,
				);
	if (!releaseObservationValid
		|| evidence?.automatedStatus !== 'installed-application-closure-audited'
		|| !SHA256.test(String(evidence?.automatedEvidenceSha256))
		|| evidence.productId !== identity.productId
		|| evidence.targetId !== identity.targetId || evidence.sourceRevision !== cell.sourceRevision
		|| typeof evidence.applicationVersion !== 'string' || evidence.applicationVersion.length === 0
		|| !Array.isArray(evidence.packages) || evidence.packages.length < 1
		|| evidence.packageCount !== evidence.packages.length) {
		throw new Error(`Milestone 5 handoff ${cellId(identity)} has invalid package evidence.`);
	}
	if (policyEvidence?.name !== policyPath
		|| policyEvidence.byteLength !== cell.inputDigests?.[policyPath]?.byteLength
		|| policyEvidence.sha256 !== cell.inputDigests?.[policyPath]?.sha256) {
		throw new Error(`Milestone 5 handoff ${cellId(identity)} has an unbound package authentication policy.`);
	}
	const inventory = desktopReleaseTargetPackageInventory(
		identity.productId,
		identity.targetId,
		evidence.applicationVersion,
	);
	if (evidence.packages.length !== inventory.length || inventory.some(({ label, pattern }) => {
		const matches = evidence.packages.filter((descriptor) => (
			descriptor.label === label && pattern.test(descriptor.name)
		));
		return matches.length !== 1;
	})) {
		throw new Error(`Milestone 5 handoff ${cellId(identity)} has invalid target package inventory.`);
	}
	const contentClosures = evidence.packages.map(({ content }) => content);
	const firstContent = contentClosures[0];
	for (const content of contentClosures) {
		if (content?.status !== 'installed-resource-closure-audited'
			|| content.productId !== identity.productId || content.targetId !== identity.targetId
			|| content.applicationVersion !== evidence.applicationVersion
			|| content.sourceRevision !== cell.sourceRevision
			|| !Number.isSafeInteger(content.fileCount) || content.fileCount < 1
			|| !Number.isSafeInteger(content.totalBytes) || content.totalBytes < 1
			|| !Number.isSafeInteger(content.contentManifestByteLength)
			|| content.contentManifestByteLength < 1
			|| !Number.isSafeInteger(content.installedFileCount) || content.installedFileCount < 1
			|| !Number.isSafeInteger(content.installedTotalBytes) || content.installedTotalBytes < 1
			|| !SHA256.test(String(content.closureSha256))
			|| !SHA256.test(String(content.contentManifestSha256))
			|| !SHA256.test(String(content.installedClosureSha256))
			|| content.closureSha256 !== firstContent.closureSha256
			|| content.contentManifestSha256 !== firstContent.contentManifestSha256
			|| content.installedClosureSha256 !== firstContent.installedClosureSha256
			|| content.fileCount !== firstContent.fileCount || content.totalBytes !== firstContent.totalBytes
			|| content.installedFileCount !== firstContent.installedFileCount
			|| content.installedTotalBytes !== firstContent.installedTotalBytes) {
			throw new Error(`Milestone 5 handoff ${cellId(identity)} has invalid package-content evidence.`);
		}
	}
	const descriptors = [
		evidence.runtimeManifest,
		...evidence.packages,
		...(releaseAuthentication.evidence === null ? [] : [releaseAuthentication.evidence]),
	];
	if (evidence.runtimeManifest?.name !== `runtime-manifest-${identity.productId}-${identity.targetId}.json`) {
		throw new Error(`Milestone 5 handoff ${cellId(identity)} has an invalid package manifest identity.`);
	}
	assertDesktopCodecPolicy(evidence.desktopCodecPolicy,
		`Milestone 5 handoff ${cellId(identity)} desktop codec policy`);
	for (const descriptor of descriptors) {
		if (typeof descriptor?.name !== 'string' || basename(descriptor.name) !== descriptor.name
			|| !Number.isSafeInteger(descriptor.byteLength) || descriptor.byteLength < 1
			|| descriptor.byteLength > MAXIMUM_PACKAGE_BYTES
			|| !SHA256.test(String(descriptor.sha256))) {
			throw new Error(`Milestone 5 handoff ${cellId(identity)} has an invalid package digest.`);
		}
		const digest = cell.inputDigests?.[
			`desktop-package:${identity.productId}:${identity.targetId}:${descriptor.name}`
		];
		if (digest?.byteLength !== descriptor.byteLength || digest.sha256 !== descriptor.sha256) {
			throw new Error(`Milestone 5 handoff ${cellId(identity)} package digest is not input-bound.`);
		}
	}
	const expectedPackageKeys = new Set(descriptors.map(({ name }) => (
		`desktop-package:${identity.productId}:${identity.targetId}:${name}`
	)));
	const actualPackageKeys = Object.keys(cell.inputDigests)
		.filter((key) => key.startsWith('desktop-package:'));
	if (actualPackageKeys.length !== expectedPackageKeys.size
		|| actualPackageKeys.some((key) => !expectedPackageKeys.has(key))) {
		throw new Error(`Milestone 5 handoff ${cellId(identity)} has foreign package digests.`);
	}
	const packageBytes = evidence.packages.reduce((total, item) => total + item.byteLength, 0);
	if (!Number.isSafeInteger(packageBytes) || evidence.totalPackageBytes !== packageBytes) {
		throw new Error(`Milestone 5 handoff ${cellId(identity)} total package bytes drifted.`);
	}
}

function validateReadinessSummary(cell, identity, engineeringScope) {
	const sources = cell.sources;
	const payloads = cell.payloads;
	const licensing = cell.licensing;
	const automatedSources = cell.automatedEvidence?.sources;
	const automatedPayloads = cell.automatedEvidence?.payloads;
	const sourceCount = engineeringScope.sourceCount;
	const payloadCount = engineeringScope.payloadCount;
	if (cell.automatedEvidence?.schemaVersion !== 1
		|| !Array.isArray(automatedSources) || automatedSources.length !== sourceCount
		|| !Array.isArray(automatedPayloads)
		|| automatedPayloads.length !== payloadCount
		|| sources?.total !== sourceCount || !integerInRange(sources.authenticated, 0, sourceCount)
		|| !integerInRange(sources.pendingExternal, 0, sourceCount)
		|| sources.authenticated + sources.pendingExternal !== sources.total
		|| !integerInRange(sources.activationBlocked, 0, sourceCount)
		|| payloads?.total !== payloadCount
		|| !integerInRange(payloads.built, 0, payloadCount)
		|| !integerInRange(payloads.pendingExternal, 0, payloadCount)
		|| payloads.built + payloads.pendingExternal !== payloads.total
		|| !closedUniqueStrings(licensing?.disabledGates,
			['native-audio', 'native-codecs', 'native-plugins'])
		|| !uniqueNonemptyStrings(licensing?.blockedPolicyRows)) {
		throw new Error(`Milestone 5 handoff ${cellId(identity)} has an invalid readiness summary.`);
	}
	const authenticatedSources = automatedSources.filter(({ authenticationStatus }) => (
		authenticationStatus === 'authenticated'
	)).length;
	const builtPayloads = automatedPayloads.filter(({ buildStatus, payloadEvidence }) => (
		buildStatus === 'built' && payloadEvidence !== null
	)).length;
	if (sources.authenticated !== authenticatedSources
		|| sources.pendingExternal !== sourceCount - authenticatedSources
		|| payloads.built !== builtPayloads
		|| payloads.pendingExternal !== payloadCount - builtPayloads
		|| !isDeepStrictEqual(cell.automatedEvidence.package, automatedPackageEvidence(cell))) {
		throw new Error(`Milestone 5 handoff ${cellId(identity)} machine summary drifted from automated evidence.`);
	}
	return authenticatedSources === sourceCount
		&& builtPayloads === payloadCount
		&& cell.packageEvidence.packages.every(({ content }) => content !== null);
}

function automatedPackageEvidence(cell) {
	const evidence = cell.packageEvidence;
	return {
		productId: evidence.productId,
		targetId: evidence.targetId,
		applicationVersion: evidence.applicationVersion,
		sourceRevision: evidence.sourceRevision,
		runtimeManifest: {
			name: evidence.runtimeManifest.name,
			byteLength: evidence.runtimeManifest.byteLength,
			sha256: evidence.runtimeManifest.sha256,
		},
		packages: evidence.packages.map((entry) => ({
			label: entry.label,
			name: entry.name,
			byteLength: entry.byteLength,
			sha256: entry.sha256,
			content: entry.content === null ? null : {
				status: entry.content.status,
				closureSha256: entry.content.closureSha256,
				contentManifestSha256: entry.content.contentManifestSha256,
				installedClosureSha256: entry.content.installedClosureSha256,
			},
		})),
	};
}

function validateInputDigests(cell, identity, engineeringScope) {
	const digests = cell.inputDigests;
	if (!digests || typeof digests !== 'object' || Array.isArray(digests)) {
		throw new Error(`Milestone 5 handoff ${cellId(identity)} has invalid input digests.`);
	}
	for (const path of milestone5RequiredHandoffInputPaths(engineeringScope)) {
		if (!Object.hasOwn(digests, path)) {
			throw new Error(`Milestone 5 handoff ${cellId(identity)} is missing ${path}.`);
		}
	}
	for (const [path, descriptor] of Object.entries(digests)) {
		if (path.length < 1 || path.length > 1_024 || path.includes('\0')
			|| !Number.isSafeInteger(descriptor?.byteLength) || descriptor.byteLength < 1
			|| !SHA256.test(String(descriptor?.sha256))) {
			throw new Error(`Milestone 5 handoff ${cellId(identity)} has an invalid input digest.`);
		}
		if (!isAllowedInputDigestPath(path, cell, engineeringScope)) {
			throw new Error(`Milestone 5 handoff ${cellId(identity)} has an unexpected input digest.`);
		}
	}
}

function isAllowedInputDigestPath(path, cell, engineeringScope) {
	if (milestone5RequiredHandoffInputPaths(engineeringScope).includes(path)
		|| path.startsWith('desktop-package:')) return true;
	if (path.startsWith('qualification/milestone-5/')) {
		const segments = path.slice('qualification/milestone-5/'.length).split('/');
		return segments.length > 0 && segments.every((segment) => (
			segment.length > 0 && segment !== '.' && segment !== '..'
		));
	}
	return cell.qualification.sourceRevision !== null
		&& path === `git:${cell.qualification.sourceRevision}:config/quality-budgets.json`;
}

function validateCommonEvidence(cells) {
	const first = cells[0];
	for (const cell of cells.slice(1)) {
		if (cell.sourceRevision !== first.sourceRevision
			|| cell.packageEvidence.applicationVersion !== first.packageEvidence.applicationVersion
			|| !isDeepStrictEqual(
				cell.automatedEvidence?.sources,
				first.automatedEvidence?.sources,
			)
			|| !isDeepStrictEqual(
				cell.automatedEvidence?.payloads,
				first.automatedEvidence?.payloads,
			)) {
			throw new Error('Milestone 5 handoff matrix cells disagree on automated source or payload evidence.');
		}
	}
}

function groupBlockers(cells) {
	const grouped = new Map();
	for (const cell of cells) for (const item of cell.automatedBlockers) {
		const key = `${item.id}\0${item.reason}`;
		const entry = grouped.get(key) ?? { id: item.id, reason: item.reason, cells: [] };
		entry.cells.push(cellId(cell.assessmentScope));
		grouped.set(key, entry);
	}
	return [...grouped.values()];
}

function cellSummary(cell, authenticated) {
	return {
		productId: cell.assessmentScope.productId,
		targetId: cell.assessmentScope.targetId,
		packageCellAutomatedReady: authenticated ? cell.packageCellAutomatedReady : null,
		declaredPackageCellAutomatedReady: cell.packageCellAutomatedReady,
		packageCellReady: null,
		status: authenticated ? cell.status : 'unattributed-serialized-cell',
		automatedBlockerCount: cell.automatedBlockers.length,
		packageEvidence: cell.packageEvidence,
	};
}

function handoffFileName(identity) {
	return `milestone-5-handoff-${identity.productId}-${identity.targetId}.json`;
}

function packageDirectoryName(identity) {
	return `nightly-${identity.productId}-${identity.targetId}`;
}

function sameIdentity(actual, expected) {
	return actual?.productId === expected.productId && actual?.targetId === expected.targetId;
}

function cellId(identity) {
	return `${identity.productId}:${identity.targetId}`;
}

function numberWord(value) {
	return value === 5 ? 'five' : value === 10 ? 'ten' : String(value);
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function integerInRange(value, minimum, maximum) {
	return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function uniqueNonemptyStrings(value) {
	return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)
		&& new Set(value).size === value.length;
}

function closedUniqueStrings(value, allowed) {
	return uniqueNonemptyStrings(value) && value.every((item) => allowed.includes(item));
}

function deepFreeze(value) {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}
