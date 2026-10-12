/* SPDX-License-Identifier: AGPL-3.0-only */

import { readRepairSettingsCustodyNativeV1 } from './lightscaper-repair-settings-reference.ts';
import { PhotoMediaStoreV1 } from '../../../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../../../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { photoDevelopPresetsKeyV1 } from '../../../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { photoDevelopPresetEntryValue } from '../../../src/lightscaper/storage/photo-develop-preset-read-v2.ts';
import { normalizePhotoDevelopPresetRowCurrentV1 } from '../../../src/lightscaper/storage/photo-develop-preset-row-current-v1.ts';
import { createPhotoResourceReachabilityCurrentV1 } from '../../../src/lightscaper/catalog/photo-resource-reachability-current-v1.ts';
import { normalizeBrushMaskResourceReferenceV1 } from '../../../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { verifyPhotoResourceReferencesCurrentV1 } from '../../../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../../../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { applyPhotoDevelopPresetCurrentV1 } from '../../../src/lightscaper/storage/photo-develop-presets-current-v1.ts';
import { normalizeImageDevelopSelectedPresetCurrentV1 } from '../../../src/common/editor/imaging/image-develop-preset-selected-v3.ts';

/** Native scalar ACK polling deliberately acquires no Original snapshot. */
export async function readRepairPresetRowNativeV1() {
	const anchor = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks, preferOpfs: false, syncWorkerClient: null });
	let media: PhotoMediaStoreV1 | null = null;
	try {
		await anchor.ready(); const selected = await location();
		media = selected.allocation ? new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks,
			databaseName: selected.location.mediaDatabaseName, preferOpfs: false, syncWorkerClient: null }) : anchor;
		await media.ready(); const key = photoDevelopPresetsKeyV1(selected.location.catalogId);
		const value = photoDevelopPresetEntryValue(await media.settingsRepository.readEntry(key));
		const row = value === undefined ? null : normalizePhotoDevelopPresetRowCurrentV1(value, selected.location.catalogId);
		check(JSON.stringify((await location()).pointer) === JSON.stringify(selected.pointer), 'Scalar preset observer namespace changed.');
		return row;
	} finally { await Promise.all([...new Set([media, anchor])].filter(owner => owner !== null).map(owner => owner.close())); }
	function location() {
		return withPhotoLibraryInitializationLockV1(navigator.locks, () => readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw Error('Preset observer cannot initialize a library.'); } }));
	}
}

/** Two actual native owners read the same row before either CAS. Only real
 * point-entry continuations are held; browser transaction isolation decides
 * both native acknowledgments. No result or stored body is manufactured. */
export async function competeRepairPresetRenameNativeV1(presetId: string, expectedRevision: number, name: string) {
	const anchor = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks, preferOpfs: false, syncWorkerClient: null });
	const media: PhotoMediaStoreV1[] = [];
	let catalog: PhotoCatalogRepositoryCurrentV1 | null = null;
	let result: Awaited<ReturnType<typeof run>> | undefined, failed = false, failure: unknown;
	async function run() {
		await anchor.ready(); const selected = await withPhotoLibraryInitializationLockV1(navigator.locks,
			() => readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
				initializeDefault: async () => { throw Error('Preset race cannot initialize a library.'); } }));
		for (let index = 0; index < 2; index++) media.push(new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks,
			databaseName: selected.location.mediaDatabaseName, preferOpfs: false, syncWorkerClient: null }));
		await Promise.all(media.map(owner => owner.ready()));
		const first = media[0]!;
		catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB, databaseName: selected.location.catalogDatabaseName, verifyOriginal: first.verifyOriginal });
		const root = await catalog.loadCatalog(selected.location.catalogId); check(root !== null, 'Native preset race catalog missing.');
		const key = photoDevelopPresetsKeyV1(root.id), raw = photoDevelopPresetEntryValue(await first.settingsRepository.readEntry(key));
		const row = normalizePhotoDevelopPresetRowCurrentV1(raw, root.id); check(row.revision === expectedRevision, 'Native preset race row changed.');
		const existing = row.presets.find(preset => preset.identity.id === presetId); check(existing !== undefined, 'Native preset race selected preset missing.');
		const preset = normalizeImageDevelopSelectedPresetCurrentV1({ ...existing, identity: { ...existing.identity, name } });
		let reads = 0, release!: () => void; const readFence = new Promise<void>(resolve => { release = resolve; });
		const acknowledgments: boolean[] = [];
		const outcomes = await Promise.allSettled(media.map(owner => {
			const source = owner.settingsRepository, read = source.readEntry, put = source.putIfAbsent, replace = source.replaceIfCurrent;
			const borrowed = Object.freeze({ get: source.get.bind(source),
				readEntry: async (requested: string) => { const entry = await Reflect.apply(read, source, [requested]) as Awaited<ReturnType<typeof read>>;
					if (++reads === 2) release(); await readFence; return entry; },
				putIfAbsent: async (...args: Parameters<typeof put>) => { const ack = await Reflect.apply(put, source, args) as boolean; acknowledgments.push(ack); return ack; },
				replaceIfCurrent: async (...args: Parameters<typeof replace>) => { const ack = await Reflect.apply(replace, source, args) as boolean; acknowledgments.push(ack); return ack; } });
			return applyPhotoDevelopPresetCurrentV1(borrowed, root, { type: 'save', expectedRevision, preset },
				{ resources: { cubeLutResources: () => owner.getCubeLutResources(), maskRasterResources: () => owner.getMaskRasterResources() } });
		}));
		check(reads === 2, 'Native preset race must reach both original point-entry reads.');
		return { acknowledgments, outcomes: outcomes.map(outcome => outcome.status === 'fulfilled'
			? { status: outcome.status, revision: outcome.value.revision }
			: { status: outcome.status, name: outcome.reason instanceof Error ? outcome.reason.name : 'opaque' }) };
	}
	try { result = await run(); } catch (error) { failed = true; failure = error; }
	const closed = await Promise.allSettled([...media, catalog, anchor].filter(owner => owner !== null).map(owner => owner.close()));
	const errors = closed.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : []);
	if (failed && !errors.length) throw failure;
	if (errors.length) throw new AggregateError(failed ? [failure, ...errors] : errors, 'Native preset race or joined cleanup failed.', failed ? { cause: failure } : undefined);
	check(result !== undefined, 'Native preset race did not complete.'); return result;
}

