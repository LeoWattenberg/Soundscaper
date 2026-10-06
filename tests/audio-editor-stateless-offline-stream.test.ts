/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { canStreamStatelessOffline, renderStatelessOfflineToSink } from '../src/common/editor/engine/stateless-offline-stream.ts';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';

const project: EngineProject = { id: 'offline', sampleRate: 8_000, masterChannels: 2,
	tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'], effects: [] }],
	clips: [{ id: 'clip', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 200_000 }],
	sources: [{ id: 'source', channelCount: 2 }], master: { gain: 1, effects: [] } };

test('stateless admission refuses every stateful or range-dependent graph branch', () => {
	assert.equal(canStreamStatelessOffline(project), true);
	for (const changes of [
		{ automationLanes: [{}] }, { clips: [{ ...project.clips![0], fadeInFrames: 100 }] },
		{ clips: [{ ...project.clips![0], envelope: [{ frame: 0, value: 1 }] }] },
		{ clips: [{ ...project.clips![0], warpMap: {} }] },
		{ clips: [{ ...project.clips![0], sourceDurationFrames: 300_000 }] },
		{ clips: [{ ...project.clips![0], speedRatio: 1.1 }] },
		{ clips: [{ ...project.clips![0], anchor: 'musical' }] },
		{ master: { effects: [{ type: 'compressor' }] } },
		{ tracks: [{ ...project.tracks![0], envelope: [{ frame: 0, value: 1 }] }] },
		{ mixer: { sends: [{ effects: [{ type: 'reverb' }] }] } },
		{ tracks: [{ ...project.tracks![0], audioFreeze: {} }] },
		{ masterChannels: 1 }, { sources: [{ id: 'source', channelCount: 1 }] },
		{ tracks: [{ ...project.tracks![0], clipIds: ['other'] }] },
		{ mixer: { groups: [{ gain: 1 }] } },
		{ mixer: { routes: { track: { groupId: 'bus' } } } },
	]) assert.equal(canStreamStatelessOffline({ ...project, ...changes }), false, JSON.stringify(changes));
	assert.equal(canStreamStatelessOffline({ ...project, master: { effects: [{ type: 'compressor', enabled: false }] } }), true);
});

test('bounded offline windows feed sequential acknowledged packets without a live clock', async () => {
	const ranges: Array<{ startFrame: number; endFrame: number }> = [];
	let frames = 0;
	const engine = { project, sampleRate: 8_000, durationFrames: 200_000,
		async renderMix(range: { startFrame: number; endFrame: number }) {
			assert.equal(frames, range.startFrame - 123);
			ranges.push(range);
			const length = range.endFrame - range.startFrame;
			assert.ok(length <= 5 * 8_000);
			return { length, sampleRate: 8_000, numberOfChannels: 2,
				getChannelData: () => Float32Array.from({ length }, (_, index) => range.startFrame + index) };
		},
	} as unknown as EngineRuntimeHost;
	const result = await renderStatelessOfflineToSink(engine, { startFrame: 123, endFrame: 100_123,
		chunkFrames: 4_096, onChunk: async (channels, metadata) => {
			assert.equal(metadata.frameOffset, frames);
			assert.equal(channels[0]![0], frames + 123);
			await Promise.resolve(); frames += channels[0]!.length;
		} });
	assert.equal(frames, 100_000);
	assert.equal(result.frameCount, frames);
	assert.equal(ranges.length, 3);
});

test('sink cancellation or project mutation prevents the next window from rendering', async () => {
	for (const cancellation of [true, false]) {
		const controller = new AbortController(); let rendered = 0; let delivered = 0;
		const active = structuredClone(project);
		const engine = { project: active, sampleRate: 8_000, durationFrames: 200_000,
			async renderMix(range: { startFrame: number; endFrame: number }) {
				rendered++; const length = range.endFrame - range.startFrame;
				return { length, sampleRate: 8_000, numberOfChannels: 2, getChannelData: () => new Float32Array(length) };
			},
		} as unknown as EngineRuntimeHost;
		await assert.rejects(renderStatelessOfflineToSink(engine, { signal: controller.signal, onChunk: async () => {
			delivered++;
			if (cancellation) controller.abort(); else Object.assign(active, { revision: 2 });
			await Promise.resolve();
		} }), cancellation ? { name: 'AbortError' } : /changed/);
		assert.equal(rendered, 1);
		assert.equal(delivered, 1);
	}
});
