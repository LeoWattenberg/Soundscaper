/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoMediaStoreV1 } from '../../../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../../../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { request, transact } from '../../../src/common/editor/storage/indexeddb-backend.ts';
import { normalizeVideoCubeLutReferenceV1 } from '../../../src/common/editor/cube-lut-reference-contract.ts';
import type { CubeLutSourcePortV1 } from '../../../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import { withImageDevelopGpuCurrentV1 } from '../../../src/common/editor/imaging/image-develop-gpu-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../../../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../../../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../../../src/common/editor/photo-library-develop-linear-port-v1.ts';

export { startGpuLutObservationCurrentV1, readGpuLutObservationCurrentV1, resetGpuLutObservationCurrentV1,
	stopGpuLutObservationCurrentV1 } from './lightscaper-native-gpu-lut-current-reference.ts';
export { readRawImportCustodyCurrentV1 as readGpuLutPhotoCustodyCurrentV1 } from './lightscaper-raw-import-current-reference.ts';

/** Actual selected immutable LUT row plus its independently authenticated scoped
 * borrower. This read-only observer cannot publish a resource or replace a port. */
export function readGpuLutCustodyCurrentV1(referenceValue: unknown) {
	const reference = normalizeVideoCubeLutReferenceV1(referenceValue);
	return withSelectedLuts(async (source, databaseName) => {
		const bytes = await source.withBytes(reference, bytes => {
			if (bytes.byteLength > 4096) throw new RangeError('LUT UI custody is bounded to the owned2³ fixture.');
			return [...bytes];
		});
		const database = await new Promise<IDBDatabase>((resolve, reject) => {
			const opening = indexedDB.open(databaseName);
			opening.addEventListener('upgradeneeded', () => opening.transaction?.abort(), { once: true });
			opening.addEventListener('error', () => reject(opening.error), { once: true });
			opening.addEventListener('success', () => resolve(opening.result), { once: true });
		});
		try {
			const row: unknown = await transact(database, 'analysis', 'readonly', stores => request(stores.analysis!.get(reference.storageKey)));
			if (row === undefined) throw new ReferenceError('Actual immutable LUT row is missing.');
			return { reference, bytes, recordJson: JSON.stringify(row), databaseName };
		} finally { database.close(); }
	});
}

/** Separate real high-broker qualification of actual native RAW words and the
 * actual stored LUT. No pixels/results from this operation feed the app UI. */
export function qualifyGpuLutPhotoCurrentV1(value: Readonly<{ words: readonly number[]; reference: unknown }>) {
	const reference = normalizeVideoCubeLutReferenceV1(value.reference);
	if (value.words.length !== 4096 || value.words.some(n => !Number.isInteger(n) || n < 0 || n > 65535)) throw new RangeError('GPU LUT UI fixture requires actual32² native words.');
	return withSelectedLuts(async source => {
		const pixels = Float32Array.from(value.words, (n, at) => at % 4 === 3 ? 1 : n / 65535), before = new Uint32Array(pixels.buffer).slice();
		const frame = { descriptor: { schemaVersion: 1 as const, width: 32, height: 32, sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }, pixels };
		const effects = [{ id: 'lut', type: 'cube-lut-profile-v1', enabled: true, params: { lut: reference } },
			{ id: 'exposure', type: 'tone-ladder-v1', enabled: true, params: { exposure: 1 } }];
		let callbacks = 0, backing: ArrayBuffer | undefined;
		try {
			const result = await withImageDevelopGpuCurrentV1({ frame, develop: normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), effects }) },
				(output, execution) => { callbacks++; backing = output.pixels.buffer;
					return { ...execution, bits: [...new Uint32Array(backing, output.pixels.byteOffset, output.pixels.length)] };
				}, PHOTO_DEVELOP_LINEAR_LIMITS_V1, { source });
			return { ...result, callbacks, sourceUnchanged: new Uint32Array(pixels.buffer).every((n, at) => n === before[at]),
				outputRetired: backing !== undefined && new Uint8Array(backing).every(n => n === 0) };
		} finally { pixels.fill(0); before.fill(0); }
	});
}

async function withSelectedLuts<Result>(consume: (source: Readonly<CubeLutSourcePortV1>, databaseName: string) => Promise<Result>): Promise<Result> {
	const anchor = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks, syncWorkerClient: null });
	let media: PhotoMediaStoreV1 | undefined;
	const result = await (async () => {
		await anchor.ready();
		const selection = await withPhotoLibraryInitializationLockV1(navigator.locks, () => readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw new Error('A LUT observer cannot initialize a library.'); } }));
		media = selection.location.mediaDatabaseName === 'lightscaper-photo-media-v2' ? anchor : new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks,
			databaseName: selection.location.mediaDatabaseName, syncWorkerClient: null });
		await media.ready(); const resources = await media.getCubeLutResources();
		const result = await consume(resources.source, selection.location.mediaDatabaseName);
		const after = await withPhotoLibraryInitializationLockV1(navigator.locks, () => readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw new Error('A LUT observer cannot initialize a library.'); } }));
		if (JSON.stringify(selection.pointer) !== JSON.stringify(after.pointer)) throw new Error('Selected LUT namespace changed.');
		return result;
	})().then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	const closed = await Promise.allSettled([...new Set([media, anchor])].filter(owner => owner !== undefined).map(owner => owner.close()));
	const errors = closed.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
	if (!result.ok) { if (errors.length) throw new AggregateError([result.error, ...errors], 'LUT observer and cleanup failed.', { cause: result.error }); throw result.error; }
	if (errors.length) throw new AggregateError(errors, 'LUT observer cleanup failed.'); return result.value;
}
