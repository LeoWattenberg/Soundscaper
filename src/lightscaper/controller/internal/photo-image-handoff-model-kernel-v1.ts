/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../../common/editor/closed-domain-value.ts';
import { createImageDevelopHandoffProvenanceV1 } from '../../../common/editor/image-develop-handoff-provenance-v1.ts';
import { createImageDevelopHandoffProvenanceV2 } from '../../../common/editor/image-develop-handoff-provenance-v2.ts';
import { prepareImageDevelopBrushMasksV1 } from '../../../common/editor/imaging/image-develop-brush-mask-v1.ts';
import { planImageDevelopMasksV1 } from '../../../common/editor/imaging/image-develop-mask-plan-v1.ts';
import { planImageDevelopRepairSpotsV1 } from '../../../common/editor/imaging/image-develop-repair-plan-v1.ts';
import { normalizeImageDevelopStateCurrentV1, type ImageDevelopStateCurrentV1 } from '../../../common/editor/imaging/image-develop-state-current-v1.ts';
import { normalizeImageDevelopStateV2 } from '../../../common/editor/imaging/image-develop-state-v2.ts';
import { planImageGeometryV1 } from '../../../common/editor/imaging/image-geometry-plan-v1.ts';
import { createVideoTrack } from '../../../common/editor/project-media-factory.ts';
import { openFramescaperImageFramePackV1, type FramescaperImageFramePackPublicationV1 } from '../../../common/editor/timeline-image-frame-pack-v1.ts';
import { normalizeFramescaperImageSourceCurrentV1, type FramescaperImageSourceCurrentV1 } from '../../../common/editor/timeline-image-model-current-v1.ts';
import { framescaperImageSourceResourceReferencesV2, normalizeFramescaperImageSourceV2 } from '../../../common/editor/timeline-image-model-v2.ts';
import { framescaperImageSourceResourceReferencesCurrentV1 } from '../../../common/editor/timeline-image-model-current-v1.ts';
import { normalizeFramescaperRawOriginalReceiptV1, type FramescaperRawOriginalReceiptV1 } from '../../../common/editor/timeline-image-raw-receipt-v1.ts';
import { framescaperImagePackSourceCurrentV1 } from '../../../common/editor/timeline-image-pack-source-current-v1.ts';
import { encodeFramescaperImageConversionReceiptV1 } from '../../../common/editor/timeline-image-conversion-receipt-v1.ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, FRAMESCAPER_IMAGE_MODEL_LIMITS_V1, FRAMESCAPER_IMAGE_TICKS_PER_SECOND } from '../../../common/editor/timeline-image-model.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, imageGeometryForVideoEffectV1 } from '../../../common/editor/video-image-geometry-v1.ts';
import { applyFramescaperProjectCommand } from '../../../framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../../framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject, type FramescaperProject } from '../../../framescaper/editor-project.ts';
import { normalizePhotoCatalogRootV1 } from '../../catalog/catalog-root.ts';
import { defaultPhotoDevelopV1 } from '../../catalog/develop-state.ts';
import { normalizePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../../catalog/photo-document-current-v1.ts';
import { normalizePhotoDocumentV1OrV2 } from '../../catalog/photo-document-v2.ts';
import { validatePhotoCatalogReferencesV1 } from '../../catalog/photo-document.ts';
import { parsePhotoExportSidecarCurrentV1, serializePhotoExportSidecarCurrentV1 } from '../../catalog/photo-export-sidecar-current-v1.ts';
import { parsePhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../../catalog/photo-export-sidecar-v1.ts';
import { assertImageDevelopMaskRasterPortableV1 } from '../../catalog/photo-mask-raster-portability-v1.ts';
import { field as photoField, id, record as photoRecord, unique, utcTimestamp } from '../../catalog/value-validation.ts';

export type HandoffProfile = 'legacy2' | 'current3';
export type EditableSource = Exclude<FramescaperImageSourceCurrentV1, { readonly schemaVersion: 1 }>;
export function assertHandoffProfile(profile: unknown): asserts profile is HandoffProfile { if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unsupported fixed Photo image handoff profile.'); }
export function normalizeEditableSourceForProfileV1(profile: HandoffProfile, value: unknown): Readonly<EditableSource> {
	assertHandoffProfile(profile); const source = profile === 'legacy2' ? normalizeFramescaperImageSourceV2(value) : normalizeFramescaperImageSourceCurrentV1(value);
	if (source.schemaVersion === 1) throw new TypeError('Editable handoff requires a real Source2, Source3 or Source4.'); return source;
}
export function handoffResourceReferencesForProfileV1(profile: HandoffProfile, source: Readonly<EditableSource>) {
	assertHandoffProfile(profile);
	if (source.schemaVersion === 3 || source.schemaVersion === 4) { if (profile !== 'current3') throw new RangeError('Legacy handoff refuses Current image sources.'); return framescaperImageSourceResourceReferencesCurrentV1(source); }
	return Object.freeze({ luts: framescaperImageSourceResourceReferencesV2(source), brushes: Object.freeze([]) });
}
const PIXEL_LIMITS = Object.freeze({ maximumSidePixels: FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumDimension,
	maximumPixels: FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumPixelsPerFrame, maximumBytes: FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumPixelsPerFrame * 4 });
export function assertPhotoDevelopHandoffMasksForProfileV1(profile: HandoffProfile, value: unknown, width: number, height: number): void {
	assertHandoffProfile(profile);
	if (profile === 'legacy2') { assertImageDevelopMaskRasterPortableV1(value); planImageDevelopMasksV1(value, width, height, PIXEL_LIMITS); return; }
	const develop = normalizeImageDevelopStateCurrentV1(value);
	if (width * height * 4 > 64 * 1024 * 1024) throw new RangeError('Current handoff canonical source exceeds its pixel byte capacity.');
	if (develop.processVersion === 3) planImageDevelopRepairSpotsV1(develop.repairs, width, height);
	// This owning execution-only view never becomes persisted Photo/Source metadata.
	const computation = develop.processVersion === 3 ? normalizeImageDevelopStateV2({ processVersion: 2, geometry: develop.geometry, effects: develop.effects, masks: develop.masks, maskBindings: develop.maskBindings }) : develop;
	prepareImageDevelopBrushMasksV1(computation, width, height, PIXEL_LIMITS);
}

export interface PhotoImageHandoffSourceRequestV1 {
	readonly sourceId: string;
	readonly factsJson: string;
	readonly original: Readonly<{ mimeType: string; width: number; height: number; hasAlpha: boolean }>;
	readonly pack: Readonly<FramescaperImageFramePackPublicationV1>;
	readonly signal?: AbortSignal;
}
export interface PhotoImageHandoffSourceRequestCurrentV1 extends PhotoImageHandoffSourceRequestV1 {
	readonly raw?: Readonly<FramescaperRawOriginalReceiptV1>;
}
export interface PhotoImageHandoffSourceForProfileV1 {
	readonly source: Readonly<EditableSource>;
	readonly body: Blob;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
const BUFFER = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'buffer')!.get!;
const BYTE_LENGTH = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!;
const BACKING_LENGTH = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

/** The internal pack producer owns decoding; this owner binds its authenticated
 * pack to the complete selected saved facts before an archive can consume it. */
export async function createPhotoImageHandoffSourceForProfileV1(profile: HandoffProfile, value: PhotoImageHandoffSourceRequestCurrentV1): Promise<Readonly<PhotoImageHandoffSourceForProfileV1>> {
	assertHandoffProfile(profile); const label = 'Photo image handoff source';
	const input = record(value, label, ['sourceId', 'factsJson', 'original', 'pack', 'signal', ...(profile === 'current3' ? ['raw'] : [])], ['sourceId', 'factsJson', 'original', 'pack']);
	const raw = Object.hasOwn(input, 'raw') ? normalizeFramescaperRawOriginalReceiptV1(field(input, 'raw', label)) : undefined;
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
	const facts = profile === 'legacy2' ? parsePhotoExportSidecarV1(text) : parsePhotoExportSidecarCurrentV1(text);
	if ((profile === 'legacy2' ? serializePhotoExportSidecarV1(facts) : serializePhotoExportSidecarCurrentV1(facts)) !== text) throw new TypeError('Photo image handoff saved facts must be canonical.');
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
	const successor = profile === 'current3' && (raw !== undefined || facts.photoSchemaVersion === 3 || develop.masks.some(graph => graph.inputs.length > 0));
	const provenance = (successor ? createImageDevelopHandoffProvenanceV2 : createImageDevelopHandoffProvenanceV1)({ develop,
		original: { exactName: facts.original.fileName, sha256: facts.original.contentSha256, byteLength: facts.original.byteLength },
		origin: { schemaFamily: 'lightscaper', schemaVersion: facts.photoSchemaVersion, catalogId: facts.binding.catalogId, photoId: facts.binding.photoId,
			revision: facts.binding.revision, versionId: facts.version.id, versionKind: facts.version.kind, versionName: facts.version.name, versionCreatedAt: facts.version.createdAt } });
	const mimeType = field(original, 'mimeType', 'Photo image original geometry');
	const source = normalizeEditableSourceForProfileV1(profile, { schemaVersion: raw ? 4 : successor ? 3 : 2, kind: 'image', id: sourceId, storageKey: sourceId,
		name: facts.version.name, mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, contentSha256: read('contentSha256'), assetByteLength: read('assetByteLength'),
		conversionReceiptSha256: read('conversionReceiptSha256'),
		original: { fileName: facts.original.fileName.normalize('NFC'), mimeType, recognizedFormat: raw ? rawFormat(mimeType) : format(mimeType), byteLength: facts.original.byteLength, sha256: facts.original.contentSha256 },
		canonical: { width: read('width'), height: read('height'), hasAlpha: read('hasAlpha'), frameCount: read('frameCount'), durationTicks: read('durationTicks'), timingMode: read('timingMode') },
		develop, developed: natural(develop, read('width'), read('height')), provenance, ...(raw ? { raw } : {}) });
	assertPhotoDevelopHandoffMasksForProfileV1(profile, develop, source.canonical.width, source.canonical.height);
	handoffResourceReferencesForProfileV1(profile, source); // Conflicting disabled resources must also refuse.
	const bytes = read('bytes');
	if (!(bytes instanceof Uint8Array) || Object.getPrototypeOf(bytes) !== Uint8Array.prototype) throw new TypeError('Photo image pack requires native bytes.');
	const byteLength = source.schemaVersion === 4 ? Number(Reflect.apply(BYTE_LENGTH, bytes, [])) : bytes.byteLength;
	if (byteLength !== source.assetByteLength) throw new RangeError('Photo image pack byte length differs from its admitted binding.');
	const peak = source.schemaVersion === 4 ? BigInt(Reflect.apply(BACKING_LENGTH, Reflect.apply(BUFFER, bytes, []), []) as number) + BigInt(source.assetByteLength) * 2n
		+ BigInt(source.original.byteLength) + BigInt(source.canonical.width) * BigInt(source.canonical.height) * 8n + 32n * 1024n * 1024n
		: BigInt(source.assetByteLength) * 3n + BigInt(source.canonical.width) * BigInt(source.canonical.height) * 8n;
	if (peak > BigInt(source.schemaVersion === 4 ? 1024 : 512) * 1024n * 1024n) {
		throw new RangeError('Photo image handoff pack exceeds its working byte bound.');
	}
	if (raw && bytesToHex(sha256(encodeFramescaperImageConversionReceiptV1({ schemaVersion: 1, kind: 'raw-original', raw }))) !== source.conversionReceiptSha256) {
		throw new Error('RAW image handoff pack receipt differs from its native Original facts.');
	}
	// Blob construction snapshots writable producer bytes before the first yield.
	const body = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE });
	const snapshot = new Uint8Array(await Blob.prototype.arrayBuffer.call(body));
	try {
		check();
		const reader = await openFramescaperImageFramePackV1({ source: framescaperImagePackSourceCurrentV1(source),
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
function rawFormat(value: unknown): 'dng' | 'crw' {
	if (value === 'image/x-adobe-dng') return 'dng';
	if (value === 'image/x-canon-crw') return 'crw';
	throw new RangeError('RAW image handoff original MIME has no admitted native route.');
}
function natural(develop: ImageDevelopStateCurrentV1, width: unknown, height: unknown) {
	if (typeof width !== 'number' || typeof height !== 'number') throw new TypeError('Photo image handoff requires natural original dimensions.');
	let plan = planImageGeometryV1({ schemaVersion: 1, ...develop.geometry, perspective: null }, width, height);
	for (const effect of develop.effects) if (effect.enabled && effect.type === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1) {
		plan = planImageGeometryV1(imageGeometryForVideoEffectV1(effect, plan.width, plan.height), plan.width, plan.height);
	}
	return Object.freeze({ width: plan.width, height: plan.height });
}

export interface PhotoFramescaperHandoffProjectIdentityV1 {
	readonly projectId: string; readonly sequenceId: string; readonly trackId: string; readonly clipId: string; readonly now: string;
}

/** Assemble one unpublished current Frame document using its own factory and
 * commands. Natural dimensions and ordered Develop remain source authority;
 * the original pack is never flattened into developed pixels. */
export function createPhotoFramescaperHandoffProjectForProfileV1(profile: HandoffProfile, sourceValue: unknown, identity: Readonly<PhotoFramescaperHandoffProjectIdentityV1>): FramescaperProject {
	assertHandoffProfile(profile); const source = normalizeEditableSourceForProfileV1(profile, sourceValue), label = 'Photo handoff project identity';
	const input = record(identity, label, ['projectId', 'sequenceId', 'trackId', 'clipId', 'now']);
	const projectId = id(field(input, 'projectId', label), 'handoff project ID'), sequenceId = id(field(input, 'sequenceId', label), 'handoff sequence ID');
	const trackId = id(field(input, 'trackId', label), 'handoff track ID'), clipId = id(field(input, 'clipId', label), 'handoff clip ID');
	if (new Set([projectId, sequenceId, trackId, clipId, source.id]).size !== 5) throw new Error('Image handoff identifiers must be distinct.');
	const now = field(input, 'now', label);
	if (typeof now !== 'string' || !Number.isFinite(Date.parse(now))) throw new TypeError('Image handoff requires an admitted timestamp.');
	if (source.canonical.frameCount !== 1) throw new RangeError('Image handoff requires one single still frame.');
	const ticks = BigInt(source.canonical.durationTicks), denominator = BigInt(FRAMESCAPER_IMAGE_TICKS_PER_SECOND);
	const sequenceFrameCount = Number((ticks * 30n + denominator - 1n) / denominator);
	const project = createFramescaperProject(PROFILE, { id: projectId, title: source.name, now, sources: [], clips: [], projectBin: { clips: [] },
		tracks: [createVideoTrack({ id: trackId, name: source.name, clipIds: [], locked: false })],
		sequences: [{ id: sequenceId, rate: { num: 30, den: 1 }, trackIds: [trackId] }], primarySequenceId: sequenceId,
		finishing: { colorContexts: [{ schemaVersion: 1, sequenceId, workingSpace: 'linear-rec709-d65', outputSpace: 'srgb',
			alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none' }] } });
	return applyFramescaperProjectCommand(PROFILE, project, { type: 'batch', commands: [
		{ type: 'image-source/set', sourceId: source.id, expectedSource: null, source },
		{ type: 'image-clip/set', clipId, expectedClip: null, expectedPlacement: null,
			clip: { schemaVersion: 1, kind: 'image', id: clipId, sourceId: source.id, sequenceId, sequenceStartFrame: 0, sequenceFrameCount, sourceStartTicks: '0' },
			placement: { scope: 'timeline', trackId } },
	] }, { now });
}

/** Pure destination document composition, without original/LUT body authority.
 * The publication allocator must also prove these identities are unused in its
 * selected repository; a catalog root does not enumerate existing photo rows. */
export function createPhotoFramescaperHandoffPhotoForProfileV1(profile: HandoffProfile, value: unknown): PhotoDocumentCurrentV1 {
	assertHandoffProfile(profile); const input = photoRecord(value, 'photo handoff composition', ['source', 'catalog', 'ownership', 'createdAt', 'metadata', 'extractedMetadata']);
	const source = normalizeEditableSourceForProfileV1(profile, photoField(input, 'source'));
	const catalog = normalizePhotoCatalogRootV1(photoField(input, 'catalog'));
	const createdAt = utcTimestamp(photoField(input, 'createdAt'), 'destination photo creation time');
	const legacyClosure = profile === 'legacy2' ? handoffResourceReferencesForProfileV1(profile, source) : undefined;
	validateNaturalGeometry(profile, source);
	const closure = legacyClosure ?? handoffResourceReferencesForProfileV1(profile, source), resources = [...closure.luts, ...closure.brushes], origin = source.provenance.origin;
	const virtual = origin.schemaFamily === 'lightscaper' && origin.versionKind === 'virtual-copy';
	const keys = ['photoId', 'originalId', 'storageKey', 'masterVersionId', ...(virtual ? ['selectedVersionId'] : [])];
	const owner = photoRecord(photoField(input, 'ownership'), 'photo handoff ownership', keys);
	const ids = keys.map(key => id(photoField(owner, key), `destination ${key}`));
	unique(ids, 'fresh destination identities');
	const incoming = origin.schemaFamily === 'lightscaper' ? [origin.catalogId, origin.photoId, origin.versionId]
		: [origin.projectId, origin.sourceId, origin.sequenceId, origin.clipId];
	const retained = new Set([source.id, source.storageKey, catalog.id, ...incoming, ...resources.map(resource => resource.storageKey)]);
	if (ids.some(identity => retained.has(identity))) throw new RangeError('Fresh destination identities collide with retained handoff identities.');
	const [photoId, originalId, storageKey, masterVersionId, selectedVersionId] = ids;
	const selected = { id: virtual ? selectedVersionId : masterVersionId, kind: virtual ? 'virtual-copy' : 'master',
		name: origin.schemaFamily === 'lightscaper' ? origin.versionName : frameMasterName(source.name),
		createdAt: origin.schemaFamily === 'lightscaper' ? origin.versionCreatedAt : createdAt, develop: source.develop };
	const versions = virtual ? [{ id: masterVersionId, kind: 'master', name: 'Original', createdAt, develop: defaultPhotoDevelopV1() }, selected] : [selected];
	const photo = (profile === 'current3' ? normalizePhotoDocumentCurrentV1 : normalizePhotoDocumentV1OrV2)({ schemaFamily: 'lightscaper', schemaVersion: source.schemaVersion === 3 || source.schemaVersion === 4 ? 3 : source.develop.processVersion, kind: 'photo',
		id: photoId, catalogId: catalog.id, revision: 0,
		original: { schemaVersion: 1, kind: 'still', id: originalId, name: source.provenance.original.exactName,
			mimeType: source.original.mimeType, storageKey, contentSha256: source.original.sha256, byteLength: source.original.byteLength,
			width: source.canonical.width, height: source.canonical.height, hasAlpha: source.canonical.hasAlpha, retention: 'managed' },
		metadata: photoField(input, 'metadata'), extractedMetadata: photoField(input, 'extractedMetadata'), folderId: null, collectionIds: [], keywordIds: [],
		rating: 0, flag: 'unflagged', colorLabel: 'none', versions, activeVersionId: selected.id });
	validatePhotoCatalogReferencesV1(photo, catalog);
	return photo;
}

function validateNaturalGeometry(profile: HandoffProfile, source: Readonly<EditableSource>): void {
	const develop = source.develop;
	assertPhotoDevelopHandoffMasksForProfileV1(profile, develop, source.canonical.width, source.canonical.height);
	let plan = planImageGeometryV1({ schemaVersion: 1, ...develop.geometry, perspective: null }, source.canonical.width, source.canonical.height);
	for (const effect of develop.effects) {
		if (effect.enabled && effect.type === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1) {
			plan = planImageGeometryV1(imageGeometryForVideoEffectV1(effect, plan.width, plan.height), plan.width, plan.height);
		}
	}
	if (plan.width !== source.developed.width || plan.height !== source.developed.height) throw new RangeError('Editable photo handoff natural geometry differs from its saved recipe.');
}

/** A Frame display label may be longer than a Photo version label; this never
 * changes the separately retained exact original filename or saved recipe. */
function frameMasterName(value: string): string {
	let result = '';
	for (const character of value) {
		if (result.length + character.length > 256) break;
		result += character;
	}
	return result.trim() ? result : 'Imported image';
}
