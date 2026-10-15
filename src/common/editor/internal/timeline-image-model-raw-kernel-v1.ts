/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { normalizeFramescaperImageSourceV1, FRAMESCAPER_IMAGE_MODEL_LIMITS_V1 as LIMITS, type FramescaperImageSourceV1 } from '../timeline-image-model.ts';
import { normalizeFramescaperRawOriginalReceiptV1, type FramescaperRawOriginalReceiptV1 } from '../timeline-image-raw-receipt-v1.ts';
import { normalizeImageDevelopStateThroughV3, type ImageDevelopStateThroughV3 } from '../imaging/image-develop-state-through-v3.ts';
import { normalizeImageDevelopStateThroughV4, type ImageDevelopStateThroughV4 } from '../imaging/image-develop-state-v4.ts';
import { normalizeBrushMaskResourceReferenceV1 } from '../imaging/brush-mask-resource-v1.ts';
import { normalizeImageDevelopHandoffProvenanceV2, imageDevelopHandoffRecipeSha256V2,
	type ImageDevelopHandoffProvenanceV2 } from '../image-develop-handoff-provenance-v2.ts';
import { normalizeImageDevelopHandoffProvenanceCurrentV1, imageDevelopHandoffRecipeSha256CurrentV1 } from '../image-develop-handoff-provenance-current-v1.ts';

type Profile = 'current3' | 'current4';
export interface FramescaperRawImageSourceForProfileV1<Mode extends Profile> extends Omit<FramescaperImageSourceV1, 'schemaVersion'> {
	readonly schemaVersion: 4;
	readonly develop: Readonly<Mode extends 'current3' ? ImageDevelopStateThroughV3 : ImageDevelopStateThroughV4>;
	readonly developed: Readonly<{ width: number; height: number }>;
	readonly provenance: Readonly<ImageDevelopHandoffProvenanceV2>;
	/** Native Original authority; canonical FramePack1 pixels are display cache. */
	readonly raw: Readonly<FramescaperRawOriginalReceiptV1>;
}
const PACK_FIELDS = ['kind', 'id', 'name', 'mimeType', 'storageKey', 'contentSha256', 'assetByteLength', 'original', 'canonical', 'conversionReceiptSha256'];

/** Fixed policies share complete admission without projecting saved metadata.
 * The ABI1 receipt and pack always describe the unchanged canonical Original. */
export function normalizeFramescaperRawImageSourceForProfileV1<Mode extends Profile>(profile: Mode, value: unknown): Readonly<FramescaperRawImageSourceForProfileV1<Mode>> {
	if (profile !== 'current3' && profile !== 'current4') throw new RangeError('Unsupported fixed RAW image source profile.');
	const input = record(value, 'Frame RAW image source', ['schemaVersion', ...PACK_FIELDS, 'develop', 'developed', 'provenance', 'raw']);
	if (field(input, 'schemaVersion', 'Frame RAW image source') !== 4) throw new RangeError('Unsupported Frame RAW image source version.');
	const pack: Record<string, unknown> = { schemaVersion: 1 };
	for (const key of PACK_FIELDS) pack[key] = field(input, key, 'Frame RAW image source');
	const base = normalizeFramescaperImageSourceV1(pack), raw = normalizeFramescaperRawOriginalReceiptV1(field(input, 'raw', 'Frame RAW image source'));
	const rawMime = base.original.recognizedFormat === 'dng' ? 'image/x-adobe-dng' : base.original.recognizedFormat === 'crw' ? 'image/x-canon-crw' : null;
	if (rawMime === null || base.original.mimeType !== rawMime || base.original.byteLength > LIMITS.maximumOriginalBytes
		|| base.assetByteLength > LIMITS.maximumAssetBytes || base.canonical.frameCount !== 1 || base.canonical.hasAlpha
		|| base.canonical.width !== raw.descriptor.width || base.canonical.height !== raw.descriptor.height) {
		throw new RangeError('Frame RAW source requires one bounded opaque native Original and its exact presentation extent.');
	}
	const develop = profile === 'current3' ? normalizeImageDevelopStateThroughV3(field(input, 'develop', 'Frame RAW image source'))
		: normalizeImageDevelopStateThroughV4(field(input, 'develop', 'Frame RAW image source'));
	const rawProvenance = field(input, 'provenance', 'Frame RAW image source');
	const provenance = profile === 'current3' ? normalizeImageDevelopHandoffProvenanceV2(rawProvenance) : normalizeImageDevelopHandoffProvenanceCurrentV1(rawProvenance);
	if (provenance.schemaVersion !== 2) throw new RangeError('Frame RAW source requires its exact handoff provenance version.');
	const hash = profile === 'current3' ? imageDevelopHandoffRecipeSha256V2(develop) : imageDevelopHandoffRecipeSha256CurrentV1(develop);
	if (provenance.original.sha256 !== base.original.sha256 || provenance.original.byteLength !== base.original.byteLength
		|| provenance.original.exactName.normalize('NFC') !== base.original.fileName || provenance.developSha256 !== hash) {
		throw new Error('Frame RAW Original or unchanged recipe differs from its handoff provenance.');
	}
	if (provenance.origin.schemaFamily === 'lightscaper' && (provenance.origin.schemaVersion === 1 && develop.processVersion !== 1
		|| provenance.origin.schemaVersion === 2 && develop.processVersion >= 3)) throw new RangeError('Frame RAW recipe requires its truthful Photo schema provenance.');
	for (const graph of develop.masks) for (const input of graph.inputs) normalizeBrushMaskResourceReferenceV1(input.sourceRef);
	const output = record(field(input, 'developed', 'Frame RAW image source'), 'Frame RAW natural output', ['width', 'height']);
	const width = dimension(field(output, 'width', 'Frame RAW natural output')), height = dimension(field(output, 'height', 'Frame RAW natural output'));
	if (width * height > LIMITS.maximumPixelsPerFrame) throw new RangeError('Frame RAW natural output exceeds its pixel bound.');
	return Object.freeze({ ...base, schemaVersion: 4, develop, developed: Object.freeze({ width, height }), provenance, raw }) as Readonly<FramescaperRawImageSourceForProfileV1<Mode>>;
}
function dimension(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > LIMITS.maximumDimension) throw new RangeError('Frame RAW natural dimension exceeds its bound.');
	return value;
}
