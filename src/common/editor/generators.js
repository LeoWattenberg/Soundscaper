/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorSignalRenderer } from './signal-generator-renderer.ts';
export { AUDIO_EDITOR_GENERATOR_TYPES, createAudioEditorSignalRenderer } from './signal-generator-renderer.ts';

/** Generate browser-native equivalents of Audacity's built-in generators. */
export function generateAudioEditorSignal(type, options = {}) {
	const renderer = createAudioEditorSignalRenderer(type, options);
	return Object.freeze({
		type: renderer.type,
		sampleRate: renderer.sampleRate,
		channelCount: renderer.channelCount,
		frameCount: renderer.frameCount,
		channels: renderer.next(renderer.frameCount) ?? Object.freeze([]),
	});
}
