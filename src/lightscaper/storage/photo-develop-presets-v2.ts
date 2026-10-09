/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPresetCommandV2, PhotoLibraryDevelopPresetSnapshotV2, PhotoLibraryDevelopPresetBodyV2,
	PhotoLibraryDevelopPresetV2 } from '../../common/editor/photo-library-develop-presets-port-v2.ts';
import { normalizeImageDevelopPresetV1OrV2, serializeImageDevelopPresetV1OrV2 } from '../../common/editor/imaging/image-develop-preset-v2.ts';
import { checkImageDevelopSettingsBytesV1 } from '../../common/editor/imaging/image-develop-settings-v1.ts';
import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import { createPhotoCubeLutReachabilityV1 } from '../catalog/photo-cube-lut-reachability-v1.ts';
import { field, id, integer, record } from '../catalog/value-validation.ts';
import { normalizePhotoDevelopPresetRowV1OrV2 } from './photo-develop-preset-row-v2.ts';
import { photoDevelopPresetsKeyV1, normalizePhotoDevelopPresetRowV1, PHOTO_DEVELOP_PRESETS_LIMITS_V1 as LIMITS,
	PhotoDevelopPresetRevisionConflictError, type PhotoDevelopPresetReadPortV1, type PhotoDevelopPresetSettingsPortV1 } from './photo-develop-presets-v1.ts';
import { borrowPhotoDevelopPresetEntryReaderV2, borrowPhotoDevelopPresetSettingsV2, photoDevelopPresetEntryValue, readPhotoDevelopSignalOptionsV2 } from './photo-develop-preset-read-v2.ts';

export interface PhotoDevelopPresetOptionsV2 {
	readonly signal?: AbortSignal;
	readonly verifyResources?: (preset: PhotoLibraryDevelopPresetV2, signal?: AbortSignal) => Promise<void>;
}
type Row = ReturnType<typeof normalizePhotoDevelopPresetRowV1OrV2>;
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal) Reflect.apply(CHECK, signal, []); }

