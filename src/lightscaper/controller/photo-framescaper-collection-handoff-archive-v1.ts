/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertPhotoDevelopHandoffMasksV1 } from './photo-develop-handoff-masks-v1.ts';

import type { PhotoLibraryCollectionHandoffPortV1, PhotoLibraryCollectionHandoffRequestV1, PhotoLibraryCollectionHandoffViewV1 } from '../../common/editor/photo-library-collection-handoff-port-v1.ts';
import type { OpenFramescaperBrowserNativeImageV1 } from '../../common/editor/timeline-image-native-decode-v1.ts';
import type { PhotoImageHandoffSourceV1 } from './photo-image-handoff-source-v1.ts';
import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { normalizeVideoCubeLutReferenceV1 } from '../../common/editor/cube-lut-reference-contract.ts';
import { framescaperImageSourceResourceReferencesV2 } from '../../common/editor/timeline-image-model-v2.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../../common/editor/timeline-image-model.ts';
import { sanitizeSuggestedSaveName } from '../../common/editor/browser-file-save-service.ts';
import { createFramescaperScapeNativeRuntime } from '../../framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../framescaper/editor-project-runtime-profile.ts';
import { parsePhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../catalog/photo-export-sidecar-v1.ts';
import { createPhotoCubeLutClosureV1 } from '../catalog/photo-cube-lut-closure-v1.ts';
import { boolean, id, integer, name, oneOf } from '../catalog/value-validation.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../storage/photo-develop-preset-read-v2.ts';
import { decodePhotoImageHandoffSourceV1 } from './photo-image-handoff-decode-v1.ts';
import { createPhotoFramescaperCollectionHandoffProjectV1 } from './photo-framescaper-collection-handoff-project-v1.ts';
import { PhotoLibrarySessionLifetime } from './photo-library-session-lifetime.ts';

export interface PhotoFramescaperCollectionHandoffArchiveRequestV1 {
	readonly capture: Readonly<PhotoLibraryCollectionHandoffPortV1>; readonly binding: Readonly<PhotoLibraryCollectionHandoffRequestV1>; readonly signal?: AbortSignal;
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
export async function exportPhotoFramescaperCollectionHandoffArchiveV1(request: Readonly<PhotoFramescaperCollectionHandoffArchiveRequestV1>,
	dependencies: Readonly<PhotoFramescaperCollectionHandoffArchiveDependenciesV1> = {}): Promise<Readonly<PhotoFramescaperCollectionHandoffArchiveV1>> {
	const label = 'Collection editable archive request', input = record(request, label, ['capture', 'binding', 'signal'], ['capture', 'binding']);
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
	const result = await joinedDelivery<Readonly<PhotoLibraryCollectionHandoffViewV1>, Readonly<PhotoFramescaperCollectionHandoffArchiveV1>>(
		consume => Reflect.apply(withCapture, capture, [binding, consume, options]) as Promise<unknown>, build, 'Collection capture');
	if (options.signal) check(options.signal);
	return result;

	async function build(viewValue: Readonly<PhotoLibraryCollectionHandoffViewV1>): Promise<Readonly<PhotoFramescaperCollectionHandoffArchiveV1>> {
		const label = 'Collection archive captured view', view = record(viewValue, label, ['schemaVersion', 'signal', 'collection', 'photos', 'lutReferences', 'withOriginal', 'withLutBytes']);
		if (field(view, 'schemaVersion', label) !== 1) throw new RangeError('Collection archive requires its current captured view.');
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
		const closure = createPhotoCubeLutClosureV1(), photoIds = new Set<string>();
		const photos = array(field(view, 'photos', label), 'Collection archive photo entries', 1, 4_094).map(candidate => {
			const photo = record(candidate, label, ['binding', 'factsJson', 'original']), selected = record(field(photo, 'binding', label), label, ['catalogId', 'photoId', 'versionId', 'expectedRevision']);
			const catalogId = id(field(selected, 'catalogId', label), 'photo catalog ID'), photoId = id(field(selected, 'photoId', label), 'photo ID');
			const versionId = id(field(selected, 'versionId', label), 'photo version ID'), revision = integer(field(selected, 'expectedRevision', label), 0, Number.MAX_SAFE_INTEGER, 'photo revision');
			const factsJson = field(photo, 'factsJson', label);
			if (typeof factsJson !== 'string') throw new TypeError('Collection archive requires canonical complete saved facts.');
			factsBytes += new TextEncoder().encode(factsJson).byteLength;
			if (factsBytes > MAXIMUM_FACTS) throw new RangeError('Collection archive exceeds its fixed facts capacity.');
			const facts = parsePhotoExportSidecarV1(factsJson);
			if (serializePhotoExportSidecarV1(facts) !== factsJson || catalogId !== binding.catalogId || facts.binding.catalogId !== catalogId || facts.binding.photoId !== photoId
				|| facts.binding.revision !== revision || facts.binding.activeVersionId !== versionId || facts.version.id !== versionId || photoIds.has(photoId)) throw new Error('Collection archive saved photo binding changed.');
			photoIds.add(photoId);
			const original = record(field(photo, 'original', label), label, ['exactName', 'contentSha256', 'byteLength', 'mimeType', 'width', 'height', 'hasAlpha']);
			if (field(original, 'exactName', label) !== facts.original.fileName || field(original, 'contentSha256', label) !== facts.original.contentSha256
				|| field(original, 'byteLength', label) !== facts.original.byteLength) throw new Error('Collection archive original binding changed.');
			const detached = Object.freeze({ exactName: facts.original.fileName, contentSha256: facts.original.contentSha256,
				byteLength: integer(facts.original.byteLength, 1, 64 * 1024 * 1024, 'collection original byte length'),
				mimeType: oneOf(field(original, 'mimeType', label), ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'] as const, 'collection original MIME'),
				width: integer(field(original, 'width', label), 1, 8192, 'original width'), height: integer(field(original, 'height', label), 1, 8192, 'original height'),
				hasAlpha: boolean(field(original, 'hasAlpha', label), 'original alpha') });
			assertPhotoDevelopHandoffMasksV1(facts.version.develop, detached.width, detached.height);
			factsBytes += new TextEncoder().encode(JSON.stringify({ catalogId, photoId, versionId, revision, original: detached })).byteLength;
			if (factsBytes > MAXIMUM_FACTS) throw new RangeError('Collection archive exceeds its fixed facts capacity.');
			closure.addDevelop(facts.version.develop);
			return Object.freeze({ photoId, factsJson, original: detached, sourceId: id(createId(), 'collection source ID'), clipId: id(createId(), 'collection clip ID') });
		});
		const references = closure.finish(), captured = array(field(view, 'lutReferences', label), 'Collection LUT entries', 0, 4_094).map(normalizeVideoCubeLutReferenceV1);
		if (photos.length + references.length + 2 > 4_096) throw new RangeError('Collection archive exceeds its fixed entry capacity.');
		if (JSON.stringify(references) !== JSON.stringify(captured)) throw new Error('Collection archive captured resource closure changed.');
		let bodyBytes = references.reduce((total, reference) => total + reference.byteLength, 0);
		if (bodyBytes > MAXIMUM_BODIES) throw new RangeError('Collection archive exceeds its fixed body capacity.');
		const identifiers = [projectId, sequenceId, trackId, ...photos.flatMap(photo => [photo.sourceId, photo.clipId]), ...references.map(reference => reference.storageKey)];
		if (new Set(identifiers).size !== identifiers.length) throw new Error('Collection archive identifiers must be globally distinct.');
		const originalMethod = field(view, 'withOriginal', label), lutMethod = field(view, 'withLutBytes', label);
		if (typeof originalMethod !== 'function' || typeof lutMethod !== 'function') throw new TypeError('Collection archive requires its scoped original and LUT readers.');
		const joined = Reflect.apply(ANY, AbortSignal, [[rawSignal, ...(options.signal ? [options.signal] : [])]]) as AbortSignal, lifetime = new PhotoLibrarySessionLifetime();
		try { return await lifetime.operation(async signal => {
			const decoded: Readonly<PhotoImageHandoffSourceV1>[] = [];
			for (const photo of photos) {
				check(signal);
				const result = await joinedDelivery<Blob, Readonly<PhotoImageHandoffSourceV1>>(consume =>
					Reflect.apply(originalMethod, viewValue, [photo.photoId, consume, { signal: rawSignal }]) as Promise<unknown>,
					originalBlob => decodePhotoImageHandoffSourceV1({ factsJson: photo.factsJson, original: photo.original, originalBlob, signal }, photo.sourceId, decoder), 'Collection original');
				check(signal); bodyBytes += Reflect.apply(SIZE, result.body, []) as number;
				if (bodyBytes > MAXIMUM_BODIES) throw new RangeError('Collection archive exceeds its fixed generated body capacity.');
				decoded.push(result);
			}
			const actualClosure = createPhotoCubeLutClosureV1(); for (const result of decoded) actualClosure.addDevelop(result.source.develop);
			if (JSON.stringify(actualClosure.finish()) !== JSON.stringify(references)
				|| decoded.some(result => JSON.stringify(framescaperImageSourceResourceReferencesV2(result.source)) !== JSON.stringify(createClosure(result.source.develop)))) throw new Error('Collection archive decoded resource closure changed.');
			const project = createPhotoFramescaperCollectionHandoffProjectV1(decoded.map(result => result.source), { projectId, sequenceId, trackId,
				clipIds: photos.map(photo => photo.clipId), name: title, now: timestamp });
			let open = true, reading: { key: string; promise: Promise<Blob> } | null = null;
			const cached = new Map<string, Blob>(), packs = new Map(decoded.map(result => [result.source.storageKey, result]));
			const metadata = (key: string) => {
				if (!open) throw new Error('Collection archive body adapter is closed.'); check(signal);
				const pack = packs.get(key);
				if (pack) return { sourceId: key, size: pack.source.assetByteLength, sha256: pack.source.contentSha256,
					mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, kind: 'timeline-image', encoding: 'framescaper-image-asset-v1' };
				const ref = references.find(reference => reference.storageKey === key);
				if (!ref) throw new ReferenceError('Collection archive body is outside the captured closure.');
				return { sourceId: key, size: ref.byteLength, sha256: ref.sha256, mimeType: 'text/plain' };
			};
			const adapter = Object.freeze({ getMediaAssetMetadata: metadata,
				loadProject(key: string) { if (!open) throw new Error('Collection archive body adapter is closed.'); check(signal); return key === projectId ? project : null; },
				async loadMediaAsset(key: string) {
					metadata(key); const pack = packs.get(key); if (pack) return pack.body;
					const existing = cached.get(key); if (existing) return existing;
					if (reading) { if (reading.key === key) return await reading.promise; throw new Error('A collection archive LUT read is already pending.'); }
					const ref = references.find(reference => reference.storageKey === key)!;
					const work = joinedDelivery<Uint8Array<ArrayBuffer>, Blob>(consume => Reflect.apply(lutMethod, viewValue, [ref, consume, { signal: rawSignal }]) as Promise<unknown>,
						bytes => new Blob([bytes], { type: 'text/plain' }), 'Collection LUT');
					reading = { key, promise: work };
					try { const body = await work; check(signal); if (Reflect.apply(SIZE, body, []) !== ref.byteLength) throw new Error('Collection archive LUT byte length changed.'); cached.set(key, body); return body; }
					finally { reading = null; }
				}, readSourceChunks() { throw new TypeError('Collection handoff has no audio body authority.'); } });
			try {
				const exported = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, adapter,
					{ signal, maximumBlobBytes: MAXIMUM_ARCHIVE, assertCurrent: () => { check(signal); } });
				check(signal); if (!exported.blob || Reflect.apply(SIZE, exported.blob, []) > MAXIMUM_ARCHIVE) throw new RangeError('Collection archive did not produce its bounded ZIP.');
				return Object.freeze({ blob: exported.blob, fileName: sanitizeSuggestedSaveName(title + '.fscape'), projectId, sequenceId, photoCount: photos.length });
			} finally { open = false; }
		}, joined); } finally { await lifetime.close(async () => undefined); }
	}
}

function createClosure(develop: unknown) { const closure = createPhotoCubeLutClosureV1(); closure.addDevelop(develop); return closure.finish(); }

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
