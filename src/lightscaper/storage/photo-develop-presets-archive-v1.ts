/* SPDX-License-Identifier: AGPL-3.0-only */

import { digestScapeBytes } from '../../common/editor/scape-byte-stream.ts';
import type { KeyValueRepository } from '../../common/editor/storage/key-value-repository.ts';
import { readPhotoStackSignalOptionsV1 } from '../catalog/photo-stack-repository-v1.ts';
import { normalizePhotoDevelopPresetRowV1, photoDevelopPresetsKeyV1, PhotoDevelopPresetRevisionConflictError,
	type PhotoDevelopPresetRowV1 } from './photo-develop-presets-v1.ts';
import { borrowPhotoDevelopPresetEntryReader, photoDevelopPresetEntryValue } from './photo-develop-preset-read.ts';

export type PhotoDevelopPresetArchiveSettingsPortV1 = Readonly<Pick<KeyValueRepository, 'readEntry'>>;

export interface PhotoDevelopPresetArchiveCaptureV1 {
	readonly row: PhotoDevelopPresetRowV1 | null;
	readonly verify: () => Promise<void>;
}
const nativeAbort = AbortSignal.prototype.throwIfAborted;

/** Borrow the selected media settings under the existing catalog writer; this row has its own revision. */
export async function capturePhotoDevelopPresetsArchiveV1(repository: PhotoDevelopPresetArchiveSettingsPortV1,
	catalogId: string, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoDevelopPresetArchiveCaptureV1> {
	const key = photoDevelopPresetsKeyV1(catalogId), { signal } = readPhotoStackSignalOptionsV1(options);
	const read = borrowPhotoDevelopPresetEntryReader(repository, true);
	const row = await snapshot(), expectedDigest = digest(row);
	return Object.freeze({ row, async verify() {
		const current = await snapshot();
		if (digest(current) !== expectedDigest) throw new PhotoDevelopPresetRevisionConflictError();
	} });

	async function snapshot(): Promise<PhotoDevelopPresetRowV1 | null> {
		check(); const entry = await read(key); check(); const raw = photoDevelopPresetEntryValue(entry);
		return raw === undefined ? null : normalizePhotoDevelopPresetRowV1(raw, catalogId);
	}
	function check(): void { if (signal) Reflect.apply(nativeAbort, signal, []); }
}
function digest(row: PhotoDevelopPresetRowV1 | null): string | null {
	return row === null ? null : digestScapeBytes(new TextEncoder().encode(JSON.stringify(row)));
}
