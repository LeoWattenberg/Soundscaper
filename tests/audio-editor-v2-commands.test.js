import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyEditorCommand,
	aggregateStereoMinutes,
	createAddClipCommand,
	createAddLabelCommand,
	createAddLabelTrackCommand,
	createAddSourceCommand,
	createAddTrackCommand,
	createAudioEditorProjectV2,
	createClipboardDescriptor,
	prepareGroupClipsCommand,
	prepareKeepRangeCommand,
	preparePasteCommand,
	prepareRangeDeleteCommand,
	prepareSplitCommand,
	validateAudioEditorProject,
} from '../src/common/editor/index.js';

function apply(project, command) {
	return applyEditorCommand(project, command, { now: '2026-07-13T00:00:00.000Z' });
}

test('V2 commands preserve arbitrary rates and nondestructive clip properties', () => {
	let project = createAudioEditorProjectV2({
		id: 'v2-project',
		title: 'V2',
		sampleRate: 44_100,
		now: '2026-07-12T00:00:00.000Z',
	});
	project = apply(project, createAddSourceCommand({
		schemaVersion: 2,
		id: 'source',
		storageKey: 'source',
		name: 'Source',
		frameCount: 96_000,
		channelCount: 2,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
	}));
	project = apply(project, createAddTrackCommand({
		schemaVersion: 2,
		id: 'track',
		name: 'Music',
	}));
	project = apply(project, createAddClipCommand('track', {
		schemaVersion: 2,
		id: 'clip',
		sourceId: 'source',
		title: 'Verse',
		timelineStartFrame: 1_000,
		sourceStartFrame: 4_000,
		sourceDurationFrames: 48_000,
		durationFrames: 44_100,
		pitchCents: 300,
		speedRatio: 0.9,
		preserveFormants: true,
		color: 'blue',
	}));
	project = apply(project, prepareSplitCommand('clip', 23_050, () => 'clip-right'));

	assert.equal(project.schemaVersion, 2);
	assert.equal(project.sampleRate, 44_100);
	assert.equal(project.sources[0].channelCount, 2);
	assert.equal(project.sources[0].sampleRate, 48_000);
	assert.equal(Object.hasOwn(project.tracks[0], 'channelCount'), false);
	assert.equal(Object.hasOwn(project.tracks[0], 'sampleRate'), false);
	assert.deepEqual(project.tracks[0].clipIds, ['clip', 'clip-right']);
	assert.equal(project.clips[0].sourceDurationFrames, 24_000);
	assert.equal(project.clips[1].sourceStartFrame, 28_000);
	assert.equal(project.clips[1].sourceDurationFrames, 24_000);
	assert.equal(project.clips[1].pitchCents, 300);
	assert.equal(project.clips[1].speedRatio, 0.9);
	assert.equal(project.clips[1].preserveFormants, true);
	assert.equal(validateAudioEditorProject(project), true);
});

test('editing preserveFormants clears an imported future AUP4 preset even when toggled back', () => {
	let project = createAudioEditorProjectV2({
		id: 'future-formant-preset',
		title: 'Future formant preset',
		sampleRate: 48_000,
		sources: [{
			id: 'source',
			storageKey: 'source',
			name: 'Source',
			frameCount: 4,
			channelCount: 1,
			sampleRate: 48_000,
		}],
		clips: [{
			id: 'clip',
			sourceId: 'source',
			durationFrames: 4,
			sourceDurationFrames: 4,
			preserveFormants: false,
			opaqueExtensions: {
				aup4PitchAndSpeedPreset: { value: 100_000, preserveFormants: false },
			},
		}],
		tracks: [{ type: 'audio', id: 'track', name: 'Track', clipIds: ['clip'] }],
	});
	project = apply(project, {
		type: 'clip/update',
		clipId: 'clip',
		changes: { preserveFormants: true },
	});
	assert.equal(project.clips[0].preserveFormants, true);
	assert.equal(project.clips[0].opaqueExtensions.aup4PitchAndSpeedPreset, undefined);
	project = apply(project, {
		type: 'clip/update',
		clipId: 'clip',
		changes: { preserveFormants: false },
	});
	assert.equal(project.clips[0].preserveFormants, false);
	assert.equal(project.clips[0].opaqueExtensions.aup4PitchAndSpeedPreset, undefined);
});

