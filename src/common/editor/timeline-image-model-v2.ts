/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import { normalizeFramescaperImageSourceV1, FRAMESCAPER_IMAGE_MODEL_LIMITS_V1 as LIMITS, type FramescaperImageSourceV1 } from './timeline-image-model.ts';
import { imageDevelopHandoffRecipeSha256V1, normalizeImageDevelopHandoffProvenanceV1, type ImageDevelopHandoffProvenanceV1 } from './image-develop-handoff-provenance-v1.ts';
import { normalizeImageDevelopStateV1OrV2, type ImageDevelopStateV2 } from './imaging/image-develop-state-v2.ts';
import type { ImageDevelopStateV1 } from './imaging/image-develop-contract-v1.ts';
import { CUBE_LUT_PROFILE_EFFECT_TYPE_V1, prepareCubeLutProfileResourcePlanV1 } from './video-cube-lut-profile-v1.ts';
import type { VideoCubeLutReferenceV1 } from './cube-lut-reference-contract.ts';

export interface FramescaperImageSourceV2 extends Omit<FramescaperImageSourceV1, 'schemaVersion'> {
	readonly schemaVersion: 2;
	readonly develop: Readonly<ImageDevelopStateV1 | ImageDevelopStateV2>;
	/** Natural recipe output before timeline contain, always canonical UNORM8/sRGB. */
	readonly developed: Readonly<{ width: number; height: number }>;
	readonly provenance: Readonly<ImageDevelopHandoffProvenanceV1>;
}
const PACK_FIELDS = ['kind', 'id', 'name', 'mimeType', 'storageKey', 'contentSha256', 'assetByteLength', 'original', 'canonical', 'conversionReceiptSha256'];

/** Explicit static successor; no clip/project/archive V1 owner is widened. */
export function normalizeFramescaperImageSourceV2(value: unknown): Readonly<FramescaperImageSourceV2> {
	const input = record(value, 'Framescaper editable image source', ['schemaVersion', ...PACK_FIELDS, 'develop', 'developed', 'provenance']);
	if (field(input, 'schemaVersion', 'Framescaper editable image source') !== 2) throw new RangeError('Unsupported editable image source version.');
	const pack: Record<string, unknown> = { schemaVersion: 1 };
	for (const key of PACK_FIELDS) pack[key] = field(input, key, 'Framescaper editable image source');
	const base = normalizeFramescaperImageSourceV1(pack);
	if (base.assetByteLength > LIMITS.maximumAssetBytes) throw new RangeError('Editable image asset exceeds its byte limit.');
	if (base.canonical.frameCount !== 1 || !['png', 'jpeg', 'gif', 'webp', 'bmp'].includes(base.original.recognizedFormat)) {
		throw new RangeError('Editable image handoff requires one admitted static image frame.');
	}
	const develop = normalizeImageDevelopStateV1OrV2(field(input, 'develop', 'Framescaper editable image source'));
	const provenance = normalizeImageDevelopHandoffProvenanceV1(field(input, 'provenance', 'Framescaper editable image source'));
	if (provenance.original.sha256 !== base.original.sha256 || provenance.original.byteLength !== base.original.byteLength
		|| provenance.original.exactName.normalize('NFC') !== base.original.fileName
		|| provenance.developSha256 !== imageDevelopHandoffRecipeSha256V1(develop)) throw new Error('Editable image original or recipe binding differs from its provenance.');
	if (provenance.origin.schemaFamily === 'lightscaper' && provenance.origin.schemaVersion === 1 && develop.processVersion !== 1) {
		throw new RangeError('A Photo1 origin cannot bind a successor develop process.');
	}
	const geometry = record(field(input, 'developed', 'Framescaper editable image source'), 'editable image natural output', ['width', 'height']);
	const width = dimension(field(geometry, 'width', 'editable image natural output')), height = dimension(field(geometry, 'height', 'editable image natural output'));
	if (width * height > LIMITS.maximumPixelsPerFrame) throw new RangeError('Editable image natural output exceeds its pixel limit.');
	return Object.freeze({ ...base, schemaVersion: 2, develop, developed: Object.freeze({ width, height }), provenance });
}

/** Current consumers opt in to this dispatcher; the legacy V1 delegate is unchanged. */
export function normalizeFramescaperImageSourceV1OrV2(value: unknown): Readonly<FramescaperImageSourceV1 | FramescaperImageSourceV2> {
	if (!value || typeof value !== 'object') throw new TypeError('Framescaper image source requires an object.');
	const version = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
	if (!version || !Object.hasOwn(version, 'value')) throw new TypeError('Framescaper image source requires an own data version.');
	if (version.value === 1) return normalizeFramescaperImageSourceV1(value);
	if (version.value === 2) return normalizeFramescaperImageSourceV2(value);
	throw new RangeError('Unsupported Framescaper image source version.');
}

/** Disabled nonnull references remain required by persistence/transfer custody. */
export function framescaperImageSourceResourceReferencesV2(value: unknown): readonly Readonly<VideoCubeLutReferenceV1>[] {
	const source = normalizeFramescaperImageSourceV2(value), resources = new Map<string, Readonly<VideoCubeLutReferenceV1>>();
	for (const effect of source.develop.effects) {
		if (effect.type !== CUBE_LUT_PROFILE_EFFECT_TYPE_V1) continue;
		const reference = prepareCubeLutProfileResourcePlanV1(effect).reference;
		if (reference === null) continue;
		const previous = resources.get(reference.storageKey);
		if (previous && JSON.stringify(previous) !== JSON.stringify(reference)) throw new Error('Editable image resource references conflict.');
		resources.set(reference.storageKey, reference);
	}
	return Object.freeze([...resources.values()]);
}

function dimension(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > LIMITS.maximumDimension) throw new RangeError('Editable image dimension exceeds its limit.');
	return value;
}
