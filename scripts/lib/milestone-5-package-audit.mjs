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
	auditMilestone5PackageContent,
	isAuditedMilestone5PackageContent,
} from './milestone-5-package-content-audit.mjs';
import { validateMilestone5PackagePayloadBinding } from './milestone-5-package-payload-binding.mjs';
import { assessMilestone5PackageAuditResult } from './milestone-5-package-audit-result.mjs';
import {
	describeMilestone5PackageAuditBytes,
	readMilestone5PackageAuditInputBytes,
	readMilestone5PackageAuditInputSnapshot,
	verifyMilestone5PackageAuditInputs,
} from './milestone-5-package-audit-inputs.mjs';
import { MILESTONE_5_PRODUCTS, milestone5EngineeringScope } from './milestone-5-product-scope.mjs';

export const MILESTONE_5_PACKAGE_AUDIT_INPUT_PATHS = Object.freeze({
	licensingMatrix: 'config/production-licensing-matrix.json',
	sourceAcquisitions: 'config/milestone-5-native-source-acquisitions.json',
	nativeAddonPayload: 'config/native-addon-payload-manifest.json',
	soundscaperProfessionalPayload: 'config/soundscaper-professional-native-payload-manifest.json',
	mediaHostPayload: 'config/framescaper-media-host-payload-manifest.json',
	openFxHostPayload: 'config/framescaper-openfx-host-payload-manifest.json',
});

const TARGET_IDS = Object.freeze(['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']);
const SOURCE_REVISION = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;
const ASSEMBLED_PACKAGE_AUDIT_INPUTS = new WeakSet();
const ASSEMBLED_PACKAGE_AUDITS = new WeakSet();
const ASSEMBLED_PACKAGE_AUDIT_SOURCE_REVISIONS = new WeakMap();

/** Produce an ordinary machine audit. It makes no human or release-readiness claim. */
export function assessMilestone5PackageAudit(inputs, productIdsValue = MILESTONE_5_PRODUCTS) {
	assertRecord(inputs, 'Milestone 5 package-audit inputs');
	const engineeringScope = milestone5EngineeringScope(productIdsValue);
	const repositoryInputsVerified = ASSEMBLED_PACKAGE_AUDIT_INPUTS.has(inputs);
	const sourceInputsAudited = isAuditedMilestone5NativeSourceAcquisitions(inputs.sourceAcquisitions);
	const sources = validateSourceAcquisitions(
		inputs.sourceAcquisitions, sourceInputsAudited, engineeringScope,
	);
	const payloadsVerified = isAuditedMilestone5Payloads(inputs.payloadAudit);
	const packageContentAudited = isAuditedMilestone5PackageContent(inputs.packageAudit);
	const declaredPayloadRows = payloadManifestEntries(inputs, engineeringScope).flatMap(
		([, manifest, product]) => validatePayloadManifest(manifest, product),
	);
	const payloadRows = payloadsVerified
		? validateAuditedPayloads(inputs, declaredPayloadRows, engineeringScope)
		: declaredPayloadRows;
	if (packageContentAudited && payloadsVerified) {
		validateMilestone5PackagePayloadBinding(
			inputs.packageAudit, inputs.payloadAudit, MILESTONE_5_PACKAGE_AUDIT_INPUT_PATHS, engineeringScope,
		);
	}
	const result = assessMilestone5PackageAuditResult({
		repositoryInputsVerified,
		sourceInputsAudited,
		payloadsAuthenticated: payloadsVerified,
		packageAudited: packageContentAudited,
		sourceRevisionVerified: ASSEMBLED_PACKAGE_AUDIT_SOURCE_REVISIONS.get(inputs) === true,
		sources,
		payloadRows,
		packageAudit: packageContentAudited ? inputs.packageAudit : null,
	});
	const built = payloadRows.filter(({ buildStatus }) => buildStatus === 'built').length;
	return deepFreeze({
		schemaVersion: 3,
		kind: 'milestone-5-package-audit',
		engineeringScope,
		assessmentScope: packageContentAudited ? {
			kind: 'package',
			productId: inputs.packageAudit.productId,
			targetId: inputs.packageAudit.targetId,
		} : { kind: 'engineering-inputs' },
		repositoryInputsVerified,
		sourceInputsVerified: sourceInputsAudited,
		...result,
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
		package: packageContentAudited ? packageAuditSummary(inputs.packageAudit) : null,
		licensing: auditMilestone5LicensingMatrix(inputs.licensingMatrix),
	});
}

