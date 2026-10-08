/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { computeAudioTrackFreezeDigestsV1 } from '../src/common/editor/audio-track-freeze-v21.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { prepareRangeDeleteCommand } from '../src/common/editor/commands/range-runtime.js';
import { projectForCommandConsumers } from '../src/common/editor/project-current-runtime.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { prepareFrozenTrackEditCommand } from '../src/common/editor/controller/edit/internal/frozen-track-edit-command.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand,
	redoSoundscaperProjectCommand, undoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

for (const kind of ['headers', 'range'] as const) test(`ordinary ${kind} removal retires an empty freeze in the same Undo`, () => {
	const before = frozenProject();
	const removal: AudioEditorCommand = kind === 'headers'
		? { type: 'clip/remove-many', clipIds: ['voice-clip'], rippleMode: 'none' }
		: prepareRangeDeleteCommand(projectForCommandConsumers(before), {
			startFrame: 0, endFrame: 512, trackIds: ['voice'], rippleMode: 'none',
		});
	assert.throws(() => applySoundscaperProjectCommand(before, removal), /must retain editable clips/iu);
	const prepared = prepareFrozenTrackEditCommand(before, removal);
	const initial = createSoundscaperProjectHistory(before);
	const edited = executeSoundscaperProjectCommand(initial, prepared);
	assert.equal(edited.undoStack.length, 1);
	assert.equal(edited.present.clips.length, 0);
	assert.equal(Object.hasOwn(edited.present.tracks[0]!, 'audioFreeze'), false);
	assert.equal(edited.present.sources.some(source => source.id === 'voice-freeze'), false);
	assert.deepEqual(edited.present.tracks[0]!.effects, before.tracks[0]!.effects);
	assert.deepEqual(edited.present.mixer, before.mixer);
	assert.equal(edited.present.featureRequirements.requirements.some(requirement =>
		requirement.featureId === PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze), false);
	const undone = undoSoundscaperProjectCommand(edited);
	assert.deepEqual(undone.present.clips, before.clips);
	assert.deepEqual(undone.present.tracks, before.tracks);
	assert.deepEqual(undone.present.sources, before.sources);
	assert.deepEqual(redoSoundscaperProjectCommand(undone).present.clips, edited.present.clips);
});

test('partial editing retains the stale freeze and untouched commands retain their identity', () => {
	const before = frozenProject();
	const command = prepareRangeDeleteCommand(projectForCommandConsumers(before), {
		startFrame: 0, endFrame: 128, trackIds: ['voice'], rippleMode: 'none',
	});
	assert.equal(prepareFrozenTrackEditCommand(before, command), command);
	const after = applySoundscaperProjectCommand(before, command);
	assert.equal(after.clips.length, 1);
	assert.deepEqual(after.tracks[0]!.audioFreeze, before.tracks[0]!.audioFreeze);
	const rename = { type: 'project/rename' as const, title: 'Still frozen' };
	assert.equal(prepareFrozenTrackEditCommand(before, rename), rename);
});

function frozenProject() {
	const live = createAudioSource({ id: 'voice-live', frameCount: 512, channelCount: 2,
		sampleRate: 48_000, contentSha256: 'ab'.repeat(32) });
	const clip = createAudioClip({ id: 'voice-clip', sourceId: live.id, timelineStartFrame: 0,
		durationFrames: 512, sourceStartFrame: 0, sourceDurationFrames: 512 });
	const track = createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [clip.id],
		effects: [{ id: 'voice-delay', type: 'delay', enabled: true, params: {} }] });
	const project = createSoundscaperProject({ id: 'freeze-edit', tracks: [track], clips: [clip], sources: [live] });
	const sourceContentIdentities = [{ sourceId: live.id, contentSha256: live.contentSha256! }];
	const freeze = { schemaVersion: 1 as const, derivedSourceId: 'voice-freeze', renderStartFrame: 0,
		renderFrameCount: 1024, capturePosition: 'post-insert-pre-strip' as const,
		...computeAudioTrackFreezeDigestsV1({ sampleRate: project.sampleRate,
			renderStartFrame: 0, renderFrameCount: 1024, track: project.tracks[0]!,
			clips: project.clips, sourceContentIdentities, automationLanes: project.automationLanes,
			tempoMap: project.tempoMap ?? null }) };
	const derivedSource = createAudioSource({ id: 'voice-freeze', frameCount: 1024,
		channelCount: 2, sampleRate: 48_000, contentSha256: 'cd'.repeat(32) });
	return applySoundscaperProjectCommand(project, { type: 'audio-freeze/install', trackId: track.id,
		expectedFreeze: null, replacementFreeze: freeze, derivedSource, sourceContentIdentities });
}
