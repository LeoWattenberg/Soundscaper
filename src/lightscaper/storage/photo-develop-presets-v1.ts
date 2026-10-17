/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPresetCommandV1, PhotoLibraryDevelopPresetSnapshotV1, PhotoLibraryDevelopPresetBodyV1 } from '../../common/editor/photo-library-develop-presets-port-v1.ts';
import type { ImageDevelopPresetV1 } from '../../common/editor/imaging/image-develop-preset-v1.ts';
import { normalizeImageDevelopPresetV1, serializeImageDevelopPresetV1 } from '../../common/editor/imaging/image-develop-preset-v1.ts';
import { checkImageDevelopSettingsBytesV1 } from '../../common/editor/imaging/image-develop-settings-v1.ts';
import type { KeyValueRepository } from '../../common/editor/storage/key-value-repository.ts';
import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import { readPhotoStackSignalOptionsV1 } from '../catalog/photo-stack-repository-v1.ts';
import { array, compareText, field, id, integer, record, unique } from '../catalog/value-validation.ts';
import { borrowPhotoDevelopPresetEntryReader, photoDevelopPresetEntryValue } from './photo-develop-preset-read.ts';

export const PHOTO_DEVELOP_PRESETS_LIMITS_V1 = Object.freeze({ maximumPresets: 16, maximumRowBytes: 10_485_760, maximumMenuBytes: 65_536 });
export type PhotoDevelopPresetReadPortV1 = Readonly<Partial<Pick<KeyValueRepository, 'get' | 'readEntry'>>>;
export type PhotoDevelopPresetSettingsPortV1 = Pick<KeyValueRepository, 'get' | 'putIfAbsent' | 'replaceIfCurrent'>
	& Readonly<Partial<Pick<KeyValueRepository, 'readEntry'>>>;
export interface PhotoDevelopPresetRowV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-develop-presets';
	readonly catalogId: string;
	readonly revision: number;
	readonly presets: readonly ImageDevelopPresetV1[];
}
const nativeAbort = AbortSignal.prototype.throwIfAborted;
export class PhotoDevelopPresetRevisionConflictError extends Error {
	readonly code = 'DEVELOP_PRESET_REVISION_CONFLICT';
	constructor() { super('Develop presets changed; reload before reading or saving.'); this.name = 'PhotoDevelopPresetRevisionConflictError'; }
}
export function photoDevelopPresetsKeyV1(catalogId: string): string { return `photo-library:develop-presets:v1:${id(catalogId, 'Develop preset catalog ID')}`; }