export async function assembleMilestone5PackageAudit(
	repositoryRoot,
	sourceRevision,
	packageOptions = null,
	dependencies = {},
) {
	return assembleMilestone5PackageAuditScope({
		repositoryRoot,
		sourceRevision,
		packageOptions,
		productIds: MILESTONE_5_PRODUCTS,
	}, dependencies);
}

export async function assembleMilestone5ProductPackageAudit(options, dependencies = {}) {
	assertRecord(options, 'Milestone 5 product package-audit options');
	const keys = Object.keys(options).sort();
	assert(keys.every((key) => [
		'packageOptions', 'productIds', 'repositoryRoot', 'sourceRevision',
	].includes(key)) && keys.includes('productIds') && keys.includes('repositoryRoot'),
	'Milestone 5 product package-audit options have an unexpected shape.');
	return assembleMilestone5PackageAuditScope({
		repositoryRoot: options.repositoryRoot,
		sourceRevision: options.sourceRevision,
		packageOptions: options.packageOptions ?? null,
		productIds: options.productIds,
	}, dependencies);
}

async function assembleMilestone5PackageAuditScope(options, dependencies) {
	const { repositoryRoot, sourceRevision, packageOptions } = options;
	const engineeringScope = milestone5EngineeringScope(options.productIds);
	const observedHeadRevision = currentRevision(repositoryRoot);
	const sourceRevisionBinding = sourceRevision === undefined
		? deepFreeze({ status: 'unverified-working-tree', sourceRevision: null, observedHeadRevision })
		: verifyMilestone5PackageAuditSourceRevision(repositoryRoot, sourceRevision);
	const revision = sourceRevisionBinding.sourceRevision ?? observedHeadRevision;
	const inputRevision = sourceRevisionBinding.status === 'verified-clean-head' ? revision : null;
	const inputPaths = milestone5PackageAuditInputPaths(engineeringScope);
	const snapshot = readMilestone5PackageAuditInputSnapshot(repositoryRoot, inputPaths, inputRevision);
	const { inputs, bytes: inputBytes, inputDigests } = snapshot;
	inputs.sourceAcquisitionRegister = inputs.sourceAcquisitions;
	for (const { manifestPath } of engineeringScope.includeDelegatedSources
		? inputs.sourceAcquisitionRegister.delegatedSources : []) {
		const bytes = readMilestone5PackageAuditInputBytes(
			repositoryRoot, inputRevision, manifestPath,
		);
		inputDigests[manifestPath] = describeMilestone5PackageAuditBytes(bytes);
	}
	inputs.sourceAcquisitions = engineeringScope.kind === 'retained-dual-product'
		? auditMilestone5NativeSourceAcquisitions(repositoryRoot)
		: auditMilestone5NativeSourceAcquisitionsForProducts(
			repositoryRoot, engineeringScope.products,
		);
	inputs.payloadAudit = await auditMilestone5Payloads(repositoryRoot, engineeringScope.products);
	if (packageOptions !== null) {
		validatePackageOptions(packageOptions);
		inputs.packageAudit = await auditMilestone5PackageContent({
			repositoryRoot: resolve(repositoryRoot),
			packageRoot: resolve(repositoryRoot, packageOptions.packageRoot),
			productId: packageOptions.productId,
			targetId: packageOptions.targetId,
		}, { auditPackageArtifactContent: dependencies.auditPackageArtifactContent });
		if (sourceRevisionBinding.status === 'verified-clean-head') {
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
		const bytes = readMilestone5PackageAuditInputBytes(repositoryRoot, inputRevision, path);
		inputDigests[path] = describeMilestone5PackageAuditBytes(bytes);
	}
	verifyMilestone5PackageAuditInputs({ inputs, inputBytes, inputDigests });
	Object.assign(inputDigests, inputs.sourceAcquisitions.inputDigests, inputs.payloadAudit.inputDigests);
	ASSEMBLED_PACKAGE_AUDIT_INPUTS.add(inputs);
	ASSEMBLED_PACKAGE_AUDIT_SOURCE_REVISIONS.set(
		inputs, sourceRevisionBinding.status === 'verified-clean-head',
	);
	const assessment = assessMilestone5PackageAudit(inputs, engineeringScope.products);
	if (sourceRevisionBinding.status === 'verified-clean-head') {
		const postflight = verifyMilestone5PackageAuditSourceRevision(repositoryRoot, revision);
		assert(postflight.sourceRevision === sourceRevisionBinding.sourceRevision,
			'Milestone 5 package-audit source revision changed during assembly.');
	}
	const audit = deepFreeze({
		...assessment,
		sourceRevision: sourceRevisionBinding.status === 'verified-clean-head' ? revision : null,
		observedHeadRevision,
		sourceRevisionBinding,
		inputDigests,
	});
	ASSEMBLED_PACKAGE_AUDITS.add(audit);
	return audit;
}

export function isAssembledMilestone5PackageAudit(value) {
	return value !== null && typeof value === 'object' && ASSEMBLED_PACKAGE_AUDITS.has(value);
}

export function verifyMilestone5PackageAuditSourceRevision(repositoryRoot, assertedRevision) {
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
	return Object.freeze({ status: 'verified-clean-head', sourceRevision: head });
}

function validateAuditedPayloads(inputs, declaredRows, engineeringScope) {
	const audit = inputs.payloadAudit;
	assert(audit.schemaVersion === 3, 'Milestone 5 payload audit has an unsupported schema.');
	for (const [key, , , inputKey] of payloadManifestEntries(inputs, engineeringScope)) {
		assert(JSON.stringify(audit.manifests[key]) === JSON.stringify(inputs[inputKey]),
			`Milestone 5 authenticated ${key} payload manifest disagrees with the audit input.`);
	}
	assert(Array.isArray(audit.rows) && audit.rows.length === declaredRows.length,
		'Milestone 5 payload audit has an incomplete target inventory.');
	for (const declared of declaredRows) {
		const matches = audit.rows.filter((row) => row.identity === declared.identity);
		assert(matches.length === 1 && matches[0].buildStatus === declared.buildStatus,
			`Milestone 5 payload row ${declared.identity} disagrees with its manifest.`);
		assert(JSON.stringify(matches[0].payload) === JSON.stringify(declared.payload),
			`Milestone 5 payload row ${declared.identity} has inconsistent file checks.`);
	}
	return audit.rows.map((row) => ({
		identity: row.identity,
		product: row.product,
		targetId: row.targetId,
		buildStatus: row.buildStatus,
		payload: row.payload,
	}));
}

function packageAuditSummary(audit) {
	return {
		status: audit.status,
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

function milestone5PackageAuditInputPaths(engineeringScope) {
	return Object.fromEntries(Object.entries(MILESTONE_5_PACKAGE_AUDIT_INPUT_PATHS).filter(([key]) => (
		!['nativeAddonPayload', 'soundscaperProfessionalPayload', 'mediaHostPayload', 'openFxHostPayload']
			.includes(key) || engineeringScope.payloadInputKeys.includes(key)
	)));
}

function validatePayloadManifest(manifest, product) {
	assertRecord(manifest, `Milestone 5 ${product} payload manifest`);
	assert(manifest.schemaVersion === 1 && Array.isArray(manifest.targets),
		`Milestone 5 ${product} payload manifest is invalid.`);
	assert(JSON.stringify(manifest.targets.map(({ id }) => id)) === JSON.stringify(TARGET_IDS),
		`Milestone 5 ${product} payload targets must be the exact five-target inventory.`);
	return manifest.targets.map((target) => {
		assert(['built', 'pending-external'].includes(target.status),
			`Milestone 5 ${product} payload ${target.id} has an invalid status.`);
		return {
			identity: `${product}:${target.id}`,
			product,
			targetId: target.id,
			buildStatus: target.status,
			payload: target.status === 'built' ? machinePayload(target, product) : null,
		};
	});
}

function machinePayload(target, product) {
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
