/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import {
	auditMilestone5NativeSourceAcquisitions,
	auditMilestone5NativeSourceAcquisitionsForProducts,
	isAuditedMilestone5NativeSourceAcquisitions,
} from './milestone-5-native-source-acquisitions.mjs';
import { validateMilestone5LicensingReadiness } from './milestone-5-licensing-readiness.mjs';
import {
	MILESTONE_5_QUALIFICATION_EVIDENCE_PATH,
	auditMilestone5QualificationEvidence,
	isAuditedMilestone5QualificationEvidence,
} from './milestone-5-qualification-evidence.mjs';
import {
	auditMilestone5Payloads,
	isAuditedMilestone5Payloads,
} from './milestone-5-payload-audit.mjs';
import {
	auditMilestone5PackageEvidence,
	isAuditedMilestone5PackageEvidence,
} from './milestone-5-package-evidence.mjs';
import { validateMilestone5PackagePayloadBinding } from './milestone-5-handoff-package-binding.mjs';
import { assessMilestone5AutomatedReadiness } from './milestone-5-handoff-automated-readiness.mjs';
import {
	NATIVE_OS_LAB_PROFILES_V2,
	NATIVE_OS_LAB_REQUIRED_PROFILE_IDS,
	validateNativeOsLabEnvironmentV2,
} from './native-os-lab-schema.mjs';
import {
	authenticateHandoffSourceRevision,
	validateQualificationRevisionCompatibility,
} from './milestone-5-qualification-revision.mjs';
import {
	authenticateMilestone5HandoffAuditorInputs,
	describeMilestone5HandoffBytes,
	readMilestone5HandoffAuthorityBytes,
	readMilestone5HandoffInputSnapshot,
} from './milestone-5-handoff-input-authentication.mjs';
import {
	MILESTONE_5_PRODUCTS,
	milestone5EngineeringScope,
} from './milestone-5-product-scope.mjs';
export const MILESTONE_5_HANDOFF_WORKLOAD_IDS = Object.freeze([
	'm5-native-helper-and-audio',
	'm5b-native-media-plan-parity-and-decode',
	'm5b-professional-media-tier',
	'm5b-persistent-services-recovery',
	'm5b-clean-external-display',
	'm5b-openfx-isolation-and-packaging',
]);

