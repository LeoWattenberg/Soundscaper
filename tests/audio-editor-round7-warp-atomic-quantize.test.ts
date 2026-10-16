/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioWarpControllerComposition } from '../src/common/editor/controller/track-audio/internal/audio-warp/audio-warp-composition.ts';
import type { AudioWarpAuthoringProject } from '../src/common/editor/controller/track-audio/internal/audio-warp/audio-warp-authoring-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { detectPcmTransients } from '../src/common/editor/transient-analysis.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand,
	undoSoundscaperProjectCommand, redoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import { round7DrumPcm } from './helpers/round7-warp-drums.ts';
import { normalizeAudioWarpMap } from '../src/common/editor/audio-warp-domain.ts';

for (const alreadyMapped of [true, false]) test(`one ordinary Quantize is atomic ${alreadyMapped ? 'with' : 'without'} an existing map`, async context => {
	const source = createAudioSource({ id: 'source', storageKey: 'source', name: 'Drums.wav',
		sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', title: 'Drums', sourceId: source.id,
		timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 48_000, sourceDurationFrames: 48_000,
		...(alreadyMapped ? { warpMap: { feature: 'audio-warp', points: [
			{ outer: 0, source: 0, mode: 'forward' },
			{ outer: 48_000, source: 48_000, mode: 'forward' },
		] } } : {}) });
	const original = createSoundscaperProject({ id: 'warp-atomic', sampleRate: 48_000,
		sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] })] });
	let history = createSoundscaperProjectHistory(original);
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const generation = new EditorProjectGeneration(); generation.activate(original.id);
	const service = createAudioWarpControllerComposition({ lifetime,
		getProject: () => history.present as unknown as AudioWarpAuthoringProject,
		getSelectedClipId: () => clip.id, editingBlocked: () => false,
		commit(command) { history = executeSoundscaperProjectCommand(history, command); return history.present; },
		captureProject: () => generation.capture(original.id), assertProject: token => generation.assertCurrent(token),
		store: { getSourceMetadata: () => null, async *readSourceChunks() {}, openSourceReadSession: () => null,
			loadAnalysis: async () => null, saveAnalysis: async () => undefined, deleteAnalysis: async () => undefined },
		pcmAccess: { resolveSourceSha256: async () => 'ab'.repeat(32),
			readSourceRange: async () => [round7DrumPcm()], dispose: () => undefined },
		analyzeChannels: (channels, options) => detectPcmTransients(channels, options),
		getRenderStatus: () => ({ path: 'exact-offline', realtimeAcceleration: false, exactOfflineAvailable: true, fallback: true }),
	});
	context.after(() => service.dispose());
	await service.quantizeSelected({ grid: { origin: 0, interval: 12_000 }, strength: { num: 1, den: 2 } });
	const authored = history.present.clips[0]?.warpMap;
	assert.ok(authored);
	assert.ok(normalizeAudioWarpMap(authored).points.length > 2, 'actual drum transients have been authored');
	history = undoSoundscaperProjectCommand(history);
	assert.deepEqual(history.present.clips[0]?.warpMap, original.clips[0]?.warpMap, 'one Undo retires the complete button action');
	history = redoSoundscaperProjectCommand(history);
	assert.deepEqual(history.present.clips[0]?.warpMap, authored, 'one Redo restores the exact authored result');
	if (!alreadyMapped) {
		history = undoSoundscaperProjectCommand(history);
		await assert.rejects(service.applyGrooveSelected({ grid: { origin: 0, interval: 12_000 }, strength: 1,
			template: { offsets: [0, 2] }, grooveStrength: 1 }), RangeError);
		assert.equal(history.present.clips[0]?.warpMap, null, 'refused groove leaves no identity edit');
	}
});
