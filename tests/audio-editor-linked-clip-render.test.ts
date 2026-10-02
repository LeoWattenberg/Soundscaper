/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { renderLinkedClipAudio } from '../src/common/editor/controller/clip-video/internal/linked-clip-render.ts';
import type { ClipSourcePreviewResources } from '../src/common/editor/controller/clip-video/internal/clip-source-preview-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import type { EngineLoadProjectOptions, EngineRenderMixOptions } from '../src/common/editor/engine/public-api.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { buildClipSchedulePlans } from '../src/common/editor/engine/clip-schedule-plan.ts';
import { createAudioClip, createAudioSource } from '../src/common/editor/project-media-factory.ts';

test('linked render uses original source geometry and leaves clip gain and fades for the replacement', async () => {
	const fixture = createFixture();
	const output = await renderLinkedClipAudio(fixture.resources, fixture.project, fixture.clip, fixture.source, new AbortController().signal);
	assert.equal(output.sampleRate, 48_000);
	assert.equal(output.length, 240);
	assert.equal(fixture.disposed(), 1);
	assert.equal(fixture.loaded()?.clips?.[0]?.gain, 1);
	assert.equal(fixture.loaded()?.clips?.[0]?.fadeInFrames, 0);
	assert.equal(fixture.loaded()?.clips?.[0]?.pitchCents, 0);
	assert.equal(fixture.clip.gain, 0.4);
	assert.equal(fixture.clip.fadeInFrames, 20);
});

test('linked render cancellation disposes its engine before publishing audio', async () => {
	const fixture = createFixture(true);
	await assert.rejects(renderLinkedClipAudio(fixture.resources, fixture.project, fixture.clip, fixture.source, new AbortController().signal), { name: 'AbortError' });
	assert.equal(fixture.disposed(), 1);
});

function createFixture(fail = false) {
	const source = createAudioSource({ id: 'source', frameCount: 1_000, sampleRate: 24_000, channelCount: 1 });
	const clip = { ...createAudioClip({ id: 'clip', sourceId: 'source', timelineStartFrame: 400, sourceStartFrame: 100,
		sourceDurationFrames: 240, durationFrames: 240, speedRatio: 2, linkPitchAndTempo: true, pitchCents: 300,
		gain: 0.4, fadeInFrames: 20, fadeOutFrames: 15,
	}), timelineStartFrame: 400, durationFrames: 240 };
	const project = { id: 'project', schemaVersion: 23, title: 'Project', sampleRate: 48_000,
		clips: [clip], sources: [source], tracks: [],
		tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
	} as ClipTransformProject;
	const buffer = { sampleRate: 24_000, numberOfChannels: 1, length: 1_000, getChannelData: () => new Float32Array(1_000) } as unknown as AudioBuffer;
	const buffers = new Map([['source', buffer]]);
	const chunks = new Map();
	let loaded: EngineProject | undefined;
	let disposed = 0;
	const resources: Pick<ClipSourcePreviewResources, 'sourceBuffers' | 'sourceChunkProviders' | 'createEngine'> = {
		sourceBuffers: buffers, sourceChunkProviders: chunks,
		createEngine: () => ({
			loadProject(value: EngineProject, actualBuffers: unknown, options: EngineLoadProjectOptions) {
				loaded = value;
				assert.equal(actualBuffers, buffers);
				assert.equal(options.chunkSources, chunks);
			},
			async renderMix(options: EngineRenderMixOptions) {
				assert.equal(options.includeTail, false);
				assert.equal(options.includeMaster, false);
				assert.ok(loaded);
				const plans = buildClipSchedulePlans({ project: loaded, sources: buffers,
					trackInputs: new Map([['linked-render', {} as AudioNode]]), fromFrame: 0, toFrame: 240, sampleRate: 48_000 });
				assert.equal(plans.length, 1);
				assert.equal(plans[0]!.playbackRate, 2);
				assert.equal(plans[0]!.offsetFrame, 100);
				if (fail) throw new DOMException('Cancelled', 'AbortError');
				return { channels: [new Float32Array(240)] };
			},
			play: async () => {}, pause() {}, stop() {}, seek: (frame: number) => frame, setLoop() {}, setPlayRange() {},
			subscribePosition: () => () => {}, dispose() { disposed += 1; },
		}),
	};
	return { source, clip, project, resources, loaded: () => loaded, disposed: () => disposed };
}
