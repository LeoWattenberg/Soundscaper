/* SPDX-License-Identifier: AGPL-3.0-only */

import { stageDesktopBundledFlacRuntime } from './desktop-bundled-flac-runtime.mjs';
import { stageDesktopBundledOpusRuntime } from './desktop-bundled-opus-runtime.mjs';
import { stageDesktopBundledWavPackRuntime } from './desktop-bundled-wavpack-runtime.mjs';

/** Stages every exact reviewed bundled audio payload into the compiled graph. */
export async function stageDesktopBundledAudioRuntime(options) {
	await stageDesktopBundledFlacRuntime(options);
	await stageDesktopBundledOpusRuntime(options);
	await stageDesktopBundledWavPackRuntime(options);
}