/** Admission and whole-request byte checks finish before any repository or Session acquisition. */
export function normalizePhotoDevelopPresetCommandV1(value: unknown): PhotoLibraryDevelopPresetCommandV1 {
	const input = record(value, 'Develop preset command', ['type', 'expectedRevision', 'preset', 'presetId'], ['type', 'expectedRevision']);
	const expectedRevision = integer(field(input, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'Develop preset expected revision');
	let command: PhotoLibraryDevelopPresetCommandV1;
	if (field(input, 'type') === 'delete') {
		record(input, 'delete Develop preset', ['type', 'expectedRevision', 'presetId']);
		command = Object.freeze({ type: 'delete', expectedRevision, presetId: id(field(input, 'presetId'), 'Develop preset ID') });
	} else {
		record(input, 'save Develop preset', ['type', 'expectedRevision', 'preset']);
		if (field(input, 'type') !== 'save') throw new RangeError('Unsupported Develop preset command.');
		command = Object.freeze({ type: 'save', expectedRevision, preset: normalizeImageDevelopPresetV1(field(input, 'preset')) });
	}
	checkImageDevelopSettingsBytesV1(command); return command;
}

export function normalizePhotoDevelopPresetRowV1(value: unknown, catalogId: string): PhotoDevelopPresetRowV1 {
	const catalog = id(catalogId, 'Develop preset catalog ID');
	const input = record(value, 'Develop preset row', ['schemaVersion', 'kind', 'catalogId', 'revision', 'presets']);
	if (field(input, 'schemaVersion') !== 1 || field(input, 'kind') !== 'photo-develop-presets' || field(input, 'catalogId') !== catalog) throw new RangeError('Unsupported or foreign Develop preset row.');
	let accumulated = 0;
	const presets = array(field(input, 'presets'), 'Develop presets', 0, PHOTO_DEVELOP_PRESETS_LIMITS_V1.maximumPresets).map(value => {
		const preset = normalizeImageDevelopPresetV1(value);
		accumulated += new TextEncoder().encode(JSON.stringify(preset)).byteLength;
		if (accumulated > PHOTO_DEVELOP_PRESETS_LIMITS_V1.maximumRowBytes) throw new RangeError('Develop preset row exceeds its UTF8 byte bound.');
		return preset;
	});
	unique(presets.map(preset => preset.identity.id), 'Develop presets');
	const row = Object.freeze({ schemaVersion: 1 as const, kind: 'photo-develop-presets' as const, catalogId: catalog,
		revision: integer(field(input, 'revision'), 1, Number.MAX_SAFE_INTEGER, 'Develop preset revision'),
		presets: Object.freeze(presets.sort((left, right) => compareText(left.identity.id, right.identity.id))) });
	if (new TextEncoder().encode(JSON.stringify(row)).byteLength > PHOTO_DEVELOP_PRESETS_LIMITS_V1.maximumRowBytes) throw new RangeError('Develop preset row exceeds its UTF8 byte bound.');
	return row;
}

export async function readPhotoDevelopPresetsV1(repository: PhotoDevelopPresetReadPortV1, catalogId: string,
	options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryDevelopPresetSnapshotV1> {
	const key = photoDevelopPresetsKeyV1(catalogId), { signal } = readPhotoStackSignalOptionsV1(options); checkSignal(signal);
	const read = borrowPhotoDevelopPresetEntryReader(repository), entry = await read(key); checkSignal(signal);
	const raw = photoDevelopPresetEntryValue(entry);
	return snapshot(raw === undefined ? { catalogId, revision: 0, presets: [] } : normalizePhotoDevelopPresetRowV1(raw, catalogId));
}

export async function readPhotoDevelopPresetV1(repository: PhotoDevelopPresetReadPortV1, catalogId: string, presetId: string,
	expectedRevision: number, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryDevelopPresetBodyV1> {
	const key = photoDevelopPresetsKeyV1(catalogId), selected = id(presetId, 'Develop preset ID');
	const expected = integer(expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'Develop preset expected revision');
	const { signal } = readPhotoStackSignalOptionsV1(options); checkSignal(signal);
	const read = borrowPhotoDevelopPresetEntryReader(repository), entry = await read(key); checkSignal(signal);
	const raw = photoDevelopPresetEntryValue(entry);
	const row = raw === undefined ? { catalogId, revision: 0, presets: [] } : normalizePhotoDevelopPresetRowV1(raw, catalogId);
	if (row.revision !== expected) throw new PhotoDevelopPresetRevisionConflictError();
	const preset = row.presets.find(preset => preset.identity.id === selected);
	if (!preset) throw new ReferenceError('Develop preset is missing.');
	return Object.freeze({ schemaVersion: 1, catalogId, revision: row.revision, preset });
}

/** Caller borrows the current root and catalog writer lease; this row never edits a photo or an import preset. */
export async function applyPhotoDevelopPresetV1(repository: PhotoDevelopPresetSettingsPortV1, catalog: unknown, value: unknown,
	options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryDevelopPresetSnapshotV1> {
	const command = normalizePhotoDevelopPresetCommandV1(value), { signal } = readPhotoStackSignalOptionsV1(options); checkSignal(signal);
	const root = validateLightscaperDocumentV1(catalog);
	if (root.kind !== 'photo-catalog') throw new TypeError('Develop presets require the current catalog root.');
	const key = photoDevelopPresetsKeyV1(root.id), read = borrowPhotoDevelopPresetEntryReader(repository), entry = await read(key); checkSignal(signal);
	const raw = photoDevelopPresetEntryValue(entry);
	const current = raw === undefined ? { catalogId: root.id, revision: 0, presets: [] } : normalizePhotoDevelopPresetRowV1(raw, root.id);
	if (current.revision !== command.expectedRevision) throw new PhotoDevelopPresetRevisionConflictError();
	const selected = command.type === 'save' ? command.preset.identity.id : command.presetId;
	const existing = current.presets.find(preset => preset.identity.id === selected);
	if (command.type === 'save' && existing && serializeImageDevelopPresetV1(existing) === serializeImageDevelopPresetV1(command.preset)) return snapshot(current);
	if (command.type === 'delete' && !existing) throw new ReferenceError('Develop preset is missing.');
	const presets = current.presets.filter(preset => preset.identity.id !== selected);
	if (command.type === 'save') presets.push(command.preset);
	const next = normalizePhotoDevelopPresetRowV1({ schemaVersion: 1, kind: 'photo-develop-presets', catalogId: root.id, revision: current.revision + 1, presets }, root.id);
	checkSignal(signal);
	let published: boolean;
	try { published = raw === undefined ? await repository.putIfAbsent(key, next) : await repository.replaceIfCurrent(key, raw, next); }
	catch (failure) {
		let actual: PhotoDevelopPresetRowV1 | undefined;
		try { const recovered = photoDevelopPresetEntryValue(await read(key)); actual = recovered === undefined ? undefined : normalizePhotoDevelopPresetRowV1(recovered, root.id); }
		catch (reconciliationFailure) { throw new AggregateError([failure, reconciliationFailure], 'Develop preset publication could not be reconciled.', { cause: reconciliationFailure }); }
		if (actual && sameRow(actual, next)) return snapshot(actual);
		throw failure;
	}
	if (published) return snapshot(next);
	checkSignal(signal); throw new PhotoDevelopPresetRevisionConflictError();
}

function sameRow(left: PhotoDevelopPresetRowV1, right: PhotoDevelopPresetRowV1): boolean {
	return left.catalogId === right.catalogId && left.revision === right.revision && left.presets.length === right.presets.length
		&& left.presets.every((preset, index) => serializeImageDevelopPresetV1(preset) === serializeImageDevelopPresetV1(right.presets[index]));
}
function snapshot(row: Readonly<{ catalogId: string; revision: number; presets: readonly ImageDevelopPresetV1[] }>): PhotoLibraryDevelopPresetSnapshotV1 {
	const result: PhotoLibraryDevelopPresetSnapshotV1 = Object.freeze({ schemaVersion: 1, catalogId: row.catalogId, revision: row.revision,
		presets: Object.freeze(row.presets.map(preset => Object.freeze({ id: preset.identity.id, name: preset.identity.name,
			authoredStateSha256: preset.identity.authoredStateSha256,
			scope: preset.settings.selection.effectTypes === 'all' && preset.settings.selection.geometry && preset.settings.selection.localAdjustments ? 'full' as const : 'partial' as const }))) });
	if (new TextEncoder().encode(JSON.stringify(result)).byteLength > PHOTO_DEVELOP_PRESETS_LIMITS_V1.maximumMenuBytes) throw new RangeError('Develop preset menu exceeds its scalar byte bound.');
	return result;
}
function checkSignal(signal?: AbortSignal): void { if (signal) Reflect.apply(nativeAbort, signal, []); }
