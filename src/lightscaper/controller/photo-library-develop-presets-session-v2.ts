/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPresetsPortV2, PhotoLibraryDevelopPresetSnapshotV2 } from '../../common/editor/photo-library-develop-presets-port-v2.ts';
import { createImageDevelopPresetV2, parseImageDevelopPresetV1OrV2, serializeImageDevelopPresetV1OrV2 } from '../../common/editor/imaging/image-develop-preset-v2.ts';
import { checkImageDevelopSettingsBytesV1 } from '../../common/editor/imaging/image-develop-settings-v1.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../storage/photo-develop-preset-read-v2.ts';
import { field, id, integer, record } from '../catalog/value-validation.ts';
import { readPhotoDevelopPresetsV2, readPhotoDevelopPresetV2, applyPhotoDevelopPresetV2,
	normalizePhotoDevelopPresetCommandV2 } from '../storage/photo-develop-presets-v2.ts';
import type { PhotoCatalogRepositoryV2 } from '../catalog/photo-catalog-repository-v2.ts';
import type { PhotoDevelopPresetSettingsPortV1 } from '../storage/photo-develop-presets-v1.ts';
import { borrowPhotoDevelopPresetSettingsV2 } from '../storage/photo-develop-preset-read-v2.ts';
import type { PhotoLibraryDevelopPresetV2 } from '../../common/editor/photo-library-develop-presets-port-v2.ts';

export interface PhotoLibraryDevelopPresetStorageV2 {
	readonly settings: PhotoDevelopPresetSettingsPortV1;
	readonly catalog: Pick<PhotoCatalogRepositoryV2, 'loadCatalog'>;
	readonly verifyResources?: (preset: PhotoLibraryDevelopPresetV2, signal?: AbortSignal) => Promise<void>;
}
export interface PhotoLibraryDevelopPresetsSessionHostV2 {
	readonly storage: PhotoLibraryDevelopPresetStorageV2;
	readonly ready: () => Promise<string>;
	readonly operation: <Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
	readonly mutate: <Result>(run: (catalogId: string, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
}
const nativeAbort = AbortSignal.prototype.throwIfAborted;

/** This optional capability borrows the existing Session lifetime, single writer and catalog lease. */
export function createPhotoLibraryDevelopPresetsSessionV2(host: PhotoLibraryDevelopPresetsSessionHostV2): Readonly<PhotoLibraryDevelopPresetsPortV2> {
	const storage = host.storage, settings = borrowPhotoDevelopPresetSettingsV2(storage.settings);
	const initialize = host.ready, operation = host.operation, mutate = host.mutate, catalog = storage.catalog, readCatalog = catalog.loadCatalog, verify = storage.verifyResources;
	if ([initialize, operation, mutate, readCatalog].some(method => typeof method !== 'function')
		|| (verify !== undefined && typeof verify !== 'function')) throw new TypeError('Complete preset host capabilities are required.');
	const ready = (): Promise<string> => Reflect.apply(initialize, host, []);
	const loadCatalog: typeof readCatalog = (...args) => Reflect.apply(readCatalog, catalog, args);
	const verifyResources = verify === undefined ? undefined : (...args: Parameters<NonNullable<typeof verify>>) => Reflect.apply(verify, storage, args);
	return Object.freeze({ create: createImageDevelopPresetV2, parse: parseImageDevelopPresetV1OrV2, serialize: serializeImageDevelopPresetV1OrV2,
		async list(value, options = {}) {
			const { signal } = readPhotoDevelopSignalOptionsV2(options);
			const input = request(value, ['schemaVersion', 'catalogId']), catalogId = id(field(input, 'catalogId'), 'Develop preset catalog ID');
			if (signal) Reflect.apply(nativeAbort, signal, []);
			return Reflect.apply(operation, host, [async (admitted: AbortSignal) => {
				checkCatalog(catalogId, await ready()); Reflect.apply(nativeAbort, admitted, []);
				return readPhotoDevelopPresetsV2(settings, catalogId, { signal: admitted });
			}, signal]);
		},
		async read(value, options = {}) {
			const { signal } = readPhotoDevelopSignalOptionsV2(options);
			const input = request(value, ['schemaVersion', 'catalogId', 'presetId', 'expectedRevision']);
			const catalogId = id(field(input, 'catalogId'), 'Develop preset catalog ID'), presetId = id(field(input, 'presetId'), 'Develop preset ID');
			const expected = integer(field(input, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'Develop preset expected revision');
			if (signal) Reflect.apply(nativeAbort, signal, []);
			return Reflect.apply(operation, host, [async (admitted: AbortSignal) => {
				checkCatalog(catalogId, await ready()); Reflect.apply(nativeAbort, admitted, []);
				return readPhotoDevelopPresetV2(settings, catalogId, presetId, expected, { signal: admitted });
			}, signal]);
		},
		async write(value, options = {}) {
			const { signal } = readPhotoDevelopSignalOptionsV2(options);
			const input = request(value, ['schemaVersion', 'catalogId', 'command']), catalogId = id(field(input, 'catalogId'), 'Develop preset catalog ID');
			const command = normalizePhotoDevelopPresetCommandV2(field(input, 'command'));
			checkImageDevelopSettingsBytesV1({ schemaVersion: 2, catalogId, command });
			if (signal) Reflect.apply(nativeAbort, signal, []);
			const completed: { snapshot: PhotoLibraryDevelopPresetSnapshotV2 | null } = { snapshot: null };
			try {
				const snapshot: PhotoLibraryDevelopPresetSnapshotV2 = await Reflect.apply(mutate, host, [async (current: string, admitted: AbortSignal) => {
					checkCatalog(catalogId, current);
					const root = await loadCatalog(catalogId); Reflect.apply(nativeAbort, admitted, []);
					if (!root) throw new ReferenceError('Photo catalog is missing.');
					completed.snapshot = await applyPhotoDevelopPresetV2(settings, root, command, { signal: admitted, ...(verifyResources ? { verifyResources } : {}) });
					return completed.snapshot;
				}, signal]);
				return Object.freeze({ schemaVersion: 2 as const, snapshot, notices: Object.freeze([]) });
			} catch (error) {
				if (completed.snapshot === null) throw error;
				return Object.freeze({ schemaVersion: 2 as const, snapshot: completed.snapshot, notices: Object.freeze(['cleanup-failed'] as const) });
			}
		},
	} satisfies PhotoLibraryDevelopPresetsPortV2);
}
function request(value: unknown, fields: readonly string[]) {
	const input = record(value, 'Develop preset request', fields);
	if (field(input, 'schemaVersion') !== 2) throw new RangeError('Unsupported Develop preset request version.');
	return input;
}
function checkCatalog(requested: string, current: string): void { if (requested !== current) throw new RangeError('Develop presets belong to another catalog.'); }
