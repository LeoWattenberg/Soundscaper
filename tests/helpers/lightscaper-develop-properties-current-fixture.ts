/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { normalizeImageDevelopStateV3 } from '../../src/common/editor/imaging/image-develop-state-v3.ts';
import type { ImageDevelopStateThroughV4 } from '../../src/common/editor/imaging/image-develop-state-v4.ts';
import type { BrushMaskResourceReferenceV1 } from '../../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { VideoCubeLutReferenceV1 } from '../../src/common/editor/video-color-cube-lut-v27.ts';
import { createVideoEffectV2 } from '../../src/common/editor/video-effects-v2.ts';
import { createPhotoLibrarySessionCurrentV1 } from '../../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { PhotoCommandOwnerCurrentV1 } from '../../src/lightscaper/controller/photo-command-owner-current-v1.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { verifyPhotoResourcesCurrentV1 } from '../../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import type { PhotoLibraryDevelopCommandCurrentV1 } from '../../src/common/editor/photo-library-develop-port-current-v1.ts';
import { repairPresetsFixture } from './lightscaper-repair-presets-current-fixture.ts';
import { LUT_BODY } from './lightscaper-lut-archive-fixture.ts';

export const GENERATED_CURRENT_TIME = '2026-10-15T00:00:00.000Z';
export interface GeneratedDevelopSpecCurrentV1 {
	readonly exposure: number; readonly temperature: number; readonly saturation: number;
	readonly target: number; readonly source: number; readonly radius: number; readonly feather: number; readonly opacity: number;
	readonly mode: 'clone' | 'heal'; readonly enabled: boolean; readonly flip: boolean; readonly rotation: number;
	readonly operation: 'union' | 'subtract' | 'intersect'; readonly inverted: boolean; readonly name: string;
}
export const generatedDevelopSpecCurrentV1: fc.Arbitrary<GeneratedDevelopSpecCurrentV1> = fc.record({
	exposure: fc.integer({ min: -24, max: 24 }), temperature: fc.integer({ min: -80, max: 80 }), saturation: fc.integer({ min: -70, max: 70 }),
	target: fc.integer({ min: 0, max: 8 }), source: fc.integer({ min: 0, max: 8 }), radius: fc.integer({ min: 1, max: 4 }),
	feather: fc.integer({ min: 0, max: 8 }), opacity: fc.integer({ min: 0, max: 8 }), mode: fc.constantFrom('clone', 'heal'),
	enabled: fc.boolean(), flip: fc.boolean(), rotation: fc.constantFrom(0, 90, 180), operation: fc.constantFrom('union', 'subtract', 'intersect'),
	inverted: fc.boolean(), name: fc.constantFrom('Paint é', '空と影', 'Mask', 'Composite') });
export interface GeneratedDevelopResourcesCurrentV1 {
	readonly brush: Readonly<BrushMaskResourceReferenceV1>;
	readonly unusedBrush: Readonly<BrushMaskResourceReferenceV1>;
	readonly lut: Readonly<VideoCubeLutReferenceV1>;
}

/** Generated scalar recipes do not grant body authority. The native fixture
 * installs their exact refs independently through the real selected Session.
 * Omitting resources gives a legitimate brush-free external preset recipe. */
export function generatedDevelopCurrentV1(spec: GeneratedDevelopSpecCurrentV1, resources?: GeneratedDevelopResourcesCurrentV1) {
	return normalizeImageDevelopStateV3({ processVersion: 3,
		effects: [createVideoEffectV2('white-balance-v1', { id: 'white', params: { temperature: spec.temperature } }),
			createVideoEffectV2('tone-ladder-v1', { id: 'local-tone', enabled: spec.enabled, params: { exposure: spec.exposure / 8 } }),
			createVideoEffectV2('chroma-v1', { id: 'chroma', params: { saturation: spec.saturation } }),
			createVideoEffectV2('tone-ladder-v1', { id: 'global-tone', params: { exposure: spec.exposure / 16 } }),
			...(resources ? [createVideoEffectV2('cube-lut-profile-v1', { id: 'retained-profile', enabled: false, params: { lut: resources.lut } })] : [])],
		geometry: { crop: null, rotationDegrees: spec.rotation, flipHorizontal: spec.flip, flipVertical: false },
		masks: [{ schemaVersion: 2, id: 'composed', name: spec.name, kind: 'matte',
			inputs: resources ? [{ name: 'paint', kind: 'alpha', sourceRef: resources.brush.storageKey },
				{ name: 'unused', kind: 'alpha', sourceRef: resources.unusedBrush.storageKey }] : [],
			nodes: [{ id: 'base', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
				resources ? { id: 'paint', kind: 'alpha', inputName: 'paint' } : { id: 'paint', kind: 'linear-gradient', start: { x: 1, y: 0 }, end: { x: 0, y: 0 } },
				{ id: 'inverse', kind: 'invert', inputNodeId: 'paint' },
				{ id: 'composite', kind: 'boolean', operation: spec.operation, inputNodeIds: ['base', spec.inverted ? 'inverse' : 'paint'] }], outputNodeId: 'composite' },
			{ schemaVersion: 2, id: 'unbound', name: `Unbound ${spec.name}`, kind: 'matte', inputs: [],
				nodes: [{ id: 'gradient', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } }], outputNodeId: 'gradient' }],
		maskBindings: [{ maskId: 'composed', effectId: 'local-tone' }],
		repairs: { schemaVersion: 1, spots: [{ id: 'generated-repair', mode: spec.mode, enabled: spec.enabled,
			target: { x: spec.target / 8, y: .5 }, source: { x: spec.source / 8, y: .5 }, radius: spec.radius / 16, feather: spec.feather / 8, opacity: spec.opacity / 8 },
			{ id: 'retained-disabled', mode: 'clone', enabled: false, target: { x: .75, y: .5 }, source: { x: .25, y: .5 }, radius: .125, feather: 0, opacity: 1 }] } });
}

