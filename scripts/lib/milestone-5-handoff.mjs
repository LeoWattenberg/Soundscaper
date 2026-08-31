/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import {
	auditMilestone5NativeSourceAcquisitions,
	auditMilestone5NativeSourceAcquisitionsForProducts,
	isAuditedMilestone5NativeSourceAcquisitions,
} from './milestone-5-native-source-acquisitions.mjs';
import { auditMilestone5LicensingMatrix } from './milestone-5-licensing-audit.mjs';
import { auditMilestone5Payloads, isAuditedMilestone5Payloads } from './milestone-5-payload-audit.mjs';
import {
	auditMilestone5Package,
	isAuditedMilestone5Package,
} from './milestone-5-package-audit.mjs';
import { validateMilestone5PackagePayloadBinding } from './milestone-5-handoff-package-binding.mjs';
import { assessMilestone5AutomatedAudit } from './milestone-5-handoff-automated-audit.mjs';
import {
	authenticateMilestone5HandoffAuditorInputs,
	describeMilestone5HandoffBytes,
	readMilestone5HandoffAuthorityBytes,
	readMilestone5HandoffInputSnapshot,
} from './milestone-5-handoff-input-authentication.mjs';
import { MILESTONE_5_PRODUCTS, milestone5EngineeringScope } from './milestone-5-product-scope.mjs';

export const MILESTONE_5_HANDOFF_INPUT_PATHS = Object.freeze({
	licensingMatrix: 'config/production-licensing-matrix.json',
	sourceAcquisitions: 'config/milestone-5-native-source-acquisitions.json',
	nativeAddonPayload: 'config/native-addon-payload-manifest.json',
	soundscaperProfessionalPayload: 'config/soundscaper-professional-native-payload-manifest.json',
	mediaHostPayload: 'config/framescaper-media-host-payload-manifest.json',
	openFxHostPayload: 'config/framescaper-openfx-host-payload-manifest.json',
});

const TARGET_IDS = Object.freeze(['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']);
const SOURCE_REVISION = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;
const ASSEMBLED_HANDOFF_INPUTS = new WeakSet();
const ASSEMBLED_HANDOFF_OUTPUTS = new WeakSet();
const ASSEMBLED_HANDOFF_SOURCE_REVISIONS = new WeakMap();

