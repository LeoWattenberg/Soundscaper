/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImportPresetCommandV1, PhotoLibraryImportPresetSnapshotV1, PhotoLibraryImportPresetV1 } from '../../common/editor/photo-library-import-settings-port-v1.ts';
import type { KeyValueRepository } from '../../common/editor/storage/key-value-repository.ts';
import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import { array, field, id, integer, name, record, unique, compareText } from '../catalog/value-validation.ts';
import { normalizePhotoImportSettingsV1 } from '../import/photo-import-settings-v1.ts';

export const PHOTO_IMPORT_PRESETS_MAXIMUM_BYTES_V1 = 10 * 1024 * 1024;
export type PhotoImportPresetSettingsPortV1 = Pick<KeyValueRepository, 'get' | 'putIfAbsent' | 'replaceIfCurrent'>;
export interface PhotoImportPresetRowV1 extends PhotoLibraryImportPresetSnapshotV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-import-presets';
	readonly catalogId: string;
}
const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;

export class PhotoImportPresetRevisionConflictError extends Error {
	readonly code = 'IMPORT_PRESET_REVISION_CONFLICT';
	constructor() { super('Photo import presets changed; reload before saving.'); this.name = 'PhotoImportPresetRevisionConflictError'; }
}

export function photoImportPresetsKeyV1(catalogId: string): string {
	return `photo-library:import-presets:v1:${id(catalogId, 'preset catalog ID')}`;
}

