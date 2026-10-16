/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAdmAuthoredRouting, type RoutingProject } from '../src/common/editor/adm-project-metadata.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { addAdmEditorObject, createDefaultAdmMetadata, listAdmEditorSourceChannels, setAdmEditorAssignment } from '../src/common/editor/ui/adm-metadata-editor-model.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand,
	redoSoundscaperProjectCommand, undoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';

for (const objects of [false, true]) test(`ordinary group removal retires its ADM ${objects ? 'bed and object' : 'bed'} references and retains explicit new-terminal assignment`, () => {
	const source = createAudioSource({ id: 'recording', storageKey: 'recording', name: 'recording',
		sampleRate: 48_000, channelCount: 2, frameCount: 64 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 64, sourceDurationFrames: 64 });
	let history = createSoundscaperProjectHistory(createSoundscaperProject({ sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] })] }));
	history = executeSoundscaperProjectCommand(history, { type: 'mixer/bus-add', busType: 'group', bus: { id: 'group', name: 'Group bus 1' } });
	history = executeSoundscaperProjectCommand(history, { type: 'mixer/route-update', trackId: 'track', changes: { groupId: 'group' } });
	let adm = createDefaultAdmMetadata(history.present);
	if (objects) {
		const group = listAdmEditorSourceChannels(history.present).find(channel => channel.stripKind === 'group');
		assert.ok(group);
		adm = addAdmEditorObject(adm, group, () => 'positioned-group');
	}
	history = executeSoundscaperProjectCommand(history, { type: 'metadata/update', changes: { adm } });
	const before = history.present;
	const count = history.undoStack.length;
	assert.deepEqual(validateAdmAuthoredRouting(before.metadata.adm, before as unknown as RoutingProject), []);
	history = executeSoundscaperProjectCommand(history, { type: 'mixer/bus-remove', busType: 'group', busId: 'group' });
	const after = history.present;
	assert.ok(after.metadata.adm?.mode === 'authored');
	assert.deepEqual(after.metadata.adm.bed.assignments, []);
	assert.deepEqual(after.metadata.adm.objects ?? [], []);
	assert.deepEqual(after.metadata.adm.programme, before.metadata.adm?.mode === 'authored' ? before.metadata.adm.programme : null);
	assert.deepEqual(validateAdmAuthoredRouting(after.metadata.adm, after as unknown as RoutingProject).map(issue => issue.code), ['missing-terminal-strip', 'missing-bed-channel', 'missing-bed-channel']);
	assert.equal(history.undoStack.length, count + 1);
	assert.equal(after.masterChannels, 2);
	history = undoSoundscaperProjectCommand(history);
	assert.deepEqual(history.present.metadata, before.metadata);
	assert.deepEqual(history.present.mixer, before.mixer);
	history = redoSoundscaperProjectCommand(history);
	assert.deepEqual(history.present.metadata, after.metadata);
	assert.deepEqual(history.present.mixer, after.mixer);
	let routedAdm = after.metadata.adm;
	for (const [sourceChannel, bedChannel] of (['L', 'R'] as const).entries()) routedAdm = setAdmEditorAssignment(routedAdm, {
		stripKind: 'track', stripId: 'track', sourceChannel, bedChannel, gain: 1,
	});
	history = executeSoundscaperProjectCommand(history, { type: 'metadata/update', changes: { adm: routedAdm } });
	assert.deepEqual(validateAdmAuthoredRouting(history.present.metadata.adm, history.present as unknown as RoutingProject), []);
});
