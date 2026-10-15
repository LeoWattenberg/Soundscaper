/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { normalizeFramescaperImageSourceV1, FRAMESCAPER_IMAGE_MODEL_LIMITS_V1 as LIMITS, type FramescaperImageSourceV1 } from '../timeline-image-model.ts';
import { imageDevelopHandoffRecipeSha256V1, normalizeImageDevelopHandoffProvenanceV1, type ImageDevelopHandoffProvenanceV1 } from '../image-develop-handoff-provenance-v1.ts';
import { imageDevelopHandoffRecipeSha256V2, normalizeImageDevelopHandoffProvenanceV2, type ImageDevelopHandoffProvenanceV2 } from '../image-develop-handoff-provenance-v2.ts';
import { normalizeImageDevelopStateThroughV3, type ImageDevelopStateThroughV3 } from '../imaging/image-develop-state-through-v3.ts';
import { normalizeImageDevelopStateThroughV4, type ImageDevelopStateThroughV4 } from '../imaging/image-develop-state-v4.ts';
import { imageDevelopHandoffRecipeSha256CurrentV1, normalizeImageDevelopHandoffProvenanceCurrentV1 } from '../image-develop-handoff-provenance-current-v1.ts';
import { normalizeBrushMaskResourceReferenceV1 } from '../imaging/brush-mask-resource-v1.ts';
import { normalizeImageDevelopStateV1OrV2, type ImageDevelopStateV2 } from '../imaging/image-develop-state-v2.ts';
import type { ImageDevelopStateV1 } from '../imaging/image-develop-contract-v1.ts';

type Profile = 'legacy2' | 'current3' | 'current4';
export interface FramescaperEditableImageSourceForProfileV1<Mode extends Profile> extends Omit<FramescaperImageSourceV1, 'schemaVersion'> {
	readonly schemaVersion: Mode extends 'legacy2' ? 2 : 3;
	readonly develop: Readonly<Mode extends 'legacy2' ? ImageDevelopStateV1 | ImageDevelopStateV2
		: Mode extends 'current3' ? ImageDevelopStateThroughV3 : ImageDevelopStateThroughV4>;
	/** Natural recipe output before timeline contain, always canonical UNORM8/sRGB. */
	readonly developed: Readonly<{ width: number; height: number }>;
	readonly provenance: Readonly<Mode extends 'legacy2' ? ImageDevelopHandoffProvenanceV1 : ImageDevelopHandoffProvenanceV2>;
}
const PACK_FIELDS = ['kind', 'id', 'name', 'mimeType', 'storageKey', 'contentSha256', 'assetByteLength', 'original', 'canonical', 'conversionReceiptSha256'];

/** Explicit static successor; no clip/project/archive V1 owner is widened. */
export function normalizeFramescaperEditableImageSourceForProfileV1<Mode extends Profile>(profile: Mode, value: unknown): Readonly<FramescaperEditableImageSourceForProfileV1<Mode>> {
	if (profile !== 'legacy2' && profile !== 'current3' && profile !== 'current4') throw new RangeError('Unsupported fixed editable image source profile.');
	const version = profile === 'legacy2' ? 2 : 3;
	const input = record(value, 'Framescaper editable image source', ['schemaVersion', ...PACK_FIELDS, 'develop', 'developed', 'provenance']);
	if (field(input, 'schemaVersion', 'Framescaper editable image source') !== version) throw new RangeError('Unsupported editable image source version.');
	const pack: Record<string, unknown> = { schemaVersion: 1 };
	for (const key of PACK_FIELDS) pack[key] = field(input, key, 'Framescaper editable image source');
	const base = normalizeFramescaperImageSourceV1(pack);
	if (base.assetByteLength > LIMITS.maximumAssetBytes) throw new RangeError('Editable image asset exceeds its byte limit.');
	if (base.canonical.frameCount !== 1 || !['png', 'jpeg', 'gif', 'webp', 'bmp'].includes(base.original.recognizedFormat)) {
		throw new RangeError('Editable image handoff requires one admitted static image frame.');
	}
	const rawDevelop = field(input, 'develop', 'Framescaper editable image source');
	const develop = profile === 'legacy2' ? normalizeImageDevelopStateV1OrV2(rawDevelop)
		: profile === 'current3' ? normalizeImageDevelopStateThroughV3(rawDevelop) : normalizeImageDevelopStateThroughV4(rawDevelop);
	if (develop.processVersion === 4 && develop.rawDevelopment.mode !== 'canonical') throw new RangeError('A raster Source3 requires the canonical profile; RAW processing requires Source4.');
	const rawProvenance = field(input, 'provenance', 'Framescaper editable image source');
	const provenance = profile === 'legacy2' ? normalizeImageDevelopHandoffProvenanceV1(rawProvenance)
		: profile === 'current3' ? normalizeImageDevelopHandoffProvenanceV2(rawProvenance) : normalizeImageDevelopHandoffProvenanceCurrentV1(rawProvenance);
	if (profile !== 'legacy2' && provenance.schemaVersion !== 2) throw new RangeError('Source3 requires its exact handoff provenance version.');
	const hash = profile === 'legacy2' ? imageDevelopHandoffRecipeSha256V1(develop)
		: profile === 'current3' ? imageDevelopHandoffRecipeSha256V2(develop) : imageDevelopHandoffRecipeSha256CurrentV1(develop);
	if (provenance.original.sha256 !== base.original.sha256 || provenance.original.byteLength !== base.original.byteLength
		|| provenance.original.exactName.normalize('NFC') !== base.original.fileName
		|| provenance.developSha256 !== hash) throw new Error('Editable image original or recipe binding differs from its provenance.');
	if (provenance.origin.schemaFamily === 'lightscaper' && (provenance.origin.schemaVersion === 1 && develop.processVersion !== 1 || provenance.origin.schemaVersion === 2 && develop.processVersion >= 3)) {
		throw new RangeError('A Photo1 origin cannot bind a successor develop process.');
	}
	if (profile !== 'legacy2') for (const graph of develop.masks) for (const input of graph.inputs) normalizeBrushMaskResourceReferenceV1(input.sourceRef);
	const geometry = record(field(input, 'developed', 'Framescaper editable image source'), 'editable image natural output', ['width', 'height']);
	const width = dimension(field(geometry, 'width', 'editable image natural output')), height = dimension(field(geometry, 'height', 'editable image natural output'));
	if (width * height > LIMITS.maximumPixelsPerFrame) throw new RangeError('Editable image natural output exceeds its pixel limit.');
	return Object.freeze({ ...base, schemaVersion: version, develop, developed: Object.freeze({ width, height }), provenance }) as Readonly<FramescaperEditableImageSourceForProfileV1<Mode>>;
}

function dimension(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > LIMITS.maximumDimension) throw new RangeError('Editable image dimension exceeds its limit.');
	return value;
}
