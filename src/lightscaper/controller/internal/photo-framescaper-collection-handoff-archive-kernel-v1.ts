/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertHandoffProfile, assertPhotoDevelopHandoffMasksForProfileV1, handoffResourceReferencesForProfileV1, type HandoffProfile, type PhotoImageHandoffSourceForProfileV1 } from './photo-image-handoff-model-kernel-v1.ts';

import type { PhotoLibraryCollectionHandoffPortV1, PhotoLibraryCollectionHandoffRequestV1, PhotoLibraryCollectionHandoffViewV1 } from '../../../common/editor/photo-library-collection-handoff-port-v1.ts';
import type { OpenFramescaperBrowserNativeImageV1 } from '../../../common/editor/timeline-image-native-decode-v1.ts';
import type { PhotoLibraryCollectionHandoffPortV2, PhotoLibraryCollectionHandoffViewV2 } from '../../../common/editor/photo-library-collection-handoff-port-v2.ts';
import { parsePhotoExportSidecarCurrentV1, serializePhotoExportSidecarCurrentV1 } from '../../catalog/photo-export-sidecar-current-v1.ts';
import { createPhotoResourceReachabilityCurrentV1, type PhotoResourceReferencesCurrentV1 } from '../../catalog/photo-resource-reachability-current-v1.ts';
import { admitPhotoImageHandoffBrushReferenceV1 } from './photo-library-image-handoff-kernel-v1.ts';
import { FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES, FRAMESCAPER_IMAGE_FRAME_PACK_INDEX_BYTES } from '../../../common/editor/timeline-image-frame-pack-v1-layout.ts';
import { normalizeImageDevelopStateV2 } from '../../../common/editor/imaging/image-develop-state-v2.ts';
import { planImageDevelopRepairSpotsV1 } from '../../../common/editor/imaging/image-develop-repair-plan-v1.ts';
import { prepareImageDevelopBrushMasksV1 } from '../../../common/editor/imaging/image-develop-brush-mask-v1.ts';
import { planImageGeometryV1 } from '../../../common/editor/imaging/image-geometry-plan-v1.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, imageGeometryForVideoEffectV1 } from '../../../common/editor/video-image-geometry-v1.ts';
import type { ImageDevelopStateThroughV4 } from '../../../common/editor/imaging/image-develop-state-v4.ts';
import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../../common/editor/closed-domain-value.ts';
import { normalizeVideoCubeLutReferenceV1 } from '../../../common/editor/cube-lut-reference-contract.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../../../common/editor/timeline-image-model.ts';
import { sanitizeSuggestedSaveName } from '../../../common/editor/browser-file-save-service.ts';
import { createFramescaperScapeNativeRuntime } from '../../../framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../../framescaper/editor-project-runtime-profile.ts';
import { parsePhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../../catalog/photo-export-sidecar-v1.ts';
import { createPhotoCubeLutClosureV1 } from '../../catalog/photo-cube-lut-closure-v1.ts';
import { boolean, id, integer, name, oneOf } from '../../catalog/value-validation.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../../storage/photo-develop-preset-read-v2.ts';
import { decodePhotoImageHandoffSourceForProfileV1 } from './photo-image-handoff-decode-kernel-v1.ts';
import { createPhotoFramescaperCollectionHandoffProjectForProfileV1 } from './photo-framescaper-collection-handoff-project-kernel-v1.ts';
import { PhotoLibrarySessionLifetime } from '../photo-library-session-lifetime.ts';
import { prepareLinearDevelopCurrentV1 } from '../../../common/editor/imaging/image-develop-linear-plan-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../../../common/editor/photo-library-develop-linear-port-v1.ts';
import { admitPhotoHdrHandoffWorkCurrentV1, isPhotoHdrHandoffOriginalCurrentV1, PHOTO_HDR_HANDOFF_LIMITS_CURRENT_V1 as HDR_LIMITS } from './photo-hdr-handoff-policy-current-v1.ts';

export interface PhotoFramescaperCollectionHandoffArchiveRequestForProfileV1 {
	readonly capture: Readonly<PhotoLibraryCollectionHandoffPortV1 | PhotoLibraryCollectionHandoffPortV2>; readonly binding: Readonly<PhotoLibraryCollectionHandoffRequestV1>; readonly signal?: AbortSignal;
}
export interface PhotoFramescaperCollectionHandoffArchiveDependenciesV1 {
	readonly openImage?: OpenFramescaperBrowserNativeImageV1; readonly createId?: () => string; readonly now?: () => string;
}
export interface PhotoFramescaperCollectionHandoffArchiveV1 {
	readonly blob: Blob; readonly fileName: string; readonly projectId: string; readonly sequenceId: string; readonly photoCount: number;
}

const MAXIMUM_BODIES = 128 * 1024 * 1024, MAXIMUM_ARCHIVE = 256 * 1024 * 1024, MAXIMUM_FACTS = 2 * 1024 * 1024;
const CHECK = AbortSignal.prototype.throwIfAborted, ANY = AbortSignal.any;
const SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }

