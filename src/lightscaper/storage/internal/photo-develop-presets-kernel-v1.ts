/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPresetCommandV2, PhotoLibraryDevelopPresetSnapshotV2, PhotoLibraryDevelopPresetBodyV2,
	PhotoLibraryDevelopPresetV2 } from '../../../common/editor/photo-library-develop-presets-port-v2.ts';
import { normalizeImageDevelopPresetV1OrV2, serializeImageDevelopPresetV1OrV2 } from '../../../common/editor/imaging/image-develop-preset-v2.ts';
import { checkImageDevelopSettingsBytesV1 } from '../../../common/editor/imaging/image-develop-settings-v1.ts';
import { validateLightscaperDocumentV1 } from '../../catalog/documents.ts';
import { createPhotoCubeLutReachabilityV1 } from '../../catalog/photo-cube-lut-reachability-v1.ts';
import { field, id, integer, record } from '../../catalog/value-validation.ts';
import { normalizePhotoDevelopPresetRowV1OrV2 } from '../photo-develop-preset-row-v2.ts';
import { photoDevelopPresetsKeyV1, PHOTO_DEVELOP_PRESETS_LIMITS_V1 as LIMITS,
	PhotoDevelopPresetRevisionConflictError, type PhotoDevelopPresetReadPortV1, type PhotoDevelopPresetSettingsPortV1 } from '../photo-develop-presets-v1.ts';
import { borrowPhotoDevelopPresetEntryReaderV2, borrowPhotoDevelopPresetSettingsV2, photoDevelopPresetEntryValue, readPhotoDevelopSignalOptionsV2 } from '../photo-develop-preset-read-v2.ts';

import type { PhotoLibraryDevelopPresetSnapshotV3, PhotoLibraryDevelopPresetBodyV3, PhotoLibraryDevelopPresetCommandV3 } from '../../../common/editor/photo-library-develop-presets-port-v3.ts';
import type { PhotoLibraryDevelopPresetBodyCurrentV1, PhotoLibraryDevelopPresetCommandCurrentV1,
	PhotoLibraryDevelopPresetCurrentV1 } from '../../../common/editor/photo-library-develop-presets-port-current-v1.ts';
import { normalizeImageDevelopPresetCurrentForProfileV1 } from '../../../common/editor/imaging/internal/image-develop-preset-kernel-v1.ts';
import { normalizePhotoDevelopPresetRowCurrentV1, type PhotoDevelopPresetRowCurrentV1 } from '../photo-develop-preset-row-current-v1.ts';
import { normalizePhotoDevelopPresetRowCurrentForProfileV1 } from './photo-develop-preset-row-kernel-v1.ts';
import { createPhotoResourceReachabilityCurrentV1 } from '../../catalog/photo-resource-reachability-current-v1.ts';
import { verifyPhotoResourceReferencesCurrentV1, type PhotoResourceVerificationHostCurrentV1 } from '../photo-media-resource-verification-current-v1.ts';
import { assertPhotoDevelopSelectedMaskInputsCurrentV1 } from '../../controller/internal/photo-develop-selected-mask-inputs-current-v1.ts';
export interface PhotoDevelopPresetOptionsV2 {
	readonly signal?: AbortSignal;
	readonly verifyResources?: (preset: PhotoLibraryDevelopPresetV2, signal?: AbortSignal) => Promise<void>;
}
export interface PhotoDevelopPresetOptionsCurrentV1 { readonly signal?: AbortSignal; readonly resources?: PhotoResourceVerificationHostCurrentV1; }
type Profile = 'legacy2' | 'current3' | 'current4';
type Options = PhotoDevelopPresetOptionsV2 | PhotoDevelopPresetOptionsCurrentV1;
type Command = PhotoLibraryDevelopPresetCommandV2 | PhotoLibraryDevelopPresetCommandV3 | PhotoLibraryDevelopPresetCommandCurrentV1;
type Snapshot = PhotoLibraryDevelopPresetSnapshotV2 | PhotoLibraryDevelopPresetSnapshotV3;
type Body = PhotoLibraryDevelopPresetBodyV2 | PhotoLibraryDevelopPresetBodyV3 | PhotoLibraryDevelopPresetBodyCurrentV1;
type Preset = PhotoLibraryDevelopPresetCurrentV1;
type Row = PhotoDevelopPresetRowCurrentV1;
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal) Reflect.apply(CHECK, signal, []); }

