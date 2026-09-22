/* SPDX-License-Identifier: AGPL-3.0-only */

import { createBrowserAudioCodecRuntime } from './browser-audio-codec-runtime.ts';

/** Load the browser codec only when a WavPack import needs its fallback decoder. */
export function createDefaultWavPackGroupDecoder() {
	return createBrowserAudioCodecRuntime();
}
