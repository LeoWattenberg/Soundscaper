/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ExternalAudioDecodePorts } from './external-media-audio-decoder.ts';
import type { ExternalAudioDecoder } from './scape-external-media.ts';

/** Load container readers only when opening a project with external audio. */
export function createDeferredExternalMediaAudioDecoder(ports: ExternalAudioDecodePorts): ExternalAudioDecoder {
	return async (...args) => {
		const { createExternalMediaAudioDecoder } = await import('./external-media-audio-decoder.ts');
		return createExternalMediaAudioDecoder(ports)(...args);
	};
}
