/* SPDX-License-Identifier: AGPL-3.0-only */

import { inspectAiffBlobPcm } from '../aiff-pcm-chunk-reader.ts';
import { isDesktopMainAudioCodecRuntime } from '../desktop-main-audio-codec-runtime-marker.ts';
import { maintainedAiffMimeType } from './aiff-file-identity.ts';

/** Admit only maintained PCM identities when the renderer is bound to desktop main audio. */
export async function inspectDesktopStandalonePcm(
	file: unknown,
	codecRuntime: unknown,
	wavDescriptor: unknown,
): Promise<unknown | null> {
	if (!isDesktopMainAudioCodecRuntime(codecRuntime)) return null;
	if (wavDescriptor) return wavDescriptor;
	if (!maintainedAiffMimeType(file)) return null;
	return inspectAiffBlobPcm(file);
}
