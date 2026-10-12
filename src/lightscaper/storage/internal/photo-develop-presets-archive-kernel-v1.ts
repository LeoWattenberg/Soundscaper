/* SPDX-License-Identifier: AGPL-3.0-only */

import { digestScapeBytes } from '../../../common/editor/scape-byte-stream.ts';
import type { KeyValueRepository } from '../../../common/editor/storage/key-value-repository.ts';
import { readPhotoStackSignalOptionsV1 } from '../../catalog/photo-stack-repository-v1.ts';
import { photoDevelopPresetsKeyV1, PhotoDevelopPresetRevisionConflictError,
	type PhotoDevelopPresetRowV1 } from '../photo-develop-presets-v1.ts';
import { normalizePhotoDevelopPresetRowV1OrV2, type PhotoDevelopPresetRowV2 } from '../photo-develop-preset-row-v2.ts';
import { photoDevelopPresetEntryValue } from '../photo-develop-preset-read.ts';

import { normalizePhotoDevelopPresetRowCurrentV1, type PhotoDevelopPresetRowCurrentV1 } from '../photo-develop-preset-row-current-v1.ts';

export type PhotoDevelopPresetArchiveSettingsPortV1 = Readonly<Pick<KeyValueRepository, 'readEntry'>>;

type Profile = 'legacy2' | 'current3';
type RowFor<Mode extends Profile> = Mode extends 'legacy2' ? PhotoDevelopPresetRowV1 | PhotoDevelopPresetRowV2 : PhotoDevelopPresetRowCurrentV1;
export interface PhotoDevelopPresetArchiveCaptureForProfileV1<Mode extends Profile> {
	readonly row: RowFor<Mode> | null;
	readonly verify: () => Promise<void>;
}
const nativeAbort = AbortSignal.prototype.throwIfAborted;

/** Borrow the selected media settings under the existing catalog writer; this row has its own revision. */
export async function capturePhotoDevelopPresetsArchiveForProfileV1<Mode extends Profile>(profile: Mode, repository: PhotoDevelopPresetArchiveSettingsPortV1,
	catalogId: string, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoDevelopPresetArchiveCaptureForProfileV1<Mode>> {
	if (profile !== 'legacy2' && profile !== 'current3') throw new RangeError('Unsupported fixed preset archive profile.');
	if (profile === 'current3') { const native = Object.getOwnPropertyDescriptor(options, 'signal');
		if (native && Object.hasOwn(native, 'value') && native.value !== undefined) Reflect.apply(nativeAbort, native.value, []); }
	const key = photoDevelopPresetsKeyV1(catalogId), { signal } = readPhotoStackSignalOptionsV1(options);
	const readEntry = repository.readEntry;
	if (typeof readEntry !== 'function') throw new TypeError('Develop preset backup requires its selected point-entry capability.');
	const read = (key: string) => Reflect.apply(readEntry, repository, [key]);
	const row = await snapshot(), expectedDigest = digest(row);
	return Object.freeze({ row, async verify() {
		const current = await snapshot();
		if (digest(current) !== expectedDigest) throw new PhotoDevelopPresetRevisionConflictError();
	} });

	async function snapshot(): Promise<RowFor<Mode> | null> {
		check(); const entry = await read(key); check(); const raw = photoDevelopPresetEntryValue(entry);
		try { return raw === undefined ? null : (profile === 'legacy2' ? normalizePhotoDevelopPresetRowV1OrV2(raw, catalogId) : normalizePhotoDevelopPresetRowCurrentV1(raw, catalogId)) as RowFor<Mode>; }
		catch (error) { if (profile === 'current3') check(); throw error; }
	}
	function check(): void { if (signal) Reflect.apply(nativeAbort, signal, []); }
}
function digest(row: PhotoDevelopPresetRowCurrentV1 | null): string | null {
	return row === null ? null : digestScapeBytes(new TextEncoder().encode(JSON.stringify(row)));
}
