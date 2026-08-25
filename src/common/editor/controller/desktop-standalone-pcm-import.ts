/* SPDX-License-Identifier: AGPL-3.0-only */

import { inspectAiffBlobPcm } from '../aiff-pcm-chunk-reader.ts';
import { isDesktopMainAudioCodecRuntime } from '../desktop-main-audio-codec-runtime-marker.ts';

interface NamedAudioFile {
	readonly name?: unknown;
	readonly type?: unknown;
}

/** Admit only maintained PCM identities when the renderer is bound to desktop main audio. */
export async function inspectDesktopStandalonePcm(
	file: unknown,
	codecRuntime: unknown,
	wavDescriptor: unknown,
): Promise<unknown | null> {
	if (!isDesktopMainAudioCodecRuntime(codecRuntime)) return null;
	if (wavDescriptor) return wavDescriptor;
	if (!isMaintainedAiffFile(file)) return null;
	return inspectAiffBlobPcm(file);
}

function isMaintainedAiffFile(value: unknown): value is NamedAudioFile {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const file = value as NamedAudioFile;
	if (typeof file.name !== 'string' || !/\.(?:aif|aiff)$/iu.test(file.name)) return false;
	return file.type === 'audio/aiff' || file.type === '' || file.type === undefined;
}