export function normalizePhotoDevelopPresetCommandForProfileV1(profile: Profile, value: unknown): Command {
	assertProfile(profile); const input = record(value, 'Develop preset command', ['type', 'expectedRevision', 'preset', 'presetId'], ['type', 'expectedRevision']);
	const expectedRevision = integer(field(input, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'Develop preset expected revision');
	let command: Command;
	if (field(input, 'type') === 'delete') {
		record(input, 'delete Develop preset', ['type', 'expectedRevision', 'presetId']);
		command = Object.freeze({ type: 'delete', expectedRevision, presetId: id(field(input, 'presetId'), 'Develop preset ID') });
	} else {
		record(input, 'save Develop preset', ['type', 'expectedRevision', 'preset']);
		if (field(input, 'type') !== 'save') throw new RangeError('Unsupported Develop preset command.');
		command = Object.freeze({ type: 'save', expectedRevision, preset: normalizePreset(profile, field(input, 'preset')) });
	}
	checkImageDevelopSettingsBytesV1(command); return command;
}

export async function readPhotoDevelopPresetsForProfileV1(profile: Profile, repository: PhotoDevelopPresetReadPortV1, catalogId: string,
	options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Snapshot> {
	assertProfile(profile); nativePreabort(profile, options);
	const key = photoDevelopPresetsKeyV1(catalogId), { signal } = signalOptions(profile, options); check(signal);
	const read = borrowPhotoDevelopPresetEntryReaderV2(repository), entry = await read(key); check(signal);
	const raw = photoDevelopPresetEntryValue(entry);
	return snapshot(profile, raw === undefined ? { catalogId, revision: 0, presets: [] } : admit(profile, signal, () => normalizeRow(profile, raw, catalogId)));
}
export async function readPhotoDevelopPresetForProfileV1(profile: Profile, repository: PhotoDevelopPresetReadPortV1, catalogId: string, presetId: string,
	expectedRevision: number, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Body> {
	assertProfile(profile); nativePreabort(profile, options);
	const key = photoDevelopPresetsKeyV1(catalogId), selected = id(presetId, 'Develop preset ID');
	const expected = integer(expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'Develop preset expected revision');
	const { signal } = signalOptions(profile, options); check(signal);
	const read = borrowPhotoDevelopPresetEntryReaderV2(repository), entry = await read(key); check(signal);
	const raw = photoDevelopPresetEntryValue(entry);
	const row = raw === undefined ? { catalogId, revision: 0, presets: [] } : admit(profile, signal, () => normalizeRow(profile, raw, catalogId));
	if (row.revision !== expected) throw new PhotoDevelopPresetRevisionConflictError();
	const preset = row.presets.find(preset => preset.identity.id === selected);
	if (!preset) throw new ReferenceError('Develop preset is missing.');
	return Object.freeze({ schemaVersion: profile === 'legacy2' ? 2 : 3, catalogId, revision: row.revision, preset }) as Body;
}

/** Borrow the selected catalog writer. All next-row resources are authenticated before conditional publication. */
export async function applyPhotoDevelopPresetForProfileV1(profile: Profile, repository: PhotoDevelopPresetSettingsPortV1, catalog: unknown, value: unknown,
	options: Options = {}): Promise<Snapshot> {
	assertProfile(profile); const firstSignal = nativePreabort(profile, options);
	const input = admit(profile, firstSignal, () => record(options, 'Develop preset options', profile === 'legacy2' ? ['signal', 'verifyResources'] : ['signal', 'resources'], []));
	const { signal } = admit(profile, firstSignal, () => readPhotoDevelopSignalOptionsV2(Object.hasOwn(input, 'signal') ? { signal: field(input, 'signal') } : {})); check(signal);
	const verifier = profile === 'legacy2' && Object.hasOwn(input, 'verifyResources') ? field(input, 'verifyResources') : undefined;
	const resources = admit(profile, signal, () => {
		const rawResources = profile !== 'legacy2' && Object.hasOwn(input, 'resources') ? field(input, 'resources') : undefined;
		return rawResources === undefined ? undefined : captureResources(rawResources);
	});
	if (verifier !== undefined && typeof verifier !== 'function') throw new TypeError('Develop preset resource verification must be callable.');
	const { command, root } = admit(profile, signal, () => ({ command: normalizePhotoDevelopPresetCommandForProfileV1(profile, value), root: validateLightscaperDocumentV1(catalog) }));
	if (root.kind !== 'photo-catalog') throw new TypeError('Develop presets require the current catalog root.');
	const pinned = borrowPhotoDevelopPresetSettingsV2(repository), read = borrowPhotoDevelopPresetEntryReaderV2(pinned);
	const key = photoDevelopPresetsKeyV1(root.id); check(signal);
	const entry = await read(key); check(signal);
	const raw = photoDevelopPresetEntryValue(entry);
	const current = raw === undefined ? { catalogId: root.id, revision: 0, presets: [], schemaVersion: 1 as const }
		: admit(profile, signal, () => normalizeRow(profile, raw, root.id));
	if (current.revision !== command.expectedRevision) throw new PhotoDevelopPresetRevisionConflictError();
	const selected = command.type === 'save' ? command.preset.identity.id : command.presetId;
	const existing = current.presets.find(preset => preset.identity.id === selected);
	if (command.type === 'delete' && !existing) throw new ReferenceError('Develop preset is missing.');
	const unchanged = command.type === 'save' && existing !== undefined
		&& serializePreset(profile, existing) === serializePreset(profile, command.preset);
	const presets = unchanged ? [...current.presets] : current.presets.filter(preset => preset.identity.id !== selected);
	if (!unchanged && command.type === 'save') presets.push(command.preset);
	const schemaVersion = profile === 'current4' && (current.schemaVersion === 4 || presets.some(preset => preset.schemaVersion === 4)) ? 4
		: profile !== 'legacy2' && (current.schemaVersion === 3 || presets.some(preset => preset.schemaVersion === 3)) ? 3
		: current.schemaVersion === 2 || presets.some(preset => preset.schemaVersion === 2) ? 2 : 1;
	const body = { schemaVersion, kind: 'photo-develop-presets', catalogId: root.id, revision: current.revision + (unchanged ? 0 : 1), presets };
	const next = admit(profile, signal, () => normalizeRow(profile, body, root.id));
	if (profile !== 'legacy2') await verifyRow(next, resources, signal);
	else {
		// One ledger proves complete retained reference geometry and its shared capacity, including disabled instances.
		const closure = createPhotoCubeLutReachabilityV1(); for (const preset of next.presets) closure.addPreset(preset);
		if (closure.finish().length > 0) {
			if (typeof verifier !== 'function') throw new TypeError('Develop preset resources require selected-library verification.');
			for (const preset of next.presets) {
				const packet = createPhotoCubeLutReachabilityV1(); packet.addPreset(preset);
				if (packet.finish().length > 0) { await Reflect.apply(verifier, options, [preset, signal]); check(signal); }
			}
		}
	}
	if (unchanged) return snapshot(profile, next);
	check(signal);
	let published: boolean;
	try { published = raw === undefined ? await pinned.putIfAbsent(key, next) : await pinned.replaceIfCurrent(key, raw, next); }
	catch (failure) {
		let actual: Row | undefined;
		try { const recovered = photoDevelopPresetEntryValue(await read(key)); actual = recovered === undefined ? undefined : normalizeRow(profile, recovered, root.id); }
		catch (reconciliationFailure) { throw new AggregateError([failure, reconciliationFailure], 'Develop preset publication could not be reconciled.', { cause: reconciliationFailure }); }
		if (actual && JSON.stringify(actual) === JSON.stringify(next)) return snapshot(profile, actual);
		throw failure;
	}
	if (published) return snapshot(profile, next);
	check(signal); throw new PhotoDevelopPresetRevisionConflictError();
}

function snapshot(profile: Profile, row: Readonly<{ catalogId: string; revision: number; presets: readonly Preset[] }>): Snapshot {
	const result = Object.freeze({ schemaVersion: profile === 'legacy2' ? 2 as const : 3 as const, catalogId: row.catalogId, revision: row.revision,
		presets: Object.freeze(row.presets.map(preset => Object.freeze({ id: preset.identity.id, name: preset.identity.name,
			authoredStateSha256: preset.identity.authoredStateSha256,
			scope: fullSelection(preset) ? 'full' as const : 'partial' as const }))) });
	if (new TextEncoder().encode(JSON.stringify(result)).byteLength > LIMITS.maximumMenuBytes) throw new RangeError('Develop preset menu exceeds its scalar byte bound.');
	return result as Snapshot;
}
function fullSelection(preset: Preset): boolean {
	const selection = preset.settings.selection;
	const repairs = preset.schemaVersion === 3 || preset.schemaVersion === 4 ? preset.settings.selection.repairs : true;
	const rawDevelopment = preset.schemaVersion === 4 ? preset.settings.selection.rawDevelopment : true;
	return selection.effectTypes === 'all' && selection.geometry && selection.localAdjustments && repairs && rawDevelopment;
}

/** Only this named native binding supplies stored settings to Current batch
 * application. It authenticates the complete row and rechecks the same row
 * before every target; no arbitrary packet enters clipboard enrollment. */
export async function preparePhotoDevelopPresetBatchCurrentKernelV1(repository: PhotoDevelopPresetReadPortV1, catalogId: string, presetId: string,
	expectedRevision: number, options: PhotoDevelopPresetOptionsCurrentV1 = {}) {
	return preparePhotoDevelopPresetBatchForProfileV1('current4', repository, catalogId, presetId, expectedRevision, options);
}
export async function preparePhotoDevelopPresetBatchForProfileV1(profile: 'current3' | 'current4', repository: PhotoDevelopPresetReadPortV1, catalogId: string, presetId: string,
	expectedRevision: number, options: PhotoDevelopPresetOptionsCurrentV1 = {}) {
	assertProfile(profile);
	const firstSignal = nativePreabort(profile, options);
	const input = admit(profile, firstSignal, () => record(options, 'Current preset binding options', ['signal', 'resources'], []));
	const { signal } = signalOptions(profile, Object.hasOwn(input, 'signal') ? { signal: field(input, 'signal') } : {});
	const rawResources = Object.hasOwn(input, 'resources') ? field(input, 'resources') : undefined;
	const resources = rawResources === undefined ? undefined : captureResources(rawResources);
	const key = photoDevelopPresetsKeyV1(catalogId), selected = id(presetId, 'Develop preset ID'), expected = integer(expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'Develop preset revision');
	const read = borrowPhotoDevelopPresetEntryReaderV2(repository); check(signal);
	const initial = photoDevelopPresetEntryValue(await read(key)); check(signal);
	if (initial === undefined) throw new ReferenceError('Develop preset is missing.');
	const row = admit(profile, signal, () => normalizeRow(profile, initial, catalogId));
	if (row.revision !== expected) throw new PhotoDevelopPresetRevisionConflictError();
	const preset = row.presets.find(value => value.identity.id === selected);
	if (!preset) throw new ReferenceError('Develop preset is missing.');
	const serialized = JSON.stringify(row); await verifyRow(row, resources, signal); check(signal);
	const recheck = async () => {
		check(signal); const raw = photoDevelopPresetEntryValue(await read(key)); check(signal);
		if (raw === undefined || JSON.stringify(admit(profile, signal, () => normalizeRow(profile, raw, catalogId))) !== serialized) throw new PhotoDevelopPresetRevisionConflictError();
		check(signal);
	};
	await recheck(); return Object.freeze({ preset, recheck });
}

function normalizePreset(profile: Profile, value: unknown): Preset {
	return profile === 'legacy2' ? normalizeImageDevelopPresetV1OrV2(value)
		: profile === 'current3' ? normalizeImageDevelopPresetCurrentForProfileV1('current3', value, 'selected') : normalizeImageDevelopPresetCurrentForProfileV1('current4', value, 'selected');
}
function normalizeRow(profile: Profile, value: unknown, catalogId: string): Row {
	const row = profile === 'legacy2' ? normalizePhotoDevelopPresetRowV1OrV2(value, catalogId)
		: profile === 'current3' ? normalizePhotoDevelopPresetRowCurrentForProfileV1('current3', value, catalogId) : normalizePhotoDevelopPresetRowCurrentV1(value, catalogId);
	if (profile !== 'legacy2') for (const preset of row.presets) assertPhotoDevelopSelectedMaskInputsCurrentV1(preset.settings.develop);
	return row;
}
function serializePreset(profile: Profile, preset: Preset): string {
	return profile === 'legacy2' ? serializeImageDevelopPresetV1OrV2(preset) : JSON.stringify(normalizePreset(profile, preset));
}
function captureResources(value: unknown): Readonly<PhotoResourceVerificationHostCurrentV1> {
	const input = record(value, 'Selected preset resource factories', ['cubeLutResources', 'maskRasterResources']);
	const luts = field(input, 'cubeLutResources'), brushes = field(input, 'maskRasterResources');
	if (typeof luts !== 'function' || typeof brushes !== 'function') throw new TypeError('Selected preset resource factories must be callable.');
	return Object.freeze({ cubeLutResources: () => Reflect.apply(luts, value, []) as ReturnType<PhotoResourceVerificationHostCurrentV1['cubeLutResources']>,
		maskRasterResources: () => Reflect.apply(brushes, value, []) as ReturnType<PhotoResourceVerificationHostCurrentV1['maskRasterResources']> });
}
async function verifyRow(row: Row, resources: PhotoResourceVerificationHostCurrentV1 | undefined, signal?: AbortSignal): Promise<void> {
	const collector = createPhotoResourceReachabilityCurrentV1();
	for (const preset of row.presets) { assertPhotoDevelopSelectedMaskInputsCurrentV1(preset.settings.develop); collector.addDevelop(preset.settings.develop); }
	const references = collector.finish(); check(signal);
	if (!references.luts.length && !references.brushes.length) return;
	if (!resources) throw new TypeError('Current native preset bodies require selected-library verification.');
	await verifyPhotoResourceReferencesCurrentV1(references, resources, signal); check(signal);
}
function nativePreabort(profile: Profile, value: unknown): AbortSignal | undefined {
	if (profile === 'legacy2' || value === null || typeof value !== 'object') return;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'signal');
	if (descriptor && Object.hasOwn(descriptor, 'value')) { const signal = descriptor.value as AbortSignal | undefined; check(signal); return signal; }
}
function signalOptions(profile: Profile, value: unknown) { const signal = nativePreabort(profile, value); return admit(profile, signal, () => readPhotoDevelopSignalOptionsV2(value)); }
function assertProfile(profile: unknown): asserts profile is Profile {
	if (profile !== 'legacy2' && profile !== 'current3' && profile !== 'current4') throw new RangeError('Unsupported fixed native preset profile.');
}

function admit<Result>(profile: Profile, signal: AbortSignal | undefined, run: () => Result): Result {
	try { const result = run(); if (profile !== 'legacy2') check(signal); return result; }
	catch (error) { if (profile !== 'legacy2') check(signal); throw error; }
}