export const MILESTONE_5_HANDOFF_INPUT_PATHS = Object.freeze({
	qualityBudgets: 'config/quality-budgets.json',
	licensingMatrix: 'config/production-licensing-matrix.json',
	sourceAcquisitions: 'config/milestone-5-native-source-acquisitions.json',
	releaseAuthenticationPolicy: 'config/milestone-5-package-release-authentication-policy.json',
	nativeIsolationReviewPolicy: 'config/milestone-5-native-isolation-review-policy.json',
	qualificationEvidence: MILESTONE_5_QUALIFICATION_EVIDENCE_PATH,
	nativeAddonPayload: 'config/native-addon-payload-manifest.json',
	soundscaperProfessionalPayload: 'config/soundscaper-professional-native-payload-manifest.json',
	mediaHostPayload: 'config/framescaper-media-host-payload-manifest.json',
	openFxHostPayload: 'config/framescaper-openfx-host-payload-manifest.json',
});
const TARGET_IDS = Object.freeze(['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']);
const HANDOFF_GATE_IDS = Object.freeze([
	'legalAndTrademarkReview',
	'nativeIsolationSecurityReview',
	'productionSigningAndNotarization',
]);
const SOURCE_REVISION = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;
const ASSEMBLED_HANDOFF_INPUTS = new WeakSet();
const ASSEMBLED_HANDOFF_OUTPUTS = new WeakSet();
const ASSEMBLED_HANDOFF_SOURCE_REVISIONS = new WeakMap();
export function assessMilestone5Handoff(inputs, productIdsValue = MILESTONE_5_PRODUCTS) {
	assertRecord(inputs, 'Milestone 5 handoff inputs');
	const engineeringScope = milestone5EngineeringScope(productIdsValue);
	const assemblyInputsAuthenticated = ASSEMBLED_HANDOFF_INPUTS.has(inputs);
	const sourceInputsAudited = isAuditedMilestone5NativeSourceAcquisitions(
		inputs.sourceAcquisitions,
	);
	const sources = validateSourceAcquisitions(
		inputs.sourceAcquisitions, sourceInputsAudited, engineeringScope,
	);
	const lab = findLab(inputs.qualityBudgets, engineeringScope);
	validateWorkloads(inputs.qualityBudgets, engineeringScope);
	const qualificationAuthenticated = isAuditedMilestone5QualificationEvidence(
		inputs.qualificationAudit,
	);
	const payloadsAuthenticated = isAuditedMilestone5Payloads(inputs.payloadAudit);
	const packageAudited = isAuditedMilestone5PackageEvidence(inputs.packageAudit);
	const cohorts = qualificationAuthenticated
		? validateAcceptedCohorts(inputs.qualificationAudit.cohorts, engineeringScope)
		: [];
	const declaredPayloadRows = payloadManifestEntries(inputs, engineeringScope).flatMap(
		([, manifest, product]) => validatePayloadManifest(manifest, product),
	);
	const payloadRows = payloadsAuthenticated
		? validateAuditedPayloads(inputs, declaredPayloadRows, engineeringScope)
		: declaredPayloadRows;
	const licensing = validateMilestone5LicensingReadiness(inputs.licensingMatrix);
	const pendingHandoffGates = HANDOFF_GATE_IDS.filter((id) => lab.handoffGates[id] !== 'accepted');
	if (packageAudited && payloadsAuthenticated) validateMilestone5PackagePayloadBinding(
		inputs.packageAudit,
		inputs.payloadAudit,
		MILESTONE_5_HANDOFF_INPUT_PATHS,
		engineeringScope,
	);
	const automated = assessMilestone5AutomatedReadiness({
		assemblyInputsAuthenticated,
		sourceInputsAudited,
		payloadsAuthenticated,
		packageAudited,
		sourceRevisionAuthenticated: ASSEMBLED_HANDOFF_SOURCE_REVISIONS.get(inputs) === true,
		sources,
		payloadRows,
		packageAudit: packageAudited ? inputs.packageAudit : null,
	});
	const built = payloadRows.filter(({ buildStatus }) => buildStatus === 'built').length;
	const provisionedProfileCount = lab.profiles.filter(({ platformId }) =>
		lab.physicalHosts[platformId] !== null).length;
	return deepFreeze({
		schemaVersion: 2,
		engineeringScope,
		assessmentScope: packageAudited
			? {
				kind: 'package-cell',
				productId: inputs.packageAudit.productId,
				targetId: inputs.packageAudit.targetId,
			}
			: { kind: 'engineering-inputs' },
		assemblyInputsAuthenticated,
		sourceInputsAudited,
		engineeringEvidenceAuthenticated: automated.automatedEvidenceAuthenticated,
		...automated,
		packageCellReady: null,
		// Whole-milestone readiness requires an exact ten-cell aggregate. A
		// single package job is intentionally incapable of making that claim.
		milestoneReleaseReady: null,
		status: automated.automatedStatus,
		sources: {
			authenticated: sources.filter(({ authenticationStatus }) => (
				authenticationStatus === 'authenticated'
			)).length,
			pendingExternal: sources.filter(({ authenticationStatus }) => (
				authenticationStatus !== 'authenticated'
			)).length,
			activationBlocked: sources.filter(({ activationStatus }) =>
				activationStatus === 'blocked').length,
			total: sources.length,
		},
		payloads: { built, pendingExternal: payloadRows.length - built, total: payloadRows.length },
		qualification: {
			workloadIds: [...engineeringScope.workloadIds],
			profileCount: lab.profiles.length,
			provisionedProfileCount,
			acceptedCohortCount: cohorts.filter(({ status }) => status === 'accepted').length,
			sourceRevision: cohorts[0]?.sourceRevision ?? null,
			revisionBinding: null,
			pendingHandoffGates,
		},
		packageEvidence: packageAudited
			? packageEvidenceSummary(inputs.packageAudit)
			: null,
		licensing,
		blockers: automated.automatedBlockers,
	});
}

