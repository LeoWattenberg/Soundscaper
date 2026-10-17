/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryCollectionHandoffRequestV1, PhotoLibraryCollectionHandoffPhotoV1, PhotoLibraryCollectionHandoffViewV1 } from '../../../common/editor/photo-library-collection-handoff-port-v1.ts';
import type { PhotoLibraryCollectionHandoffViewV2 } from '../../../common/editor/photo-library-collection-handoff-port-v2.ts';
import { IMAGE_IMPORT_LIMITS } from '../../../common/editor/image-import-admission.ts';
import { canonicalMediaContentBlob, digestMediaContent } from '../../../common/editor/storage/media-content-digest.ts';
import { normalizePhotoCatalogRootV1 } from '../../catalog/catalog-root.ts';
import { createPhotoCubeLutClosureV1 } from '../../catalog/photo-cube-lut-closure-v1.ts';
import { normalizePhotoDocumentV1OrV2 } from '../../catalog/photo-document-v2.ts';
import { canonicalPhotoDocumentJsonV1 } from '../../catalog/photo-document-json-v1.ts';
import { assertPhotoMaskRasterPortableV1 } from '../../catalog/photo-mask-raster-portability-v1.ts';
import { createPhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../../catalog/photo-export-sidecar-v1.ts';
import { normalizePhotoCatalogQueryV2, photoQueryDigestV2, readPhotoQueryContinuationV2, type PhotoQueryContinuationV2 } from '../../catalog/photo-query-types-v2.ts';
import { projectPhotoQueryRowV2 } from '../../catalog/photo-query-index-v2.ts';
import { photoQueryMatcherV2 } from '../../catalog/photo-query-matcher-v2.ts';
import { readPhotoSavedQueryContinuationV1, type PhotoSavedQueryContinuationV1 } from '../../catalog/photo-smart-collection-query-types-v1.ts';
import { photoSavedDefinitionDigestV1 } from '../../catalog/photo-smart-collection-query-progress-v1.ts';
import { normalizePhotoSmartCollectionV1 } from '../../catalog/photo-smart-collection-v1.ts';
import { photoSummary, readPhotoSummary } from '../../catalog/repository-records.ts';
import { array, field, id, integer, record } from '../../catalog/value-validation.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../../storage/photo-develop-preset-read-v2.ts';
import { readPhotoLibrarySavedContextV1 } from '../photo-library-saved-collection-admission-v1.ts';
import { withPhotoLibraryImageHandoffResourcesForProfileV1 } from './photo-library-image-handoff-kernel-v1.ts';
import type { PhotoLibrarySessionPortsV2 } from '../photo-library-session-ports-v2.ts';

import { normalizePhotoDocumentCurrentV1 } from '../../catalog/photo-document-current-v1.ts';
import { createPhotoResourceReachabilityCurrentV1 } from '../../catalog/photo-resource-reachability-current-v1.ts';
import { createPhotoExportSidecarCurrentV1, parsePhotoExportSidecarCurrentV1, serializePhotoExportSidecarCurrentV1 } from '../../catalog/photo-export-sidecar-current-v1.ts';
import type { PhotoLibrarySessionPortsCurrentV1 } from '../photo-library-session-ports-current-v1.ts';
import { assertPhotoDevelopHandoffMasksForProfileV1 } from './photo-image-handoff-model-kernel-v1.ts';
import { preparePhotoLibraryHandoffRetainedResourcesCurrentV1 } from './photo-library-handoff-retained-resources-current-v1.ts';
import { admitPhotoHdrHandoffWorkCurrentV1, isPhotoHdrHandoffOriginalCurrentV1, PHOTO_HDR_HANDOFF_LIMITS_CURRENT_V1 as HDR_LIMITS } from './photo-hdr-handoff-policy-current-v1.ts';

type Profile = 'legacy2' | 'current3';
type Ports = PhotoLibrarySessionPortsV2 | PhotoLibrarySessionPortsCurrentV1;
type View = PhotoLibraryCollectionHandoffViewV1 | PhotoLibraryCollectionHandoffViewV2;
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }
const LIMITS = Object.freeze({ entries: 4_094, retainedFactsBytes: 2 * 1024 * 1024, uniqueBodyBytes: 128 * 1024 * 1024 });
const bytes = (text: string): number => new TextEncoder().encode(text).byteLength;
const PAGE_FIELDS = ['schemaVersion', 'kind', 'catalogId', 'catalogName', 'totalCount', 'catalogRevision', 'indexRevision', 'items', 'scanned', 'continuation'];
const SAVED_FIELDS = [...PAGE_FIELDS, 'mode', 'collectionId', 'collectionName', 'definitionRevision', 'collectionStateRevision', 'definitionSha256', 'querySha256', 'stackStateRevision'];
type Continuation = PhotoQueryContinuationV2 | PhotoSavedQueryContinuationV1 | null;
type CapturedPhoto = Readonly<{ view: Readonly<PhotoLibraryCollectionHandoffPhotoV1>; fullJson: string;
	storageKey: string; original: ReturnType<typeof normalizePhotoDocumentV1OrV2>['original'] }>;