/** Bounded complete native Photo/Original custody and the actual same-key preset
 * row, with independent full retained preset LUT/brush body authentication. */
export async function readRepairPresetsCustodyNativeV1(photoIds: readonly string[], beforeClose?: () => Promise<void>) {
	const custody = await readRepairSettingsCustodyNativeV1(photoIds, beforeClose);
	const anchor = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks, preferOpfs: false, syncWorkerClient: null });
	let media: PhotoMediaStoreV1 | null = null;
	let result: Awaited<ReturnType<typeof read>> | undefined, failed = false, failure: unknown;
	async function read() {
		await anchor.ready(); const selected = await location();
		check(selected.location.namespaceToken === custody.namespace, 'Preset observer selected namespace changed.');
		check(custody.photos.every(row => row.photo.catalogId === selected.location.catalogId), 'Preset observer selected catalog changed.');
		media = selected.allocation ? new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks,
			databaseName: selected.location.mediaDatabaseName, preferOpfs: false, syncWorkerClient: null }) : anchor;
		await media.ready(); const selectedMedia = media, key = photoDevelopPresetsKeyV1(selected.location.catalogId);
		async function readRow() {
			const value = photoDevelopPresetEntryValue(await selectedMedia.settingsRepository.readEntry(key));
			return value === undefined ? null : normalizePhotoDevelopPresetRowCurrentV1(value, selected.location.catalogId);
		}
		const row = await readRow(), collector = createPhotoResourceReachabilityCurrentV1();
		for (const retained of custody.photos) collector.addPhoto(retained.photo);
		for (const preset of row?.presets ?? []) {
			for (const graph of preset.settings.develop.masks) for (const input of graph.inputs) normalizeBrushMaskResourceReferenceV1(input.sourceRef);
			collector.addDevelop(preset.settings.develop);
		}
		const references = collector.finish();
		await verifyPhotoResourceReferencesCurrentV1(references, { cubeLutResources: () => selectedMedia.getCubeLutResources(),
			maskRasterResources: () => selectedMedia.getMaskRasterResources() });
		const masks = await selectedMedia.getMaskRasterResources(), cubes = await selectedMedia.getCubeLutResources();
		const bodies = [], luts = [];
		for (const reference of references.brushes) {
			check(reference.width * reference.height <= 4096, 'Preset fixture brush exceeds its small observer bound.');
			bodies.push(await masks.source.withBytes(reference, bytes => ({ reference, bytes: Array.from(bytes) })));
		}
		for (const reference of references.luts) {
			check(reference.byteLength <= 4096, 'Preset fixture LUT exceeds its small observer bound.');
			luts.push(await cubes.source.withBytes(reference, bytes => ({ reference, bytes: Array.from(bytes) })));
		}
		check(JSON.stringify(await readRow()) === JSON.stringify(row), 'Preset observer native row changed during body reads.');
		check(JSON.stringify((await location()).pointer) === JSON.stringify(selected.pointer), 'Preset observer namespace changed during body reads.');
		await beforeClose?.(); return { ...custody, row, bodies, luts };
	}
	function location() {
		return withPhotoLibraryInitializationLockV1(navigator.locks, () => readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw Error('Preset observer cannot initialize a library.'); } }));
	}
	try { result = await read(); } catch (error) { failed = true; failure = error; }
	const closed = await Promise.allSettled([...new Set([media, anchor])].filter(owner => owner !== null).map(owner => owner.close()));
	const errors = closed.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : []);
	if (failed && !errors.length) throw failure;
	if (errors.length) throw new AggregateError(failed ? [failure, ...errors] : errors, 'Preset custody or joined cleanup failed.', failed ? { cause: failure } : undefined);
	check(result !== undefined, 'Preset custody did not complete.'); return result;
}

function check(condition: unknown, message: string): asserts condition { if (!condition) throw Error(message); }
