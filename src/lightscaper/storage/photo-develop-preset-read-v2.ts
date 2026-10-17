/* SPDX-License-Identifier: AGPL-3.0-only */

import type { KeyValueEntry } from '../../common/editor/storage/key-value-repository.ts';
import type { PhotoDevelopPresetReadPortV1, PhotoDevelopPresetSettingsPortV1 } from './photo-develop-presets-v1.ts';
import { field, record } from '../catalog/value-validation.ts';
import { assertPhotoStackQuerySignalV1 } from '../catalog/photo-stack-query-signal-v1.ts';
export { photoDevelopPresetEntryValue } from './photo-develop-preset-read.ts';

/** Intrinsic preabort precedes mutable native shadows; options are detached before any host acquisition. */
export function readPhotoDevelopSignalOptionsV2(value: unknown): Readonly<{ signal?: AbortSignal }> {
	const input = record(value, 'Develop signal options', ['signal'], []);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
	if (signal === undefined) return Object.freeze({});
	assertPhotoStackQuerySignalV1(signal); return Object.freeze({ signal });
}

/** Current reads pin the capability and receiver without borrowing callable metadata. */
export function borrowPhotoDevelopPresetEntryReaderV2(repository: PhotoDevelopPresetReadPortV1): (key: string) => Promise<KeyValueEntry> {
	const readEntry = repository.readEntry;
	if (readEntry !== undefined) {
		if (typeof readEntry !== 'function') throw new TypeError('Develop presets require a callable point-entry capability.');
		return key => Reflect.apply(readEntry, repository, [key]) as Promise<KeyValueEntry>;
	}
	const get = repository.get;
	if (typeof get !== 'function') throw new TypeError('Develop presets require a settings read capability.');
	return async key => {
		const value: unknown = await Reflect.apply(get, repository, [key]);
		return value === undefined ? { present: false } : { present: true, value };
	};
}

/** Capture all methods before initialization or an acquisition wait. */
export function borrowPhotoDevelopPresetSettingsV2(repository: PhotoDevelopPresetSettingsPortV1): PhotoDevelopPresetSettingsPortV1 {
	const readEntry = borrowPhotoDevelopPresetEntryReaderV2(repository), put = repository.putIfAbsent, replace = repository.replaceIfCurrent;
	if (typeof put !== 'function' || typeof replace !== 'function') throw new TypeError('Develop presets require conditional write capabilities.');
	return Object.freeze({ readEntry, get: async key => {
		const entry = await readEntry(key); return entry.present ? entry.value : undefined;
	}, putIfAbsent: (...args: Parameters<typeof put>) => Reflect.apply(put, repository, args) as ReturnType<typeof put>,
	replaceIfCurrent: (...args: Parameters<typeof replace>) => Reflect.apply(replace, repository, args) as ReturnType<typeof replace> });
}