export async function assembleMilestone5Handoff(
	repositoryRoot,
	sourceRevision,
	packageOptions = null,
	dependencies = {},
) {
	return assembleMilestone5HandoffScope({
		repositoryRoot,
		sourceRevision,
		packageOptions,
		productIds: MILESTONE_5_PRODUCTS,
	}, dependencies);
}

export async function assembleMilestone5ProductHandoff(options, dependencies = {}) {
	assertRecord(options, 'Milestone 5 product handoff options');
	const keys = Object.keys(options).sort();
	assert(keys.every((key) => [
		'packageOptions', 'productIds', 'repositoryRoot', 'sourceRevision',
	].includes(key)) && keys.includes('productIds') && keys.includes('repositoryRoot'),
	'Milestone 5 product handoff options have an unexpected shape.');
	return assembleMilestone5HandoffScope({
		repositoryRoot: options.repositoryRoot,
		sourceRevision: options.sourceRevision,
		packageOptions: options.packageOptions ?? null,
		productIds: options.productIds,
	}, dependencies);
}

async function assembleMilestone5HandoffScope(options, dependencies) {
	const { repositoryRoot, sourceRevision, packageOptions } = options;
	const engineeringScope = milestone5EngineeringScope(options.productIds);
	const observedHeadRevision = currentRevision(repositoryRoot);
	const sourceRevisionBinding = sourceRevision === undefined
		? deepFreeze({
			status: 'unattributed-working-tree',
			sourceRevision: null,
			observedHeadRevision,
		})
		: authenticateMilestone5HandoffSourceRevision(repositoryRoot, sourceRevision);
	const revision = sourceRevisionBinding.sourceRevision ?? observedHeadRevision;
	const authorityRevision = sourceRevisionBinding.status === 'authenticated-clean-head'
		? revision : null;
	const inputPaths = milestone5HandoffInputPaths(engineeringScope);
	const snapshot = readMilestone5HandoffInputSnapshot(
		repositoryRoot,
		inputPaths,
		authorityRevision,
	);
	const { inputs, bytes: inputBytes, inputDigests } = snapshot;
	inputs.sourceAcquisitionRegister = inputs.sourceAcquisitions;
	for (const { manifestPath } of engineeringScope.includeDelegatedSources
		? inputs.sourceAcquisitionRegister.delegatedSources : []) {
		const bytes = readMilestone5HandoffAuthorityBytes(
			repositoryRoot,
			authorityRevision,
			manifestPath,
		);
		inputDigests[manifestPath] = describeMilestone5HandoffBytes(bytes);
	}
	// The audit checks the duplicated Framescaper pins and only authenticates
	// rows backed by the exact external archive/source cache in this process.
	inputs.sourceAcquisitions = engineeringScope.kind === 'retained-dual-product'
		? auditMilestone5NativeSourceAcquisitions(repositoryRoot)
		: auditMilestone5NativeSourceAcquisitionsForProducts(
			repositoryRoot, engineeringScope.products,
		);
	inputs.payloadAudit = await auditMilestone5Payloads(repositoryRoot, engineeringScope.products);
	inputs.qualificationAudit = await auditMilestone5QualificationEvidence({
		repositoryRoot,
		productIds: engineeringScope.products,
	});
	if (packageOptions !== null) {
		validatePackageOptions(packageOptions);
		inputs.packageAudit = await auditMilestone5PackageEvidence({
			repositoryRoot: resolve(repositoryRoot),
			packageRoot: resolve(repositoryRoot, packageOptions.packageRoot),
			productId: packageOptions.productId,
			targetId: packageOptions.targetId,
		}, {
			auditPackageArtifactContent: dependencies.auditPackageArtifactContent,
			releaseAuthenticationPolicyBytes:
				inputBytes[MILESTONE_5_HANDOFF_INPUT_PATHS.releaseAuthenticationPolicy],
		});
		if (sourceRevisionBinding.status === 'authenticated-clean-head') {
			assert(inputs.packageAudit.sourceRevision === sourceRevisionBinding.sourceRevision,
				'Milestone 5 package runtime manifest does not bind the authenticated handoff revision.');
		}
		for (const descriptor of [
			inputs.packageAudit.runtimeManifest,
			...inputs.packageAudit.packages,
			...(inputs.packageAudit.releaseAuthentication.evidence === null
				? [] : [inputs.packageAudit.releaseAuthentication.evidence]),
		]) {
			inputDigests[
				`desktop-package:${inputs.packageAudit.productId}:${inputs.packageAudit.targetId}:${descriptor.name}`
			] = { byteLength: descriptor.byteLength, sha256: descriptor.sha256 };
		}
	}
	for (const path of Object.keys(inputs.payloadAudit.inputDigests)) {
		if (Object.hasOwn(inputDigests, path)) continue;
		const bytes = readMilestone5HandoffAuthorityBytes(
			repositoryRoot,
			authorityRevision,
			path,
		);
		inputDigests[path] = describeMilestone5HandoffBytes(bytes);
	}
	authenticateMilestone5HandoffAuditorInputs({ inputs, inputBytes, inputDigests });
	Object.assign(inputDigests, inputs.sourceAcquisitions.inputDigests);
	Object.assign(inputDigests, inputs.payloadAudit.inputDigests);
	for (const row of inputs.qualificationAudit.rows) {
		if (row.cohort.path !== null) inputDigests[row.cohort.path] = {
			byteLength: row.cohort.byteLength,
			sha256: row.cohort.sha256,
		};
		for (const measurement of row.status === 'accepted' ? inputs.qualificationEvidence.rows
			.find(({ workloadId }) => workloadId === row.workloadId).measurements : []) {
			inputDigests[measurement.path] = {
				byteLength: measurement.byteLength,
				sha256: measurement.sha256,
			};
		}
	}
	if (inputs.qualificationAudit.sourceRevision !== null) {
		inputDigests[`git:${inputs.qualificationAudit.sourceRevision}:config/quality-budgets.json`] = {
			byteLength: inputs.qualificationAudit.historicalBudgetByteLength,
			sha256: inputs.qualificationAudit.budgetSha256,
		};
	}
	ASSEMBLED_HANDOFF_INPUTS.add(inputs);
	ASSEMBLED_HANDOFF_SOURCE_REVISIONS.set(
		inputs,
		sourceRevisionBinding.status === 'authenticated-clean-head',
	);
	const assessment = assessMilestone5Handoff(inputs, engineeringScope.products);
	const revisionBinding = assessment.qualification.sourceRevision === null
		? null
		: validateMilestone5QualificationRevisionCompatibility(
			repositoryRoot,
			assessment.qualification.sourceRevision,
			revision,
			inputs.qualityBudgets,
			engineeringScope.products,
		);
	const sourceAuthenticated = sourceRevisionBinding.status === 'authenticated-clean-head';
	if (sourceAuthenticated) {
		const postflight = authenticateMilestone5HandoffSourceRevision(repositoryRoot, revision);
		assert(postflight.sourceRevision === sourceRevisionBinding.sourceRevision,
			'Milestone 5 handoff source revision changed during assembly.');
	}
	const handoff = deepFreeze({
		...assessment,
		qualification: { ...assessment.qualification, revisionBinding },
		sourceRevision: sourceAuthenticated ? revision : null,
		observedHeadRevision,
		sourceRevisionBinding,
		inputDigests,
	});
	ASSEMBLED_HANDOFF_OUTPUTS.add(handoff);
	return handoff;
}