/** Produce an ordinary machine audit. It makes no human or release-readiness claim. */
export function assessMilestone5Handoff(inputs, productIdsValue = MILESTONE_5_PRODUCTS) {
	assertRecord(inputs, 'Milestone 5 package-audit inputs');
	const engineeringScope = milestone5EngineeringScope(productIdsValue);
	const inputsAuthenticated = ASSEMBLED_HANDOFF_INPUTS.has(inputs);
	const sourceInputsAudited = isAuditedMilestone5NativeSourceAcquisitions(inputs.sourceAcquisitions);
	const sources = validateSourceAcquisitions(
		inputs.sourceAcquisitions, sourceInputsAudited, engineeringScope,
	);
	const payloadsAuthenticated = isAuditedMilestone5Payloads(inputs.payloadAudit);
	const packageAudited = isAuditedMilestone5Package(inputs.packageAudit);
	const declaredPayloadRows = payloadManifestEntries(inputs, engineeringScope).flatMap(
		([, manifest, product]) => validatePayloadManifest(manifest, product),
	);
	const payloadRows = payloadsAuthenticated
		? validateAuditedPayloads(inputs, declaredPayloadRows, engineeringScope)
		: declaredPayloadRows;
	if (packageAudited && payloadsAuthenticated) {
		validateMilestone5PackagePayloadBinding(
			inputs.packageAudit, inputs.payloadAudit, MILESTONE_5_HANDOFF_INPUT_PATHS, engineeringScope,
		);
	}
	const audit = assessMilestone5AutomatedAudit({
		assemblyInputsAuthenticated: inputsAuthenticated,
		sourceInputsAudited,
		payloadsAuthenticated,
		packageAudited,
		sourceRevisionAuthenticated: ASSEMBLED_HANDOFF_SOURCE_REVISIONS.get(inputs) === true,
		sources,
		payloadRows,
		packageAudit: packageAudited ? inputs.packageAudit : null,
	});
	const built = payloadRows.filter(({ buildStatus }) => buildStatus === 'built').length;
	return deepFreeze({
		schemaVersion: 3,
		kind: 'milestone-5-package-audit',
		engineeringScope,
		assessmentScope: packageAudited ? {
			kind: 'package-cell',
			productId: inputs.packageAudit.productId,
			targetId: inputs.packageAudit.targetId,
		} : { kind: 'engineering-inputs' },
		inputsAuthenticated,
		sourceInputsAudited,
		...audit,
		sources: {
			authenticated: sources.filter(({ authenticationStatus }) => (
				authenticationStatus === 'authenticated'
			)).length,
			unavailable: sources.filter(({ authenticationStatus }) => (
				authenticationStatus !== 'authenticated'
			)).length,
			total: sources.length,
		},
		payloads: { built, unavailable: payloadRows.length - built, total: payloadRows.length },
		package: packageAudited ? packageAuditSummary(inputs.packageAudit) : null,
		licensing: auditMilestone5LicensingMatrix(inputs.licensingMatrix),
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
	assertRecord(options, 'Milestone 5 product package-audit options');
	const keys = Object.keys(options).sort();
	assert(keys.every((key) => [
		'packageOptions', 'productIds', 'repositoryRoot', 'sourceRevision',
	].includes(key)) && keys.includes('productIds') && keys.includes('repositoryRoot'),
	'Milestone 5 product package-audit options have an unexpected shape.');
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
		? deepFreeze({ status: 'unattributed-working-tree', sourceRevision: null, observedHeadRevision })
		: authenticateMilestone5HandoffSourceRevision(repositoryRoot, sourceRevision);
	const revision = sourceRevisionBinding.sourceRevision ?? observedHeadRevision;
	const authorityRevision = sourceRevisionBinding.status === 'authenticated-clean-head' ? revision : null;
	const inputPaths = milestone5HandoffInputPaths(engineeringScope);
	const snapshot = readMilestone5HandoffInputSnapshot(repositoryRoot, inputPaths, authorityRevision);
	const { inputs, bytes: inputBytes, inputDigests } = snapshot;
	inputs.sourceAcquisitionRegister = inputs.sourceAcquisitions;
	for (const { manifestPath } of engineeringScope.includeDelegatedSources
		? inputs.sourceAcquisitionRegister.delegatedSources : []) {
		const bytes = readMilestone5HandoffAuthorityBytes(
			repositoryRoot, authorityRevision, manifestPath,
		);
		inputDigests[manifestPath] = describeMilestone5HandoffBytes(bytes);
	}
	inputs.sourceAcquisitions = engineeringScope.kind === 'retained-dual-product'
		? auditMilestone5NativeSourceAcquisitions(repositoryRoot)
		: auditMilestone5NativeSourceAcquisitionsForProducts(
			repositoryRoot, engineeringScope.products,
		);
	inputs.payloadAudit = await auditMilestone5Payloads(repositoryRoot, engineeringScope.products);
	if (packageOptions !== null) {
		validatePackageOptions(packageOptions);
		inputs.packageAudit = await auditMilestone5Package({
			repositoryRoot: resolve(repositoryRoot),
			packageRoot: resolve(repositoryRoot, packageOptions.packageRoot),
			productId: packageOptions.productId,
			targetId: packageOptions.targetId,
		}, { auditPackageArtifactContent: dependencies.auditPackageArtifactContent });
		if (sourceRevisionBinding.status === 'authenticated-clean-head') {
			assert(inputs.packageAudit.sourceRevision === sourceRevisionBinding.sourceRevision,
				'Milestone 5 package runtime manifest does not bind the audited revision.');
		}
		for (const descriptor of [inputs.packageAudit.runtimeManifest, ...inputs.packageAudit.packages]) {
			inputDigests[
				`desktop-package:${inputs.packageAudit.productId}:${inputs.packageAudit.targetId}:${descriptor.name}`
			] = { byteLength: descriptor.byteLength, sha256: descriptor.sha256 };
		}
	}
	for (const path of Object.keys(inputs.payloadAudit.inputDigests)) {
		if (Object.hasOwn(inputDigests, path)) continue;
		const bytes = readMilestone5HandoffAuthorityBytes(repositoryRoot, authorityRevision, path);
		inputDigests[path] = describeMilestone5HandoffBytes(bytes);
	}
	authenticateMilestone5HandoffAuditorInputs({ inputs, inputBytes, inputDigests });
	Object.assign(inputDigests, inputs.sourceAcquisitions.inputDigests, inputs.payloadAudit.inputDigests);
	ASSEMBLED_HANDOFF_INPUTS.add(inputs);
	ASSEMBLED_HANDOFF_SOURCE_REVISIONS.set(
		inputs, sourceRevisionBinding.status === 'authenticated-clean-head',
	);
	const assessment = assessMilestone5Handoff(inputs, engineeringScope.products);
	if (sourceRevisionBinding.status === 'authenticated-clean-head') {
		const postflight = authenticateMilestone5HandoffSourceRevision(repositoryRoot, revision);
		assert(postflight.sourceRevision === sourceRevisionBinding.sourceRevision,
			'Milestone 5 package-audit source revision changed during assembly.');
	}
	const handoff = deepFreeze({
		...assessment,
		sourceRevision: sourceRevisionBinding.status === 'authenticated-clean-head' ? revision : null,
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

export function authenticateMilestone5HandoffSourceRevision(repositoryRoot, assertedRevision) {
	assert(SOURCE_REVISION.test(assertedRevision),
		'Milestone 5 asserted package-audit revision must be one Git object ID.');
	const resolved = gitText(repositoryRoot, ['rev-parse', '--verify', `${assertedRevision}^{commit}`]);
	const head = gitText(repositoryRoot, ['rev-parse', '--verify', 'HEAD^{commit}']);
	assert(resolved === head, 'Milestone 5 asserted package-audit revision does not resolve to HEAD.');
	const status = execFileSync(
		'git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
		{ cwd: repositoryRoot, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
	);
	assert(status.byteLength === 0, 'Milestone 5 package audit requires a clean worktree and index.');
	return Object.freeze({ status: 'authenticated-clean-head', sourceRevision: head });
}

function validateAuditedPayloads(inputs, declaredRows, engineeringScope) {
	const audit = inputs.payloadAudit;
	assert(audit.schemaVersion === 3, 'Milestone 5 payload audit has an unsupported schema.');
	for (const [key, , , inputKey] of payloadManifestEntries(inputs, engineeringScope)) {
		assert(JSON.stringify(audit.manifests[key]) === JSON.stringify(inputs[inputKey]),
			`Milestone 5 authenticated ${key} payload manifest disagrees with the audit input.`);
	}
	assert(Array.isArray(audit.rows) && audit.rows.length === declaredRows.length,
		'Milestone 5 payload audit has an incomplete target matrix.');
	for (const declared of declaredRows) {
		const matches = audit.rows.filter((row) => row.identity === declared.identity);
		assert(matches.length === 1 && matches[0].buildStatus === declared.buildStatus,
			`Milestone 5 payload row ${declared.identity} disagrees with its manifest.`);
		assert(JSON.stringify(matches[0].payloadEvidence) === JSON.stringify(declared.payloadEvidence),
			`Milestone 5 payload row ${declared.identity} has inconsistent machine evidence.`);
	}
	return audit.rows.map((row) => ({
		identity: row.identity,
		product: row.product,
		targetId: row.targetId,
		buildStatus: row.buildStatus,
		payloadEvidence: row.payloadEvidence,
	}));
}

function packageAuditSummary(audit) {
	return {
		status: audit.automatedStatus,
		evidenceSha256: audit.automatedEvidenceSha256,
		productId: audit.productId,
		targetId: audit.targetId,
		applicationVersion: audit.applicationVersion,
		sourceRevision: audit.sourceRevision,
		runtimeManifest: descriptor(audit.runtimeManifest),
		desktopCodecPolicy: structuredClone(audit.desktopCodecPolicy),
		packages: audit.packages.map(({ label, name, byteLength, sha256, content }) => ({
			label, name, byteLength, sha256,
			content: content === null ? null : { ...content },
		})),
		packageCount: audit.packageCount,
		totalPackageBytes: audit.totalPackageBytes,
	};
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
			: source.authenticationStatus === 'pinned-metadata'),
		`Milestone 5 native source ${source.id} has invalid audit state.`);
	}
	return register.sources;
}

function payloadManifestEntries(inputs, engineeringScope) {
	return [
		['nativeAddon', inputs.nativeAddonPayload, 'soundscaper', 'nativeAddonPayload'],
		['soundscaperProfessional', inputs.soundscaperProfessionalPayload,
			'soundscaper-professional', 'soundscaperProfessionalPayload'],
		['mediaHost', inputs.mediaHostPayload, 'framescaper-media', 'mediaHostPayload'],
		['openFxHost', inputs.openFxHostPayload, 'framescaper-openfx', 'openFxHostPayload'],
	].filter(([, , product]) => engineeringScope.payloadProducts.includes(product));
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
		return {
			identity: `${product}:${target.id}`,
			product,
			targetId: target.id,
			buildStatus: target.status,
			payloadEvidence: target.status === 'built' ? machinePayloadEvidence(target, product) : null,
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

function descriptor(value) {
	return { name: value.name, byteLength: value.byteLength, sha256: value.sha256 };
}

function currentRevision(repositoryRoot) {
	return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
}

function gitText(repositoryRoot, arguments_) {
	return execFileSync('git', arguments_, {
		cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 1024 * 1024,
	}).trim();
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
