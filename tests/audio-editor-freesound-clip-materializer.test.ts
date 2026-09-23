/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFreesoundClipUploadMaterializer,
	createIsolatedFreesoundClipRenderProject,
} from '../src/common/editor/controller/track-audio/internal/freesound-clip-upload-materializer.ts';
import { createDefaultMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createNonImportedSourceProvenance } from '../src/common/editor/source-provenance.ts';

test('Freesound clip projection preserves clip edits while excluding every non-clip mix contribution', () => {
	const project = projectFixture();
	const projected = createIsolatedFreesoundClipRenderProject(project, 'clip-a');
	const targetTrack = projected.tracks.find(({ id }) => id === 'track-a');
	const otherTrack = projected.tracks.find(({ id }) => id === 'track-b');

	assert.deepEqual(projected.clips.map(({ id }) => id), ['clip-a']);
	assert.deepEqual(targetTrack?.clipIds, ['clip-a']);
	assert.equal(targetTrack?.gain, 1);
	assert.equal(targetTrack?.pan, 0);
	assert.equal(targetTrack?.effectsActive, false);
	assert.deepEqual(targetTrack?.effects, []);
	assert.deepEqual(targetTrack?.envelope, []);
	assert.deepEqual(otherTrack?.clipIds, []);
	assert.equal(otherTrack?.mute, true);
	assert.deepEqual(projected.master, {
		gain: 1, pan: 0, mute: false, solo: false, effectsActive: false, effects: [],
	});
	assert.deepEqual(projected.mixer.routes['track-a'], { groupId: null, sends: {} });
	assert.equal(projected.clips[0]?.reversed, true, 'clip-local edits remain render-authoritative');
	assert.notStrictEqual(projected, project);
});

test('Freesound clip projection replaces production routing and automation with one dry output path', async () => {
	const project = {
		...projectFixture(),
		schemaFamily: 'soundscaper' as const,
		schemaVersion: 1,
		masterChannels: 6,
		automationLanes: [{ id: 'master-gain', address: { kind: 'strip', strip: { kind: 'master' } } }],
		mixer: createDefaultMixerGraphV21([
			{ id: 'track-a', channelCount: 2 },
			{ id: 'track-b', channelCount: 1 },
		], 6),
	};
	const projected = createIsolatedFreesoundClipRenderProject(project, 'clip-a');

	assert.deepEqual(projected.tracks.map(({ id }) => id), ['track-a']);
	assert.deepEqual(projected.automationLanes, []);
	assert.deepEqual(projected.mixer, createDefaultMixerGraphV21([{
		id: 'track-a', channelCount: 2,
	}], 6));
	assert.equal(project.automationLanes.length, 1, 'the canonical project remains untouched');

	let rendered = false;
	const materializer = createFreesoundClipUploadMaterializer({
		getProject: () => project,
		maximumBytes: 4_120,
		renderClip: async () => {
			rendered = true;
			throw new Error('must not render');
		},
		encodeWav: () => new Uint8Array(),
	});
	await assert.rejects(
		materializer.materialize({ projectId: 'project-a', clipId: 'clip-a' }),
		/100 MB/iu,
		'the preflight uses the projected six-channel main output, not source width',
	);
	assert.equal(rendered, false);
});

test('Freesound clip materialization renders one isolated range into 24-bit WAV', async () => {
	const project = projectFixture();
	const renderCalls: Array<Readonly<{ project: ReturnType<typeof projectFixture>; startFrame: number; endFrame: number }>> = [];
	const encodeCalls: Array<Readonly<Record<string, unknown>>> = [];
	const materializer = createFreesoundClipUploadMaterializer({
		getProject: () => project,
		renderClip: async (renderProject, range) => {
			renderCalls.push({ project: renderProject as ReturnType<typeof projectFixture>, ...range });
			return {
				length: 4, numberOfChannels: 2, sampleRate: 48_000,
				getChannelData: (channel: number) => channel === 0
					? Float32Array.of(0, 0.25, -0.25, 0)
					: Float32Array.of(0, -0.25, 0.25, 0),
			};
		},
		encodeWav: (channels, options) => {
			encodeCalls.push({ channels, ...options });
			return new Uint8Array([0x52, 0x49, 0x46, 0x46]);
		},
	});

	const result = await materializer.materialize({
		projectId: 'project-a', clipId: 'clip-a',
	});

	assert.equal(renderCalls.length, 1);
	assert.deepEqual({ startFrame: renderCalls[0]?.startFrame, endFrame: renderCalls[0]?.endFrame }, {
		startFrame: 100, endFrame: 104,
	});
	assert.equal(encodeCalls[0]?.sampleRate, 48_000);
	assert.equal(encodeCalls[0]?.bitDepth, 24);
	assert.equal(encodeCalls[0]?.float, false);
	assert.equal(encodeCalls[0]?.dither, 'triangular');
	assert.equal(result.file.name, 'Window Rain.wav');
	assert.equal(result.file.type, 'audio/wav');
	assert.equal(result.clipTitle, 'Window Rain');
	assert.equal(result.source.provenance?.extensions?.soundscaper.recordingDeviceLabels[0], 'Studio Microphone');
	assert.equal(result.clip.reversed, true);
});

