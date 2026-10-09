/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipTimePitchRenderService } from '../src/common/editor/controller/clip-video/clip-time-pitch-render-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import type { AudioBufferLike } from '../src/common/editor/controller/source/source-audio.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand, redoSoundscaperProjectCommand,
	undoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';

for (const warped of [false, true]) for (const speed of [1, 2]) {
	test(`Render chooses authored ${warped ? 'warp' : 'scalar'} playback with independent speed ${String(speed)}`, async () => {
		const sampleRate = speed === 1 ? 48_000 : 24_000;
		const sourceStartFrame = speed === 1 ? 0 : 120;
		const sourceDurationFrames = sampleRate / 2;
		const durationFrames = 24_000 / speed;
		const source = createAudioSource({ id: 'source', storageKey: 'source', name: 'Recording',
			sampleRate, frameCount: sampleRate, channelCount: 1 });
		const clip = createAudioClip({ id: 'clip', title: 'Recording', sourceId: source.id, timelineStartFrame: 300,
			sourceStartFrame, sourceDurationFrames, durationFrames, speedRatio: speed, pitchCents: 200,
			linkPitchAndTempo: false, gain: .4, inverted: true, fadeInFrames: 37, fadeOutFrames: 21,
			envelope: [{ frame: 0, value: .7 }, { frame: durationFrames, value: 1 }],
			...(warped ? { warpMap: { feature: 'audio-warp', points: [
				{ outer: 0, source: sourceStartFrame, mode: 'forward' },
				{ outer: durationFrames / 2, source: sourceStartFrame + sourceDurationFrames * .75, mode: 'forward' },
				{ outer: durationFrames, source: sourceStartFrame + sourceDurationFrames, mode: 'forward' },
			] } } : {}) });
		const original = createSoundscaperProject({ id: 'project', sampleRate: 48_000, sources: [source], clips: [clip],
			tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] })] });
		let history = createSoundscaperProjectHistory(original);
		const lifetime = new EditorControllerLifetime();
		lifetime.markReady();
		const generation = new EditorProjectGeneration();
		generation.activate(original.id);
		const native = buffer(durationFrames, 48_000, .123);
		const scalar = buffer(sourceDurationFrames / speed, sampleRate, .456);
		const paths: string[] = [];
		const writes: Float32Array[][] = [];
		const discarded: string[] = [];
		const service = createClipTimePitchRenderService({ lifetime,
			copy: { audioClipNotFound: 'Missing audio.', rendering: 'Rendering', renderPitchSpeed: 'Render', done: 'Done' },
			store: { async beginSourceWrite() { return { async write(channels) { writes.push(channels); },
				async commit() {}, async abort() {} }; }, async saveAnalysis() {},
				async deleteSource(id) { discarded.push(id); } },
			sourceBuffers: new Map<string, AudioBufferLike>(), sourcePeaks: new Map<string, unknown>(), sourceChunkFrames: 65_536,
			getProject: () => history.present as unknown as ClipTransformProject, getSelectedClipId: () => clip.id,
			editingBlocked: () => false, captureProject: () => generation.capture(original.id),
			assertProject: token => generation.assertCurrent(token),
			async renderLinkedOutput(project, target, media) {
				assert.equal(project, history.present);
				assert.deepEqual(target.warpMap, original.clips[0]?.warpMap);
				assert.equal(media.id, source.id);
				paths.push('native');
				return native;
			},
			async prepareCommittedOutput() { paths.push('scalar'); return { cacheKey: 'scalar', sampleRate, audioBuffer: scalar }; },
			materializeEntry: async entry => entry, preflightStorage: async () => undefined,
			createId: () => 'rendered-source', writeBuffer: async (writer, output) => { await writer.write([output.getChannelData(0)]); },
			generateWaveformPeaks: async () => ({}), peakCacheKey: id => id, cacheSourceBuffer() {},
			commit: command => { history = executeSoundscaperProjectCommand(history, command); },
			setProcessing() {}, setStatus() {}, publish() {},
		});
		assert.equal(await service.renderClipPitchSpeed(clip.id), clip.id);
		assert.deepEqual(paths, [warped ? 'native' : 'scalar']);
		const replacement = history.present.clips[0];
		assert.ok(replacement?.kind === 'audio');
		assert.equal(replacement.sourceId, 'rendered-source');
		assert.equal(replacement.sourceStartFrame, 0);
		assert.equal(replacement.sourceDurationFrames, warped ? native.length : scalar.length);
		assert.equal(replacement.durationFrames, clip.durationFrames);
		assert.equal(replacement.timelineStartFrame, clip.timelineStartFrame);
		assert.equal(replacement.warpMap, null, 'authored-map output must play once, without applying its old map again');
		assert.equal(replacement.pitchCents, 0);
		assert.equal(replacement.speedRatio, 1);
		for (const property of ['gain', 'inverted', 'fadeInFrames', 'fadeOutFrames', 'envelope'] as const)
			assert.deepEqual(replacement[property], clip[property], `${property} stays authored rather than being baked twice`);
		assert.deepEqual(writes, [[(warped ? native : scalar).getChannelData(0)]]);
		assert.deepEqual(discarded, []);
		assert.equal(history.undoStack.length, 1);
		history = undoSoundscaperProjectCommand(history);
		assert.deepEqual(history.present.clips, original.clips);
		history = redoSoundscaperProjectCommand(history);
		assert.deepEqual(history.present.clips, [replacement]);
		assert.equal(original.clips[0]?.warpMap != null, warped, 'the original immutable map survives for Undo');
	});
}

function buffer(length: number, sampleRate: number, amplitude: number): AudioBufferLike {
	const channel = new Float32Array(length).fill(amplitude);
	return { length, sampleRate, numberOfChannels: 1, getChannelData: () => channel };
}