export function isAssembledMilestone5Handoff(value) {
	return value !== null && typeof value === 'object' && ASSEMBLED_HANDOFF_OUTPUTS.has(value);
}

/**
 * Admit the unavoidable evidence commit without letting measurements for an
 * older runtime qualify changed product code. Only raw/register evidence and
 * the six workload publication markers may differ from the measured revision.
 */
export function validateMilestone5QualificationRevisionCompatibility(
	repositoryRoot,
	qualificationSourceRevision,
	handoffSourceRevision,
	currentQualityBudgets,
	productIdsValue = MILESTONE_5_PRODUCTS,
) {
	const engineeringScope = milestone5EngineeringScope(productIdsValue);
	return validateQualificationRevisionCompatibility({
		repositoryRoot,
		qualificationSourceRevision,
		handoffSourceRevision,
		currentQualityBudgets,
		workloadIds: engineeringScope.workloadIds,
	});
}

export function authenticateMilestone5HandoffSourceRevision(repositoryRoot, assertedRevision) {
	return authenticateHandoffSourceRevision(repositoryRoot, assertedRevision);
}

function findLab(qualityBudgets, engineeringScope) {
	assertRecord(qualityBudgets, 'Milestone 5 quality budgets');
	const matches = qualityBudgets.environments?.filter(({ id }) => id === 'native-os-lab-matrix') ?? [];
	assert(matches.length === 1, 'Milestone 5 quality budgets need exactly one native OS lab.');
	const lab = validateNativeOsLabEnvironmentV2(matches[0]);
	assert(JSON.stringify(lab.profiles.map(({ id }) => id)) === JSON.stringify(NATIVE_OS_LAB_REQUIRED_PROFILE_IDS),
		'Milestone 5 native lab profiles do not match the exact handoff matrix.');
	return deepFreeze({
		...lab,
		profiles: lab.profiles.filter(({ id }) => engineeringScope.labProfileIds.includes(id)),
	});
}

