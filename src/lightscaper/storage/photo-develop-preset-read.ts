/* SPDX-License-Identifier: AGPL-3.0-only */

import type { KeyValueEntry, KeyValueRepository } from '../../common/editor/storage/key-value-repository.ts';
import { field, record } from '../catalog/value-validation.ts';

/** Pin the method and receiver before acquisition. Get-only custom ports retain their legacy contract. */
export function borrowPhotoDevelopPresetEntryReader(repository: Readonly<Partial<Pick<KeyValueRepository, 'get' | 'readEntry'>>>,
	requirePresence = false): (key: string) => Promise<KeyValueEntry> {
	const readEntry = repository.readEntry;
	if (readEntry !== undefined) {
		if (typeof readEntry !== 'function') throw new TypeError('Develop presets require a callable point-entry capability.');
		return readEntry.bind(repository);
	}
	if (requirePresence) throw new TypeError('Develop preset backup requires its selected point-entry capability.');
	const get = repository.get;
	if (typeof get !== 'function') throw new TypeError('Develop presets require a settings read capability.');
	const read = get.bind(repository);
	return async key => {
		const value = await read(key);
		return value === undefined ? { present: false } : { present: true, value };
	};
}

/** Called after the owning intrinsic cancellation check, before any row normalization or write. */
export function photoDevelopPresetEntryValue(value: unknown): unknown {
	const entry = record(value, 'Develop preset settings entry', ['present', 'value'], ['present']);
	if (field(entry, 'present') === false) {
		record(entry, 'Absent Develop preset settings entry', ['present']); return undefined;
	}
	if (field(entry, 'present') !== true) throw new TypeError('Develop preset settings presence must be a boolean.');
	record(entry, 'Present Develop preset settings entry', ['present', 'value']);
	const body = field(entry, 'value');
	if (body === undefined) throw new TypeError('A physically present Develop preset row requires a value.');
	return body;
}
