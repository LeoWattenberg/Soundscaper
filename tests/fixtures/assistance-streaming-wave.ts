/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';

import type {
	AssistanceFloat32WaveGeometryV1,
	AssistanceFloat32WaveReadRequestV1,
	AssistanceFloat32WaveSinkV1,
	AssistanceFloat32WaveSourceV1,
	AssistanceFloat32WaveStorageV1,
} from '../../desktop/assistance-streaming-float32-wave.ts';

export interface VirtualWaveRead {
	readonly startFrame: number;
	readonly frameCount: number;
	readonly channelStart: number;
	readonly channelCount: number;
}

export interface VirtualWaveSinkState {
	writtenFrames: number;
	maximumWriteFrames: number;
	maximumSampleError: number;
	published: boolean;
	rolledBack: boolean;
}

export function virtualWaveStorage(options: Readonly<{
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	readonly sparse?: boolean;
	readonly expectedFactor?: number;
}>): AssistanceFloat32WaveStorageV1 & Readonly<{
	readonly geometry: AssistanceFloat32WaveGeometryV1;
	readonly reads: VirtualWaveRead[];
	readonly sinks: VirtualWaveSinkState[];
}> {
	const geometry = Object.freeze({ sampleRate: options.sampleRate,
		channelCount: options.channelCount, frameCount: options.frameCount,
		byteLength: 44 + options.frameCount * options.channelCount * 4 });
	const reads: VirtualWaveRead[] = [];
	const sinks: VirtualWaveSinkState[] = [];
	return {
		geometry, reads, sinks,
		async openSource(input, expectedSampleRate): Promise<AssistanceFloat32WaveSourceV1> {
			assert.equal(input.byteLength, geometry.byteLength);
			assert.equal(expectedSampleRate, geometry.sampleRate);
			return Object.freeze({ geometry,
				async readFrames(request: AssistanceFloat32WaveReadRequestV1,
					signal?: AbortSignal) {
					signal?.throwIfAborted();
					reads.push({ startFrame: request.startFrame, frameCount: request.frameCount,
						channelStart: request.channelStart, channelCount: request.channelCount });
					return Object.freeze(Array.from({ length: request.channelCount }, (_value, channel) =>
						Float32Array.from({ length: request.frameCount }, (_sample, frame) =>
							sourceSample(options, request.startFrame + frame,
								channel + request.channelStart))));
				},
				async close() {},
			});
		},
		async openSink(_output, sinkGeometry): Promise<AssistanceFloat32WaveSinkV1> {
			assert.deepEqual(sinkGeometry, geometry);
			const state: VirtualWaveSinkState = { writtenFrames: 0,
				maximumWriteFrames: 0, maximumSampleError: 0,
				published: false, rolledBack: false };
			sinks.push(state);
			return Object.freeze({ geometry,
				async writeFrames(channels: readonly Float32Array[], signal?: AbortSignal) {
					signal?.throwIfAborted();
					assert.equal(channels.length, geometry.channelCount);
					const frames = channels[0]?.length ?? 0;
					assert.ok(frames > 0);
					assert.ok(channels.every((channel) => channel.length === frames
						&& channel.every(Number.isFinite)));
					if (options.expectedFactor !== undefined) {
						for (let channel = 0; channel < channels.length; channel += 1) {
							for (let frame = 0; frame < frames; frame += 1) {
								const expected = sourceSample(options, state.writtenFrames + frame, channel)
									* options.expectedFactor;
								state.maximumSampleError = Math.max(state.maximumSampleError,
									Math.abs(channels[channel]![frame]! - expected));
							}
						}
					}
					state.writtenFrames += frames;
					state.maximumWriteFrames = Math.max(state.maximumWriteFrames, frames);
				},
				async seal() {
					assert.equal(state.writtenFrames, geometry.frameCount);
					return Object.freeze({ byteLength: geometry.byteLength, sha256: 'a'.repeat(64) });
				},
				async publish(signal?: AbortSignal) {
					signal?.throwIfAborted(); state.published = true;
				},
				async commit() {},
				async rollback() { state.rolledBack = true; state.published = false; },
			});
		},
	};
}

function sourceSample(
	options: Readonly<{ readonly sparse?: boolean }>,
	frame: number,
	channel: number,
): number {
	return options.sparse ? 0 : 0.1 * Math.sin(frame * (channel + 1) / 37);
}