export function normalizePhotoImportPresetCommandV1(value: unknown): PhotoLibraryImportPresetCommandV1 {
	const input = record(value, 'photo import preset command', ['type', 'expectedRevision', 'id', 'name', 'settings'], ['type', 'expectedRevision', 'id']);
	const common = { expectedRevision: integer(field(input, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'preset expected revision'), id: id(field(input, 'id'), 'preset ID') };
	if (field(input, 'type') === 'delete') {
		record(input, 'delete import preset', ['type', 'expectedRevision', 'id']);
		return Object.freeze({ type: 'delete', ...common });
	}
	if (field(input, 'type') !== 'save') throw new RangeError('Unsupported import preset command.');
	return Object.freeze({ type: 'save', ...common, name: name(field(input, 'name'), 'preset name'), settings: requiredSettings(field(input, 'settings')) });
}

export function normalizePhotoImportPresetRowV1(value: unknown, catalogId: string): Readonly<PhotoImportPresetRowV1> {
	const catalog = id(catalogId, 'preset catalog ID');
	const input = record(value, 'photo import preset row', ['schemaVersion', 'kind', 'catalogId', 'revision', 'presets']);
	if (field(input, 'schemaVersion') !== 1 || field(input, 'kind') !== 'photo-import-presets' || field(input, 'catalogId') !== catalog) {
		throw new RangeError('Unsupported or foreign photo import preset row.');
	}
	const presets = array(field(input, 'presets'), 'photo import presets', 0, 16).map(value => {
		const preset = record(value, 'photo import preset', ['id', 'name', 'settings']);
		return Object.freeze({ id: id(field(preset, 'id'), 'preset ID'), name: name(field(preset, 'name'), 'preset name'), settings: requiredSettings(field(preset, 'settings')) });
	});
	unique(presets.map(preset => preset.id), 'photo import presets');
	const row = Object.freeze({ schemaVersion: 1 as const, kind: 'photo-import-presets' as const, catalogId: catalog,
		revision: integer(field(input, 'revision'), 1, Number.MAX_SAFE_INTEGER, 'preset revision'),
		presets: Object.freeze(presets.sort((left, right) => compareText(left.id, right.id))) });
	const serialized = JSON.stringify(row);
	if (serialized.length > PHOTO_IMPORT_PRESETS_MAXIMUM_BYTES_V1 || new TextEncoder().encode(serialized).byteLength > PHOTO_IMPORT_PRESETS_MAXIMUM_BYTES_V1) {
		throw new RangeError('Photo import preset row exceeds its UTF8 byte bound.');
	}
	return row;
}

export async function readPhotoImportPresetsV1(repository: PhotoImportPresetSettingsPortV1, catalogId: string,
	options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryImportPresetSnapshotV1> {
	const key = photoImportPresetsKeyV1(catalogId), signal = admission(options);
	const value = await repository.get(key); checkSignal(signal);
	return value === undefined ? Object.freeze({ revision: 0, presets: Object.freeze([]) }) : snapshot(normalizePhotoImportPresetRowV1(value, catalogId));
}

/** Caller supplies the freshly loaded root under the existing catalog writer lease. */
export async function applyPhotoImportPresetV1(repository: PhotoImportPresetSettingsPortV1, catalog: unknown, value: unknown,
	options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryImportPresetSnapshotV1> {
	const command = normalizePhotoImportPresetCommandV1(value), signal = admission(options);
	const root = validateLightscaperDocumentV1(catalog);
	if (root.kind !== 'photo-catalog') throw new TypeError('Import presets require the current catalog root.');
	if (command.type === 'save') {
		const available = new Set(root.keywords.map(keyword => keyword.id));
		for (const key of command.settings.keywordIds) if (!available.has(key)) throw new ReferenceError('Import preset references a missing keyword.');
	}
	const key = photoImportPresetsKeyV1(root.id), raw = await repository.get(key); checkSignal(signal);
	const current = raw === undefined ? { revision: 0, presets: [] } : normalizePhotoImportPresetRowV1(raw, root.id);
	if (current.revision !== command.expectedRevision) throw new PhotoImportPresetRevisionConflictError();
	const presets: PhotoLibraryImportPresetV1[] = current.presets.filter(preset => preset.id !== command.id);
	if (command.type === 'delete' && presets.length === current.presets.length) throw new ReferenceError('Import preset is missing.');
	if (command.type === 'save') presets.push({ id: command.id, name: command.name, settings: command.settings });
	const next = normalizePhotoImportPresetRowV1({ schemaVersion: 1, kind: 'photo-import-presets', catalogId: root.id, revision: current.revision + 1, presets }, root.id);
	checkSignal(signal);
	let published: boolean;
	try {
		published = raw === undefined ? await repository.putIfAbsent(key, next) : await repository.replaceIfCurrent(key, raw, next);
	} catch (failure) {
		let actual: Readonly<PhotoImportPresetRowV1> | undefined;
		try {
			const recovered = await repository.get(key);
			actual = recovered === undefined ? undefined : normalizePhotoImportPresetRowV1(recovered, root.id);
		}
		catch (reconciliationFailure) { throw new AggregateError([failure, reconciliationFailure], 'Import preset publication could not be reconciled.', { cause: reconciliationFailure }); }
		if (actual && sameRow(actual, next)) return snapshot(actual);
		throw failure;
	}
	if (published) return snapshot(next);
	checkSignal(signal); throw new PhotoImportPresetRevisionConflictError();
}

function requiredSettings(value: unknown) {
	if (value === undefined) throw new TypeError('Stored and saved presets require explicit import settings.');
	return normalizePhotoImportSettingsV1(value);
}

/** Compare one recipe at a time, retaining two bounded recipe strings rather than two whole rows. */
function sameRow(left: PhotoImportPresetRowV1, right: PhotoImportPresetRowV1): boolean {
	return left.catalogId === right.catalogId && left.revision === right.revision && left.presets.length === right.presets.length
		&& left.presets.every((preset, index) => {
			const other = right.presets[index]!;
			return preset.id === other.id && preset.name === other.name && JSON.stringify(preset.settings) === JSON.stringify(other.settings);
		});
}

function snapshot(row: PhotoLibraryImportPresetSnapshotV1): PhotoLibraryImportPresetSnapshotV1 {
	return Object.freeze({ revision: row.revision, presets: row.presets });
}

function admission(value: unknown): AbortSignal | undefined {
	const input = record(value, 'import preset options', ['signal'], []);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
	if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('Import presets require a native cancellation signal.');
	checkSignal(signal); return signal;
}

function checkSignal(signal?: AbortSignal): void {
	if (!signal) return;
	Reflect.apply(nativeThrowIfAborted, signal, []);
	if (Object.getPrototypeOf(signal) !== AbortSignal.prototype
		|| ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(signal, key))) {
		throw new TypeError('Import presets require native signal behavior without overrides.');
	}
}