function validateWorkloads(qualityBudgets, engineeringScope) {
	assert(Array.isArray(qualityBudgets.workloads), 'Milestone 5 quality workloads must be an array.');
	const registeredIds = qualityBudgets.qualification?.qualifiedWorkloadIds;
	assert(Array.isArray(registeredIds), 'Milestone 5 qualifiedWorkloadIds must be an array.');
	return engineeringScope.workloadIds.map((id) => {
		const matches = qualityBudgets.workloads.filter((workload) => workload.id === id);
		assert(matches.length === 1, `Milestone 5 workload ${id} must occur exactly once.`);
		assert(typeof matches[0].status === 'string', `Milestone 5 workload ${id} needs a status.`);
		return { ...matches[0], registered: registeredIds.includes(id) };
	});
}

function validateAcceptedCohorts(cohortsValue, engineeringScope) {
	assert(Array.isArray(cohortsValue), 'Milestone 5 accepted cohorts must be an array.');
	const cohorts = cohortsValue.map((cohort, index) => {
		assertRecord(cohort, `Milestone 5 cohort ${String(index)}`);
		assert(engineeringScope.workloadIds.includes(cohort.workloadId),
			`Milestone 5 cohort ${String(index)} has an unknown workload.`);
		assert(cohort.schemaVersion === 2, `Milestone 5 cohort ${cohort.workloadId} must use schemaVersion 2.`);
		assert(['accepted', 'pending-external', 'failed'].includes(cohort.status),
			`Milestone 5 cohort ${cohort.workloadId} has an invalid status.`);
		assert(SOURCE_REVISION.test(cohort.sourceRevision),
			`Milestone 5 cohort ${cohort.workloadId} has an invalid source revision.`);
		const productId = cohort.workloadId.startsWith('m5b-') ? 'framescaper' : 'soundscaper';
		const expectedProfileIds = NATIVE_OS_LAB_PROFILES_V2
			.filter((profile) => profile.productId === productId
				&& engineeringScope.labProfileIds.includes(profile.id))
			.map(({ id }) => id);
		assert(JSON.stringify(cohort.labProfileIds) === JSON.stringify(expectedProfileIds),
			`Milestone 5 cohort ${cohort.workloadId} does not cover its exact native-lab profiles.`);
		const accepted = cohort.status === 'accepted';
		assert(cohort.qualificationEvidencePublished === accepted
			&& cohort.evaluation?.passed === accepted,
			`Milestone 5 cohort ${cohort.workloadId} publication state is inconsistent.`);
		return cohort;
	});
	assert(new Set(cohorts.map(({ workloadId }) => workloadId)).size === cohorts.length,
		'Milestone 5 cohort workloads must be unique.');
	assert(new Set(cohorts.map(({ sourceRevision }) => sourceRevision)).size <= 1,
		'Milestone 5 cohorts must bind one source revision.');
	return cohorts;
}