test('track and clip colors remain attached while tracks reorder and clips move', () => {
	let project = createAudioEditorProjectV2({ title: 'Colors', sampleRate: 48_000 });
	project = apply(project, createAddSourceCommand({
		id: 'source', storageKey: 'source', name: 'Source', frameCount: 48_000,
		channelCount: 1, sampleRate: 48_000,
	}));
	project = apply(project, createAddTrackCommand({ id: 'blue-track', name: 'Blue', color: 'blue' }));
	project = apply(project, createAddTrackCommand({ id: 'red-track', name: 'Red', color: 'red' }));
	project = apply(project, createAddClipCommand('blue-track', {
		id: 'following-clip', sourceId: 'source', durationFrames: 12_000, color: 'auto',
	}));
	project = apply(project, createAddClipCommand('blue-track', {
		id: 'green-clip', sourceId: 'source', timelineStartFrame: 12_000,
		durationFrames: 12_000, color: 'green',
	}));

	project = apply(project, { type: 'track/reorder', trackId: 'red-track', index: 0 });
	assert.deepEqual(project.tracks.map(({ id, color }) => [id, color]), [
		['red-track', 'red'],
		['blue-track', 'blue'],
	]);

	project = apply(project, {
		type: 'clip/move', clipId: 'green-clip', trackId: 'red-track', timelineStartFrame: 0,
	});
	assert.equal(project.clips.find((clip) => clip.id === 'following-clip').color, 'auto');
	assert.equal(project.clips.find((clip) => clip.id === 'green-clip').color, 'green');
	assert.deepEqual(project.tracks.find((track) => track.id === 'red-track').clipIds, ['green-clip']);
});

test('V2 project tempo, time signature, metadata, and source formats are replay-stable', () => {
	let project = createAudioEditorProjectV2({ id: 'music-project', title: 'Music', sampleRate: 48_000 });
	project = apply(project, createAddSourceCommand({
		id: 'hires-source',
		storageKey: 'hires-source',
		name: 'Hi-res source',
		frameCount: 96_000,
		channelCount: 2,
		sampleRate: 96_000,
		originalSampleRate: 96_000,
		sampleFormat: 'int24',
	}));
	project = apply(project, createAddTrackCommand({ schemaVersion: 2, id: 'track', name: 'Track' }));
	project = apply(project, { type: 'tempo/set', bpm: 137.5, numerator: 7, denominator: 8 });
	project = apply(project, {
		type: 'metadata/update',
		changes: { artist: 'Artist', year: 2026, tags: { ISRC: 'DE-KWM-26-00001' } },
	});

	assert.equal(project.tempo.bpm, 137.5);
	assert.deepEqual(project.tempo.timeSignature, { numerator: 7, denominator: 8 });
	assert.equal(project.sources[0].sampleRate, 96_000);
	assert.equal(project.sources[0].channelCount, 2);
	assert.equal(project.sources[0].sampleFormat, 'int24');
	for (const field of ['channelCount', 'channelLayout', 'sampleRate', 'sampleFormat']) {
		assert.equal(Object.hasOwn(project.tracks[0], field), false);
	}
	assert.throws(
		() => apply(project, { type: 'track/update', trackId: 'track', changes: { sampleRate: 44_100 } }),
		/Track field cannot be updated: sampleRate/,
	);
	assert.deepEqual(project.metadata, {
		title: 'Music',
		artist: 'Artist',
		album: '',
		trackNumber: '',
		year: '2026',
		comments: '',
		tags: { ISRC: 'DE-KWM-26-00001' },
	});
	assert.equal(validateAudioEditorProject(project), true);
	assert.throws(
		() => apply(project, { type: 'tempo/set', numerator: 4, denominator: 3 }),
		/denominator/i,
	);
	assert.throws(
		() => apply(project, { type: 'metadata/update', changes: { accountToken: 'nope' } }),
		/metadata field/i,
	);
});

test('capacity accounting uses each immutable source sample rate', () => {
	let project = createAudioEditorProjectV2({ id: 'mixed-rate-capacity', title: 'Mixed rates', sampleRate: 48_000 });
	project = apply(project, createAddSourceCommand({
		schemaVersion: 2,
		id: 'source-96k',
		storageKey: 'source-96k',
		name: '96 kHz minute',
		frameCount: 96_000 * 60,
		channelCount: 2,
		sampleRate: 96_000,
		originalSampleRate: 96_000,
	}));
	project = apply(project, createAddTrackCommand({ schemaVersion: 2, id: 'track', name: 'Track' }));
	project = apply(project, createAddClipCommand('track', {
		schemaVersion: 2,
		id: 'clip',
		sourceId: 'source-96k',
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		sourceDurationFrames: 96_000 * 60,
		durationFrames: 48_000 * 60,
	}));
	assert.equal(aggregateStereoMinutes(project), 1);
});

