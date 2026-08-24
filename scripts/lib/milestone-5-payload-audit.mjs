/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
	FRAMESCAPER_MEDIA_HOST_PAYLOAD_MANIFEST,
} from './framescaper-media-host-build.mjs';
import {
	framescaperMediaProductionReadinessStageSummary,
	verifyFramescaperMediaHostPayloadRelease,
} from './framescaper-media-host-readiness.mjs';
import {
	FRAMESCAPER_OPENFX_PAYLOAD_MANIFEST,
	framescaperOpenFxProductionReadinessStageSummary,
	verifyFramescaperOpenFxPayloadRelease,
} from './framescaper-openfx-host-build.mjs';
import {
	NATIVE_ADDON_PAYLOAD_MANIFEST_PATH,
	NATIVE_HELPER_ADDON_TARGETS,
	verifyNativeAddonPayloadManifest,
} from './native-addon-payload-manifest.mjs';
import {
	PROFESSIONAL_NATIVE_MANIFEST_PATH,
	PROFESSIONAL_NATIVE_TARGETS,
	professionalNativePayloadStageSummary,
	verifySoundscaperProfessionalNativePayload,
} from './soundscaper-professional-native-payload.mjs';
import { MILESTONE_5_NATIVE_ISOLATION_REVIEW_POLICY_PATH } from '../../desktop/native-isolation-review-policy.mjs';

const AUDITED = new WeakSet();
export const MILESTONE_5_PAYLOAD_ROW_COUNT = 20;
const READINESS_REQUIRED_PRODUCTS = Object.freeze([
	'soundscaper-professional', 'framescaper-media', 'framescaper-openfx',
]);

/** Authenticate every built native payload against its owning source manifest and bytes. */
export async function auditMilestone5Payloads(repositoryRootValue) {
	const repositoryRoot = resolve(repositoryRootValue);
	const nativeReleases = await Promise.all(NATIVE_HELPER_ADDON_TARGETS.map(({ id }) => (
		verifyNativeAddonPayloadManifest({ repositoryRoot, target: id, targetSource: 'declared' })
	)));
	const nativeManifestBytes = nativeReleases[0].manifestBytes;
	for (const release of nativeReleases.slice(1)) {
		if (!release.manifestBytes.equals(nativeManifestBytes)
			|| !isDeepStrictEqual(release.manifest, nativeReleases[0].manifest)) {
			throw new Error('Milestone 5 native-addon target audits did not read one manifest.');
		}
	}
	const professionalReleases = await Promise.all(PROFESSIONAL_NATIVE_TARGETS.map((target) => (
		verifySoundscaperProfessionalNativePayload({ repositoryRoot, target, targetSource: 'declared' })
	)));
	const professionalManifestBytes = professionalReleases[0].manifestBytes;
	for (const release of professionalReleases.slice(1)) {
		if (!release.manifestBytes.equals(professionalManifestBytes)
			|| !isDeepStrictEqual(release.manifest, professionalReleases[0].manifest)) {
			throw new Error('Milestone 5 professional native target audits did not read one manifest.');
		}
	}
	const media = await verifyFramescaperMediaHostPayloadRelease({ repositoryRoot });
	const openFx = await verifyFramescaperOpenFxPayloadRelease({ repositoryRoot });
	const reviewPolicyBytes = professionalReleases[0].reviewPolicy.bytes;
	for (const release of [...professionalReleases.slice(1), media, openFx]) {
		if (!release.reviewPolicy.bytes.equals(reviewPolicyBytes)) {
			throw new Error('Milestone 5 payload auditors did not use one native-isolation review policy.');
		}
	}
	const mediaManifestBytes = await authenticatedManifestBytes(
		repositoryRoot, FRAMESCAPER_MEDIA_HOST_PAYLOAD_MANIFEST, media.payload,
	);
	const openFxManifestBytes = await authenticatedManifestBytes(
		repositoryRoot, FRAMESCAPER_OPENFX_PAYLOAD_MANIFEST, openFx.payload,
	);
	const rows = [
		...nativeReleases.map((release) => createMilestone5PayloadAuditRow({
			product: 'soundscaper', targetId: release.target.id, status: release.target.status,
			blockedBy: release.target.blockedBy, payload: release.payload, productionReadiness: null,
		})),
		...professionalReleases.map((release) => createMilestone5PayloadAuditRow({
			product: 'soundscaper-professional', targetId: release.target.id,
			status: release.target.status, blockedBy: release.target.blockedBy,
			payload: release.target.payload,
			productionReadiness: professionalNativePayloadStageSummary(release).productionReadiness,
		})),
		...media.payload.targets.map((target) => createMilestone5PayloadAuditRow({
			product: 'framescaper-media', targetId: target.id, status: target.status,
			blockedBy: target.blockedBy, payload: target.payload,
			productionReadiness: framescaperMediaProductionReadinessStageSummary(media, target.id),
		})),
		...openFx.payload.targets.map((target) => createMilestone5PayloadAuditRow({
			product: 'framescaper-openfx', targetId: target.id, status: target.status,
			blockedBy: target.blockedBy, payload: target.payload,
			productionReadiness: framescaperOpenFxProductionReadinessStageSummary(openFx, target.id),
		})),
	];
	const inputDigests = {
		[NATIVE_ADDON_PAYLOAD_MANIFEST_PATH]: descriptor(nativeManifestBytes),
		[PROFESSIONAL_NATIVE_MANIFEST_PATH]: descriptor(professionalManifestBytes),
		[FRAMESCAPER_MEDIA_HOST_PAYLOAD_MANIFEST]: descriptor(mediaManifestBytes),
		[FRAMESCAPER_OPENFX_PAYLOAD_MANIFEST]: descriptor(openFxManifestBytes),
		[MILESTONE_5_NATIVE_ISOLATION_REVIEW_POLICY_PATH]: descriptor(reviewPolicyBytes),
	};
	for (const release of professionalReleases) {
		if (release.productionReadiness !== null) addEvidenceDigest(
			inputDigests,
			release.productionReadiness.reference.evidence.path,
			release.productionReadiness.evidenceBytes,
		);
	}
	for (const readiness of Object.values(media.productionReadiness)) {
		if (readiness !== null) addEvidenceDigest(
			inputDigests,
			readiness.reference.evidence.path,
			readiness.evidenceBytes,
		);
	}
	for (const readiness of Object.values(openFx.productionReadiness)) {
		if (readiness !== null) addEvidenceDigest(
			inputDigests,
			readiness.reference.evidence.path,
			readiness.evidenceBytes,
		);
	}
	const audit = deepFreeze({
		schemaVersion: 2,
		reviewPolicy: {
			path: MILESTONE_5_NATIVE_ISOLATION_REVIEW_POLICY_PATH,
			...descriptor(reviewPolicyBytes),
		},
		manifests: {
			nativeAddon: nativeReleases[0].manifest,
			soundscaperProfessional: professionalReleases[0].manifest,
			mediaHost: media.payload,
			openFxHost: openFx.payload,
		},
		rows,
		inputDigests,
	});
	AUDITED.add(audit);
	return audit;
}