function validateAuditedPayloads(inputs, declaredRows, engineeringScope) {
	const audit = inputs.payloadAudit;
	assert(audit.schemaVersion === 2,
		'Milestone 5 authenticated payload audit has an unsupported schema.');
	assert(JSON.stringify(audit.reviewPolicy) === JSON.stringify({
		path: MILESTONE_5_HANDOFF_INPUT_PATHS.nativeIsolationReviewPolicy,
		...audit.inputDigests[MILESTONE_5_HANDOFF_INPUT_PATHS.nativeIsolationReviewPolicy],
	}), 'Milestone 5 authenticated payload audit has inconsistent isolation-review policy evidence.');
	for (const [key, , , inputKey] of payloadManifestEntries(inputs, engineeringScope)) {
		assert(JSON.stringify(audit.manifests[key]) === JSON.stringify(inputs[inputKey]),
			`Milestone 5 authenticated ${key} payload manifest disagrees with the handoff input.`);
	}
	assert(Array.isArray(audit.rows) && audit.rows.length === declaredRows.length,
		'Milestone 5 authenticated payload audit has an incomplete target matrix.');
	for (const declared of declaredRows) {
		const identity = `${declared.product}:${declared.id}`;
		const matches = audit.rows.filter((row) => row.identity === identity);
		assert(matches.length === 1 && matches[0].buildStatus === declared.status,
			`Milestone 5 authenticated payload row ${identity} disagrees with its manifest.`);
		const row = matches[0];
		assert(JSON.stringify(row.payloadEvidence) === JSON.stringify(declared.payloadEvidence),
			`Milestone 5 authenticated payload row ${identity} has inconsistent machine evidence.`);
	}
	return audit.rows.map((row) => ({
		identity: row.identity,
		product: row.product,
		id: row.targetId,
		targetId: row.targetId,
		buildStatus: row.buildStatus,
		payloadEvidence: row.payloadEvidence,
		status: row.status,
		blockedBy: row.blockedBy,
		productionReadiness: row.productionReadiness,
	}));
}

function packageEvidenceSummary(audit) {
	return {
		status: audit.status,
		automatedStatus: audit.automatedStatus,
		automatedEvidenceSha256: audit.automatedEvidenceSha256,
		releaseAuthentication: { ...audit.releaseAuthentication },
		productId: audit.productId,
		targetId: audit.targetId,
		applicationVersion: audit.applicationVersion,
		sourceRevision: audit.sourceRevision,
		runtimeManifest: {
			name: audit.runtimeManifest.name,
			byteLength: audit.runtimeManifest.byteLength,
			sha256: audit.runtimeManifest.sha256,
		},
		desktopCodecPolicy: structuredClone(audit.desktopCodecPolicy),
		packages: audit.packages.map(({ label, name, byteLength, sha256: digest, content }) => ({
			label, name, byteLength, sha256: digest,
			content: content === null ? null : { ...content },
		})),
		packageCount: audit.packageCount,
		totalPackageBytes: audit.totalPackageBytes,
	};
}

function validatePackageOptions(options) {
	assertRecord(options, 'Milestone 5 package audit options');
	assert(JSON.stringify(Object.keys(options).sort())
		=== JSON.stringify(['packageRoot', 'productId', 'targetId']),
	'Milestone 5 package audit options have an unexpected shape.');
	for (const field of ['packageRoot', 'productId', 'targetId']) {
		assert(typeof options[field] === 'string' && options[field].length > 0,
			`Milestone 5 package audit ${field} is required.`);
	}
}

