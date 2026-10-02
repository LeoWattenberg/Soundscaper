/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createCurrentAudioEditorProject, validateCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createClipPropertyService } from '../src/common/editor/controller/clip-video/internal/clip/clip-property-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { clipNeedsTimePitchRender } from '../src/common/editor/clip-time-pitch-cache-plan.js';
import { buildClipSchedulePlans } from '../src/common/editor/engine/clip-schedule-plan.ts';
import type { EngineChunkSource, EngineProject } from '../src/common/editor/engine/types.ts';
import { createClipSourcePreviewProject, type ClipSourcePreviewProject } from '../src/common/editor/controller/clip-video/internal/clip-source-preview-project.ts';
import { normalizeAudioWarpMap } from '../src/common/editor/audio-warp-domain.ts';
import type { HoldTempoMap } from '../src/common/editor/timeline-time.ts';
import { scheduleProjectClips } from '../src/common/editor/engine/clip-scheduler.ts';
import { MockAudioContext } from './helpers/mock-audio-context.js';

test('linked pitch edits share playback rate while preserving the independent pitch for unlink', () => {
	const harness = createHarness();
	assert.equal(Boolean(harness.clip().linkPitchAndTempo), false);
	harness.service.setClipTimePitch('clip', { linkPitchAndTempo: true });
	assert.equal(harness.clip().linkPitchAndTempo, true);
	assert.equal(harness.clip().pitchCents, 300);
	harness.service.setClipTimePitch('clip', { pitchCents: 2_400 });
	assert.equal(harness.clip().speedRatio, 4);
	assert.equal(harness.clip().pitchCents, 300);
	assert.equal(harness.clip().durationFrames, 24_000);
	assert.equal(harness.clip().timelineStartFrame, 400);
	assert.equal(harness.clip().sourceDurationFrames, 48_000);
	assert.equal(clipNeedsTimePitchRender(harness.clip()), false);
	harness.service.setClipTimePitch('clip', { speedRatio: 0.001 });
	assert.equal(harness.clip().speedRatio, 0.001);
	assert.equal(harness.clip().pitchCents, 300);
	harness.service.setClipTimePitch('clip', { linkPitchAndTempo: false });
	assert.equal(harness.clip().linkPitchAndTempo, false);
	assert.equal(harness.clip().pitchCents, 300);
	assert.equal(clipNeedsTimePitchRender(harness.clip()), true);
	assert.equal(validateCurrentAudioEditorProject(JSON.parse(JSON.stringify(harness.project()))), true);
});

test('linked pitch validation leaves the independent StaffPad bounds and document unchanged', () => {
	const harness = createHarness();
	assert.throws(() => harness.service.setClipTimePitch('clip', { pitchCents: 1_201 }), /Pitch/);
	harness.service.setClipTimePitch('clip', { linkPitchAndTempo: true });
	const before = harness.project();
	assert.throws(() => harness.service.setClipTimePitch('clip', { pitchCents: 12_000 }), /Speed/);
	assert.throws(() => harness.service.setClipTimePitch('clip', { pitchCents: Number.NaN }), /Pitch/);
	assert.equal(harness.project(), before);
});

test('buffered, streamed, and source preview plans bypass cached pitch renders for linked clips', () => {
	const harness = createHarness();
	harness.service.setClipTimePitch('clip', { linkPitchAndTempo: true, speedRatio: 2 });
	const runtime = projectForRuntimeConsumers(harness.project());
	const preview = createClipSourcePreviewProject(runtime as unknown as ClipSourcePreviewProject, 'clip');
	const buffer = { length: 48_000, numberOfChannels: 1, sampleRate: 24_000, getChannelData: () => new Float32Array(48_000) } as unknown as AudioBuffer;
	const provider: EngineChunkSource = { frameCount: 48_000, channelCount: 1, sampleRate: 24_000, chunkFrames: 1_024, readStorageChunk: () => { throw new Error('Planning must not read PCM.'); } };
	for (const project of [runtime, preview] as EngineProject[]) {
		for (const streamed of [false, true]) {
			const plans = buildClipSchedulePlans({ project, sampleRate: 48_000, fromFrame: 0, toFrame: 100_000,
				sources: streamed ? new Map() : new Map([['source', buffer]]),
				chunkSources: streamed ? new Map([['source', provider]]) : new Map(),
				trackInputs: new Map(project.tracks!.map((track) => [String(track.id), {} as AudioNode])),
				sourceResolver: () => { throw new Error('Linked playback must not use a StaffPad cache.'); },
			});
			assert.equal(plans.length, 1);
			assert.equal(plans[0]!.playbackRate, 2);
			assert.equal(plans[0]!.segmentDuration, 1);
			assert.equal(plans[0]!.offsetFrame, 0);
		}
	}
});

