/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField as field, readClosedDomainRecord } from '../../closed-domain-value.ts';
import { createPhotoLibraryImportCollectorV1, detachPhotoLibraryImportSettingsV1 } from '../../controller/shared/photo-library-import-gesture-v1.ts';
import type { PhotoLibraryDevelopPresetReadV2 } from '../../photo-library-develop-presets-port-v2.ts';
import type { PhotoLibraryImportSettingsV1 } from '../../photo-library-import-settings-port-v1.ts';
import type { PhotoLibrarySessionPortV2 } from '../../photo-library-session-port-v2.ts';

export interface PhotoLibraryImportGestureOptionsV2 {
	readonly signal?: AbortSignal;
	readonly settings?: PhotoLibraryImportSettingsV1;
	readonly developPreset?: PhotoLibraryDevelopPresetReadV2;
}
const nativeCheck = AbortSignal.prototype.throwIfAborted;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeFileName = Object.getOwnPropertyDescriptor(File.prototype, 'name')!.get!;

/** Capture the complete gesture before selected-library acquisition can yield. */
export function detachPhotoLibraryImportGestureV2(files: unknown, options: unknown = {}, captureSignal?: (signal: AbortSignal | undefined) => void) {
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
			developPreset: developPreset === undefined ? undefined : detachPhotoLibraryImportDevelopPresetV2(developPreset) });
		check(); return draft;
	} catch (error) { check(); throw error; }
}

/** Scope ACK observation to the one selected request; receipts outlive later refresh failures. */
export async function executePhotoLibraryImportGestureV2(owner: Pick<PhotoLibrarySessionPortV2, 'importFiles' | 'developImport'>,
	draft: ReturnType<typeof detachPhotoLibraryImportGestureV2>, signal: AbortSignal, publish: () => void): Promise<void> {
	let observing = true;
	const request = { signal, ...(draft.settings === undefined ? {} : { settings: draft.settings }),
		onAcknowledged: (item: unknown) => { if (observing && draft.collector.acknowledge(item)) publish(); } };
	try {
		let results;
		if (draft.developPreset) {
			const port = owner.developImport, write = port.importFiles; Reflect.apply(nativeCheck, signal, []);
			results = await Reflect.apply(write, port, [draft.selected, { ...request, schemaVersion: 2, developPreset: draft.developPreset }]) as Awaited<ReturnType<typeof write>>;
		} else {
			const write = owner.importFiles; Reflect.apply(nativeCheck, signal, []);
			results = await Reflect.apply(write, owner, [draft.selected, request]) as Awaited<ReturnType<typeof write>>;
		}
		observing = false; draft.collector.finish(results);
	} finally { observing = false; }
}

export function detachPhotoLibraryImportDevelopPresetV2(value: unknown): PhotoLibraryDevelopPresetReadV2 {
	const name = 'Import Develop preset', record = readClosedDomainRecord(value, name, ['schemaVersion', 'catalogId', 'presetId', 'expectedRevision']);
	if (field(record, 'schemaVersion', name) !== 2) throw new RangeError('Unsupported current import Develop preset version.');
	const catalogId = field(record, 'catalogId', name), presetId = field(record, 'presetId', name), expectedRevision = field(record, 'expectedRevision', name);
	if (typeof catalogId !== 'string' || typeof presetId !== 'string'
		|| !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(catalogId) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(presetId)) {
		throw new TypeError('Import Develop presets require stable identities.');
	}
	if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || Object.is(expectedRevision, -0)) {
		throw new RangeError('Import Develop presets require a canonical bounded revision.');
	}
	return Object.freeze({ schemaVersion: 2, catalogId, presetId, expectedRevision });
}
