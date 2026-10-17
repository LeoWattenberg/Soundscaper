/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoLibraryExportPresetsAccessCurrentV1, PhotoExportPresetCommandCurrentV1 } from '../../../common/editor/photo-library-export-presets-port-current-v1.ts';
import type { PhotoExportPresetSnapshotV1 } from '../../../common/editor/photo-library-export-presets-port-v1.ts';
import type { PhotoDevelopPresetSettingsPortV1 } from '../../storage/photo-develop-presets-v1.ts';
import { borrowPhotoDevelopPresetSettingsV2, readPhotoDevelopSignalOptionsV2 } from '../../storage/photo-develop-preset-read-v2.ts';
import { normalizePhotoExportPresetCommandForProfileV1, type PhotoExportPresetProfileV1 } from './photo-raster-export-preset-kernel-v1.ts';
import { readPhotoExportPresetsForProfileV1, readPhotoExportPresetForProfileV1, writePhotoExportPresetForProfileV1 } from '../../storage/internal/photo-raster-export-presets-kernel-v1.ts';
import { field, id, integer, record } from '../../catalog/value-validation.ts';

export interface PhotoLibraryExportPresetsSessionHostV1 {
	readonly settings: PhotoDevelopPresetSettingsPortV1;
	readonly ready: () => Promise<string>;
	readonly operation: <Result>(run: (signal: AbortSignal) => Promise<Result>, caller?: AbortSignal, admit?: () => void) => Promise<Result>;
	readonly mutate: <Result>(run: (catalogId: string, signal: AbortSignal) => Promise<Result>, caller?: AbortSignal) => Promise<Result>;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
/** Fixed-profile scalar facade; all methods retain the original selected
 * operation/writer lifetime and positive-CAS outcome semantics. */
export async function openPhotoLibraryExportPresetsForProfileV1(profile: PhotoExportPresetProfileV1, host: PhotoLibraryExportPresetsSessionHostV1,
	options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Readonly<PhotoLibraryExportPresetsAccessCurrentV1>> {
	if (profile !== 'legacy1' && profile !== 'current1') throw new TypeError('Unsupported fixed export preset Session profile.');
	const settings = borrowPhotoDevelopPresetSettingsV2(host.settings), ready = host.ready, run = host.operation, mutate = host.mutate;
	const signal = readPhotoDevelopSignalOptionsV2(options).signal;
	const operation: PhotoLibraryExportPresetsSessionHostV1['operation'] = (...args) => Reflect.apply(run, host, args);
	const catalogId = await operation(async admitted => { const selected = await Reflect.apply(ready, host, []) as string; Reflect.apply(CHECK, admitted, []); return id(selected, 'export preset catalog ID'); }, signal);
	const request = (value: unknown, fields: readonly string[]) => {
		const input = record(value, 'export preset request', fields); if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported export preset request version.'); return input;
	};
	const checked = async (admitted: AbortSignal) => {
		Reflect.apply(CHECK, admitted, []); if (await Reflect.apply(ready, host, []) !== catalogId) throw new Error('Export preset catalog changed.'); Reflect.apply(CHECK, admitted, []);
	};
	const caller = (options: Readonly<{ signal?: AbortSignal }>) => {
		const extra = readPhotoDevelopSignalOptionsV2(options).signal; return extra && signal ? AbortSignal.any([extra, signal]) : extra ?? signal;
	};
	return Object.freeze<PhotoLibraryExportPresetsAccessCurrentV1>({ catalogId,
		list(value, options = {}) { return operation(async admitted => { await checked(admitted); return readPhotoExportPresetsForProfileV1(profile, settings, catalogId, { signal: admitted }); }, caller(options), () => { request(value, ['schemaVersion']); }); },
		read(value, options = {}) {
			let presetId!: string, revision!: number;
			return operation(async admitted => { await checked(admitted); return readPhotoExportPresetForProfileV1(profile, settings, catalogId, presetId, revision, { signal: admitted }); }, caller(options), () => {
				const input = request(value, ['schemaVersion', 'presetId', 'expectedRevision']); presetId = id(field(input, 'presetId'), 'export preset ID'); revision = integer(field(input, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'export preset expected revision');
			});
		},
		write(value, options = {}) {
			let command!: PhotoExportPresetCommandCurrentV1;
			return operation(async admitted => {
				await checked(admitted); const completed: { snapshot: PhotoExportPresetSnapshotV1 | null } = { snapshot: null };
				try {
					const snapshot = await Reflect.apply(mutate, host, [async (current: string, signal: AbortSignal) => {
						if (current !== catalogId) throw new Error('Export preset catalog changed.');
						completed.snapshot = await writePhotoExportPresetForProfileV1(profile, settings, catalogId, command, { signal }); return completed.snapshot;
					}, admitted]) as PhotoExportPresetSnapshotV1;
					return Object.freeze({ schemaVersion: 1 as const, snapshot, notices: Object.freeze([]) });
				} catch (error) {
					if (!completed.snapshot) throw error;
					return Object.freeze({ schemaVersion: 1 as const, snapshot: completed.snapshot, notices: Object.freeze(['cleanup-failed'] as const) });
				}
			}, caller(options), () => { command = normalizePhotoExportPresetCommandForProfileV1(profile, field(request(value, ['schemaVersion', 'command']), 'command')); });
		},
	});
}