test('linked rate changes retain every stretch sample and scale sample and musical marker positions', () => {
	const point = (outer: number, source: number) => ({ outer: { num: outer, den: 1 }, source: { num: source, den: 1 }, mode: 'forward' as const });
	const sample = createHarness({ warpMap: { feature: 'audio-warp', points: [point(0, 0), point(24_000, 12_000), point(96_000, 48_000)] } });
	sample.service.setClipTimePitch('clip', { linkPitchAndTempo: true, speedRatio: 2 });
	assert.equal(sample.clip().sourceDurationFrames, 48_000);
	assert.deepEqual(normalizeAudioWarpMap(sample.clip().warpMap).points.map(({ outer, source }) => [outer.num / outer.den, source.num / source.den]), [[0, 0], [12_000, 12_000], [48_000, 48_000]]);
	const musical = createHarness({ anchor: 'musical', musicalStartBeat: 2, musicalExtent: 'beat', musicalDurationBeats: 8, speedRatio: 2 / 7,
		warpMap: { feature: 'audio-warp', points: [point(0, 0), point(2, 12_000), point(8, 48_000)] },
	}, { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }, { beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 } }] });
	musical.service.setClipTimePitch('clip', { linkPitchAndTempo: true, speedRatio: 4 / 7 });
	assert.equal(musical.clip().sourceDurationFrames, 48_000);
	assert.equal(musical.clip().timelineStartFrame, 48_000);
	assert.equal(musical.clip().durationFrames, 168_000);
	assert.deepEqual(normalizeAudioWarpMap(musical.clip().warpMap).points.map(({ outer, source }) => [outer.num / outer.den, source.num / source.den]), [[0, 0], [1, 12_000], [4.5, 48_000]]);
});

test('the live scheduler sets linked buffer source playbackRate without changing transport speed', async () => {
	const harness = createHarness();
	harness.service.setClipTimePitch('clip', { linkPitchAndTempo: true, speedRatio: 2 });
	const project = projectForRuntimeConsumers(harness.project());
	const context = new MockAudioContext({ sampleRate: 48_000 });
	await scheduleProjectClips({ context: context as unknown as BaseAudioContext, project,
		sources: new Map([['source', context.createBuffer(1, 48_000, 24_000) as unknown as AudioBuffer]]),
		trackInputs: new Map([['track', context.createGain() as unknown as AudioNode]]), fromFrame: 400, toFrame: 48_400,
		contextStartTime: 1, sampleRate: 48_000, transportRate: 1, reversedBuffers: new WeakMap(),
		sourceResolver: () => { throw new Error('Naive playback must bypass cached pitch.'); }, activeSources: new Set(), allNodes: [],
	});
	const started = context.bufferSources[0] as unknown as { playbackRate: { value: number }; started: number[] };
	assert.equal(started.playbackRate.value, 2);
	assert.deepEqual(started.started, [1, 0, 2]);
});

test('fast linked rates preserve adjacent sample markers as distinct rational positions', () => {
	const point = (outer: number, source: number) => ({ outer: { num: outer, den: 1 }, source: { num: source, den: 1 }, mode: 'forward' as const });
	const harness = createHarness({ warpMap: { feature: 'audio-warp', points: [point(0, 0), point(1, 1), point(96_000, 48_000)] } });
	harness.service.setClipTimePitch('clip', { linkPitchAndTempo: true, speedRatio: 1_000 });
	const marker = normalizeAudioWarpMap(harness.clip().warpMap).points[1]!;
	assert.deepEqual(marker.outer, { num: 1, den: 1_000 });
	assert.deepEqual(marker.source, { num: 1, den: 1 });
});

function createHarness(clipChanges: Readonly<Record<string, unknown>> = {}, tempoMap?: HoldTempoMap) {
	let project = createCurrentAudioEditorProject({ id: 'linked-project', now: '2026-10-02T12:00:00.000Z', sampleRate: 48_000,
		...(tempoMap ? { tempoMap } : {}),
		sources: [createAudioSource({ id: 'source', frameCount: 48_000, sampleRate: 24_000, channelCount: 1 })],
		clips: [createAudioClip({ id: 'clip', sourceId: 'source', timelineStartFrame: 400, sourceDurationFrames: 48_000,
			durationFrames: 96_000, pitchCents: 300, gain: 0.5, fadeInFrames: 100, ...clipChanges })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
	});
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const generation = new EditorProjectGeneration();
	generation.activate(project.id);
	const service = createClipPropertyService({
		lifetime, copy: { audioClipNotFound: 'Missing clip', clipPitchRange: 'Pitch out of range', clipSpeedPositive: 'Speed out of range', timelineFramesFinite: 'Invalid timeline' },
		getProject: () => projectForRuntimeConsumers(project) as ClipTransformProject,
		getSelectedClipId: () => 'clip', editingBlocked: () => false,
		captureProject: () => generation.capture(project.id), assertProject: (token) => generation.assertCurrent(token),
		analyzeChannels: async () => ({ peakAmplitude: 1, integratedLufs: -14 }), sourceBuffers: new Map(), createId: (prefix) => `${prefix}-id`,
		commit: (command: AudioEditorCommand) => { project = applyEditorCommand(project, command) as typeof project; return project; },
	});
	return { service, project: () => project, clip: () => projectForRuntimeConsumers(project).clips[0]! };
}