test('V2 commands cover per-clip ripple, trim outside, grouping, track order, and spectral selection', () => {
	let project = createAudioEditorProjectV2({
		id: 'editing-project',
		title: 'Editing',
		sampleRate: 48_000,
		now: '2026-07-12T00:00:00.000Z',
	});
	project = apply(project, createAddSourceCommand({
		schemaVersion: 2,
		id: 'source',
		storageKey: 'source',
		name: 'Source',
		frameCount: 10_000,
		channelCount: 2,
		sampleRate: 48_000,
	}));
	project = apply(project, createAddTrackCommand({ schemaVersion: 2, id: 'track-a', name: 'A' }));
	project = apply(project, createAddTrackCommand({ schemaVersion: 2, id: 'track-b', name: 'B' }));
	project = apply(project, createAddClipCommand('track-a', {
		schemaVersion: 2,
		id: 'clip-a',
		sourceId: 'source',
		timelineStartFrame: 100,
		sourceStartFrame: 0,
		durationFrames: 1_000,
	}));
	project = apply(project, createAddClipCommand('track-a', {
		schemaVersion: 2,
		id: 'clip-b',
		sourceId: 'source',
		timelineStartFrame: 1_500,
		sourceStartFrame: 2_000,
		durationFrames: 500,
	}));

	project = apply(project, prepareGroupClipsCommand(['clip-a', 'clip-b'], () => 'group-one'));
	assert.deepEqual(project.clips.map((clip) => clip.groupId), ['group-one', 'group-one']);
	project = apply(project, { type: 'clip/ungroup', clipIds: ['clip-a', 'clip-b'] });
	assert.deepEqual(project.clips.map((clip) => clip.groupId), [null, null]);
	project = apply(project, prepareSplitCommand('clip-a', 600, () => 'clip-a-split'));
	project = apply(project, { type: 'clip/join', clipIds: ['clip-a', 'clip-a-split'] });
	assert.equal(project.clips.some((clip) => clip.id === 'clip-a-split'), false);
	assert.equal(project.clips.find((clip) => clip.id === 'clip-a').durationFrames, 1_000);

	project = apply(project, prepareRangeDeleteCommand(project, {
		startFrame: 300,
		endFrame: 600,
		trackIds: ['track-a'],
		rippleMode: 'clip',
	}, () => 'clip-a-right'));
	assert.deepEqual(project.tracks[0].clipIds.map((id) => {
		const clip = project.clips.find((candidate) => candidate.id === id);
		return [id, clip.timelineStartFrame, clip.durationFrames];
	}), [
		['clip-a', 100, 200],
		['clip-a-right', 300, 500],
		['clip-b', 1_500, 500],
	]);

	project = apply(project, prepareKeepRangeCommand(project, {
		startFrame: 250,
		endFrame: 1_700,
		trackIds: ['track-a'],
	}));
	assert.deepEqual(project.tracks[0].clipIds.map((id) => {
		const clip = project.clips.find((candidate) => candidate.id === id);
		return [id, clip.timelineStartFrame, clip.durationFrames];
	}), [
		['clip-a', 250, 50],
		['clip-a-right', 300, 500],
		['clip-b', 1_500, 200],
	]);

	project = apply(project, { type: 'track/reorder', trackId: 'track-b', index: 0 });
	assert.deepEqual(project.tracks.map((track) => track.id), ['track-b', 'track-a']);
	project = apply(project, {
		type: 'selection/set',
		startFrame: 300,
		endFrame: 800,
		trackIds: ['track-a'],
		clipIds: ['clip-a-right'],
		frequencyRange: { minimumFrequency: 500, maximumFrequency: 8_000 },
	});
	assert.deepEqual(project.selection, {
		startFrame: 300,
		endFrame: 800,
		trackIds: ['track-a'],
		clipIds: ['clip-a-right'],
		frequencyRange: { minimumFrequency: 500, maximumFrequency: 8_000 },
	});
	assert.equal(validateAudioEditorProject(project), true);
});

