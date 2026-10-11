/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionAudioPlaybackOutput } from '../motion-audio-preview.ts';

/** AudioContext.currentTime is the only playback clock; the adapter never decodes complete media files. */
export function createMotionWebAudioOutput(supplied?: AudioContext): MotionAudioPlaybackOutput {
	const context = supplied ?? new AudioContext({ latencyHint: 'interactive' });
	return {
		get sampleRate() { return context.sampleRate; }, get currentTime() { return context.currentTime; },
		resume: () => context.resume(), close: () => supplied ? Promise.resolve() : context.close(),
		schedule(block, when, ended) {
			const buffer = context.createBuffer(block.channels, block.sampleCount, block.sampleRate);
			for (let channel = 0; channel < block.channels; channel++) {
				const samples = buffer.getChannelData(channel); for (let index = 0; index < block.sampleCount; index++) samples[index] = block.interleaved[index * block.channels + channel]!;
			}
			const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); source.onended = ended; source.start(when);
			let stopped = false;
			return { stop() { if (!stopped) { stopped = true; source.onended = null; source.stop(); source.disconnect(); source.buffer = null; } } };
		},
	};
}
