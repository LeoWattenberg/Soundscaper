/* SPDX-License-Identifier: AGPL-3.0-only */

import { isDesktopMainAudioCodecRuntime } from '../../desktop-main-audio-codec-runtime-marker.ts';
import type { PreparedStreamedAudioImport } from '../../browser-streamed-audio-import.ts';
import type { WavPackImportGroupDecoder } from '../../browser-streamed-wavpack-import.ts';

/** Keep DAWproject's compressed decoder outside the startup graph. */
export function createDawprojectAudioPreparer(codec: WavPackImportGroupDecoder): (
	file: Blob, name: string, signal: AbortSignal,
) => Promise<PreparedStreamedAudioImport> {
	const desktop = isDesktopMainAudioCodecRuntime(codec);
	return async (blob, name, signal) => {
		const { prepareStreamedAudioImport } = await import('../../browser-streamed-audio-import.ts');
		const named = typeof File === 'function' && !(blob instanceof File)
			? new File([blob], name, { type: blob.type })
			: blob;
		return prepareStreamedAudioImport(named, {
			signal, reviewedFallback: !desktop, desktopCodec: desktop ? codec : undefined,
		});
	};
}