/** Export one unpublished sequence in native collection order. Every Photo
 * owns a distinct image pack entry even when original bodies alias. Retained
 * generated packs plus unique LUT bodies are <=128MiB; final ZIP output is
 * independently <=256MiB. Existing serial decoder working limits still apply;
 * these are controlled body bounds, not a native codec/ZIP heap estimate. */
export async function exportPhotoFramescaperCollectionHandoffArchiveForProfileV1(profile: HandoffProfile, request: Readonly<PhotoFramescaperCollectionHandoffArchiveRequestForProfileV1>,
	dependencies: Readonly<PhotoFramescaperCollectionHandoffArchiveDependenciesV1> = {}): Promise<Readonly<PhotoFramescaperCollectionHandoffArchiveV1>> {
	assertHandoffProfile(profile); const label = 'Collection editable archive request', input = record(request, label, ['capture', 'binding', 'signal'], ['capture', 'binding']);
	const options = readPhotoDevelopSignalOptionsV2(Object.hasOwn(input, 'signal') ? { signal: field(input, 'signal', label) } : {});
	const capture = field(input, 'capture', label), cap = record(capture, label, ['withCapture']), withCapture = field(cap, 'withCapture', label);
	if (typeof withCapture !== 'function') throw new TypeError('Collection archive requires its callable capture capability.');
	const value = record(field(input, 'binding', label), label, ['catalogId', 'collectionId', 'scope', 'expectedCatalogRevision', 'expectedDefinitionRevision'],
		['catalogId', 'collectionId', 'scope', 'expectedCatalogRevision']);
	const scope = oneOf(field(value, 'scope', label), ['catalog', 'saved-query'] as const, 'collection scope');
	if (Object.hasOwn(value, 'expectedDefinitionRevision') !== (scope === 'saved-query')) throw new TypeError('Collection definition revision must match its scope.');
	const binding = Object.freeze({ catalogId: id(field(value, 'catalogId', label), 'collection catalog ID'), collectionId: id(field(value, 'collectionId', label), 'collection ID'), scope,
		expectedCatalogRevision: integer(field(value, 'expectedCatalogRevision', label), 0, Number.MAX_SAFE_INTEGER, 'collection revision'),
		...(scope === 'saved-query' ? { expectedDefinitionRevision: integer(field(value, 'expectedDefinitionRevision', label), 0, Number.MAX_SAFE_INTEGER, 'definition revision') } : {}) });
	const ports = record(dependencies, 'Collection archive dependencies', ['openImage', 'createId', 'now'], []);
	const pin = (key: string, fallback: () => unknown) => {
		const method = Object.hasOwn(ports, key) ? field(ports, key, label) : fallback;
		if (typeof method !== 'function') throw new TypeError(`Collection archive ${key} must be callable.`);
		return Reflect.apply(Function.prototype.bind, method, [dependencies]) as () => unknown;
	};
	const nativeRandomUUID = Reflect.apply(Function.prototype.bind, crypto.randomUUID, [crypto]) as () => string;
	const createId = pin('createId', nativeRandomUUID), now = pin('now', () => new Date().toISOString());
	const native = Object.hasOwn(ports, 'openImage') ? field(ports, 'openImage', label) : undefined;
	if (native !== undefined && typeof native !== 'function') throw new TypeError('Collection archive requires a callable native image port.');
	const decoder = native ? { openImage: Reflect.apply(Function.prototype.bind, native, [dependencies]) as OpenFramescaperBrowserNativeImageV1 } : {};
	const projectId = id(createId(), 'collection project ID'), sequenceId = id(createId(), 'collection sequence ID'), trackId = id(createId(), 'collection track ID'), timestampValue = now();
	if (typeof timestampValue !== 'string' || !Number.isFinite(Date.parse(timestampValue))) throw new TypeError('Collection archive timestamp is invalid.');
	const timestamp = timestampValue;
	const result = await joinedDelivery<Readonly<PhotoLibraryCollectionHandoffViewV1 | PhotoLibraryCollectionHandoffViewV2>, Readonly<PhotoFramescaperCollectionHandoffArchiveV1>>(
		consume => Reflect.apply(withCapture, capture, [binding, consume, options]) as Promise<unknown>, build, 'Collection capture');
	if (options.signal) check(options.signal);
	return result;

	async function build(viewValue: Readonly<PhotoLibraryCollectionHandoffViewV1 | PhotoLibraryCollectionHandoffViewV2>): Promise<Readonly<PhotoFramescaperCollectionHandoffArchiveV1>> {
		const label = 'Collection archive captured view', view = record(viewValue, label, ['schemaVersion', 'signal', 'collection', 'photos', 'lutReferences', 'withOriginal', 'withLutBytes', ...(profile === 'current3' ? ['maskRasterReferences', 'withMaskRasterBytes'] : [])]);
		if (field(view, 'schemaVersion', label) !== (profile === 'current3' ? 2 : 1)) throw new RangeError('Collection archive requires its current captured view.');
		const rawSignal = readPhotoDevelopSignalOptionsV2({ signal: field(view, 'signal', label) }).signal;
		if (!rawSignal) throw new TypeError('Collection archive requires its native captured lifetime.');
		const collection = record(field(view, 'collection', label), label, ['catalogId', 'id', 'scope', 'name', 'catalogRevision', 'indexRevision', 'definitionRevision', 'definitionJson']);
		const title = name(field(collection, 'name', label), 'collection name'), definition = field(collection, 'definitionJson', label);
		integer(field(collection, 'indexRevision', label), 0, Number.MAX_SAFE_INTEGER, 'collection index revision');
		if (field(collection, 'catalogId', label) !== binding.catalogId || field(collection, 'id', label) !== binding.collectionId || field(collection, 'scope', label) !== binding.scope
			|| field(collection, 'catalogRevision', label) !== binding.expectedCatalogRevision || field(collection, 'definitionRevision', label) !== (binding.expectedDefinitionRevision ?? null)) {
			throw new Error('Collection archive captured identity changed.');
		}
		if (typeof definition !== 'string' || definition.length > MAXIMUM_FACTS) throw new RangeError('Collection definition exceeds its fixed facts capacity.');
		let factsBytes = new TextEncoder().encode(JSON.stringify(collection)).byteLength;
		const closure = createClosure(profile), photoIds = new Set<string>();
		const photos = array(field(view, 'photos', label), 'Collection archive photo entries', 1, 4_094).map(candidate => {
			const photo = record(candidate, label, ['binding', 'factsJson', 'original']), selected = record(field(photo, 'binding', label), label, ['catalogId', 'photoId', 'versionId', 'expectedRevision']);
			const catalogId = id(field(selected, 'catalogId', label), 'photo catalog ID'), photoId = id(field(selected, 'photoId', label), 'photo ID');
			const versionId = id(field(selected, 'versionId', label), 'photo version ID'), revision = integer(field(selected, 'expectedRevision', label), 0, Number.MAX_SAFE_INTEGER, 'photo revision');
			const factsJson = field(photo, 'factsJson', label);
			if (typeof factsJson !== 'string') throw new TypeError('Collection archive requires canonical complete saved facts.');
			factsBytes += new TextEncoder().encode(factsJson).byteLength;
			if (factsBytes > MAXIMUM_FACTS) throw new RangeError('Collection archive exceeds its fixed facts capacity.');
			const facts = profile === 'legacy2' ? parsePhotoExportSidecarV1(factsJson) : parsePhotoExportSidecarCurrentV1(factsJson);
			if ((profile === 'legacy2' ? serializePhotoExportSidecarV1(facts) : serializePhotoExportSidecarCurrentV1(facts)) !== factsJson || catalogId !== binding.catalogId || facts.binding.catalogId !== catalogId || facts.binding.photoId !== photoId
				|| facts.binding.revision !== revision || facts.binding.activeVersionId !== versionId || facts.version.id !== versionId || photoIds.has(photoId)) throw new Error('Collection archive saved photo binding changed.');
			photoIds.add(photoId);
			const original = record(field(photo, 'original', label), label, ['exactName', 'contentSha256', 'byteLength', 'mimeType', 'width', 'height', 'hasAlpha']);
			if (field(original, 'exactName', label) !== facts.original.fileName || field(original, 'contentSha256', label) !== facts.original.contentSha256
				|| field(original, 'byteLength', label) !== facts.original.byteLength) throw new Error('Collection archive original binding changed.');
			const detached = Object.freeze({ exactName: facts.original.fileName, contentSha256: facts.original.contentSha256,
				byteLength: integer(facts.original.byteLength, 1, profile === 'current3' && field(original, 'mimeType', label) === 'image/x-lightscaper-hdr' ? HDR_LIMITS.originalBytes : 64 * 1024 * 1024, 'collection original byte length'),
				mimeType: oneOf(field(original, 'mimeType', label), ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp',
					...(profile === 'current3' ? ['image/x-adobe-dng', 'image/x-canon-crw', 'image/x-lightscaper-hdr'] as const : [])] as const, 'collection original MIME'),
				width: integer(field(original, 'width', label), 1, 8192, 'original width'), height: integer(field(original, 'height', label), 1, 8192, 'original height'),
				hasAlpha: boolean(field(original, 'hasAlpha', label), 'original alpha') });
			assertPhotoDevelopHandoffMasksForProfileV1(profile, facts.version.develop, detached.width, detached.height);
			if (profile === 'current3') {
				if (isPhotoHdrHandoffOriginalCurrentV1(detached)) admitPhotoHdrHandoffWorkCurrentV1(facts.version.develop, detached.width, detached.height, detached.byteLength);
				else if (detached.mimeType === 'image/x-adobe-dng' || detached.mimeType === 'image/x-canon-crw') admitRawCurrentWork(facts.version.develop, detached.width, detached.height, detached.byteLength);
				else admitCurrentWork(facts.version.develop, detached.width, detached.height, detached.byteLength);
			}
			factsBytes += new TextEncoder().encode(JSON.stringify({ catalogId, photoId, versionId, revision, original: detached })).byteLength;
			if (factsBytes > MAXIMUM_FACTS) throw new RangeError('Collection archive exceeds its fixed facts capacity.');
			closure.addDevelop(facts.version.develop);
			return Object.freeze({ photoId, factsJson, original: detached, sourceId: id(createId(), 'collection source ID'), clipId: id(createId(), 'collection clip ID') });
		});
		const hdr = profile === 'current3' && photos.some(photo => isPhotoHdrHandoffOriginalCurrentV1(photo.original));
		const maximumBodies = hdr ? HDR_LIMITS.bodyBytes : MAXIMUM_BODIES, maximumArchive = hdr ? HDR_LIMITS.archiveBytes : MAXIMUM_ARCHIVE;
		const selectedResources = closure.finish(), references = selectedResources.luts, masks = selectedResources.brushes, captured = array(field(view, 'lutReferences', label), 'Collection LUT entries', 0, 4_094).map(normalizeVideoCubeLutReferenceV1);
		if (photos.length + references.length + masks.length + 2 > 4_096) throw new RangeError('Collection archive exceeds its fixed entry capacity.');
		if (JSON.stringify(references) !== JSON.stringify(captured)) throw new Error('Collection archive captured resource closure changed.');
		if (profile === 'current3') {
			const capturedMasks = array(field(view, 'maskRasterReferences', label), 'Collection brush entries', 0, 4_094).map(admitPhotoImageHandoffBrushReferenceV1);
			if (JSON.stringify(masks) !== JSON.stringify(capturedMasks)) throw new Error('Collection archive captured brush closure changed.');
		}
		let bodyBytes = [...references, ...masks].reduce((total, reference) => total + reference.byteLength, 0);
		if (bodyBytes > maximumBodies) throw new RangeError('Collection archive exceeds its fixed body capacity.');
		if (hdr) {
			const retained = photos.reduce((sum, photo) => sum + photo.original.byteLength * 2 + photo.original.width * photo.original.height * 4 + 1024 * 1024, bodyBytes);
			for (const photo of photos) {
				const develop = parsePhotoExportSidecarCurrentV1(photo.factsJson).version.develop, original = photo.original;
				if (isPhotoHdrHandoffOriginalCurrentV1(original)) admitPhotoHdrHandoffWorkCurrentV1(develop, original.width, original.height, original.byteLength, retained);
				else if (original.mimeType === 'image/x-adobe-dng' || original.mimeType === 'image/x-canon-crw') admitRawCurrentWork(develop, original.width, original.height, original.byteLength, retained);
				else admitCurrentWork(develop, original.width, original.height, original.byteLength, retained);
			}
		}
		if (profile === 'current3') {
			const minimum = photos.reduce((sum, photo) => sum + BigInt(photo.original.byteLength) + BigInt(FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES + FRAMESCAPER_IMAGE_FRAME_PACK_INDEX_BYTES), BigInt(bodyBytes));
			if (minimum > BigInt(maximumBodies)) throw new RangeError('Collection archive exceeds its mandatory per-photo pack body capacity.');
		}
		const identifiers = [projectId, sequenceId, trackId, ...photos.flatMap(photo => [photo.sourceId, photo.clipId]), ...[...references, ...masks].map(reference => reference.storageKey)];
		if (new Set(identifiers).size !== identifiers.length) throw new Error('Collection archive identifiers must be globally distinct.');
		const originalMethod = field(view, 'withOriginal', label), lutMethod = field(view, 'withLutBytes', label);
		const maskMethod = profile === 'current3' ? field(view, 'withMaskRasterBytes', label) : undefined;
		if (profile === 'current3' && typeof maskMethod !== 'function') throw new TypeError('Collection archive requires its scoped brush reader.');
		if (typeof originalMethod !== 'function' || typeof lutMethod !== 'function') throw new TypeError('Collection archive requires its scoped original and LUT readers.');
		const joined = Reflect.apply(ANY, AbortSignal, [[rawSignal, ...(options.signal ? [options.signal] : [])]]) as AbortSignal, lifetime = new PhotoLibrarySessionLifetime();
		try { return await lifetime.operation(async signal => {
			const decoded: Readonly<PhotoImageHandoffSourceForProfileV1>[] = [];
			for (const photo of photos) {
				check(signal);
				const result = await joinedDelivery<Blob, Readonly<PhotoImageHandoffSourceForProfileV1>>(consume =>
					Reflect.apply(originalMethod, viewValue, [photo.photoId, consume, { signal: rawSignal }]) as Promise<unknown>,
					originalBlob => decodePhotoImageHandoffSourceForProfileV1(profile, { factsJson: photo.factsJson, original: photo.original, originalBlob, signal }, photo.sourceId, decoder), 'Collection original');
				check(signal); bodyBytes += Reflect.apply(SIZE, result.body, []) as number;
				if (bodyBytes > maximumBodies) throw new RangeError('Collection archive exceeds its fixed generated body capacity.');
				decoded.push(result);
			}
			const actualClosure = createClosure(profile); for (const result of decoded) actualClosure.addDevelop(result.source.develop);
			if (JSON.stringify(actualClosure.finish()) !== JSON.stringify(selectedResources)
				|| decoded.some(result => JSON.stringify(handoffResourceReferencesForProfileV1(profile, result.source)) !== JSON.stringify(developResources(profile, result.source.develop)))) throw new Error('Collection archive decoded resource closure changed.');
			const project = createPhotoFramescaperCollectionHandoffProjectForProfileV1(profile, decoded.map(result => result.source), { projectId, sequenceId, trackId,
				clipIds: photos.map(photo => photo.clipId), name: title, now: timestamp });
			let open = true, reading: { key: string; promise: Promise<Blob> } | null = null;
			const cached = new Map<string, Blob>(), packs = new Map(decoded.map(result => [result.source.storageKey, result]));
			const metadata = (key: string) => {
				if (!open) throw new Error('Collection archive body adapter is closed.'); check(signal);
				const pack = packs.get(key);
				if (pack) return { sourceId: key, size: pack.source.assetByteLength, sha256: pack.source.contentSha256,
					mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, kind: 'timeline-image', encoding: 'framescaper-image-asset-v1' };
				const ref = [...references, ...masks].find(reference => reference.storageKey === key);
				if (!ref) throw new ReferenceError('Collection archive body is outside the captured closure.');
				return masks.some(reference => reference.storageKey === key)
					? { sourceId: key, size: ref.byteLength, sha256: ref.sha256, mimeType: 'application/octet-stream', kind: 'photo-mask-raster', encoding: 'lightscaper-mask-raster-v1' }
					: { sourceId: key, size: ref.byteLength, sha256: ref.sha256, mimeType: 'text/plain' };
			};
			const adapter = Object.freeze({ getMediaAssetMetadata: metadata,
				loadProject(key: string) { if (!open) throw new Error('Collection archive body adapter is closed.'); check(signal); return key === projectId ? project : null; },
				async loadMediaAsset(key: string) {
					metadata(key); const pack = packs.get(key); if (pack) return pack.body;
					const existing = cached.get(key); if (existing) return existing;
					if (reading) { if (reading.key === key) return await reading.promise; throw new Error('A collection archive LUT read is already pending.'); }
					const ref = [...references, ...masks].find(reference => reference.storageKey === key)!, brush = masks.some(reference => reference.storageKey === key);
					const method = brush ? maskMethod : lutMethod;
					if (typeof method !== 'function') throw new TypeError('Collection archive requires its captured resource reader.');
					const work = joinedDelivery<Uint8Array<ArrayBuffer>, Blob>(consume => Reflect.apply(method, viewValue, [ref, consume, { signal: rawSignal }]) as Promise<unknown>,
						bytes => new Blob([bytes], { type: brush ? 'application/octet-stream' : 'text/plain' }), brush ? 'Collection brush' : 'Collection LUT');
					reading = { key, promise: work };
					try { const body = await work; check(signal); if (Reflect.apply(SIZE, body, []) !== ref.byteLength) throw new Error('Collection archive LUT byte length changed.'); cached.set(key, body); return body; }
					finally { reading = null; }
				}, readSourceChunks() { throw new TypeError('Collection handoff has no audio body authority.'); } });
			try {
				const exported = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, adapter,
					{ signal, maximumBlobBytes: maximumArchive, assertCurrent: () => { check(signal); } });
				check(signal); if (!exported.blob || Reflect.apply(SIZE, exported.blob, []) > maximumArchive) throw new RangeError('Collection archive did not produce its bounded ZIP.');
				return Object.freeze({ blob: exported.blob, fileName: sanitizeSuggestedSaveName(title + '.fscape'), projectId, sequenceId, photoCount: photos.length });
			} finally { open = false; }
		}, joined); } finally { await lifetime.close(async () => undefined); }
	}
}