/** One selected Session operation, never a nested reader or writer lease.
 * Retained canonical root/definition/full Photo facts, projections and resource
 * identity ledger are <=2MiB; one independently admitted Photo/query page is
 * transient. Unique immutable encoded originals plus selected LUT/brush bytes
 * are <=128MiB (each original <=64MiB, each LUT retains its existing <=16MiB
 * admission). <=4094 selected photos+unique resources; no prefix delivery. These are
 * capture-owned limits, not a native heap, generated frame pack or ZIP bound.
 * Current admission seals the combined retained resource ledger before any
 * body. Only selected recipe declarations enter the scoped transport view.
 * Native Query2 order and all empty candidate pages are retained. */
export async function withPhotoLibraryCollectionHandoffForProfileV1<Result>(
	profile: Profile, ports: Ports, catalogId: string, request: Readonly<PhotoLibraryCollectionHandoffRequestV1>,
	consume: (view: Readonly<View>) => Result | Promise<Result>, signal: AbortSignal,
): Promise<Result> {
	if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unsupported fixed collection handoff profile.');
	check(signal);
	if (catalogId !== request.catalogId) throw new Error('Collection handoff selected catalog changed.');
	const backup = ports.backup, load = backup?.loadOriginal, catalog = ports.catalog, loadPhoto = catalog.loadPhoto,
		loadCatalog = catalog.loadCatalog, readQuery = catalog.readQueryPageV2, saved = ports.smartCollections, verify = ports.verifyResources;
	const lutFactory = ports.cubeLutResources, maskFactory = ports.maskRasterResources;
	const resources: Pick<Ports, 'cubeLutResources' | 'maskRasterResources'> = Object.freeze({
		cubeLutResources: typeof lutFactory === 'function' ? () => Reflect.apply(lutFactory, ports, []) : undefined,
		maskRasterResources: typeof maskFactory === 'function' ? () => Reflect.apply(maskFactory, ports, []) : undefined,
	});
	const readSaved = saved?.readSmartCollectionQueryPageV1, readSavedSnapshot = saved?.readSmartCollectionSnapshotV1;
	if (!load || !readQuery || (request.scope === 'saved-query' && (!saved || !readSaved || !readSavedSnapshot))) {
		throw new Error('Collection handoff selected body or query source is unavailable.');
	}
	const initial = await snapshot(), captured: CapturedPhoto[] = [];
	const collector = profile === 'legacy2' ? createPhotoCubeLutClosureV1() : null,
		selected = profile === 'current3' ? createPhotoResourceReachabilityCurrentV1() : null,
		complete = profile === 'current3' ? createPhotoResourceReachabilityCurrentV1() : null;
	let retained = bytes(initial.json) + bytes(initial.definitionJson)
		+ bytes(canonicalPhotoDocumentJsonV1({ query: initial.query, first: initial.first, savedIdentity: initial.savedIdentity })), uniqueBytes = 0;
	const originals = new Map<string, Readonly<{ identity: string; original: CapturedPhoto['original'] }>>();
	const digests = new Map<string, string>();
	await walk(initial, async (summary, ordinal) => {
		if (ordinal >= LIMITS.entries) throw new RangeError('Collection handoff entry capacity exceeded.');
		const photo = await photoFor(summary, initial);
		if (profile === 'legacy2') assertPhotoMaskRasterPortableV1(photo);
		else {
			const admitted = preparePhotoLibraryHandoffRetainedResourcesCurrentV1(photo);
			complete!.addPhoto(admitted.photo);
			assertPhotoDevelopHandoffMasksForProfileV1('current3', photo.versions.find(version => version.id === photo.activeVersionId)!.develop, photo.original.width, photo.original.height);
		}
		const fullJson = canonicalPhotoDocumentJsonV1(photo);
		const binding = Object.freeze({ catalogId, photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision });
		const factsJson = profile === 'legacy2' ? serializePhotoExportSidecarV1(createPhotoExportSidecarV1(photo, binding))
			: serializePhotoExportSidecarCurrentV1(createPhotoExportSidecarCurrentV1(photo, binding)), original = photo.original;
		const view = Object.freeze({ binding, factsJson, original: Object.freeze({ exactName: original.name, contentSha256: original.contentSha256,
			byteLength: original.byteLength, mimeType: original.mimeType, width: original.width, height: original.height, hasAlpha: original.hasAlpha }) });
		retained += bytes(fullJson) + bytes(canonicalPhotoDocumentJsonV1(view));
		if (retained > LIMITS.retainedFactsBytes) throw new RangeError('Collection handoff retained facts capacity exceeded.');
		const identity = canonicalPhotoDocumentJsonV1({ contentSha256: original.contentSha256, byteLength: original.byteLength,
			mimeType: original.mimeType, width: original.width, height: original.height, hasAlpha: original.hasAlpha });
		if (original.byteLength > (profile === 'current3' && isPhotoHdrHandoffOriginalCurrentV1(original) ? HDR_LIMITS.originalBytes : IMAGE_IMPORT_LIMITS.maximumFileInputBytes)) throw new RangeError('Collection handoff original byte capacity exceeded.');
		const previous = originals.get(original.storageKey);
		if (previous && previous.identity !== identity) throw new TypeError('Collection originals disagree about a retained body key.');
		const digestIdentity = digests.get(original.contentSha256);
		if (digestIdentity && digestIdentity !== identity) throw new TypeError('Collection originals disagree about a shared digest.');
		if (!digestIdentity) { uniqueBytes += original.byteLength; digests.set(original.contentSha256, identity);
			retained += bytes(original.contentSha256) + bytes(identity); }
		if (!previous) retained += bytes(original.storageKey) + bytes(identity);
		if (retained > LIMITS.retainedFactsBytes) throw new RangeError('Collection handoff retained identity capacity exceeded.');
		originals.set(original.storageKey, { identity, original });
		const develop = photo.versions.find(version => version.id === photo.activeVersionId)!.develop;
		if (profile === 'legacy2') collector!.addDevelop(develop); else selected!.addDevelop(develop);
		captured.push(Object.freeze({ view, fullJson, storageKey: original.storageKey, original }));
	});
	const references = profile === 'legacy2' ? Object.freeze({ luts: collector!.finish(), brushes: Object.freeze([]) }) : selected!.finish();
	const retainedReferences = complete?.finish(), lutReferences = references.luts;
	retained += bytes(canonicalPhotoDocumentJsonV1(profile === 'legacy2' ? lutReferences : { selected: references, retained: retainedReferences }));
	uniqueBytes += [...lutReferences, ...references.brushes].reduce((total, reference) => total + reference.byteLength, 0);
	const hdr = profile === 'current3' && captured.some(photo => isPhotoHdrHandoffOriginalCurrentV1(photo.original));
	if (retained > LIMITS.retainedFactsBytes || captured.length + lutReferences.length + references.brushes.length > LIMITS.entries || uniqueBytes > (hdr ? HDR_LIMITS.bodyBytes : LIMITS.uniqueBodyBytes)) {
		throw new RangeError('Collection handoff whole resource capacity exceeded.');
	}
	if (hdr) for (const photo of captured) if (isPhotoHdrHandoffOriginalCurrentV1(photo.original)) {
		const facts = parsePhotoExportSidecarCurrentV1(photo.view.factsJson);
		admitPhotoHdrHandoffWorkCurrentV1(facts.version.develop, photo.original.width, photo.original.height, photo.original.byteLength, uniqueBytes);
	}
	if (retainedReferences && (retainedReferences.luts.length || retainedReferences.brushes.length)) {
		if (typeof verify !== 'function') throw new TypeError('Current collection handoff requires independent complete retained-resource verification.');
		for (const expected of captured) {
			check(signal); const photo = await photoForId(expected.view.binding.photoId);
			if (canonicalPhotoDocumentJsonV1(photo) !== expected.fullJson) throw new Error('Collection complete Photo facts changed before resource verification.');
			await Reflect.apply(verify, ports, [photo, signal]); check(signal);
		}
	}
	const blobs = new Map<string, Blob>(), byDigest = new Map<string, Blob>();
	const result = await withPhotoLibraryImageHandoffResourcesForProfileV1(profile, resources, references, signal, async () => {
		for (const [key, entry] of originals) {
			check(signal); const blob = Object.freeze(canonicalMediaContentBlob(await Reflect.apply(load, backup, [entry.original, signal]))); check(signal);
			if (blob.size !== entry.original.byteLength || await digestMediaContent(blob, { signal }) !== entry.original.contentSha256) {
				throw new Error('Collection handoff original body identity changed.');
			}
			check(signal); const same = byDigest.get(entry.original.contentSha256) ?? blob;
			byDigest.set(entry.original.contentSha256, same); blobs.set(key, same);
		}
	}, async readers => {
		await current();
		let accepting = true, reading = false, resourceFailed = false, resourceFailure: unknown, joined: Promise<void> | null = null;
		const withOriginal: PhotoLibraryCollectionHandoffViewV1['withOriginal'] = (value, borrower, options) => {
			try {
				if (!accepting) throw new Error('Collection handoff original capability is closed.');
				check(signal);
				if (profile === 'current3' && reading) throw new Error('A collection original consumer is already pending.');
				const photoId = id(value, 'captured collection photo ID');
				const { signal: caller } = readPhotoDevelopSignalOptionsV2(options ?? {});
				if (caller !== undefined && caller !== signal) throw new TypeError('Collection originals use their captured lifetime signal.');
				const selected = captured.find(photo => photo.view.binding.photoId === photoId);
				if (!selected || typeof borrower !== 'function') throw new TypeError('Collection handoff original requires its selected photo and callable consumer.');
				if (reading) throw new Error('A collection original consumer is already pending.');
				reading = true;
				const work = (async () => { check(signal); const answer = await borrower(blobs.get(selected.storageKey)!); check(signal); return answer; })();
				joined = work.then(() => { reading = false; }, error => { reading = false; if (!resourceFailed) { resourceFailed = true; resourceFailure = error; } });
				return work;
			} catch (error) { return Promise.reject(error); }
		};
		const scopedLut: PhotoLibraryCollectionHandoffViewV1['withLutBytes'] = (...args) => {
			if (!accepting) return Promise.reject(new Error('Collection handoff resource capability is closed.'));
			return readers.withLutBytes(...args);
		};
		const scopedMask: PhotoLibraryCollectionHandoffViewV2['withMaskRasterBytes'] = (...args) => {
			if (!accepting) return Promise.reject(new Error('Collection handoff resource capability is closed.'));
			return readers.withMaskRasterBytes(...args);
		};
		let answer!: Result, failed = false, primary: unknown;
		try {
			const common = { signal, collection: Object.freeze({ catalogId, id: request.collectionId,
				scope: request.scope, name: initial.name, catalogRevision: initial.root.revision, indexRevision: initial.indexRevision,
				definitionRevision: initial.definitionRevision, definitionJson: initial.definitionJson }),
				photos: Object.freeze(captured.map(photo => photo.view)), lutReferences, withOriginal, withLutBytes: scopedLut };
			answer = await consume(profile === 'legacy2' ? Object.freeze({ schemaVersion: 1, ...common })
				: Object.freeze({ schemaVersion: 2, ...common, maskRasterReferences: references.brushes, withMaskRasterBytes: scopedMask }));
		} catch (error) { failed = true; primary = error; }
		accepting = false; await joined;
		if (failed) {
			if (resourceFailed && resourceFailure !== primary) throw new AggregateError([primary, resourceFailure], 'Collection consumer and original borrower failed.', { cause: primary });
			throw primary;
		}
		if (resourceFailed) throw resourceFailure;
		return answer;
	});
	check(signal); await current(); return result;

	async function snapshot() {
		check(signal); const raw = await Reflect.apply(loadCatalog, catalog, [catalogId]); check(signal);
		if (!raw) throw new ReferenceError('Collection handoff catalog is missing.');
		const root = normalizePhotoCatalogRootV1(raw);
		if (root.id !== catalogId || root.revision !== request.expectedCatalogRevision) throw new Error('Collection handoff catalog changed.');
		if (request.scope === 'catalog') {
			const definition = root.collections.find(item => item.id === request.collectionId);
			if (!definition) throw new ReferenceError('Collection handoff root definition is missing.');
			const query = normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query', filter: { kind: 'collection', id: definition.id } });
			// The ordinary page atomically supplies the current index revision.
			const first = await readPage(query, root, null); check(signal);
			return { root, query, first, matches: photoQueryMatcherV2(root, query), name: definition.name, definitionRevision: null, definitionJson: canonicalPhotoDocumentJsonV1(definition),
				indexRevision: first.indexRevision, savedIdentity: null, json: canonicalPhotoDocumentJsonV1({ root, indexRevision: first.indexRevision, definition }) };
		}
		const input = record(await Reflect.apply(readSavedSnapshot!, saved!, [catalogId, request.collectionId, { signal }]),
			'collection handoff saved snapshot', ['schemaVersion', 'kind', 'selectedId', 'context', 'definition']); check(signal);
		if (field(input, 'schemaVersion') !== 1 || field(input, 'kind') !== 'photo-smart-collection-snapshot' || field(input, 'selectedId') !== request.collectionId) throw new TypeError('Collection handoff saved snapshot selection differs.');
		const context = readPhotoLibrarySavedContextV1(field(input, 'context')), definition = normalizePhotoSmartCollectionV1(field(input, 'definition'));
		if (context.catalogId !== catalogId || context.catalogRevision !== root.revision || context.collectionCount < 1
			|| definition.id !== request.collectionId || definition.catalogId !== catalogId || definition.revision !== request.expectedDefinitionRevision) throw new Error('Collection handoff saved definition changed.');
		const savedIdentity = { definitionSha256: photoSavedDefinitionDigestV1(definition), querySha256: photoQueryDigestV2(definition.query),
			definitionRevision: definition.revision, collectionStateRevision: context.collectionStateRevision };
		const first = await readPage(definition.query, root, null, savedIdentity); check(signal);
		if (first.indexRevision !== context.indexRevision) throw new Error('Collection handoff saved index changed.');
		return { root, query: definition.query, first, matches: photoQueryMatcherV2(root, definition.query), name: definition.name, definitionRevision: definition.revision,
			definitionJson: canonicalPhotoDocumentJsonV1(definition), indexRevision: context.indexRevision, savedIdentity,
			json: canonicalPhotoDocumentJsonV1({ root, context, definition }) };
	}
	async function readPage(query: ReturnType<typeof normalizePhotoCatalogQueryV2>, root: ReturnType<typeof normalizePhotoCatalogRootV1>, continuation: Continuation,
		savedIdentity: Readonly<{ definitionSha256: string; querySha256: string; definitionRevision: number; collectionStateRevision: number }> | null = null) {
		check(signal);
		const raw = savedIdentity === null ? await Reflect.apply(readQuery!, catalog, [catalogId, { query, continuation, signal }])
			: await Reflect.apply(readSaved!, saved!, [catalogId, request.collectionId, { continuation, signal }]); check(signal);
		const input = record(raw, 'collection handoff native page', savedIdentity === null ? PAGE_FIELDS : SAVED_FIELDS);
		if (field(input, 'schemaVersion') !== (savedIdentity === null ? 2 : 1) || field(input, 'kind') !== (savedIdentity === null ? 'photo-query-page' : 'saved-photo-query-page')
			|| field(input, 'catalogId') !== catalogId || field(input, 'catalogRevision') !== root.revision || field(input, 'catalogName') !== root.name
			|| field(input, 'totalCount') !== root.photoCount) throw new TypeError('Collection handoff page catalog differs.');
		const indexRevision = integer(field(input, 'indexRevision'), 0, Number.MAX_SAFE_INTEGER, 'collection index revision');
		const scanned = integer(field(input, 'scanned'), 0, 64, 'collection candidate count');
		const items = array(field(input, 'items'), 'collection candidate summaries', 0, 64).map(readPhotoSummary);
		if (items.length > scanned || items.some(item => item.catalogId !== catalogId) || new Set(items.map(item => item.photoId)).size !== items.length) throw new TypeError('Collection page summaries disagree.');
		if (savedIdentity !== null) {
			if (field(input, 'mode') !== 'ordinary' || field(input, 'collectionId') !== request.collectionId || field(input, 'stackStateRevision') !== null) throw new TypeError('Collection handoff requires its ordinary saved query.');
			for (const [key, value] of Object.entries(savedIdentity)) if (field(input, key) !== value) throw new Error('Collection handoff saved page definition changed.');
		}
		const nextValue = field(input, 'continuation');
		const next = nextValue === null ? null : savedIdentity === null ? readPhotoQueryContinuationV2(nextValue, catalogId, query)
			: readPhotoSavedQueryContinuationV1(nextValue, catalogId, request.collectionId, 'ordinary');
		for (const cursor of [continuation, next]) if (cursor !== null) {
			if (cursor.catalogRevision !== root.revision || cursor.indexRevision !== indexRevision || cursor.querySha256 !== photoQueryDigestV2(query)) throw new Error('Collection handoff query cursor changed.');
			if (savedIdentity !== null) for (const [key, value] of Object.entries(savedIdentity)) if (Object.getOwnPropertyDescriptor(cursor, key)?.value !== value) throw new Error('Collection handoff saved cursor changed.');
		}
		return { items, scanned, continuation: next, indexRevision };
	}
	async function walk(context: Awaited<ReturnType<typeof snapshot>>, receive: (summary: ReturnType<typeof readPhotoSummary>, ordinal: number) => Promise<void>) {
		let page = context.first, ordinal = 0, scanned = 0, pages = 0; const ids = new Set<string>();
		for (;;) {
			check(signal); scanned += page.scanned; pages++;
			if (scanned > context.root.photoCount || pages > Math.ceil(context.root.photoCount / 64) + 3 || page.indexRevision !== context.indexRevision) throw new Error('Collection query traversal changed or exceeded its bounded candidates.');
			for (const summary of page.items) {
				if (ids.has(summary.photoId)) throw new TypeError('Collection query repeated a selected photo.'); ids.add(summary.photoId);
				await receive(summary, ordinal++); check(signal);
			}
			if (page.continuation === null) break;
			await new Promise<void>(resolve => setTimeout(resolve, 0)); check(signal);
			const next = await readPage(context.query, context.root, page.continuation, context.savedIdentity);
			if (next.continuation !== null && JSON.stringify(next.continuation) === JSON.stringify(page.continuation)) throw new Error('Collection query continuation made no progress.');
			page = next;
		}
		return ordinal;
	}
	async function photoFor(summary: ReturnType<typeof readPhotoSummary>, context: Awaited<ReturnType<typeof snapshot>>) {
		const photo = await photoForId(summary.photoId);
		if (photo.catalogId !== catalogId || canonicalPhotoDocumentJsonV1(photoSummary(photo)) !== canonicalPhotoDocumentJsonV1(summary)
			|| !context.matches(projectPhotoQueryRowV2(photo))) throw new Error('Collection summary, definition membership or complete Photo facts changed.');
		return photo;
	}
	async function photoForId(photoId: string) {
		check(signal); const raw = await Reflect.apply(loadPhoto, catalog, [catalogId, photoId]); check(signal);
		if (!raw) throw new ReferenceError('A selected collection photo is missing.');
		try { const photo = profile === 'legacy2' ? normalizePhotoDocumentV1OrV2(raw) : normalizePhotoDocumentCurrentV1(raw); check(signal); return photo; }
		catch (error) { check(signal); throw error; }
	}
	async function current(): Promise<void> {
		const context = await snapshot(); if (context.json !== initial.json) throw new Error('Collection complete definition or root/index changed.');
		const count = await walk(context, async (summary, ordinal) => {
			const expected = captured[ordinal], photo = await photoFor(summary, context);
			if (!expected || expected.view.binding.photoId !== photo.id || canonicalPhotoDocumentJsonV1(photo) !== expected.fullJson) throw new Error('Collection ordered membership or complete Photo facts changed.');
		});
		if (count !== captured.length) throw new Error('Collection complete membership changed.'); check(signal);
	}
}