export function normalizePhotoDevelopPresetCommandV2(value: unknown): PhotoLibraryDevelopPresetCommandV2 {
	const input = record(value, 'Develop preset command', ['type', 'expectedRevision', 'preset', 'presetId'], ['type', 'expectedRevision']);
	const expectedRevision = integer(field(input, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'Develop preset expected revision');
	let command: PhotoLibraryDevelopPresetCommandV2;
	if (field(input, 'type') === 'delete') {
		record(input, 'delete Develop preset', ['type', 'expectedRevision', 'presetId']);
		command = Object.freeze({ type: 'delete', expectedRevision, presetId: id(field(input, 'presetId'), 'Develop preset ID') });
	} else {
		record(input, 'save Develop preset', ['type', 'expectedRevision', 'preset']);
		if (field(input, 'type') !== 'save') throw new RangeError('Unsupported Develop preset command.');
		command = Object.freeze({ type: 'save', expectedRevision, preset: normalizeImageDevelopPresetV1OrV2(field(input, 'preset')) });
	}
	checkImageDevelopSettingsBytesV1(command); return command;
}

export async function readPhotoDevelopPresetsV2(repository: PhotoDevelopPresetReadPortV1, catalogId: string,
	options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryDevelopPresetSnapshotV2> {
	const key = photoDevelopPresetsKeyV1(catalogId), { signal } = readPhotoDevelopSignalOptionsV2(options); check(signal);
	const read = borrowPhotoDevelopPresetEntryReaderV2(repository), entry = await read(key); check(signal);
	const raw = photoDevelopPresetEntryValue(entry);
	return snapshot(raw === undefined ? { catalogId, revision: 0, presets: [] } : normalizePhotoDevelopPresetRowV1OrV2(raw, catalogId));
}
export async function readPhotoDevelopPresetV2(repository: PhotoDevelopPresetReadPortV1, catalogId: string, presetId: string,
	expectedRevision: number, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryDevelopPresetBodyV2> {
	const key = photoDevelopPresetsKeyV1(catalogId), selected = id(presetId, 'Develop preset ID');
	const expected = integer(expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'Develop preset expected revision');
	const { signal } = readPhotoDevelopSignalOptionsV2(options); check(signal);
	const read = borrowPhotoDevelopPresetEntryReaderV2(repository), entry = await read(key); check(signal);
	const raw = photoDevelopPresetEntryValue(entry);
	const row = raw === undefined ? { catalogId, revision: 0, presets: [] } : normalizePhotoDevelopPresetRowV1OrV2(raw, catalogId);
	if (row.revision !== expected) throw new PhotoDevelopPresetRevisionConflictError();
	const preset = row.presets.find(preset => preset.identity.id === selected);
	if (!preset) throw new ReferenceError('Develop preset is missing.');
	return Object.freeze({ schemaVersion: 2, catalogId, revision: row.revision, preset });
}

/** Borrow the selected catalog writer. All next-row resources are authenticated before conditional publication. */
export async function applyPhotoDevelopPresetV2(repository: PhotoDevelopPresetSettingsPortV1, catalog: unknown, value: unknown,
	options: PhotoDevelopPresetOptionsV2 = {}): Promise<PhotoLibraryDevelopPresetSnapshotV2> {
	const input = record(options, 'Develop preset options', ['signal', 'verifyResources'], []);
	const { signal } = readPhotoDevelopSignalOptionsV2(Object.hasOwn(input, 'signal') ? { signal: field(input, 'signal') } : {}); check(signal);
	const verifier = Object.hasOwn(input, 'verifyResources') ? field(input, 'verifyResources') : undefined;
	if (verifier !== undefined && typeof verifier !== 'function') throw new TypeError('Develop preset resource verification must be callable.');
	const command = normalizePhotoDevelopPresetCommandV2(value), root = validateLightscaperDocumentV1(catalog);
	if (root.kind !== 'photo-catalog') throw new TypeError('Develop presets require the current catalog root.');
	const pinned = borrowPhotoDevelopPresetSettingsV2(repository), read = borrowPhotoDevelopPresetEntryReaderV2(pinned);
	const key = photoDevelopPresetsKeyV1(root.id); check(signal);
	const entry = await read(key); check(signal);
	const raw = photoDevelopPresetEntryValue(entry);
	const current = raw === undefined ? { catalogId: root.id, revision: 0, presets: [], schemaVersion: 1 as const }
		: normalizePhotoDevelopPresetRowV1OrV2(raw, root.id);
	if (current.revision !== command.expectedRevision) throw new PhotoDevelopPresetRevisionConflictError();
	const selected = command.type === 'save' ? command.preset.identity.id : command.presetId;
	const existing = current.presets.find(preset => preset.identity.id === selected);
	if (command.type === 'delete' && !existing) throw new ReferenceError('Develop preset is missing.');
	const unchanged = command.type === 'save' && existing !== undefined
		&& serializeImageDevelopPresetV1OrV2(existing) === serializeImageDevelopPresetV1OrV2(command.preset);
	const presets = unchanged ? [...current.presets] : current.presets.filter(preset => preset.identity.id !== selected);
	if (!unchanged && command.type === 'save') presets.push(command.preset);
	const schemaVersion = current.schemaVersion === 2 || presets.some(preset => preset.schemaVersion === 2) ? 2 : 1;
	const body = { schemaVersion, kind: 'photo-develop-presets', catalogId: root.id, revision: current.revision + (unchanged ? 0 : 1), presets };
	const next = schemaVersion === 1 ? normalizePhotoDevelopPresetRowV1(body, root.id) : normalizePhotoDevelopPresetRowV1OrV2(body, root.id);
	// One ledger proves complete retained reference geometry and its shared capacity, including disabled instances.
	const closure = createPhotoCubeLutReachabilityV1(); for (const preset of next.presets) closure.addPreset(preset);
	if (closure.finish().length > 0) {
		if (typeof verifier !== 'function') throw new TypeError('Develop preset resources require selected-library verification.');
		for (const preset of next.presets) {
			const packet = createPhotoCubeLutReachabilityV1(); packet.addPreset(preset);
			if (packet.finish().length > 0) { await Reflect.apply(verifier, options, [preset, signal]); check(signal); }
		}
	}
	if (unchanged) return snapshot(next);
	check(signal);
	let published: boolean;
	try { published = raw === undefined ? await pinned.putIfAbsent(key, next) : await pinned.replaceIfCurrent(key, raw, next); }
	catch (failure) {
		let actual: Row | undefined;
		try { const recovered = photoDevelopPresetEntryValue(await read(key)); actual = recovered === undefined ? undefined : normalizePhotoDevelopPresetRowV1OrV2(recovered, root.id); }
		catch (reconciliationFailure) { throw new AggregateError([failure, reconciliationFailure], 'Develop preset publication could not be reconciled.', { cause: reconciliationFailure }); }
		if (actual && JSON.stringify(actual) === JSON.stringify(next)) return snapshot(actual);
		throw failure;
	}
	if (published) return snapshot(next);
	check(signal); throw new PhotoDevelopPresetRevisionConflictError();
}

function snapshot(row: Readonly<{ catalogId: string; revision: number; presets: readonly PhotoLibraryDevelopPresetV2[] }>): PhotoLibraryDevelopPresetSnapshotV2 {
	const result = Object.freeze({ schemaVersion: 2 as const, catalogId: row.catalogId, revision: row.revision,
		presets: Object.freeze(row.presets.map(preset => Object.freeze({ id: preset.identity.id, name: preset.identity.name,
			authoredStateSha256: preset.identity.authoredStateSha256,
			scope: preset.settings.selection.effectTypes === 'all' && preset.settings.selection.geometry && preset.settings.selection.localAdjustments ? 'full' as const : 'partial' as const }))) });
	if (new TextEncoder().encode(JSON.stringify(result)).byteLength > LIMITS.maximumMenuBytes) throw new RangeError('Develop preset menu exceeds its scalar byte bound.');
	return result;
}
