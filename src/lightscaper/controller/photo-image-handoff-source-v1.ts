/* SPDX-License-Identifier: AGPL-3.0-only */

import { openFramescaperImageFramePackV1, type FramescaperImageFramePackPublicationV1 } from '../../common/editor/timeline-image-frame-pack-v1.ts';
import { normalizeFramescaperImageSourceV2, framescaperImageSourceResourceReferencesV2, type FramescaperImageSourceV2 } from '../../common/editor/timeline-image-model-v2.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../../common/editor/timeline-image-model.ts';
import { createImageDevelopHandoffProvenanceV1 } from '../../common/editor/image-develop-handoff-provenance-v1.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { planImageGeometryV1 } from '../../common/editor/imaging/image-geometry-plan-v1.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, imageGeometryForVideoEffectV1 } from '../../common/editor/video-image-geometry-v1.ts';
import { parsePhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../catalog/photo-export-sidecar-v1.ts';
import { assertPhotoDevelopHandoffMasksV1 } from './photo-develop-handoff-masks-v1.ts';

export interface PhotoImageHandoffSourceRequestV1 {
	readonly sourceId: string;
	readonly factsJson: string;
	readonly original: Readonly<{ mimeType: string; width: number; height: number; hasAlpha: boolean }>;
	readonly pack: Readonly<FramescaperImageFramePackPublicationV1>;
	readonly signal?: AbortSignal;
}
export interface PhotoImageHandoffSourceV1 {
	readonly source: Readonly<FramescaperImageSourceV2>;
	readonly body: Blob;
}
const CHECK = AbortSignal.prototype.throwIfAborted;

/** The internal pack producer owns decoding; this owner binds its authenticated
 * pack to the complete selected saved facts before an archive can consume it. */
export async function createPhotoImageHandoffSourceV1(value: PhotoImageHandoffSourceRequestV1): Promise<Readonly<PhotoImageHandoffSourceV1>> {
	const label = 'Photo image handoff source';
	const input = record(value, label, ['sourceId', 'factsJson', 'original', 'pack', 'signal'], ['sourceId', 'factsJson', 'original', 'pack']);
	const caller = Object.hasOwn(input, 'signal') ? field(input, 'signal', label) : undefined;
	if (caller !== undefined && (!(caller instanceof AbortSignal) || Object.getPrototypeOf(caller) !== AbortSignal.prototype
		|| ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(caller, key)))) {
		throw new TypeError('Photo image handoff requires unmodified native cancellation behavior.');
	}
	// Keep cancellation at our intrinsic range/current checks. The legacy reader
	// must never inspect mutable caller-owned signal properties after a yield.
	const check = () => { if (caller) Reflect.apply(CHECK, caller, []); };
	check();
	const text = field(input, 'factsJson', label);
	if (typeof text !== 'string') throw new TypeError('Photo image handoff requires canonical saved facts JSON.');
	const facts = parsePhotoExportSidecarV1(text);
	if (serializePhotoExportSidecarV1(facts) !== text) throw new TypeError('Photo image handoff saved facts must be canonical.');
	if (facts.binding.activeVersionId !== facts.version.id) throw new Error('Photo image handoff active saved version changed.');
	const original = record(field(input, 'original', label), 'Photo image original geometry', ['mimeType', 'width', 'height', 'hasAlpha']);
	const pack = record(field(input, 'pack', label), 'Photo image decoded pack', ['bytes', 'contentSha256', 'assetByteLength', 'originalSha256', 'originalByteLength',
		'conversionReceiptSha256', 'width', 'height', 'hasAlpha', 'frameCount', 'durationTicks', 'timingMode']);
	const read = (key: string) => field(pack, key, 'Photo image decoded pack');
	if (read('originalSha256') !== facts.original.contentSha256 || read('originalByteLength') !== facts.original.byteLength) {
		throw new Error('Photo image decoded original digest or byte binding differs from its selected saved facts.');
	}
	if (read('width') !== field(original, 'width', 'Photo image original geometry') || read('height') !== field(original, 'height', 'Photo image original geometry')
		|| read('hasAlpha') !== field(original, 'hasAlpha', 'Photo image original geometry')) throw new Error('Photo image decoded original geometry or alpha binding changed.');
	const sourceId = field(input, 'sourceId', label), develop = facts.version.develop;
	const provenance = createImageDevelopHandoffProvenanceV1({ develop,
		original: { exactName: facts.original.fileName, sha256: facts.original.contentSha256, byteLength: facts.original.byteLength },
		origin: { schemaFamily: 'lightscaper', schemaVersion: facts.photoSchemaVersion, catalogId: facts.binding.catalogId, photoId: facts.binding.photoId,
			revision: facts.binding.revision, versionId: facts.version.id, versionKind: facts.version.kind, versionName: facts.version.name, versionCreatedAt: facts.version.createdAt } });
	const mimeType = field(original, 'mimeType', 'Photo image original geometry');
	const source = normalizeFramescaperImageSourceV2({ schemaVersion: 2, kind: 'image', id: sourceId, storageKey: sourceId,
		name: facts.version.name, mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, contentSha256: read('contentSha256'), assetByteLength: read('assetByteLength'),
		conversionReceiptSha256: read('conversionReceiptSha256'),
		original: { fileName: facts.original.fileName.normalize('NFC'), mimeType, recognizedFormat: format(mimeType), byteLength: facts.original.byteLength, sha256: facts.original.contentSha256 },
		canonical: { width: read('width'), height: read('height'), hasAlpha: read('hasAlpha'), frameCount: read('frameCount'), durationTicks: read('durationTicks'), timingMode: read('timingMode') },
		develop, developed: natural(develop, read('width'), read('height')), provenance });
	assertPhotoDevelopHandoffMasksV1(develop, source.canonical.width, source.canonical.height);
	framescaperImageSourceResourceReferencesV2(source); // Conflicting disabled resources must also refuse.
	const bytes = read('bytes');
	if (!(bytes instanceof Uint8Array) || Object.getPrototypeOf(bytes) !== Uint8Array.prototype) throw new TypeError('Photo image pack requires native bytes.');
	if (bytes.byteLength !== source.assetByteLength) throw new RangeError('Photo image pack byte length differs from its admitted binding.');
	if (BigInt(source.assetByteLength) * 3n + BigInt(source.canonical.width) * BigInt(source.canonical.height) * 8n > 512n * 1024n * 1024n) {
		throw new RangeError('Photo image handoff pack exceeds its working byte bound.');
	}
	// Blob construction snapshots writable producer bytes before the first yield.
	const body = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE });
	const snapshot = new Uint8Array(await Blob.prototype.arrayBuffer.call(body));
	try {
		check();
		const { develop: _develop, developed: _developed, provenance: _provenance, ...base } = source;
		const reader = await openFramescaperImageFramePackV1({ source: { ...base, schemaVersion: 1 },
			read: (offset, length) => { check(); return snapshot.slice(offset, offset + length); } });
		// Our snapshot is immutable. Receive and wipe the decoded plane before
		// the final cancellation fence can reject after its last range read.
		const pixels = await reader.readFrame(0);
		pixels.fill(0); check();
		return Object.freeze({ source, body });
	} finally { snapshot.fill(0); }
}

function format(value: unknown): string {
	if (typeof value !== 'string' || !['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'].includes(value)) {
		throw new RangeError('Photo image handoff original MIME has no admitted static route.');
	}
	return value.slice(6);
}
function natural(develop: FramescaperImageSourceV2['develop'], width: unknown, height: unknown) {
	if (typeof width !== 'number' || typeof height !== 'number') throw new TypeError('Photo image handoff requires natural original dimensions.');
	let plan = planImageGeometryV1({ schemaVersion: 1, ...develop.geometry, perspective: null }, width, height);
	for (const effect of develop.effects) if (effect.enabled && effect.type === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1) {
		plan = planImageGeometryV1(imageGeometryForVideoEffectV1(effect, plan.width, plan.height), plan.width, plan.height);
	}
	return Object.freeze({ width: plan.width, height: plan.height });
}
