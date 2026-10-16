/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAdmAuthoredRouting, type RoutingProject } from '../src/common/editor/adm-project-metadata.ts';
import { createAudioClip, createAudioSource, createAudioTrack, createLabelTrack } from '../src/common/editor/project-media-factory.ts';
import { addAdmEditorObject, createDefaultAdmMetadata, listAdmEditorSourceChannels } from '../src/common/editor/ui/adm-metadata-editor-model.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand,
	redoSoundscaperProjectCommand, undoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';

for (const objects of [false, true]) test(`ordinary track deletion retires its ADM ${objects ? 'bed and object' : 'bed'} references atomically`, () => {
	let history = createSoundscaperProjectHistory(project());
	let adm = createDefaultAdmMetadata(history.present);
	if (objects) for (const trackId of ['track-a', 'track-b']) {
		const source = listAdmEditorSourceChannels(history.present).find(channel => channel.stripId === trackId && channel.sourceChannel === 0);
		assert.ok(source);
		adm = addAdmEditorObject(adm, source, () => `object-${trackId}`);
	}
	history = executeSoundscaperProjectCommand(history, { type: 'metadata/update', changes: { adm } });
	assert.deepEqual(validateAdmAuthoredRouting(history.present.metadata.adm, history.present as unknown as RoutingProject), []);
	const before = history.present;
	const undoCount = history.undoStack.length;
	history = executeSoundscaperProjectCommand(history, { type: 'track/remove', trackId: 'track-a' });
	const after = history.present;
	assert.ok(after.metadata.adm?.mode === 'authored');
	assert.deepEqual(after.metadata.adm.bed.assignments, adm.bed.assignments.filter(assignment => assignment.stripId !== 'track-a'));
	assert.deepEqual(after.metadata.adm.objects ?? [], (adm.objects ?? []).filter(object => object.stripId !== 'track-a'));
	assert.deepEqual(after.metadata.adm.programme, adm.programme);
	assert.deepEqual(after.metadata.adm.content, adm.content);
	assert.deepEqual(after.clips.map(clip => clip.id), ['clip-b']);
	assert.deepEqual(after.clips[0], before.clips.find(clip => clip.id === 'clip-b'));
	assert.equal(after.masterChannels, objects ? 3 : 2);
	assert.deepEqual(validateAdmAuthoredRouting(after.metadata.adm, after as unknown as RoutingProject), []);
	assert.equal(history.undoStack.length, undoCount + 1);
	history = undoSoundscaperProjectCommand(history);
	assert.deepEqual(history.present.metadata, before.metadata);
	assert.deepEqual(history.present.tracks, before.tracks);
	assert.deepEqual(history.present.clips, before.clips);
	assert.deepEqual(history.present.mixer, before.mixer);
	assert.equal(history.present.masterChannels, before.masterChannels);
	history = redoSoundscaperProjectCommand(history);
	assert.deepEqual(history.present.metadata, after.metadata);
	assert.deepEqual(history.present.mixer, after.mixer);
	assert.equal(history.present.masterChannels, after.masterChannels);
});

for (const authored of [false, true]) test(`removing an unrelated label track preserves ${authored ? 'authored ADM' : 'ordinary'} metadata`, () => {
	let history = createSoundscaperProjectHistory(project());
	if (authored) history = executeSoundscaperProjectCommand(history, {
		type: 'metadata/update', changes: { adm: createDefaultAdmMetadata(history.present) },
	});
	const before = history.present;
	history = executeSoundscaperProjectCommand(history, { type: 'track/remove', trackId: 'labels' });
	assert.deepEqual(history.present.metadata, before.metadata);
	assert.deepEqual(history.present.clips, before.clips);
	assert.equal(history.present.masterChannels, before.masterChannels);
});

function project() {
	const sources = ['a', 'b'].map(id => createAudioSource({ id, storageKey: id, name: id,
		sampleRate: 48_000, channelCount: 2, frameCount: 64 }));
	const clips = sources.map(source => createAudioClip({ id: `clip-${source.id}`, sourceId: source.id,
		durationFrames: 64, sourceDurationFrames: 64 }));
	return createSoundscaperProject({ id: 'ordinary-adm', sources, clips, tracks: [
		...clips.map(clip => createAudioTrack({ id: `track-${clip.sourceId}`, clipIds: [clip.id] })),
		createLabelTrack({ id: 'labels', labels: [] }),
	] });
}
