/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FileSizeWarningConfirmation } from './controller/shared/file-size-warning.ts';
import type { EmbeddedExportChapter } from './export-embedded-chapters.ts';

export interface BrowserAudioCodecRuntimeSettings {
	readonly capabilities?: unknown;
	readonly sampleRate?: number;
	readonly inputChannelCount?: number;
	readonly channelCount?: number;
	readonly channelMapping?: unknown;
	readonly sampleFormat?: string;
	readonly bitDepth?: number;
	readonly dither?: unknown;
	readonly metadata?: Readonly<Record<string, unknown>>;
	readonly embeddedChapters?: readonly EmbeddedExportChapter[];
	readonly compressionLevel?: number;
	readonly quality?: number;
	readonly bitRate?: number;
	readonly maximumOutputBytes?: number;
	readonly confirmFileSizeWarning?: FileSizeWarningConfirmation;
	readonly maximumOutputChunkBytes?: number;
	readonly frameCount?: number;
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
	readonly onProgress?: (value: number) => void;
}
