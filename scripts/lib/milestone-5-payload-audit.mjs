/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
	FRAMESCAPER_MEDIA_HOST_PAYLOAD_MANIFEST,
	verifyFramescaperMediaHostPayloadRelease,
} from './framescaper-media-host-build.mjs';
import {
	FRAMESCAPER_OPENFX_PAYLOAD_MANIFEST,
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
	verifySoundscaperProfessionalNativePayload,
} from './soundscaper-professional-native-payload.mjs';
import { milestone5EngineeringScope } from './milestone-5-product-scope.mjs';

const AUDITED = new WeakSet();
export const MILESTONE_5_PAYLOAD_ROW_COUNT = 20;

/** Authenticate every built native payload against its owning source manifest and bytes. */
export async function auditMilestone5Payloads(repositoryRootValue, productIdsValue) {
	const repositoryRoot = resolve(repositoryRootValue);
	const scope = milestone5EngineeringScope(productIdsValue);
	const includes = (product) => scope.payloadProducts.includes(product);
	const nativeReleases = includes('soundscaper')
		? await Promise.all(NATIVE_HELPER_ADDON_TARGETS.map(({ id }) => (
		verifyNativeAddonPayloadManifest({ repositoryRoot, target: id, targetSource: 'declared' })
		))) : [];
	const nativeManifestBytes = nativeReleases[0]?.manifestBytes ?? null;
	for (const release of nativeReleases.slice(1)) {
		if (!release.manifestBytes.equals(nativeManifestBytes)
			|| !isDeepStrictEqual(release.manifest, nativeReleases[0].manifest)) {
			throw new Error('Milestone 5 native-addon target audits did not read one manifest.');
		}
	}
	const professionalReleases = includes('soundscaper-professional')
		? await Promise.all(PROFESSIONAL_NATIVE_TARGETS.map((target) => (
		verifySoundscaperProfessionalNativePayload({ repositoryRoot, target, targetSource: 'declared' })
		))) : [];
	const professionalManifestBytes = professionalReleases[0]?.manifestBytes ?? null;
	for (const release of professionalReleases.slice(1)) {
		if (!release.manifestBytes.equals(professionalManifestBytes)
			|| !isDeepStrictEqual(release.manifest, professionalReleases[0].manifest)) {
			throw new Error('Milestone 5 professional native target audits did not read one manifest.');
		}
	}
	const media = includes('framescaper-media')
		? await verifyFramescaperMediaHostPayloadRelease({ repositoryRoot }) : null;
	const openFx = includes('framescaper-openfx')
		? await verifyFramescaperOpenFxPayloadRelease({ repositoryRoot }) : null;
	const mediaManifestBytes = media === null ? null : await authenticatedManifestBytes(
		repositoryRoot, FRAMESCAPER_MEDIA_HOST_PAYLOAD_MANIFEST, media.payload,
	);
	const openFxManifestBytes = openFx === null ? null : await authenticatedManifestBytes(
		repositoryRoot, FRAMESCAPER_OPENFX_PAYLOAD_MANIFEST, openFx.payload,
	);
	const rows = [
		...nativeReleases.map((release) => createMilestone5PayloadAuditRow({
			product: 'soundscaper', targetId: release.target.id, status: release.target.status,
			blockedBy: release.target.blockedBy, payload: release.target.payload,
		})),
		...professionalReleases.map((release) => createMilestone5PayloadAuditRow({
			product: 'soundscaper-professional', targetId: release.target.id,
			status: release.target.status, blockedBy: release.target.blockedBy,
			payload: release.target.status === 'built' ? {
				payload: release.target.payload,
				pluginPeer: release.target.pluginPeer,
				isolation: release.target.isolation,
				sourceAuthentication: release.target.sourceAuthentication,
				toolchainIdentity: release.target.toolchainIdentity,
			} : null,
		})),
		...(media === null ? [] : media.payload.targets.map((target) => createMilestone5PayloadAuditRow({
			product: 'framescaper-media', targetId: target.id, status: target.status,
			blockedBy: target.blockedBy, payload: target.status === 'built' ? {
				payload: target.payload,
				isolationPayload: target.isolationPayload,
			} : null,
		}))),
		...(openFx === null ? [] : openFx.payload.targets.map((target) => createMilestone5PayloadAuditRow({
			product: 'framescaper-openfx', targetId: target.id, status: target.status,
			blockedBy: target.blockedBy, payload: target.payload,
		}))),
	];
	const inputDigests = {
		...(nativeManifestBytes === null ? {} : {
			[NATIVE_ADDON_PAYLOAD_MANIFEST_PATH]: descriptor(nativeManifestBytes),
		}),
		...(professionalManifestBytes === null ? {} : {
			[PROFESSIONAL_NATIVE_MANIFEST_PATH]: descriptor(professionalManifestBytes),
		}),
		...(mediaManifestBytes === null ? {} : {
			[FRAMESCAPER_MEDIA_HOST_PAYLOAD_MANIFEST]: descriptor(mediaManifestBytes),
		}),
		...(openFxManifestBytes === null ? {} : {
			[FRAMESCAPER_OPENFX_PAYLOAD_MANIFEST]: descriptor(openFxManifestBytes),
		}),
	};
	const audit = deepFreeze({
		schemaVersion: 3,
		manifests: {
			...(nativeReleases.length === 0 ? {} : { nativeAddon: nativeReleases[0].manifest }),
			...(professionalReleases.length === 0 ? {} : {
				soundscaperProfessional: professionalReleases[0].manifest,
			}),
			...(media === null ? {} : { mediaHost: media.payload }),
			...(openFx === null ? {} : { openFxHost: openFx.payload }),
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
}) {
	if (!['built', 'pending-external'].includes(status)) {
		throw new Error(`Milestone 5 payload ${product}:${targetId} has an unsupported status.`);
	}
	if (status === 'built' ? payload === null || blockedBy !== null
		: payload !== null || typeof blockedBy !== 'string' || blockedBy.trim().length < 8) {
		throw new Error(`Milestone 5 payload ${product}:${targetId} has inconsistent build state.`);
	}
	return {
		identity: `${product}:${targetId}`,
		product,
		targetId,
		buildStatus: status,
		verified: status === 'built',
		payload: payload === null ? null : structuredClone(payload),
		blockedBy,
	};
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
