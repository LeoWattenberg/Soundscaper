/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField as field, readClosedDomainRecord } from '../../../closed-domain-value.ts';
import { createPhotoLibraryImportCollectorV1, detachPhotoLibraryImportSettingsV1 } from '../../../controller/shared/photo-library-import-gesture-v1.ts';
import type { PhotoLibraryDevelopPresetReadV2 } from '../../../photo-library-develop-presets-port-v2.ts';
import type { PhotoLibraryDevelopPresetReadV3 } from '../../../photo-library-develop-presets-port-v3.ts';
import type { PhotoLibraryImportSettingsV1 } from '../../../photo-library-import-settings-port-v1.ts';
import type { PhotoLibrarySessionPortV2 } from '../../../photo-library-session-port-v2.ts';
import type { PhotoLibrarySessionPortCurrentV1 } from '../../../photo-library-session-port-current-v1.ts';

type Profile = 'legacy2' | 'current3';
type Choice = PhotoLibraryDevelopPresetReadV2 | PhotoLibraryDevelopPresetReadV3;
interface Draft {
	readonly selected: readonly File[];
	readonly signal: AbortSignal | undefined;
	readonly collector: ReturnType<typeof createPhotoLibraryImportCollectorV1>;
	readonly settings: PhotoLibraryImportSettingsV1 | undefined;
	readonly developPreset: Choice | undefined;
}
export type PhotoLibraryImportDraftLegacyV2 = Omit<Draft, 'developPreset'> & { readonly developPreset: PhotoLibraryDevelopPresetReadV2 | undefined };
export type PhotoLibraryImportDraftCurrentV1 = Omit<Draft, 'developPreset'> & { readonly developPreset: PhotoLibraryDevelopPresetReadV3 | undefined };
type LegacyOwner = Pick<PhotoLibrarySessionPortV2, 'importFiles' | 'developImport'>;
type CurrentOwner = Pick<PhotoLibrarySessionPortCurrentV1, 'importFiles' | 'developImportCurrent'>;
const nativeCheck = AbortSignal.prototype.throwIfAborted;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeFileName = Object.getOwnPropertyDescriptor(File.prototype, 'name')!.get!;

export function detachPhotoLibraryImportGestureForProfileV1(profile: 'legacy2', files: unknown, options?: unknown, captureSignal?: (signal: AbortSignal | undefined) => void): PhotoLibraryImportDraftLegacyV2;
export function detachPhotoLibraryImportGestureForProfileV1(profile: 'current3', files: unknown, options?: unknown, captureSignal?: (signal: AbortSignal | undefined) => void): PhotoLibraryImportDraftCurrentV1;
/** Capture the complete gesture before selected-library acquisition can yield. */
export function detachPhotoLibraryImportGestureForProfileV1(profile: Profile, files: unknown, options: unknown = {}, captureSignal?: (signal: AbortSignal | undefined) => void): Draft {
	admit(profile);
	const descriptor = options && typeof options === 'object' ? Object.getOwnPropertyDescriptor(options, 'signal') : undefined;
	if (descriptor && !Object.hasOwn(descriptor, 'value')) throw new TypeError('Import signal must be an own data property.');
	const signal = descriptor?.value as AbortSignal | undefined;
	if (signal !== undefined) Reflect.apply(nativeAborted, signal, []);
	captureSignal?.(signal);
	const check = () => { if (signal !== undefined) Reflect.apply(nativeCheck, signal, []); };
	check();
	try {
		const record = readClosedDomainRecord(options, 'Import options', ['settings', 'signal', 'developPreset'], []);
		const selected = Object.freeze(readClosedDomainArray(files, 'Import Files', 1, 64).map(value => {
			Reflect.apply(nativeFileName, value, []); return value as File;
		}));
		const names = selected.map(file => Reflect.apply(nativeFileName, file, []) as string);
		const settings = Object.hasOwn(record, 'settings') ? field(record, 'settings', 'Import options') : undefined;
		const developPreset = Object.hasOwn(record, 'developPreset') ? field(record, 'developPreset', 'Import options') : undefined;
		const draft = Object.freeze({ selected, signal, collector: createPhotoLibraryImportCollectorV1(names),
			settings: settings === undefined ? undefined : detachPhotoLibraryImportSettingsV1(settings),
			developPreset: developPreset === undefined ? undefined : detachPhotoLibraryImportDevelopPresetForProfileV1(profile, developPreset) });
		check(); return draft;
	} catch (error) { check(); throw error; }
}

/** Scope ACK observation to the one selected request; receipts outlive later refresh failures. */
export async function executePhotoLibraryImportGestureForProfileV1(profile: Profile, owner: LegacyOwner | CurrentOwner,
	draft: Draft, signal: AbortSignal, publish: () => void): Promise<void> {
	admit(profile); let observing = true;
	const request = { signal, ...(draft.settings === undefined ? {} : { settings: draft.settings }),
		onAcknowledged: (item: unknown) => { if (observing && draft.collector.acknowledge(item)) publish(); } };
	try {
		let results: unknown;
		if (draft.developPreset) {
			const port = profile === 'current3' ? (owner as CurrentOwner).developImportCurrent : (owner as LegacyOwner).developImport;
			if (profile === 'current3' && (!port || port.schemaVersion !== 3)) throw new Error('Current Develop preset import is unavailable.');
			const write = port!.importFiles; Reflect.apply(nativeCheck, signal, []);
			results = await Reflect.apply(write, port, [draft.selected, { ...request, schemaVersion: profile === 'current3' ? 3 : 2, developPreset: draft.developPreset }]);
		} else {
			const write = owner.importFiles; Reflect.apply(nativeCheck, signal, []);
			results = await Reflect.apply(write, owner, [draft.selected, request]);
		}
		observing = false; draft.collector.finish(results);
	} finally { observing = false; }
}

export function detachPhotoLibraryImportDevelopPresetForProfileV1(profile: 'legacy2', value: unknown): PhotoLibraryDevelopPresetReadV2;
export function detachPhotoLibraryImportDevelopPresetForProfileV1(profile: 'current3', value: unknown): PhotoLibraryDevelopPresetReadV3;
export function detachPhotoLibraryImportDevelopPresetForProfileV1(profile: Profile, value: unknown): Choice;
export function detachPhotoLibraryImportDevelopPresetForProfileV1(profile: Profile, value: unknown): Choice {
	admit(profile);
	const name = 'Import Develop preset', record = readClosedDomainRecord(value, name, ['schemaVersion', 'catalogId', 'presetId', 'expectedRevision']);
	const schemaVersion = profile === 'current3' ? 3 : 2;
	if (field(record, 'schemaVersion', name) !== schemaVersion) throw new RangeError('Unsupported current import Develop preset version.');
	const catalogId = field(record, 'catalogId', name), presetId = field(record, 'presetId', name), expectedRevision = field(record, 'expectedRevision', name);
	if (typeof catalogId !== 'string' || typeof presetId !== 'string'
		|| !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(catalogId) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(presetId)) {
		throw new TypeError('Import Develop presets require stable identities.');
	}
	if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || Object.is(expectedRevision, -0)) {
		throw new RangeError('Import Develop presets require a canonical bounded revision.');
	}
	return Object.freeze({ schemaVersion, catalogId, presetId, expectedRevision });
}
function admit(profile: Profile): void { if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unknown Import gesture profile.'); }