test('Project Bin audio clips are projected onto one dry audio track before rendering', async () => {
	const base = projectFixture();
	const binClip = {
		...base.clips[0]!, id: 'bin-clip', title: 'Unplaced capture', timelineStartFrame: 900,
		binItemId: 'bin-clip',
	};
	const project = {
		...base,
		schemaFamily: 'soundscaper' as const,
		schemaVersion: 1,
		automationLanes: [],
		projectBin: { clips: [binClip] },
		mixer: createDefaultMixerGraphV21([
			{ id: 'track-a', channelCount: 2 },
			{ id: 'track-b', channelCount: 1 },
		], 2),
	};
	const calls: Array<Readonly<{ project: typeof project; startFrame: number; endFrame: number }>> = [];
	const materializer = createFreesoundClipUploadMaterializer({
		getProject: () => project,
		renderClip: async (renderProject, range) => {
			calls.push({ project: renderProject, ...range });
			return {
				length: 4, numberOfChannels: 2, sampleRate: 48_000,
				getChannelData: () => new Float32Array(4),
			};
		},
		encodeWav: () => Uint8Array.of(82, 73, 70, 70),
	});

	const result = await materializer.materialize({ projectId: project.id, clipId: binClip.id });
	assert.equal(calls.length, 1);
	assert.deepEqual({ startFrame: calls[0]?.startFrame, endFrame: calls[0]?.endFrame }, {
		startFrame: 0, endFrame: 4,
	});
	assert.deepEqual(calls[0]?.project.clips.map(({ id, timelineStartFrame }) => ({ id, timelineStartFrame })), [
		{ id: 'bin-clip', timelineStartFrame: 0 },
	]);
	assert.deepEqual(calls[0]?.project.tracks.map(({ id, clipIds }) => ({ id, clipIds })), [
		{ id: 'track-a', clipIds: ['bin-clip'] },
	]);
	assert.equal(calls[0]?.project.projectBin.clips.length, 0);
	assert.equal(project.projectBin.clips[0]?.timelineStartFrame, 900, 'the Project Bin document stays untouched');
	assert.equal(result.clipTitle, 'Unplaced capture');
});

test('Freesound clip materialization refuses stale projects and oversized WAV plans', async () => {
	const project = projectFixture();
	let current: ReturnType<typeof projectFixture> | null = project;
	const stale = createFreesoundClipUploadMaterializer({
		getProject: () => current,
		renderClip: async () => {
			current = null;
			return {
				length: 4, numberOfChannels: 1, sampleRate: 48_000,
				getChannelData: () => new Float32Array(4),
			};
		},
		encodeWav: () => new Uint8Array([1]),
	});
	await assert.rejects(stale.materialize({ projectId: 'project-a', clipId: 'clip-a' }), {
		name: 'AbortError',
	});

	const oversizedProject = projectFixture();
	oversizedProject.clips[0]!.durationFrames = 20_000_000;
	let rendered = false;
	const oversized = createFreesoundClipUploadMaterializer({
		getProject: () => oversizedProject,
		renderClip: async () => { rendered = true; throw new Error('must not render'); },
		encodeWav: () => new Uint8Array(),
	});
	await assert.rejects(
		oversized.materialize({ projectId: 'project-a', clipId: 'clip-a' }),
		/100 MB/iu,
	);
	assert.equal(rendered, false);
});

function projectFixture() {
	return {
		id: 'project-a', schemaVersion: 21, title: 'Project', sampleRate: 48_000,
		masterChannels: 2,
		clips: [{
			kind: 'audio', id: 'clip-a', sourceId: 'source-a', title: 'Window Rain',
			timelineStartFrame: 100, durationFrames: 4, sourceStartFrame: 1, sourceDurationFrames: 4,
			gain: 0.5, fadeInFrames: 1, fadeOutFrames: 1, reversed: true, inverted: false,
			pitchCents: 100, speedRatio: 0.75, warpMap: null,
		}, {
			kind: 'audio', id: 'clip-b', sourceId: 'source-b', title: 'Other',
			timelineStartFrame: 100, durationFrames: 4, sourceStartFrame: 0, sourceDurationFrames: 4,
		}],
		tracks: [{
			id: 'track-a', type: 'audio', clipIds: ['clip-a'], gain: 0.75, pan: -0.25,
			mute: false, solo: false, effectsActive: true, effects: [{ id: 'fx-a' }], envelope: [{ frame: 0, value: 0.5 }],
		}, {
			id: 'track-b', type: 'audio', clipIds: ['clip-b'], gain: 1, pan: 0,
			mute: false, solo: false, effectsActive: true, effects: [{ id: 'fx-b' }], envelope: [],
		}],
		sources: [{
			kind: 'audio', id: 'source-a', storageKey: 'source-a', name: 'capture.wav', mimeType: 'audio/wav',
			frameCount: 8, channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
			sampleFormat: 'float32', chunkFrames: 65_536,
			provenance: createNonImportedSourceProvenance('recorded', {
				recordingDeviceLabel: 'Studio Microphone',
			}),
		}, {
			kind: 'audio', id: 'source-b', storageKey: 'source-b', name: 'other.wav', mimeType: 'audio/wav',
			frameCount: 8, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
			sampleFormat: 'float32', chunkFrames: 65_536,
		}],
		master: { gain: 0.8, pan: 0.2, mute: false, solo: false, effectsActive: true, effects: [{ id: 'master-fx' }] },
		mixer: {
			groups: [{ id: 'group-a', effectsActive: true, effects: [{ id: 'group-fx' }] }],
			sends: [{ id: 'send-a', effectsActive: true, effects: [{ id: 'send-fx' }] }],
			routes: {
				'track-a': { groupId: 'group-a', sends: { 'send-a': 1 } },
				'track-b': { groupId: null, sends: {} },
			},
		},
	};
}