function validateSourceAcquisitions(register, audited, engineeringScope) {
	assertRecord(register, 'Milestone 5 native source acquisitions');
	assert(register.schemaVersion === 1 && Array.isArray(register.sources),
		'Milestone 5 native source acquisitions are invalid.');
	assert(JSON.stringify(register.sources.map(({ id }) => id)) === JSON.stringify(engineeringScope.sourceIds),
		'Milestone 5 native source IDs are incomplete or out of order.');
	for (const source of register.sources) {
		assert((audited
			? ['authenticated', 'pending-external'].includes(source.authenticationStatus)
			: source.authenticationStatus === 'pinned-metadata')
			&& ['blocked', 'accepted'].includes(source.activationStatus),
			`Milestone 5 native source ${source.id} has invalid audit or activation state.`);
		assert(source.authenticationStatus === 'authenticated'
			? source.authenticationBlockedBy === null
			: audited
				? typeof source.authenticationBlockedBy === 'string'
					&& source.authenticationBlockedBy.length > 0
				: !Object.hasOwn(source, 'authenticationBlockedBy'),
			`Milestone 5 native source ${source.id} authentication evidence is inconsistent.`);
		assert(source.activationStatus === 'blocked'
			? typeof source.blockedBy === 'string' && source.blockedBy.length > 0
			: source.blockedBy === null,
			`Milestone 5 native source ${source.id} activation evidence is inconsistent.`);
	}
	return register.sources;
}

function payloadManifestEntries(inputs, engineeringScope) {
	const entries = [
		['nativeAddon', inputs.nativeAddonPayload, 'soundscaper', 'nativeAddonPayload'],
		['soundscaperProfessional', inputs.soundscaperProfessionalPayload,
			'soundscaper-professional', 'soundscaperProfessionalPayload'],
		['mediaHost', inputs.mediaHostPayload, 'framescaper-media', 'mediaHostPayload'],
		['openFxHost', inputs.openFxHostPayload, 'framescaper-openfx', 'openFxHostPayload'],
	];
	return entries.filter(([, , product]) => engineeringScope.payloadProducts.includes(product));
}

function milestone5HandoffInputPaths(engineeringScope) {
	return Object.fromEntries(Object.entries(MILESTONE_5_HANDOFF_INPUT_PATHS).filter(([key]) => (
		!['nativeAddonPayload', 'soundscaperProfessionalPayload', 'mediaHostPayload', 'openFxHostPayload']
			.includes(key) || engineeringScope.payloadInputKeys.includes(key)
	)));
}
function validatePayloadManifest(manifest, product) {
	assertRecord(manifest, `Milestone 5 ${product} payload manifest`);
	assert(manifest.schemaVersion === 1 && Array.isArray(manifest.targets),
		`Milestone 5 ${product} payload manifest is invalid.`);
	assert(JSON.stringify(manifest.targets.map(({ id }) => id)) === JSON.stringify(TARGET_IDS),
		`Milestone 5 ${product} payload targets must be the exact five-target matrix.`);
	return manifest.targets.map((target) => {
		assert(['built', 'pending-external'].includes(target.status),
			`Milestone 5 ${product} payload ${target.id} has an invalid status.`);
		assert(target.status === 'built'
			? target.payload !== null && target.blockedBy === null
			: target.payload === null && typeof target.blockedBy === 'string' && target.blockedBy.length > 0,
			`Milestone 5 ${product} payload ${target.id} has inconsistent evidence.`);
		return {
			identity: `${product}:${target.id}`,
			product,
			id: target.id,
			targetId: target.id,
			buildStatus: target.status,
			payloadEvidence: target.status === 'built'
				? machinePayloadEvidence(target, product) : null,
			status: target.status,
			blockedBy: target.blockedBy,
			productionReadiness: target.productionReadiness ?? null,
		};
	});
}

function machinePayloadEvidence(target, product) {
	if (product === 'soundscaper') return structuredClone(target.payload);
	if (product === 'soundscaper-professional') return structuredClone({
		payload: target.payload,
		pluginPeer: target.pluginPeer,
		isolation: target.isolation,
		sourceAuthentication: target.sourceAuthentication,
		toolchainIdentity: target.toolchainIdentity,
	});
	if (product === 'framescaper-media') return structuredClone({
		payload: target.payload,
		isolationPayload: target.isolationPayload,
	});
	return structuredClone(target.payload);
}

function currentRevision(repositoryRoot) {
	return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
}

function deepFreeze(value) {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}

function assertRecord(value, label) {
	assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
