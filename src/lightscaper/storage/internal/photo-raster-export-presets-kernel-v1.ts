/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoExportPresetSnapshotV1 } from '../../../common/editor/photo-library-export-presets-port-v1.ts';
import type { PhotoRasterExportPresetCurrentV1 } from '../../../common/editor/photo-library-export-presets-port-current-v1.ts';
import type { PhotoDevelopPresetSettingsPortV1 } from '../photo-develop-presets-v1.ts';
import { borrowPhotoDevelopPresetSettingsV2, photoDevelopPresetEntryValue, readPhotoDevelopSignalOptionsV2 } from '../photo-develop-preset-read-v2.ts';
import { normalizePhotoRasterExportPresetForProfileV1, normalizePhotoExportPresetCommandForProfileV1,
	PHOTO_EXPORT_PRESETS_LIMITS_V1 as LIMITS, checkPhotoExportPresetBytesV1, type PhotoExportPresetProfileV1 } from '../../controller/internal/photo-raster-export-preset-kernel-v1.ts';
import { array, compareText, field, id, integer, record, unique } from '../../catalog/value-validation.ts';

export interface PhotoExportPresetRowCurrentV1 {
	readonly schemaVersion: 1; readonly kind: 'photo-export-presets'; readonly catalogId: string;
	readonly revision: number; readonly presets: readonly Readonly<PhotoRasterExportPresetCurrentV1>[];
}
export class PhotoExportPresetConflictError extends Error {
	constructor() { super('Export presets changed; reload before applying or saving.'); this.name = 'PhotoExportPresetConflictError'; }
}
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal) { if (signal) Reflect.apply(CHECK, signal, []); }
export function photoExportPresetsKeyV1(catalogId: string): string { return `photo-library:export-presets:v1:${id(catalogId, 'export preset catalog ID')}`; }
export function normalizePhotoExportPresetRowForProfileV1(profile: PhotoExportPresetProfileV1, value: unknown, catalogId: string): Readonly<PhotoExportPresetRowCurrentV1> {
	const input = record(value, 'photo export preset row', ['schemaVersion', 'kind', 'catalogId', 'revision', 'presets']);
	if (field(input, 'schemaVersion') !== 1 || field(input, 'kind') !== 'photo-export-presets' || field(input, 'catalogId') !== id(catalogId, 'export preset catalog ID')) throw new RangeError('Unsupported or foreign export preset row.');
	const presets = array(field(input, 'presets'), 'photo export presets', 0, LIMITS.maximumPresets).map(value => normalizePhotoRasterExportPresetForProfileV1(profile, value));
	unique(presets.map(preset => preset.id), 'photo export presets');
	const row = Object.freeze({ schemaVersion: 1 as const, kind: 'photo-export-presets' as const, catalogId,
		revision: integer(field(input, 'revision'), 1, Number.MAX_SAFE_INTEGER, 'export preset revision'), presets: Object.freeze(presets.sort((a, b) => compareText(a.id, b.id))) });
	checkPhotoExportPresetBytesV1(row); return row;
}
function snapshot(row: Readonly<{ catalogId: string; revision: number; presets: readonly Readonly<PhotoRasterExportPresetCurrentV1>[] }>): PhotoExportPresetSnapshotV1 {
	return Object.freeze({ schemaVersion: 1, catalogId: row.catalogId, revision: row.revision, presets: Object.freeze(row.presets.map(preset => Object.freeze({ id: preset.id, name: preset.name }))) });
}
async function load(profile: PhotoExportPresetProfileV1, settings: PhotoDevelopPresetSettingsPortV1, catalogId: string, signal?: AbortSignal) {
	const raw = photoDevelopPresetEntryValue(await settings.readEntry!(photoExportPresetsKeyV1(catalogId))); check(signal);
	return { raw, row: raw === undefined ? { catalogId, revision: 0, presets: [] } : normalizePhotoExportPresetRowForProfileV1(profile, raw, catalogId) };
}
export async function readPhotoExportPresetsForProfileV1(profile: PhotoExportPresetProfileV1, repository: PhotoDevelopPresetSettingsPortV1, catalogId: string, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoExportPresetSnapshotV1> {
	const { signal } = readPhotoDevelopSignalOptionsV2(options); check(signal);
	const settings = borrowPhotoDevelopPresetSettingsV2(repository), { row } = await load(profile, settings, catalogId, signal); return snapshot(row);
}
export async function readPhotoExportPresetForProfileV1(profile: PhotoExportPresetProfileV1, repository: PhotoDevelopPresetSettingsPortV1, catalogId: string, presetId: string, expectedRevision: number, options: Readonly<{ signal?: AbortSignal }> = {}) {
	const selected = id(presetId, 'export preset ID'), revision = integer(expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'export preset expected revision');
	const { signal } = readPhotoDevelopSignalOptionsV2(options); check(signal);
	const settings = borrowPhotoDevelopPresetSettingsV2(repository), { row } = await load(profile, settings, catalogId, signal);
	if (row.revision !== revision) throw new PhotoExportPresetConflictError();
	const preset = row.presets.find(preset => preset.id === selected); if (!preset) throw new ReferenceError('Export preset is missing.'); return Object.freeze({ preset });
}
/** One native scalar CAS, preserving exact complete-row ACK reconciliation. */
export async function writePhotoExportPresetForProfileV1(profile: PhotoExportPresetProfileV1, repository: PhotoDevelopPresetSettingsPortV1, catalogId: string, value: unknown, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoExportPresetSnapshotV1> {
	const command = normalizePhotoExportPresetCommandForProfileV1(profile, value), { signal } = readPhotoDevelopSignalOptionsV2(options); check(signal);
	const settings = borrowPhotoDevelopPresetSettingsV2(repository), key = photoExportPresetsKeyV1(catalogId), { raw, row } = await load(profile, settings, catalogId, signal);
	if (row.revision !== command.expectedRevision) throw new PhotoExportPresetConflictError();
	const selected = command.type === 'save' ? command.preset.id : command.presetId;
	if (command.type === 'delete' && !row.presets.some(preset => preset.id === selected)) throw new ReferenceError('Export preset is missing.');
	const presets = row.presets.filter(preset => preset.id !== selected); if (command.type === 'save') presets.push(command.preset);
	const next = normalizePhotoExportPresetRowForProfileV1(profile, { schemaVersion: 1, kind: 'photo-export-presets', catalogId, revision: row.revision + 1, presets }, catalogId);
	check(signal); let ack: unknown;
	try { ack = raw === undefined ? await settings.putIfAbsent(key, next) : await settings.replaceIfCurrent(key, raw, next); }
	catch (primary) {
		let recovered: Awaited<ReturnType<typeof load>> | undefined, cleanup: unknown;
		try { recovered = await load(profile, settings, catalogId); } catch (failure) { cleanup = failure; }
		if (recovered === undefined) throw new AggregateError([primary, cleanup], 'Export preset publication could not be reconciled.', { cause: primary });
		if (recovered.raw !== undefined && JSON.stringify(recovered.row) === JSON.stringify(next)) return snapshot(next);
		throw primary;
	}
	if (ack === true) return snapshot(next);
	throw new PhotoExportPresetConflictError();
}
