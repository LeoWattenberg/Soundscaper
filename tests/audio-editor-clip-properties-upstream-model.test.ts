/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { clipPropertiesPresentation } from '../src/common/editor/ui/inspector/clip-properties-upstream-model.ts';

const source = { id: 'source', name: 'Recording', sampleRate: 96_000, frameCount: 960_000 };
const clip = { id: 'one', kind: 'audio', sourceId: 'source', title: '', timelineStartFrame: 48_000,
	durationFrames: 96_000, sourceStartFrame: 96_000, sourceDurationFrames: 384_000,
	speedRatio: 2, pitchCents: 300, fadeInFrames: 24_000, fadeOutFrames: 0, reversed: false };
const track = { id: 'track', type: 'audio', name: 'Voice', clipIds: ['one', 'two'], locked: false, color: 'blue' };
const project = { id: 'project', sampleRate: 48_000, sources: [source], clips: [clip], tracks: [track] };

test('upstream property values retain separate source and project clocks', () => {
	const view = clipPropertiesPresentation(project, ['one'], 'Clip');
	assert.equal(view.clip?.start, 1);
	assert.equal(view.clip.duration, 2);
	assert.equal(view.clip.trimStart, 1);
	assert.equal(view.clip.fullDuration, 10);
	assert.equal(view.clip.stretchFactor, 0.5);
	assert.equal(view.clip.pitchSemitones, 3);
	assert.equal(view.clip.fadeIn, 0.5);
	assert.equal(view.clip.trackId, 'track');
	assert.equal(view.clip.name, 'Recording');
	assert.equal(view.selection, null);
});

test('multi-selection merges matching values and reports mixed values with the union span', () => {
	const two = { ...clip, id: 'two', timelineStartFrame: 240_000, sourceDurationFrames: 192_000, speedRatio: 1, pitchCents: 0 };
	const view = clipPropertiesPresentation({ ...project, clips: [clip, two] }, ['one', 'two'], 'Clip');
	assert.equal(view.selection?.count, 2);
	assert.equal(view.selection.start, 1);
	assert.equal(view.selection.end, 7);
	assert.equal(view.selection.pitchSemitones, 'mixed');
	assert.equal(view.selection.stretchFactor, 'mixed');
	assert.equal(view.selection.fadeIn, 0.5);
	assert.deepEqual(view.selection.trackNames, ['Voice']);
});

test('all selected property mutations are blocked when any owning track is locked', () => {
	assert.equal(clipPropertiesPresentation({ ...project, tracks: [{ ...track, locked: true }] }, ['one'], 'Clip').locked, true);
	assert.equal(clipPropertiesPresentation(project, ['removed'], 'Clip').clip, null);
});

test('mixed linked selections retain the focused audio or video as the native property target', () => {
	const video = { ...clip, id: 'camera', kind: 'video' };
	const linked = { ...project, clips: [video, clip] };
	const audioView = clipPropertiesPresentation(linked, ['camera', 'one'], 'Clip', 'one');
	assert.equal(audioView.clip?.id, 'one');
	assert.equal(audioView.clips[0]?.kind, 'audio');
	assert.equal(audioView.selection?.count, 2);
	const videoView = clipPropertiesPresentation(linked, ['one', 'camera'], 'Clip', 'camera');
	assert.equal(videoView.clip?.id, 'camera');
	assert.deepEqual(new Set(audioView.clips.map(item => item.id)), new Set(['one', 'camera']));
});


test('loop repetitions change the visible length without changing the displayed source speed', () => {
	const looped = { ...clip, durationFrames: 192_000, opaqueExtensions: { 'org.soundscaper.clip-loop/v1': { periodFrames: 96_000, offsetFrames: 0 } } };
	const view = clipPropertiesPresentation({ ...project, clips: [looped] }, ['one'], 'Clip');
	assert.equal(view.clip?.duration, 4);
	assert.equal(view.clip.stretchFactor, 0.5);
});
