/* SPDX-License-Identifier: AGPL-3.0-only */

import { PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND } from '../../common/editor/scape-photo-develop-preset-pack.ts';
import { PHOTO_DEVELOP_PRESET_PACK_ENCODING_V3 } from '../../common/editor/scape-photo-catalog-pack-v4.ts';
import { PHOTO_DEVELOP_PRESET_PACK_ENCODING_V4 } from '../../common/editor/scape-photo-develop-preset-pack-v4.ts';
import { PHOTO_DEVELOP_PRESET_PACK_ENCODING_V2 } from '../../common/editor/scape-photo-catalog-pack-v2.ts';
import { PHOTO_CUBE_LUT_ASSET_KIND, PHOTO_CUBE_LUT_ENCODING } from '../../common/editor/scape-photo-cube-lut.ts';
import { readValidatedPhotoCatalogRootV1 } from '../catalog/documents.ts';
import { readClosedDomainRecord as record, readClosedDomainField as field } from '../../common/editor/closed-domain-value.ts';
import { normalizePhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import { normalizePhotoDocumentThroughV3 } from '../catalog/photo-document-through-v3.ts';
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
import { normalizePhotoDevelopPresetRowCurrentV1 } from '../storage/photo-develop-preset-row-current-v1.ts';
import { normalizePhotoDevelopPresetRowCurrentForProfileV1 } from '../storage/internal/photo-develop-preset-row-kernel-v1.ts';
import { createPhotoCatalogArchiveReachabilityCurrentV1 } from './catalog-archive-reachability-current-v1.ts';
import { normalizePhotoDevelopPresetRowV1OrV2 } from '../storage/photo-develop-preset-row-v2.ts';
import { PhotoCatalogArchiveIdentityGuard } from './catalog-archive-contract.ts';
import { normalizePhotoCatalogArchiveForVersion, serializePhotoCatalogArchiveForVersion,
	type PhotoCatalogArchiveDocumentForVersion, type PhotoCatalogArchiveDevelopPresetPackForVersion } from './catalog-archive-contract-kernel-v1.ts';
import { PhotoCatalogArchiveIdentityLedger } from './catalog-archive-identities.ts';
import { createPhotoCatalogCompanionWriter } from './catalog-archive-companion-packs.ts';
import { writePhotoCatalogArchiveV7 } from './catalog-archive-writer-v7.ts';
import { writePhotoCatalogArchiveV8 } from './catalog-archive-writer-v8.ts';
import type { PhotoCatalogArchivePrepare } from './catalog-archive-writer-kernel.ts';
import { writePhotoCatalogArchiveV6, type PhotoCatalogArchiveWrittenResult } from './catalog-archive-writer-v6.ts';
import type { PhotoCatalogArchiveExportOptionsV3 } from './catalog-archive-export-v3.ts';
import type { PhotoCatalogPackInputV4 } from './catalog-pack-v4.ts';
import type { PhotoCatalogPackInputCurrentV1 } from './catalog-pack-current-v1.ts';
import type { PhotoCatalogPackInputV2 } from './catalog-pack-v2.ts';
import { encodePhotoDevelopPresetPackV3 } from './develop-preset-pack-v3.ts';
import { encodePhotoDevelopPresetPackV4 } from './develop-preset-pack-v4.ts';
import { encodePhotoDevelopPresetPackV2 } from './develop-preset-pack-v2.ts';
import { borrowPhotoCubeLutArchiveSourceV1, type PhotoCubeLutArchiveSourceV1 } from './cube-lut-archive-source-v1.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;

/** Complete admitted Photo/preset closure, then serial exact body publication.
 * Originals, stacks and saved collections retain their existing authorities.
 * Scalar identities survive enumeration; no full photo list or body cache. */
export async function exportPhotoCatalogArchiveForVersion<Version extends 6 | 7 | 8>(version: Version, rootValue: unknown,
	photos: Iterable<PhotoCatalogPackInputCurrentV1> | AsyncIterable<PhotoCatalogPackInputCurrentV1>,
	stacks: Iterable<PhotoStackV1> | AsyncIterable<PhotoStackV1>, stateValue: unknown,
	definitions: Iterable<PhotoSmartCollectionV1> | AsyncIterable<PhotoSmartCollectionV1>, rowValue: unknown,
	lutSource: PhotoCubeLutArchiveSourceV1 | undefined, maskSource: MaskRasterSourcePortV1 | undefined, options: PhotoCatalogArchiveExportOptionsV3 = {}): Promise<PhotoCatalogArchiveWrittenResult<PhotoCatalogArchiveDocumentForVersion<Version>>> {
	if (version !== 6 && version !== 7 && version !== 8) throw new RangeError('Unsupported fixed archive export version.');
	const root = readValidatedPhotoCatalogRootV1(rootValue), signal = options.signal;
	const state = stateValue === null ? null : normalizePhotoSmartCollectionsStateV1(stateValue);
	const row = rowValue === null ? null : version === 8 ? normalizePhotoDevelopPresetRowCurrentV1(rowValue, root.id)
		: version === 7 ? normalizePhotoDevelopPresetRowCurrentForProfileV1('current3', rowValue, root.id) : normalizePhotoDevelopPresetRowV1OrV2(rowValue, root.id);
	const readBody = borrowPhotoCubeLutArchiveSourceV1(lutSource, signal), readMask = borrowPhotoMaskRasterArchiveSourceV1(maskSource, signal);
	const verifySource = options.verifySource;
	if (verifySource !== undefined && typeof verifySource !== 'function') throw new TypeError('A source verification callback is required.');
	const verify = () => verifySource === undefined ? Promise.resolve() : Reflect.apply(verifySource, options, []);
	const reachability = createPhotoCubeLutReachabilityV1(), masks = createPhotoMaskRasterReachabilityV1();
	const current = version >= 7 ? createPhotoCatalogArchiveReachabilityCurrentV1() : undefined;
	if (row && current) current.addPresetRow(row, root.id);
	else for (const preset of row?.presets ?? []) { reachability.addPreset(preset); masks.addPreset(preset); }
	const identity = new PhotoCatalogArchiveIdentityLedger();
	const writeCompanions = createPhotoCatalogCompanionWriter(root, stacks, state, definitions, identity, signal);
	const records = portableRecords(photos, photo => { if (current) current.addPhoto(photo); else { masks.addPhoto(photo); reachability.addPhoto(photo); } }, signal, version);
	const prepare: PhotoCatalogArchivePrepare<PhotoCatalogArchiveDocumentForVersion<Version>, Version> = async (packs, writer) => {
		const companions = await writeCompanions(writer);
		let developPresetPack: PhotoCatalogArchiveDevelopPresetPackForVersion<Version> | null = null;
		if (row) {
			developPresetPack = Object.freeze({ id: 'develop-presets', entry: (version === 8 ? 'assets/develop-presets-v4.bin' : version === 7 ? 'assets/develop-presets-v3.bin' : 'assets/develop-presets-v2.bin') as PhotoCatalogArchiveDevelopPresetPackForVersion<Version>['entry'], rowSchemaVersion: row.schemaVersion as PhotoCatalogArchiveDevelopPresetPackForVersion<Version>['rowSchemaVersion'],
				revision: row.revision, presetCount: row.presets.length });
			await writer.addPack({ sourceId: developPresetPack.id, entry: developPresetPack.entry, kind: PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND,
				encoding: version === 8 ? PHOTO_DEVELOP_PRESET_PACK_ENCODING_V4 : version === 7 ? PHOTO_DEVELOP_PRESET_PACK_ENCODING_V3 : PHOTO_DEVELOP_PRESET_PACK_ENCODING_V2 },
				(version === 8 ? encodePhotoDevelopPresetPackV4 : version === 7 ? encodePhotoDevelopPresetPackV3 : encodePhotoDevelopPresetPackV2)(row, root.id, { signal }));
		}
		const references = current?.finish();
		const lutResources = (references?.luts ?? reachability.finish()).map(reference => Object.freeze({ id: reference.storageKey, entry: `assets/luts/${reference.sha256}.cube`, reference }));
		const maskRasters = (references?.brushes ?? masks.finish()).map(reference => Object.freeze({ id: reference.storageKey, entry: `assets/masks/${reference.sha256}.scmask`, reference }));
		// Admit the complete combined entry/identity budget before any resource body acquisition.
		const document = normalizePhotoCatalogArchiveForVersion(version, { schemaFamily: 'lightscaper', schemaVersion: version, kind: 'photo-catalog-archive',
			id: root.id, title: root.name, catalog: root, packs, ...companions, developPresetPack, lutResources, maskRasters });
		for (const resource of document.lutResources) await readBody(resource.reference, async bytes => {
			async function* chunks() { for (let offset = 0; offset < bytes.byteLength; offset += 65_536) yield bytes.subarray(offset, offset + 65_536); }
			await writer.addPack({ sourceId: resource.id, entry: resource.entry, kind: PHOTO_CUBE_LUT_ASSET_KIND, encoding: PHOTO_CUBE_LUT_ENCODING }, chunks());
		});
		for (const resource of document.maskRasters) await readMask(resource.reference, async bytes => {
			async function* chunks() { for (let offset = 0; offset < bytes.byteLength; offset += 65_536) yield bytes.subarray(offset, offset + 65_536); }
			await writer.addPack({ sourceId: resource.id, entry: resource.entry, kind: PHOTO_MASK_RASTER_ASSET_KIND_V1, encoding: PHOTO_MASK_RASTER_ENCODING_V1 }, chunks());
		});
		return { document, text: serializePhotoCatalogArchiveForVersion(version, document), schemaVersion: version, async beforeFinish() {
			for (const resource of document.lutResources) await readBody(resource.reference, async () => undefined);
			for (const resource of document.maskRasters) await readMask(resource.reference, async () => undefined);
			// Saved inventory verification is one-shot. Run its complete source fence
			// after every held resource reread and immediately before destination Close.
			await verify();
		} };
	};
	const guard = new PhotoCatalogArchiveIdentityGuard(root, identity);
	if (version === 8) return writePhotoCatalogArchiveV8(root, records, guard, prepare as PhotoCatalogArchivePrepare<PhotoCatalogArchiveDocumentForVersion<Version>, 8>, options);
	if (version === 7) return writePhotoCatalogArchiveV7(root, records as AsyncIterable<PhotoCatalogPackInputV4>, guard, prepare as PhotoCatalogArchivePrepare<PhotoCatalogArchiveDocumentForVersion<Version>, 7>, options);
	return writePhotoCatalogArchiveV6(root, records as AsyncIterable<PhotoCatalogPackInputV2>, guard, prepare as PhotoCatalogArchivePrepare<PhotoCatalogArchiveDocumentForVersion<Version>, 6>, options);
}

/** A mapping iterator owns upstream retirement even when metadata refusal
 * precedes the first original. Pin methods/receiver before any asynchronous
 * demand and join the actual return outcome, retaining distinct opaque errors. */
function portableRecords(photos: Iterable<PhotoCatalogPackInputCurrentV1> | AsyncIterable<PhotoCatalogPackInputCurrentV1>,
	admit: (photo: PhotoCatalogPackInputCurrentV1['photo']) => void, signal: AbortSignal | undefined, version: 6 | 7 | 8): AsyncIterable<PhotoCatalogPackInputCurrentV1> {
	// The writer's synchronous signal admission still precedes source opening.
	return Object.freeze({ [Symbol.asyncIterator]() {
		const iterate = Symbol.asyncIterator in photos ? photos[Symbol.asyncIterator] : photos[Symbol.iterator];
		if (typeof iterate !== 'function') throw new TypeError('A photo archive iterator is required.');
		const owner = Reflect.apply(iterate, photos, []) as AsyncIterator<PhotoCatalogPackInputCurrentV1> | Iterator<PhotoCatalogPackInputCurrentV1>;
		const next = owner.next, leave = owner.return;
		if (typeof next !== 'function' || leave !== undefined && typeof leave !== 'function') throw new TypeError('A photo archive iterator is incomplete.');
		const done = Object.freeze({ done: true as const, value: undefined });
		let retired = false, failureOwnsRetirement = false, retiring: Promise<IteratorResult<PhotoCatalogPackInputCurrentV1>> | undefined;
		function retire(): Promise<IteratorResult<PhotoCatalogPackInputCurrentV1>> {
			// A failed next already joined and retained return's failure. Sequence
			// Close must not report that same cleanup failure a second time.
			if (failureOwnsRetirement || retired && retiring === undefined) return Promise.resolve(done);
			retired = true;
			retiring ??= Promise.resolve().then(async () => { if (leave !== undefined) await Reflect.apply(leave, owner, []); return done; });
			return retiring;
		}
		const iterator: AsyncIterator<PhotoCatalogPackInputCurrentV1> = Object.freeze({ async next(): Promise<IteratorResult<PhotoCatalogPackInputCurrentV1>> {
			if (retired) return done;
			let primary: unknown;
			try {
				if (signal !== undefined) Reflect.apply(CHECK, signal, []);
				const result = await Reflect.apply(next, owner, []) as IteratorResult<PhotoCatalogPackInputCurrentV1>;
				if (signal !== undefined) Reflect.apply(CHECK, signal, []);
				if (result.done) { retired = true; return done; }
				const input = record(result.value, 'photo archive input', ['photo', 'original']);
				const value = field(input, 'photo', 'photo archive input');
				const photo = version === 8 ? normalizePhotoDocumentCurrentV1(value) : version === 7 ? normalizePhotoDocumentThroughV3(value) : normalizePhotoDocumentV1OrV2(value);
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