/** Real Current factory/catalog/media owners in one instrumented native IDB
 * namespace. This is transaction/property evidence, not browser qualification. */
export async function developPropertiesFixtureCurrentV1(count = 3) {
	const f = await repairPresetsFixture(count); let session = f.session;
	const owned: { media?: PhotoMediaStoreV1; catalog?: PhotoCatalogRepositoryCurrentV1 } = {}, commands = new Set<PhotoCommandOwnerCurrentV1>();
	try {
		const brush = (await f.installBrush([0, 96, 255])).reference, unusedBrush = (await f.installBrush([255, 32, 0])).reference;
		const lut = (await session.cubeLuts.importFile(new Blob([new Uint8Array(LUT_BODY)]))).reference;
		const resourcesForRecipe = Object.freeze({ brush, unusedBrush, lut });
		const anchor = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks, preferOpfs: false });
		let selected: Awaited<ReturnType<typeof readPhotoLibrarySessionLocationV2>>;
		try { await anchor.ready(); selected = await readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw new Error('Generated fixture cannot initialize another media namespace.'); } }); } finally { await anchor.close(); }
		const media = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks, databaseName: selected.location.mediaDatabaseName, preferOpfs: false }); owned.media = media;
		await media.ready();
		const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: f.native.factory, databaseName: selected.location.catalogDatabaseName,
			verifyOriginal: media.verifyOriginal, verifyResources: (photo, signal) => verifyPhotoResourcesCurrentV1(photo, f.resources, signal) }); owned.catalog = catalog;
		const refresh = async () => { const rows = await f.inspect(); rows.forEach((row, index) => { f.photos[index] = row.photo; }); return rows; };
		const read = async (index = 0) => { await refresh(); return session.develop.read({ schemaVersion: 3, photoId: f.photos[index]!.id }); };
		const apply = async (command: PhotoLibraryDevelopCommandCurrentV1, index = 0) => {
			const before = await read(index), ack = await session.develop.apply({ schemaVersion: 3, photoId: before.photoId, expectedRevision: before.revision, command });
			await refresh(); return ack;
		};
		const resourceKeys = [brush.storageKey, unusedBrush.storageKey, lut.storageKey];
		return { ...f, get session() { return session; }, resourcesForRecipe, read, apply,
			source(index = 0, develop: ImageDevelopStateThroughV4 = f.photos[index]!.versions.find(version => version.id === f.photos[index]!.activeVersionId)!.develop) {
				const photo = f.photos[index]!; return { schemaVersion: 3 as const, catalogId: photo.catalogId, photoId: photo.id, versionId: photo.activeVersionId, revision: photo.revision, develop };
			},
			async record(develop: ImageDevelopStateThroughV4, index = 0) { const before = await read(index); return apply({ type: 'record-develop', versionId: before.versionId, develop, label: 'Generated', createdAt: GENERATED_CURRENT_TIME }, index); },
			async reopen() { await session.close(); session = await createPhotoLibrarySessionCurrentV1(f.options); await session.readPage(); await refresh(); return session; },
			async openCommandOwner(index = 0) { await refresh(); const photo = f.photos[index]!;
				const owner = await PhotoCommandOwnerCurrentV1.open(catalog, photo.catalogId, photo.id); commands.add(owner); return owner; },
			async inspectCustody() {
				const rows = await refresh(), raw = f.native.raw(selected.location.mediaDatabaseName);
				const bodies = [];
				for (const reference of [brush, unusedBrush]) { const resource = await f.resources.maskRasterResources();
					bodies.push({ key: reference.storageKey, bytes: await resource.source.withBytes(reference, bytes => Array.from(bytes)) }); }
				const profiles = await f.resources.cubeLutResources(); bodies.push({ key: lut.storageKey, bytes: await profiles.source.withBytes(lut, bytes => Array.from(bytes)) });
				const keys = new Set(rows.map(row => row.photo.original.storageKey)), mediaRows = raw.records(selected.location.mediaDatabaseName, 'mediaAssets') as Record<string, unknown>[];
				const originals = rows.map(row => { assert.equal(createHash('sha256').update(row.bytes).digest('hex'), row.photo.original.contentSha256);
					return { original: row.photo.original, bytes: row.bytes }; });
				const retained = mediaRows.filter(row => keys.has(row.sourceId as string)).map(row => { const { blob, ...metadata } = row;
					assert.ok(blob instanceof Blob); assert.equal(typeof metadata.mediaContentToken, 'string'); return { metadata, blobSize: blob.size, blobType: blob.type }; });
				assert.equal(retained.length, keys.size);
				return { originals, mediaRows: retained, roots: raw.records(selected.location.mediaDatabaseName, 'catalogOriginalRoots'),
					analysis: (raw.records(selected.location.mediaDatabaseName, 'analysis') as Record<string, unknown>[]).filter(row => resourceKeys.includes(row.key as string)), bodies };
			},
			async close() {
				const outcomes = await Promise.allSettled([...commands].map(owner => owner.close()));
				for (const close of [() => session.close(), () => catalog.close(), () => media.close(), () => f.close()]) try { await close(); } catch (error) { outcomes.push({ status: 'rejected', reason: error }); }
				const failures = outcomes.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
				if (failures.length) throw new AggregateError(failures, 'Generated Current fixture retirement failed.');
			},
		};
	} catch (error) {
		await Promise.allSettled([session.close(), owned.catalog?.close(), owned.media?.close(), f.close()]); throw error;
	}
}