function createClosure(profile: HandoffProfile) {
	if (profile === 'current3') return createPhotoResourceReachabilityCurrentV1();
	const legacy = createPhotoCubeLutClosureV1();
	return { addDevelop: legacy.addDevelop, finish: (): Readonly<PhotoResourceReferencesCurrentV1> => Object.freeze({ luts: legacy.finish(), brushes: Object.freeze([]) }) };
}
function developResources(profile: HandoffProfile, develop: unknown) { const closure = createClosure(profile); closure.addDevelop(develop); return closure.finish(); }

/** Metadata-only preparation cannot borrow bodies. Actual RAW signature,
 * receipt and native pixels are proved later by the owning decoder/audits.
 * Reserve the whole retained collection capacity in both serial phases. */
const RAW_METADATA_ONLY = Object.freeze({ async withBytes<Result>(): Promise<Result> {
	throw new TypeError('Collection RAW metadata preparation cannot read a resource body.');
} });
function admitRawCurrentWork(develop: Readonly<ImageDevelopStateThroughV4>, width: number, height: number, originalBytes: number, retainedBytes = MAXIMUM_BODIES): void {
	const prepared = prepareLinearDevelopCurrentV1({ frame: { descriptor: { schemaVersion: 1, width, height,
		sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' } }, develop }, PHOTO_DEVELOP_LINEAR_LIMITS_V1,
	{ source: RAW_METADATA_ONLY, maskSource: RAW_METADATA_ONLY });
	const original = BigInt(originalBytes), retained = BigInt(retainedBytes), reserve = 32n * 1024n * 1024n;
	const decode = retained + original * 3n + (512n + 128n) * 1024n * 1024n + reserve;
	const render = retained + original * 2n + BigInt(prepared.peakWorkingBytes) + reserve;
	if (decode > 1024n * 1024n * 1024n || render > 1024n * 1024n * 1024n) throw new RangeError('Collection native RAW image exceeds its working byte capacity.');
}

/** Pure admission of the canonical repair stage and every downstream mask,
 * geometry and declared resource. The mandatory pack prefix is a lower bound;
 * actual compressed pack bytes remain independently checked after decoding. */
function admitCurrentWork(develop: Readonly<ImageDevelopStateThroughV4>, originalWidth: number, originalHeight: number, originalBytes: number, retainedBytes = 0): void {
	const limits = { maximumSidePixels: 8_192, maximumPixels: 16_777_216, maximumBytes: 64 * 1024 * 1024 };
	const computation = develop.processVersion === 3 || develop.processVersion === 4 ? normalizeImageDevelopStateV2({ processVersion: 2, geometry: develop.geometry,
		effects: develop.effects, masks: develop.masks, maskBindings: develop.maskBindings }) : develop;
	const masks = prepareImageDevelopBrushMasksV1(computation, originalWidth, originalHeight, limits);
	const repair = develop.processVersion === 3 || develop.processVersion === 4 ? planImageDevelopRepairSpotsV1(develop.repairs, originalWidth, originalHeight) : undefined;
	let width = originalWidth, height = originalHeight, maximum = BigInt(width) * BigInt(height) * 4n;
	const geometry = (value: Parameters<typeof planImageGeometryV1>[0]) => {
		const planned = planImageGeometryV1(value, width, height); width = planned.width; height = planned.height;
		if (width * height > 33_554_432) throw new RangeError('Collection editable intermediate geometry exceeds its pixel capacity.');
		const frameBytes = BigInt(width) * BigInt(height) * 4n; if (frameBytes > maximum) maximum = frameBytes;
	};
	geometry({ schemaVersion: 1, ...develop.geometry, perspective: null });
	for (const effect of develop.effects) if (effect.enabled && effect.type === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1) geometry(imageGeometryForVideoEffectV1(effect, width, height));
	const references = developResources('current3', develop); let resourceBytes = 0n;
	for (const reference of references.luts) {
		const bytes = BigInt(reference.byteLength) * 3n + BigInt(reference.size) ** 3n * 3n * 8n * 2n;
		if (bytes > resourceBytes) resourceBytes = bytes;
	}
	for (const reference of references.brushes) { const bytes = BigInt(reference.byteLength) * 3n; if (bytes > resourceBytes) resourceBytes = bytes; }
	const downstream = BigInt(originalWidth) * BigInt(originalHeight) * 4n + maximum * 4n + resourceBytes + BigInt(masks.plan.maximumWorkingBytes) + 4_096n;
	const working = repair && BigInt(repair.stageWorkingBytes) > downstream ? BigInt(repair.stageWorkingBytes) : downstream;
	const prefix = BigInt(originalBytes + FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES + FRAMESCAPER_IMAGE_FRAME_PACK_INDEX_BYTES);
	if (prefix * 3n + working + BigInt(retainedBytes) > BigInt(retainedBytes ? HDR_LIMITS.workingBytes : 512 * 1024 * 1024)) throw new RangeError('Collection editable image exceeds its working byte capacity.');
}

/** Pin exactly one callback delivery before entering its work, and join it
 * independently of a transport that ignores its return value or rejects. */
async function joinedDelivery<Input, Result>(invoke: (consume: (input: Input) => Promise<Result>) => Promise<unknown>,
	consume: (input: Input) => Result | Promise<Result>, label: string): Promise<Result> {
	type Outcome = { ok: true; value: Result } | { ok: false; reason: unknown };
	let accepting = true, entered = false, settled: Promise<Outcome> | null = null, failed = false, primary: unknown;
	try { await invoke(input => {
		if (!accepting || entered) throw new Error(`${label} requires exactly one joined delivery.`);
		entered = true;
		const work = (async () => consume(input))(); settled = work.then(value => ({ ok: true, value }), reason => ({ ok: false, reason })); return work;
	}); } catch (error) { failed = true; primary = error; }
	accepting = false;
	const outcome = await settled as Outcome | null;
	if (failed) { if (outcome?.ok === false && outcome.reason !== primary) throw new AggregateError([primary, outcome.reason], `${label} transport and consumer failed.`, { cause: primary }); throw primary; }
	if (outcome === null) throw new Error(`${label} did not deliver its authenticated body or facts.`);
	if (!outcome.ok) throw outcome.reason;
	return outcome.value;
}
