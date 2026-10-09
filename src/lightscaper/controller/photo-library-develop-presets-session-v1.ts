/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPresetsPortV1, PhotoLibraryDevelopPresetSnapshotV1 } from '../../common/editor/photo-library-develop-presets-port-v1.ts';
import { createImageDevelopPresetV1, parseImageDevelopPresetV1, serializeImageDevelopPresetV1 } from '../../common/editor/imaging/image-develop-preset-v1.ts';
import { checkImageDevelopSettingsBytesV1 } from '../../common/editor/imaging/image-develop-settings-v1.ts';
import { readPhotoStackSignalOptionsV1 } from '../catalog/photo-stack-repository-v1.ts';
import { field, id, integer, record } from '../catalog/value-validation.ts';
import { readPhotoDevelopPresetsV1, readPhotoDevelopPresetV1, applyPhotoDevelopPresetV1,
	normalizePhotoDevelopPresetCommandV1, type PhotoDevelopPresetSettingsPortV1 } from '../storage/photo-develop-presets-v1.ts';
import type { PhotoLibrarySessionPortsV1 } from './photo-library-session-ports.ts';

export interface PhotoLibraryDevelopPresetStorageV1 {
	readonly settings: PhotoDevelopPresetSettingsPortV1;
	readonly catalog: Pick<PhotoLibrarySessionPortsV1['catalog'], 'loadCatalog'>;
}
export interface PhotoLibraryDevelopPresetsSessionHostV1 {
	readonly storage: PhotoLibraryDevelopPresetStorageV1;
	readonly ready: () => Promise<string>;
	readonly operation: <Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
	readonly mutate: <Result>(run: (catalogId: string, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
}
const nativeAbort = AbortSignal.prototype.throwIfAborted;

/** This optional capability borrows the existing Session lifetime, single writer and catalog lease. */
export function createPhotoLibraryDevelopPresetsSessionV1(host: PhotoLibraryDevelopPresetsSessionHostV1): Readonly<PhotoLibraryDevelopPresetsPortV1> {
	return Object.freeze({ create: createImageDevelopPresetV1, parse: parseImageDevelopPresetV1, serialize: serializeImageDevelopPresetV1,
		async list(value, options = {}) {
			const input = request(value, ['schemaVersion', 'catalogId']), catalogId = id(field(input, 'catalogId'), 'Develop preset catalog ID');
			const { signal } = readPhotoStackSignalOptionsV1(options);
			return host.operation(async admitted => {
				checkCatalog(catalogId, await host.ready()); Reflect.apply(nativeAbort, admitted, []);
				return readPhotoDevelopPresetsV1(host.storage.settings, catalogId, { signal: admitted });
			}, signal);
		},
		async read(value, options = {}) {
			const input = request(value, ['schemaVersion', 'catalogId', 'presetId', 'expectedRevision']);
			const catalogId = id(field(input, 'catalogId'), 'Develop preset catalog ID'), presetId = id(field(input, 'presetId'), 'Develop preset ID');
			const expected = integer(field(input, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'Develop preset expected revision');
			const { signal } = readPhotoStackSignalOptionsV1(options);
			return host.operation(async admitted => {
				checkCatalog(catalogId, await host.ready()); Reflect.apply(nativeAbort, admitted, []);
				return readPhotoDevelopPresetV1(host.storage.settings, catalogId, presetId, expected, { signal: admitted });
			}, signal);
		},
		async write(value, options = {}) {
			const input = request(value, ['schemaVersion', 'catalogId', 'command']), catalogId = id(field(input, 'catalogId'), 'Develop preset catalog ID');
			const command = normalizePhotoDevelopPresetCommandV1(field(input, 'command'));
			checkImageDevelopSettingsBytesV1({ schemaVersion: 1, catalogId, command });
			const { signal } = readPhotoStackSignalOptionsV1(options);
			const completed: { snapshot: PhotoLibraryDevelopPresetSnapshotV1 | null } = { snapshot: null };
			try {
				const snapshot = await host.mutate(async (current, admitted) => {
					checkCatalog(catalogId, current);
					const root = await host.storage.catalog.loadCatalog(catalogId); Reflect.apply(nativeAbort, admitted, []);
					if (!root) throw new ReferenceError('Photo catalog is missing.');
					completed.snapshot = await applyPhotoDevelopPresetV1(host.storage.settings, root, command, { signal: admitted });
					return completed.snapshot;
				}, signal);
				return Object.freeze({ snapshot, notices: Object.freeze([]) });
			} catch (error) {
				if (completed.snapshot === null) throw error;
				return Object.freeze({ snapshot: completed.snapshot, notices: Object.freeze(['cleanup-failed'] as const) });
			}
		},
	} satisfies PhotoLibraryDevelopPresetsPortV1);
}
function request(value: unknown, fields: readonly string[]) {
	const input = record(value, 'Develop preset request', fields);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported Develop preset request version.');
	return input;
}
function checkCatalog(requested: string, current: string): void { if (requested !== current) throw new RangeError('Develop presets belong to another catalog.'); }
