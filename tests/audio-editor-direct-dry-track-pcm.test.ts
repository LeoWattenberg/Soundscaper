import assert from 'node:assert/strict';
import test from 'node:test';

import { renderSimpleDryTrackPcm } from '../src/common/editor/controller/effects/internal/direct-dry-track-pcm.ts';
import type { EffectAudioProject } from '../src/common/editor/controller/effects/internal/effect-audio-service-types.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createHarness } from './audio-editor-effect-audio-service-fixture.ts';

function fixture() {
	const channels = [Float32Array.from({ length: 2_003 }, (_, frame) => Math.sin(frame * 0.017) * 0.5),
		Float32Array.from({ length: 2_003 }, (_, frame) => Math.cos(frame * 0.023) * 0.3)];
	const buffer = { sampleRate: 44_100, numberOfChannels: 2, length: 2_003,
		getChannelData: (channel: number) => channels[channel] } as unknown as AudioBuffer;
	const clip = createAudioClip({ id: 'clip', sourceId: 'source', timelineStartFrame: 101,
		sourceStartFrame: 17, durationFrames: 1_501 });
	const project = createAudioEditorProjectV17({ sampleRate: 44_100, masterChannels: 2,
		sources: [createAudioSource({ id: 'source', sampleRate: 44_100, channelCount: 2, frameCount: 2_003 })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })], clips: [clip],
	}) as unknown as EffectAudioProject;
	return { channels, buffer, project, sources: new Map([['source', buffer]]) };
}

test('the admitted direct path copies exact source frames, silence and independent stereo channels', async () => {
	const { project, sources, channels } = fixture();
	const output = await renderSimpleDryTrackPcm(project, sources, 'track', 89, 1_700, 2);
	assert.ok(output);
	assert.deepEqual(output[0].subarray(12, 1_513), channels[0].subarray(17, 1_518));
	assert.ok(output[0].subarray(0, 12).every((sample) => sample === 0));
	assert.ok(output[0].subarray(1_513).every((sample) => sample === 0));
	assert.notEqual(output[0].buffer, output[1].buffer);
	assert.notEqual(output[0].buffer, channels[0].buffer);
	output[0][12] = 0.123;
	assert.notEqual(channels[0][17], output[0][12]);
});

test('unity WebAudio rendering flushes signed zero and subnormal samples, and nonfinite PCM uses the engine', async () => {
	const { project, sources, channels } = fixture();
	channels[0].set([-0, 1e-40, -1e-40, 2 ** -126], 17);
	const output = await renderSimpleDryTrackPcm(project, sources, 'track', 101, 1_602, 2);
	assert.ok(output);
	assert.deepEqual(output[0].subarray(0, 4), new Float32Array([0, 0, 0, 2 ** -126]));
	for (const value of [NaN, Infinity, -Infinity]) {
		channels[0][17] = value;
		assert.equal(await renderSimpleDryTrackPcm(project, sources, 'track', 101, 1_602, 2), null);
	}
});

test('every unsupported clip transformation or non-neutral layout falls back to the engine', async () => {
	const { project, sources } = fixture();
	for (const changes of [
		{ reversed: true }, { inverted: true }, { gain: 0.7 }, { fadeInFrames: 10 }, { fadeOutFrames: 10 },
		{ envelope: [{ frame: 10, value: 0.4 }] }, { pitchCents: 1 }, { speedRatio: 1.1 }, { stretchToTempo: true },
		{ linkPitchAndTempo: true }, { warpMap: {} }, { anchor: 'musical' }, { sourceDurationFrames: 1_500 },
		{ opaqueExtensions: { 'org.soundscaper.clip-loop/v1': { periodFrames: 1_501, offsetFrames: 0 } } },
	]) {
		const changed = { ...project, clips: [{ ...project.clips[0]!, ...changes }] } as EffectAudioProject;
		assert.equal(await renderSimpleDryTrackPcm(changed, sources, 'track', 101, 1_602, 2), null);
	}
	for (const changed of [
		{ ...project, masterChannels: 6 }, { ...project, metadata: { adm: {} } },
		{ ...project, trackFolders: [{}] }, { ...project, automationLanes: [{}] },
		{ ...project, tracks: [{ ...project.tracks[0]!, gain: 0.8 }] },
		{ ...project, tracks: [{ ...project.tracks[0]!, audioFreeze: {} }] },
		{ ...project, tracks: [{ ...project.tracks[0]!, clipIds: ['clip', 'clip'] }] },
		{ ...project, clips: [...project.clips, { ...project.clips[0]!, id: 'other' }],
			tracks: [{ ...project.tracks[0]!, clipIds: ['clip', 'other'] }] },
	]) assert.equal(await renderSimpleDryTrackPcm(changed, sources, 'track', 101, 1_602, 2), null);
	assert.equal(await renderSimpleDryTrackPcm(project, new Map(), 'track', 101, 1_602, 2), null);
	assert.equal(await renderSimpleDryTrackPcm(project, sources, 'track', 101, 1_602, 1), null);
	assert.equal(await renderSimpleDryTrackPcm(project, new Map([['source', { ...sources.get('source')!, sampleRate: 48_000 } as AudioBuffer]]), 'track', 101, 1_602, 2), null);
});

test('clip scope excludes unrelated overlaps and an aborted direct job publishes no PCM', async () => {
	const { project, sources } = fixture();
	const overlap = { ...project, clips: [...project.clips, { ...project.clips[0]!, id: 'other' }],
		tracks: [{ ...project.tracks[0]!, clipIds: ['clip', 'other'] }] };
	assert.ok(await renderSimpleDryTrackPcm(overlap, sources, 'track', 101, 1_602, 2, ['clip']));
	const controller = new AbortController();
	controller.abort(new Error('Cancelled'));
	await assert.rejects(renderSimpleDryTrackPcm(project, sources, 'track', 101, 1_602, 2, null, controller.signal), /Cancelled/);
});

test('the effect service uses direct PCM and keeps authored rendering on the engine', async () => {
	const { project, sources, channels } = fixture();
	const harness = createHarness({ project, sourceBuffers: sources });
	const output = await harness.service.renderDryTrackRange('track', 103, 1_601, 2);
	assert.deepEqual(output[0], channels[0].subarray(19, 1_517));
	assert.equal(harness.snapshots.length, 0);
	await harness.service.renderDryTrackRange('track', 103, 1_601, 2, null, null, 'authored');
	assert.equal(harness.snapshots.length, 1);
});

test('a project switch fences direct PCM completion before its caller can consume the audio', async () => {
	const { project, sources } = fixture();
	const harness = createHarness({ project, sourceBuffers: sources });
	const pending = harness.service.renderDryTrackRange('track', 103, 1_601, 2);
	harness.switchProject();
	await assert.rejects(pending, { name: 'AbortError' });
});
