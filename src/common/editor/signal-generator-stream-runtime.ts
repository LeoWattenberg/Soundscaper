/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorSignalRenderer } from './generators.js';
import { createWaveformPeakBuilder, type WaveformPeakBuilder } from './waveform-peak-builder.ts';

/** One renderer owns phase, RNG and keying state until its last acknowledged block. */
export function createSignalGeneratorStreamRuntime() {
	let renderer: ReturnType<typeof createAudioEditorSignalRenderer> | null = null;
	let peaks: WaveformPeakBuilder | null = null;
	let frames = 0;
	return (value: unknown) => {
		let requestId: string | null = null;
		try {
			if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('A generator stream request is required.');
			const request = value as Record<string, unknown>;
			if (typeof request.requestId !== 'string' || !request.requestId || request.requestId.length > 160) throw new TypeError('A bounded request id is required.');
			requestId = request.requestId;
			if (request.operation === 'start') {
				if (renderer) throw new Error('The generator stream has already started.');
				if (typeof request.generator !== 'string' || !request.options || typeof request.options !== 'object' || Array.isArray(request.options)) throw new TypeError('Generator options are required.');
				renderer = createAudioEditorSignalRenderer(request.generator, request.options as Readonly<Record<string, unknown>>);
				frames = 0;
				return { type: 'result' as const, requestId, result: { type: renderer.type, sampleRate: renderer.sampleRate,
					channelCount: renderer.channelCount, frameCount: renderer.frameCount } };
			}
			if (!renderer) throw new Error('The generator stream has not started.');
			if (request.operation === 'next') {
				peaks ??= createWaveformPeakBuilder(renderer);
				const channels = renderer.next(65_536);
				if (channels) { peaks.append(channels); frames += channels[0]!.length; }
				return { type: 'result' as const, requestId, result: { channels } };
			}
			if (request.operation === 'finish') {
				if (frames !== renderer.frameCount || !peaks) throw new Error('The generator stream is incomplete.');
				const result = peaks.finish(); renderer = null; peaks = null;
				return { type: 'result' as const, requestId, result };
			}
			throw new RangeError('Unknown generator stream operation.');
		} catch (error) {
			renderer = null; peaks = null;
			return { type: 'error' as const, requestId, error: {
				name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error),
			} };
		}
	};
}
