/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { renderClipNormalizationAudio } from '../src/common/editor/controller/clip-video/internal/clip-normalization-render.ts';
import type { ClipSourcePreviewResources } from '../src/common/editor/controller/clip-video/internal/clip-source-preview-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import type { EngineRenderMixOptions, EngineSourceBufferInput } from '../src/common/editor/engine/public-api.ts';
import { buildClipSchedulePlans } from '../src/common/editor/engine/clip-schedule-plan.ts';
import { normalizeAudioWarpMap } from '../src/common/editor/audio-warp-domain.ts';
import { clipLoopUpdateFields, readClipLoop } from '../src/common/editor/audio-clip-loop.ts';
import { createAudioClip, createAudioSource } from '../src/common/editor/project-media-factory.ts';

for (const mode of ['plain', 'reverse', 'loop', 'warp'] as const) test(`normalization renders the authored ${mode} clip with unity gain and its exact source clock`, async () => {
	const f = fixture(mode);
	const output = await renderClipNormalizationAudio(f.resources, f.project, f.clip, f.buffer, new AbortController().signal);
	assert.equal(output.length, f.clip.durationFrames); assert.equal(output.sampleRate, 48_000);
	assert.equal(f.disposed(), 1);
	const loaded = f.loaded(); assert.ok(loaded);
	const dry = loaded.clips?.[0]; assert.ok(dry);
	assert.equal(dry.timelineStartFrame, 0); assert.equal(dry.gain, 1);
	assert.equal(dry.fadeInFrames, 20); assert.equal(dry.fadeOutFrames, 15);
	assert.equal(dry.fadeInShape, 2); assert.equal(dry.inverted, true);
	assert.equal(dry.pitchCents, 300); assert.equal(dry.linkPitchAndTempo, true);
	assert.deepEqual(dry.envelope, f.clip.envelope);
	assert.equal(dry.reversed, mode === 'reverse');
	assert.deepEqual(readClipLoop(dry), mode === 'loop' ? { periodFrames: 240, offsetFrames: 0 } : null);
	assert.deepEqual(dry.warpMap, mode === 'warp' ? normalizeAudioWarpMap(f.clip.warpMap) : null);
	assert.equal(f.clip.gain, 0.3); assert.equal(f.clip.timelineStartFrame, 400);
});

test('failed normalization rendering releases its owned engine and does not publish partial PCM', async () => {
	const f = fixture('plain', true);
	await assert.rejects(renderClipNormalizationAudio(f.resources, f.project, f.clip, f.buffer, new AbortController().signal), { name: 'AbortError' });
	assert.equal(f.disposed(), 1);
});

function fixture(mode: 'plain' | 'reverse' | 'loop' | 'warp', fail = false) {
	const source = createAudioSource({ id: 'source', frameCount: 1000, sampleRate: 24_000, channelCount: 1 });
	const original = { ...createAudioClip({ id: 'clip', sourceId: 'source', timelineStartFrame: 400, durationFrames: 240,
		sourceStartFrame: 100, sourceDurationFrames: 240, gain: 0.3, speedRatio: 2, pitchCents: 300, linkPitchAndTempo: true,
		fadeInFrames: 20, fadeOutFrames: 15, fadeInShape: 2, inverted: true, reversed: mode === 'reverse',
		envelope: [{ frame: 0, value: 0.5 }, { frame: 120, value: 0.25 }],
	}), timelineStartFrame: 400, durationFrames: 240, sourceStartFrame: 100, sourceDurationFrames: 240 };
	const clip = { ...original, ...(mode === 'loop' ? clipLoopUpdateFields(original, { periodFrames: 240, durationFrames: 480 }) : {}),
		...(mode === 'warp' ? { warpMap: { feature: 'audio-warp', points: [
			{ outer: 0, source: 100, mode: 'forward' }, { outer: 120, source: 280, mode: 'forward' }, { outer: 240, source: 340, mode: 'forward' },
		] } } : {}) };
	const project = { id: 'project', schemaVersion: 23, title: 'Recording', sampleRate: 48_000, sources: [source], clips: [clip], tracks: [],
		tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] } } as ClipTransformProject;
	const buffer = { sampleRate: 24_000, numberOfChannels: 1, length: 1000, getChannelData: () => new Float32Array(1000).fill(0.5) } as unknown as AudioBuffer;
	let loaded: EngineProject | undefined, buffers: EngineSourceBufferInput | undefined, disposed = 0;
	const resources: Pick<ClipSourcePreviewResources, 'createEngine' | 'sourceChunkProviders'> = { sourceChunkProviders: new Map(),
		createEngine: () => ({
			async getAudioContext(options: Readonly<{ resume?: boolean }>) {
				assert.equal(options.resume, false);
				return { createBuffer(channelCount: number, length: number, sampleRate: number) {
					assert.equal(channelCount, 1); assert.equal(length, 1000); assert.equal(sampleRate, 24_000);
					const channel = new Float32Array(length);
					return { sampleRate, length, numberOfChannels: channelCount,
						getChannelData: () => channel, copyToChannel(values: Float32Array) { channel.set(values); } };
				} };
			},
			loadProject(value: EngineProject, actualBuffers: EngineSourceBufferInput) { loaded = value; buffers = actualBuffers; },
			async renderMix(options: EngineRenderMixOptions) {
				assert.equal(options.endFrame, clip.durationFrames); assert.equal(options.includeMaster, false); assert.equal(options.includeTrackPan, false);
				assert.equal(options.includeTail, false); assert.equal(options.preRollFrames, 0); assert.ok(loaded); assert.ok(buffers instanceof Map);
				assert.notEqual(buffers.get('source'), buffer, 'stored PCM must become a native buffer through the owned context');
				assert.equal((buffers.get('source') as AudioBuffer).getChannelData(0)[0], 0.5);
				const plans = buildClipSchedulePlans({ project: loaded, sources: buffers,
					trackInputs: new Map([['clip-normalization', {} as AudioNode]]), fromFrame: 0, toFrame: clip.durationFrames, sampleRate: 48_000 });
				assert.equal(plans.length, mode === 'warp' ? 2 : 1);
				assert.deepEqual(plans.map(plan => plan.playbackRate), mode === 'warp' ? [3, 1] : [2]);
				assert.equal(plans[0]?.offsetFrame, mode === 'reverse' ? 660 : 100);
				assert.equal(plans[0]?.loopSourceStartFrame, mode === 'loop' ? 100 : undefined);
				assert.equal(plans[0]?.loopSourceEndFrame, mode === 'loop' ? 340 : undefined);
				if (fail) throw new DOMException('Cancelled', 'AbortError');
				return { channels: [new Float32Array(clip.durationFrames).fill(0.25)] };
			}, play: async () => {}, pause() {}, stop() {}, seek: frame => frame, setLoop() {}, setPlayRange() {},
			subscribePosition: () => () => {}, dispose() { disposed += 1; },
		}),
	};
	return { resources, project, clip, buffer, loaded: () => loaded, disposed: () => disposed };
}
