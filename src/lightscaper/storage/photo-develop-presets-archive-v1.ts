/* SPDX-License-Identifier: AGPL-3.0-only */

import { digestScapeBytes } from '../../common/editor/scape-byte-stream.ts';
import { readPhotoStackSignalOptionsV1 } from '../catalog/photo-stack-repository-v1.ts';
import { normalizePhotoDevelopPresetRowV1, photoDevelopPresetsKeyV1, PhotoDevelopPresetRevisionConflictError,
	type PhotoDevelopPresetRowV1, type PhotoDevelopPresetSettingsPortV1 } from './photo-develop-presets-v1.ts';

export interface PhotoDevelopPresetArchiveCaptureV1 {
	readonly row: PhotoDevelopPresetRowV1 | null;
	readonly verify: () => Promise<void>;
}
const nativeAbort = AbortSignal.prototype.throwIfAborted;

/** Borrow the selected media settings under the existing catalog writer; this row has its own revision. */
export async function capturePhotoDevelopPresetsArchiveV1(repository: Readonly<Pick<PhotoDevelopPresetSettingsPortV1, 'get'>>,
	catalogId: string, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoDevelopPresetArchiveCaptureV1> {
	const key = photoDevelopPresetsKeyV1(catalogId), { signal } = readPhotoStackSignalOptionsV1(options);
	const read = repository.get.bind(repository);
	const row = await snapshot(), expectedDigest = digest(row);
	return Object.freeze({ row, async verify() {
		const current = await snapshot();
		if (digest(current) !== expectedDigest) throw new PhotoDevelopPresetRevisionConflictError();
	} });

	async function snapshot(): Promise<PhotoDevelopPresetRowV1 | null> {
		check(); const raw = await read(key); check();
		return raw === undefined ? null : normalizePhotoDevelopPresetRowV1(raw, catalogId);
	}
	function check(): void { if (signal) Reflect.apply(nativeAbort, signal, []); }
}
function digest(row: PhotoDevelopPresetRowV1 | null): string | null {
	return row === null ? null : digestScapeBytes(new TextEncoder().encode(JSON.stringify(row)));
}
