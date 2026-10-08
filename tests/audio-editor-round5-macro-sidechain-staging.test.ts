/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffectMacroChainRunner, planEffectMacroChain } from '../src/common/editor/controller/effects/internal/macro/effect-macro-chain.ts';
import { applyAudacityEffect } from '../src/common/editor/audacity-effects/index.js';
import type { EngineProject } from '../src/common/editor/engine/types.ts';

interface PcmBuffer { readonly channels: Float32Array[]; }

for (const native of [false, true]) test(`${native ? 'source' : 'mixed timeline'} macro stages its control beside rewritten PCM`, async () => {
	const sampleRate = native ? 24_000 : 48_000;
	const input = new Float32Array(sampleRate * 2).fill(0.35);
	const control = new Float32Array(input.length).fill(0.35);
	const target = { track: { id: native ? 'source-editor:music' : 'music-track' },
		startFrame: sampleRate, endFrame: sampleRate * 3, channelCount: 1 };
	const reads: Array<readonly [string, number, number]> = [];
	const runner = createEffectMacroChainRunner<PcmBuffer>({
		sampleRate, copy: { autoDuckControlTrack: 'Missing control', effectInvalidAudio: 'Invalid audio', noiseProfileMissing: 'Missing profile' },
		assertCurrent() {}, projectFrameCount: () => sampleRate * 4,
		renderDryRange: async (id, start, end) => { reads.push([id, start, end]); return [control]; },
		runSelectionEffect: async (request) => ({ channels: applyAudacityEffect(request.effectType,
			[...request.channels], request.sampleRate, request.params) }),
		createAudioBuffer: async (channels) => ({ channels: [...channels] }),
		renderSnapshot: async (value, range, buffers) => {
			const project = value as EngineProject;
			const tracks = project.tracks;
			const clips = project.clips;
			assert.ok(tracks);
			assert.ok(clips);
			const track = tracks.find(item => item.id === range.trackId);
			assert.ok(track);
			const effect = track.effects?.[0];
			assert.ok(effect);
			const controlId = effect.context?.controlTrackId;
			const controlTrack = tracks.find(item => item.id === controlId);
			assert.ok(controlTrack, 'the engine can resolve the authored voice control');
			const read = (clipId: unknown) => {
				assert.ok(typeof clipId === 'string');
				const clip = clips.find(item => item.id === clipId);
				assert.ok(clip);
				assert.ok(typeof clip.sourceId === 'string');
				return (buffers.get(clip.sourceId) as PcmBuffer).channels;
			};
			assert.equal(project.sampleRate, sampleRate);
			return { channels: applyAudacityEffect(effect.type, read(track.clipIds?.[0]), sampleRate,
				effect.params, { controlChannels: read(controlTrack.clipIds?.[0]) }) };
		},
		audioBufferChannels: buffer => buffer.channels,
		matchSelectionChannels: channels => [...channels],
	});
	const steps = [
		...(native ? [] : [{ id: 'invert', type: 'audacity-amplify', params: { gainDb: -3 } }]),
		{ id: 'duck', type: 'audacity-auto-duck', params: {}, context: { controlTrackId: 'voice-track' } },
	];
	const actual = await runner.runSegments(planEffectMacroChain(steps), [input], target);
	assert.deepEqual(reads, [['voice-track', sampleRate, sampleRate * 3]]);
	assert.equal(actual[0]!.length, input.length);
	assert.ok(Math.abs(actual[0]![Math.round(sampleRate * 0.75)]!) < 0.1);
});
