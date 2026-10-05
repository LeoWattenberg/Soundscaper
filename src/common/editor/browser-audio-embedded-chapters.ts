/* SPDX-License-Identifier: AGPL-3.0-only */

import { confirmFileSizeWarning } from './controller/shared/file-size-warning.ts';
import { isFileBackedAudioExport, registerFileBackedExport } from './file-backed-audio-export.ts';
import type { BrowserAudioCodecRuntimeSettings } from './browser-audio-codec-runtime-settings.ts';

/** Add container metadata after audio validation, retaining the staged file's owner. */
export async function embedBrowserAudioChapters(
	blob: Blob,
	format: unknown,
	settings: BrowserAudioCodecRuntimeSettings,
	sampleRate: number,
	maximumOutputBytes: number,
): Promise<Blob> {
	if (!settings.embeddedChapters?.length) return blob;
	const assertCurrent = (): void => {
		settings.signal?.throwIfAborted();
		settings.assertCurrent?.();
	};
	assertCurrent();
	const { embedAudioChapters } = await import('./audio-embedded-chapter-container.ts');
	assertCurrent();
	const result = await embedAudioChapters(blob, format, settings.embeddedChapters, sampleRate, settings.signal);
	assertCurrent();
	await confirmFileSizeWarning(result.size, maximumOutputBytes, 'Compressed audio export', { ...settings, assertCurrent });
	assertCurrent();
	return isFileBackedAudioExport(blob) ? registerFileBackedExport(result) : result;
}
