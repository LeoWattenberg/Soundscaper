/* SPDX-License-Identifier: AGPL-3.0-only */

import { inspectAiffBlobPcm } from '../../../aiff-pcm-chunk-reader.ts';
import { isDesktopMainAudioCodecRuntime } from '../../../desktop-main-audio-codec-runtime-marker.ts';
import { maintainedAiffMimeType } from './aiff-file-identity.ts';

/** Use the maintained AIFF reader on every platform; retain desktop WAV admission. */
export async function inspectDesktopStandalonePcm(
	file: unknown,
	codecRuntime: unknown,
	wavDescriptor: unknown,
): Promise<unknown | null> {
	if (wavDescriptor) return isDesktopMainAudioCodecRuntime(codecRuntime) ? wavDescriptor : null;
	if (!maintainedAiffMimeType(file)) return null;
	return inspectAiffBlobPcm(file);
}
