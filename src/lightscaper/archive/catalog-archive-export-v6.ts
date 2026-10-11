/* SPDX-License-Identifier: AGPL-3.0-only */

import { PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND } from '../../common/editor/scape-photo-develop-preset-pack.ts';
import { PHOTO_DEVELOP_PRESET_PACK_ENCODING_V2 } from '../../common/editor/scape-photo-catalog-pack-v2.ts';
import { PHOTO_CUBE_LUT_ASSET_KIND, PHOTO_CUBE_LUT_ENCODING } from '../../common/editor/scape-photo-cube-lut.ts';
import { readValidatedPhotoCatalogRootV1 } from '../catalog/documents.ts';
import { readClosedDomainRecord as record, readClosedDomainField as field } from '../../common/editor/closed-domain-value.ts';
import { normalizePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
import { createPhotoMaskRasterReachabilityV1 } from '../catalog/photo-mask-raster-reachability-v1.ts';
import type { MaskRasterSourcePortV1 } from '../../common/editor/imaging/mask-raster-source-port-v1.ts';
import { PHOTO_MASK_RASTER_ASSET_KIND_V1, PHOTO_MASK_RASTER_ENCODING_V1 } from '../../common/editor/scape-photo-mask-raster-v1.ts';
import { borrowPhotoMaskRasterArchiveSourceV1 } from './mask-raster-archive-source-v1.ts';
import { canonicalMediaContentBlob } from '../../common/editor/storage/media-content-digest.ts';
import { createPhotoCubeLutReachabilityV1 } from '../catalog/photo-cube-lut-reachability-v1.ts';
import { normalizePhotoSmartCollectionsStateV1 } from '../catalog/photo-smart-collection-state-v1.ts';
import type { PhotoSmartCollectionV1 } from '../catalog/photo-smart-collection-v1.ts';
import type { PhotoStackV1 } from '../catalog/photo-stack-v1.ts';
import { normalizePhotoDevelopPresetRowV1OrV2 } from '../storage/photo-develop-preset-row-v2.ts';
import { PhotoCatalogArchiveIdentityGuard } from './catalog-archive-contract.ts';
import { normalizePhotoCatalogArchiveV6, serializePhotoCatalogArchiveV6,
	type PhotoCatalogArchiveDocumentV6, type PhotoCatalogArchiveDevelopPresetPackV6 } from './catalog-archive-contract-v6.ts';
import { PhotoCatalogArchiveIdentityLedger } from './catalog-archive-identities.ts';
import { createPhotoCatalogCompanionWriter } from './catalog-archive-companion-packs.ts';
import { writePhotoCatalogArchiveV6, type PhotoCatalogArchiveWrittenResult } from './catalog-archive-writer-v6.ts';
import type { PhotoCatalogArchiveExportOptionsV3 } from './catalog-archive-export-v3.ts';
import type { PhotoCatalogPackInputV2 } from './catalog-pack-v2.ts';
import { encodePhotoDevelopPresetPackV2 } from './develop-preset-pack-v2.ts';
import { borrowPhotoCubeLutArchiveSourceV1, type PhotoCubeLutArchiveSourceV1 } from './cube-lut-archive-source-v1.ts';

export type PhotoCatalogArchiveExportResultV6 = PhotoCatalogArchiveWrittenResult<PhotoCatalogArchiveDocumentV6>;
const CHECK = AbortSignal.prototype.throwIfAborted;

/** Complete admitted Photo/preset closure, then serial exact body publication.
 * Originals, stacks and saved collections retain their existing authorities.
 * Scalar identities survive enumeration; no full photo list or body cache. */
export async function exportPhotoCatalogArchiveV6(rootValue: unknown,
	photos: Iterable<PhotoCatalogPackInputV2> | AsyncIterable<PhotoCatalogPackInputV2>,
	stacks: Iterable<PhotoStackV1> | AsyncIterable<PhotoStackV1>, stateValue: unknown,
	definitions: Iterable<PhotoSmartCollectionV1> | AsyncIterable<PhotoSmartCollectionV1>, rowValue: unknown,
	lutSource: PhotoCubeLutArchiveSourceV1 | undefined, maskSource: MaskRasterSourcePortV1 | undefined, options: PhotoCatalogArchiveExportOptionsV3 = {}): Promise<PhotoCatalogArchiveExportResultV6> {
	const root = readValidatedPhotoCatalogRootV1(rootValue), signal = options.signal;
	const state = stateValue === null ? null : normalizePhotoSmartCollectionsStateV1(stateValue);
	const row = rowValue === null ? null : normalizePhotoDevelopPresetRowV1OrV2(rowValue, root.id);
	const readBody = borrowPhotoCubeLutArchiveSourceV1(lutSource, signal), readMask = borrowPhotoMaskRasterArchiveSourceV1(maskSource, signal);
	const verifySource = options.verifySource;
	if (verifySource !== undefined && typeof verifySource !== 'function') throw new TypeError('A source verification callback is required.');
	const verify = () => verifySource === undefined ? Promise.resolve() : Reflect.apply(verifySource, options, []);
	const reachability = createPhotoCubeLutReachabilityV1(), masks = createPhotoMaskRasterReachabilityV1();
	for (const preset of row?.presets ?? []) { reachability.addPreset(preset); masks.addPreset(preset); }
	const identity = new PhotoCatalogArchiveIdentityLedger();
	const writeCompanions = createPhotoCatalogCompanionWriter(root, stacks, state, definitions, identity, signal);
	const records = portableRecords(photos, photo => { masks.addPhoto(photo); reachability.addPhoto(photo); }, signal);
	return writePhotoCatalogArchiveV6(root, records, new PhotoCatalogArchiveIdentityGuard(root, identity), async (packs, writer) => {
		const companions = await writeCompanions(writer);
		let developPresetPack: PhotoCatalogArchiveDevelopPresetPackV6 | null = null;
		if (row) {
			developPresetPack = Object.freeze({ id: 'develop-presets', entry: 'assets/develop-presets-v2.bin', rowSchemaVersion: row.schemaVersion,
				revision: row.revision, presetCount: row.presets.length });
			await writer.addPack({ sourceId: developPresetPack.id, entry: developPresetPack.entry, kind: PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND,
				encoding: PHOTO_DEVELOP_PRESET_PACK_ENCODING_V2 }, encodePhotoDevelopPresetPackV2(row, root.id, { signal }));
		}
		const lutResources = reachability.finish().map(reference => Object.freeze({ id: reference.storageKey, entry: `assets/luts/${reference.sha256}.cube`, reference }));
		const maskRasters = masks.finish().map(reference => Object.freeze({ id: reference.storageKey, entry: `assets/masks/${reference.sha256}.scmask`, reference }));
		// Admit the complete combined entry/identity budget before any resource body acquisition.
		const document = normalizePhotoCatalogArchiveV6({ schemaFamily: 'lightscaper', schemaVersion: 6, kind: 'photo-catalog-archive',
			id: root.id, title: root.name, catalog: root, packs, ...companions, developPresetPack, lutResources, maskRasters });
		for (const resource of document.lutResources) await readBody(resource.reference, async bytes => {
			async function* chunks() { for (let offset = 0; offset < bytes.byteLength; offset += 65_536) yield bytes.subarray(offset, offset + 65_536); }
			await writer.addPack({ sourceId: resource.id, entry: resource.entry, kind: PHOTO_CUBE_LUT_ASSET_KIND, encoding: PHOTO_CUBE_LUT_ENCODING }, chunks());
		});
		for (const resource of document.maskRasters) await readMask(resource.reference, async bytes => {
			async function* chunks() { for (let offset = 0; offset < bytes.byteLength; offset += 65_536) yield bytes.subarray(offset, offset + 65_536); }
			await writer.addPack({ sourceId: resource.id, entry: resource.entry, kind: PHOTO_MASK_RASTER_ASSET_KIND_V1, encoding: PHOTO_MASK_RASTER_ENCODING_V1 }, chunks());
		});
		return { document, text: serializePhotoCatalogArchiveV6(document), schemaVersion: 6, async beforeFinish() {
			for (const resource of document.lutResources) await readBody(resource.reference, async () => undefined);
			for (const resource of document.maskRasters) await readMask(resource.reference, async () => undefined);
			// Saved inventory verification is one-shot. Run its complete source fence
			// after every held resource reread and immediately before destination Close.
			await verify();
		} };
	}, options);
}

/** A mapping iterator owns upstream retirement even when metadata refusal
 * precedes the first original. Pin methods/receiver before any asynchronous
 * demand and join the actual return outcome, retaining distinct opaque errors. */
function portableRecords(photos: Iterable<PhotoCatalogPackInputV2> | AsyncIterable<PhotoCatalogPackInputV2>,
	admit: (photo: PhotoCatalogPackInputV2['photo']) => void, signal?: AbortSignal): AsyncIterable<PhotoCatalogPackInputV2> {
	// The writer's synchronous signal admission still precedes source opening.
	return Object.freeze({ [Symbol.asyncIterator]() {
		const iterate = Symbol.asyncIterator in photos ? photos[Symbol.asyncIterator] : photos[Symbol.iterator];
		if (typeof iterate !== 'function') throw new TypeError('A photo archive iterator is required.');
		const owner = Reflect.apply(iterate, photos, []) as AsyncIterator<PhotoCatalogPackInputV2> | Iterator<PhotoCatalogPackInputV2>;
		const next = owner.next, leave = owner.return;
		if (typeof next !== 'function' || leave !== undefined && typeof leave !== 'function') throw new TypeError('A photo archive iterator is incomplete.');
		const done = Object.freeze({ done: true as const, value: undefined });
		let retired = false, failureOwnsRetirement = false, retiring: Promise<IteratorResult<PhotoCatalogPackInputV2>> | undefined;
		function retire(): Promise<IteratorResult<PhotoCatalogPackInputV2>> {
			// A failed next already joined and retained return's failure. Sequence
			// Close must not report that same cleanup failure a second time.
			if (failureOwnsRetirement || retired && retiring === undefined) return Promise.resolve(done);
			retired = true;
			retiring ??= Promise.resolve().then(async () => { if (leave !== undefined) await Reflect.apply(leave, owner, []); return done; });
			return retiring;
		}
		const iterator: AsyncIterator<PhotoCatalogPackInputV2> = Object.freeze({ async next(): Promise<IteratorResult<PhotoCatalogPackInputV2>> {
			if (retired) return done;
			let primary: unknown;
			try {
				if (signal !== undefined) Reflect.apply(CHECK, signal, []);
				const result = await Reflect.apply(next, owner, []) as IteratorResult<PhotoCatalogPackInputV2>;
				if (signal !== undefined) Reflect.apply(CHECK, signal, []);
				if (result.done) { retired = true; return done; }
				const input = record(result.value, 'photo archive input', ['photo', 'original']);
				const photo = normalizePhotoDocumentV1OrV2(field(input, 'photo', 'photo archive input'));
				admit(photo);
				const original = canonicalMediaContentBlob(field(input, 'original', 'photo archive input'));
				return { done: false, value: { photo, original } };
			} catch (error) { primary = error; }
			let cleanup: unknown, cleanupFailed = false;
			try { await retire(); } catch (error) { cleanup = error; cleanupFailed = true; }
			failureOwnsRetirement = true;
			if (cleanupFailed && !Object.is(primary, cleanup)) throw new AggregateError([primary, cleanup], 'Photo archive metadata and source retirement both failed.', { cause: primary });
			throw primary;
		}, return: retire });
		return iterator;
	} });
}