test('V2 label commands coexist with audio history without clip assumptions', () => {
	let project = createAudioEditorProjectV2({
		id: 'labels-project',
		title: 'Labels',
		now: '2026-07-12T00:00:00.000Z',
	});
	project = apply(project, createAddLabelTrackCommand({ id: 'labels', name: 'Markers' }));
	project = apply(project, createAddLabelCommand('labels', {
		id: 'label-b',
		title: 'B',
		startFrame: 2_000,
		endFrame: 3_000,
	}));
	project = apply(project, createAddLabelCommand('labels', {
		id: 'label-a',
		title: 'A',
		startFrame: 1_000,
		endFrame: 1_000,
	}));
	project = apply(project, {
		type: 'label/update',
		trackId: 'labels',
		labelId: 'label-b',
		changes: { title: 'Chorus', startFrame: 4_000, endFrame: 5_000 },
	});

	assert.deepEqual(project.tracks[0].labels.map((label) => label.id), ['label-a', 'label-b']);
	assert.equal(project.tracks[0].labels[1].title, 'Chorus');
	project = apply(project, { type: 'label/remove', trackId: 'labels', labelId: 'label-a' });
	assert.deepEqual(project.tracks[0].labels.map((label) => label.id), ['label-b']);
	assert.equal(validateAudioEditorProject(project), true);
});

test('paste overlap layers clips while insert variants preserve collision regions with replay-stable splits', () => {
	let project = createAudioEditorProjectV2({ id: 'paste-project', title: 'Paste', sampleRate: 48_000 });
	project = apply(project, createAddSourceCommand({
		schemaVersion: 2, id: 'source', storageKey: 'source', name: 'Source', frameCount: 4_000, channelCount: 1, sampleRate: 48_000,
	}));
	project = apply(project, createAddTrackCommand({ schemaVersion: 2, id: 'track', name: 'Track' }));
	project = apply(project, createAddClipCommand('track', {
		schemaVersion: 2, id: 'long', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 2_000,
	}));
	const clipboard = createClipboardDescriptor(project, { startFrame: 100, endFrame: 300, trackIds: ['track'] });
	let sequence = 0;
	project = apply(project, preparePasteCommand(clipboard, {
		project,
		atFrame: 500,
		mode: 'overlap',
	}, () => `overlap-${++sequence}`));
	assert.deepEqual(project.tracks[0].clipIds.map((id) => {
		const clip = project.clips.find((candidate) => candidate.id === id);
		return [clip.timelineStartFrame, clip.durationFrames];
	}), [[0, 2_000], [500, 200]]);

	sequence = 0;
	project = apply(project, preparePasteCommand(clipboard, {
		project,
		atFrame: 1_000,
		mode: 'insert-all',
	}, () => `insert-${++sequence}`));
	assert.deepEqual(project.tracks[0].clipIds.map((id) => {
		const clip = project.clips.find((candidate) => candidate.id === id);
		return [clip.timelineStartFrame, clip.durationFrames];
	}), [[0, 1_000], [500, 200], [1_000, 200], [1_200, 1_000]]);
	assert.equal(validateAudioEditorProject(project), true);
});

test('clipboard frame positions scale across arbitrary project sample rates', () => {
	let sourceProject = createAudioEditorProjectV2({ id: 'source-project', title: 'Source', sampleRate: 48_000 });
	sourceProject = apply(sourceProject, createAddSourceCommand({
		schemaVersion: 2, id: 'shared-source', storageKey: 'shared-source', name: 'Shared', frameCount: 10_000, channelCount: 1, sampleRate: 48_000,
	}));
	sourceProject = apply(sourceProject, createAddTrackCommand({ schemaVersion: 2, id: 'source-track', name: 'Source' }));
	sourceProject = apply(sourceProject, createAddClipCommand('source-track', {
		schemaVersion: 2, id: 'source-clip', sourceId: 'shared-source', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 1_000,
	}));
	const clipboard = createClipboardDescriptor(sourceProject, { startFrame: 0, endFrame: 1_000, trackIds: ['source-track'] });

	let target = createAudioEditorProjectV2({ id: 'target-project', title: 'Target', sampleRate: 96_000 });
	target = apply(target, createAddSourceCommand({
		schemaVersion: 2, id: 'shared-source', storageKey: 'shared-source', name: 'Shared', frameCount: 10_000, channelCount: 1, sampleRate: 48_000,
	}));
	target = apply(target, createAddTrackCommand({ schemaVersion: 2, id: 'target-track', name: 'Target' }));
	target = apply(target, preparePasteCommand(clipboard, {
		project: target,
		atFrame: 2_000,
		trackMap: { 'source-track': 'target-track' },
	}, () => 'pasted'));
	const pasted = target.clips.find((clip) => clip.id === 'pasted');
	assert.equal(pasted.timelineStartFrame, 2_000);
	assert.equal(pasted.durationFrames, 2_000);
	assert.equal(pasted.sourceDurationFrames, 1_000);
});