export function isAuditedMilestone5Payloads(value) {
	return value !== null && typeof value === 'object' && AUDITED.has(value);
}

export function milestone5PayloadRequiresProductionReadiness(product) {
	return READINESS_REQUIRED_PRODUCTS.includes(product);
}

async function authenticatedManifestBytes(repositoryRoot, path, expected) {
	const bytes = await readFile(resolve(repositoryRoot, path));
	let parsed;
	try {
		parsed = JSON.parse(bytes.toString('utf8'));
	} catch (error) {
		throw new Error(`Milestone 5 payload manifest ${path} is invalid JSON.`, { cause: error });
	}
	if (!isDeepStrictEqual(parsed, expected)) {
		throw new Error(`Milestone 5 payload manifest ${path} changed during its audit.`);
	}
	return bytes;
}

export function createMilestone5PayloadAuditRow({
	product,
	targetId,
	status,
	blockedBy,
	payload,
	productionReadiness,
}) {
	if (!['built', 'pending-external'].includes(status)) {
		throw new Error(`Milestone 5 payload ${product}:${targetId} has an unsupported status.`);
	}
	if (status === 'built' ? payload === null || blockedBy !== null
		: payload !== null || typeof blockedBy !== 'string' || blockedBy.trim().length < 8) {
		throw new Error(`Milestone 5 payload ${product}:${targetId} has inconsistent evidence.`);
	}
	const readinessRequired = milestone5PayloadRequiresProductionReadiness(product);
	if ((!readinessRequired || status !== 'built') && productionReadiness !== null) {
		throw new Error(`Milestone 5 payload ${product}:${targetId} carries unexpected readiness evidence.`);
	}
	const readinessAuthenticated = productionReadiness !== null
		&& productionReadiness?.verified?.status === 'authenticated';
	const releaseStatus = status === 'built' && (!readinessRequired || readinessAuthenticated)
		? 'built' : 'pending-external';
	const releaseBlocker = status === 'built' && readinessRequired && !readinessAuthenticated
		? `The ${product}:${targetId} payload has no authenticated per-target production-readiness evidence.`
		: blockedBy;
	return {
		identity: `${product}:${targetId}`,
		product,
		targetId,
		buildStatus: status,
		status: releaseStatus,
		blockedBy: releaseBlocker,
		productionReadiness: productionReadiness === null
			? null : structuredClone(productionReadiness),
	};
}

function addEvidenceDigest(inputDigests, path, bytes) {
	const observed = descriptor(bytes);
	if (Object.hasOwn(inputDigests, path)
		&& !isDeepStrictEqual(inputDigests[path], observed)) {
		throw new Error(`Milestone 5 readiness evidence path ${path} has conflicting bytes.`);
	}
	inputDigests[path] = observed;
}

function descriptor(bytes) {
	return {
		byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
	};
}

function deepFreeze(value) {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}
