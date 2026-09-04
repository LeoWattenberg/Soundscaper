import test from 'node:test';
import assert from 'node:assert/strict';
import {
	collectClipTransformIds,
	createClipboardDescriptor,
	prepareOverwriteClipCommand,
	preparePasteCommand,
	preparePunchCommand,
	prepareRangeDeleteCommand,
	prepareRangeReplacementCommand,
	prepareSplitCommand,
	prepareTransformClipsCommand,
} from '../src/common/editor/commands.js';
import {
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import {
	findClip,
	validateAudioEditorProject,
} from '../src/common/editor/project.js';
import {
	createCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import {
	createAudioClip,
	createAudioSource,
} from '../src/common/editor/project-media-factory.ts';
import { coreClip } from './helpers/audio-editor-model-clip-projection.js';
import {
	NOW,
	apply,
	createFixture,
} from './helpers/audio-editor-model-harness.js';

test('Project Bin media replacement preserves spacing or contracts shortened instances atomically', () => {
	const oldSource = createAudioSource({
		id: 'bin-old-source',
		name: 'old.wav',
		storageKey: 'bin-old-source',
		frameCount: 48_000,
		channelCount: 1,
		sampleRate: 48_000,
	});
	const laterSource = createAudioSource({
		id: 'later-source',
		name: 'later.wav',
		storageKey: 'later-source',
		frameCount: 4_800,
		channelCount: 1,
		sampleRate: 48_000,
	});
	const replacementSource = createAudioSource({
		id: 'bin-new-source',
		name: 'new.wav',
		storageKey: 'bin-new-source',
		frameCount: 24_000,
		channelCount: 1,
		sampleRate: 48_000,
	});
	const binClip = createAudioClip({
		id: 'bin-template',
		sourceId: oldSource.id,
		title: 'Reusable take',
		color: 'green',
		sourceStartFrame: 0,
		sourceDurationFrames: 48_000,
		durationFrames: 48_000,
		binItemId: 'bin-template',
	});
	const timelineClip = createAudioClip({
		id: 'timeline-instance',
		sourceId: oldSource.id,
		title: 'Edited instance',
		color: 'red',
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		sourceDurationFrames: 48_000,
		durationFrames: 48_000,
		fadeOutFrames: 30_000,
	});
	const laterClip = createAudioClip({
		id: 'later-clip',
		sourceId: laterSource.id,
		timelineStartFrame: 60_000,
		sourceStartFrame: 0,
		sourceDurationFrames: 4_800,
		durationFrames: 4_800,
	});
	const project = createCurrentAudioEditorProject({
		id: 'replacement-project',
		now: NOW,
		sources: [oldSource, laterSource],
		clips: [timelineClip, laterClip],
		tracks: [{
			type: 'audio',
			id: 'replacement-track',
			name: 'Replacement track',
			clipIds: [timelineClip.id, laterClip.id],
		}],
		projectBin: { clips: [binClip] },
	});
	const replacementTemplate = createAudioClip({
		id: 'staged-template',
		sourceId: replacementSource.id,
		title: replacementSource.name,
		sourceStartFrame: 0,
		sourceDurationFrames: 24_000,
		durationFrames: 24_000,
		binItemId: 'staged-template',
	});
	const replace = (shortfallMode) => apply(project, {
		type: 'batch',
		commands: [{
			type: 'source/add',
			source: replacementSource,
		}, {
			type: 'project-bin/replace-media',
			clipId: binClip.id,
			replacements: [{ oldSourceId: oldSource.id, newSourceId: replacementSource.id }],
			templates: [replacementTemplate],
			shortfallMode,
		}],
	});

	const spaced = replace('keep-spacing');
	assert.equal(findClip(spaced, timelineClip.id).durationFrames, 24_000);
	assert.equal(findClip(spaced, timelineClip.id).fadeOutFrames, 24_000);
	assert.equal(findClip(spaced, laterClip.id).timelineStartFrame, 60_000);
	assert.equal(spaced.projectBin.clips[0].sourceId, replacementSource.id);
	assert.equal(spaced.projectBin.clips[0].title, 'Reusable take');
	assert.equal(spaced.projectBin.clips[0].color, 'green');
	assert.equal(spaced.sources.some((source) => source.id === oldSource.id), false);

	const contracted = replace('contract-gaps');
	assert.equal(findClip(contracted, timelineClip.id).durationFrames, 24_000);
	assert.equal(findClip(contracted, laterClip.id).timelineStartFrame, 36_000);
	assert.equal(validateAudioEditorProject(contracted), true);
});

test('current clip commands preserve layered overlaps and source bounds while moving and trimming', () => {
	let project = createFixture();
	project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'clip-1', sourceId: 'source-1', timelineStartFrame: 100, sourceStartFrame: 50,
		durationFrames: 400, fadeInFrames: 20, fadeOutFrames: 30,
	} });
	project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'clip-2', sourceId: 'source-1', timelineStartFrame: 600, sourceStartFrame: 500, durationFrames: 100,
	} });
	project = apply(project, {
		type: 'clip/move', clipId: 'clip-2', timelineStartFrame: 450,
	});
	assert.equal(findClip(project, 'clip-2').timelineStartFrame, 450);
	assert.equal(validateAudioEditorProject(project), true);

	project = apply(project, {
		type: 'clip/trim', clipId: 'clip-1', timelineStartFrame: 120, sourceStartFrame: 70, durationFrames: 300,
	});
	assert.deepEqual(coreClip(findClip(project, 'clip-1')), {
		id: 'clip-1', sourceId: 'source-1', timelineStartFrame: 120, sourceStartFrame: 70,
		durationFrames: 300, gain: 1, fadeInFrames: 20, fadeOutFrames: 30, reversed: false,
	});
	assert.equal(findClip(project, 'clip-1').sourceDurationFrames, 300);
	assert.equal(findClip(project, 'clip-1').sourceDurationFrames / findClip(project, 'clip-1').durationFrames, 1);
	project = apply(project, { type: 'clip/move', clipId: 'clip-2', trackId: 'track-2', timelineStartFrame: 200 });
	assert.deepEqual(project.tracks.map((track) => track.clipIds), [['clip-1'], ['clip-2']]);
	assert.throws(() => apply(project, {
		type: 'clip/trim', clipId: 'clip-1', sourceStartFrame: 4_700, durationFrames: 300,
	}), /source bounds/);
});

test('selected and grouped clips layer atomically and can explicitly overwrite inactive material', () => {
	let project = createFixture();
	project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'selected-a', sourceId: 'source-1', timelineStartFrame: 100, sourceStartFrame: 0, durationFrames: 100,
	} });
	project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'selected-b', sourceId: 'source-1', timelineStartFrame: 200, sourceStartFrame: 100, durationFrames: 100,
	} });
	project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'inactive', sourceId: 'source-1', timelineStartFrame: 500, sourceStartFrame: 1_000, durationFrames: 400,
	} });
	project = apply(project, {
		type: 'clip/group', clipIds: ['selected-a', 'selected-b'], groupId: 'selected-group',
	});
	project = apply(project, {
		type: 'selection/set', startFrame: 100, endFrame: 300,
		trackIds: ['track-1'], clipIds: ['selected-a'],
	});
	assert.deepEqual(collectClipTransformIds(project, 'selected-a'), ['selected-a', 'selected-b']);

	const collision = {
		type: 'clip/transform-many',
		transforms: [
			{ clipId: 'selected-a', trackId: 'track-1', changes: { timelineStartFrame: 450 } },
			{ clipId: 'selected-b', trackId: 'track-1', changes: { timelineStartFrame: 550 } },
		],
	};
	const layered = apply(project, collision);
	assert.equal(findClip(layered, 'selected-a').timelineStartFrame, 450);
	assert.equal(findClip(layered, 'selected-b').timelineStartFrame, 550);
	assert.equal(validateAudioEditorProject(layered), true);

	const overwrite = prepareTransformClipsCommand(project, [
		{ clipId: 'selected-a', trackId: 'track-1', changes: { timelineStartFrame: 600 } },
		{ clipId: 'selected-b', trackId: 'track-1', changes: { timelineStartFrame: 700 } },
	], { overwrite: true }, () => 'inactive-right');
	assert.deepEqual(overwrite.splitClipIds, { inactive: ['inactive-right'] });
	project = apply(project, overwrite);
	assert.deepEqual(project.tracks[0].clipIds, ['inactive', 'selected-a', 'selected-b', 'inactive-right']);
	assert.deepEqual([
		coreClip(findClip(project, 'inactive')),
		coreClip(findClip(project, 'selected-a')),
		coreClip(findClip(project, 'selected-b')),
		coreClip(findClip(project, 'inactive-right')),
	].map((clip) => [clip.id, clip.timelineStartFrame, clip.sourceStartFrame, clip.durationFrames]), [
		['inactive', 500, 1_000, 100],
		['selected-a', 600, 0, 100],
		['selected-b', 700, 100, 100],
		['inactive-right', 800, 1_300, 100],
	]);
	assert.equal(validateAudioEditorProject(project), true);
});

test('overwrite clip placement trims, splits, and removes inactive clips', () => {
	let project = createFixture();
	project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'backing', sourceId: 'source-1', timelineStartFrame: 100, sourceStartFrame: 0, durationFrames: 800,
	} });
	project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'active', sourceId: 'source-1', timelineStartFrame: 1_100, sourceStartFrame: 1_000, durationFrames: 200,
	} });
	project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'untouched', sourceId: 'source-1', timelineStartFrame: 1_500, sourceStartFrame: 1_400, durationFrames: 100,
	} });
	const overwrite = prepareOverwriteClipCommand(project, 'active', {
		trackId: 'track-1',
		changes: { timelineStartFrame: 300 },
	}, () => 'backing-right');
	assert.deepEqual(overwrite.splitClipIds, { backing: 'backing-right' });
	project = apply(project, overwrite);
	assert.deepEqual(project.tracks[0].clipIds, ['backing', 'active', 'backing-right', 'untouched']);
	assert.deepEqual(coreClip(findClip(project, 'backing')), {
		id: 'backing', sourceId: 'source-1', timelineStartFrame: 100, sourceStartFrame: 0, durationFrames: 200,
		gain: 1, fadeInFrames: 0, fadeOutFrames: 0, reversed: false,
	});
	assert.deepEqual(coreClip(findClip(project, 'backing-right')), {
		id: 'backing-right', sourceId: 'source-1', timelineStartFrame: 500, sourceStartFrame: 400, durationFrames: 400,
		gain: 1, fadeInFrames: 0, fadeOutFrames: 0, reversed: false,
	});
	assert.deepEqual(coreClip(findClip(project, 'untouched')), {
		id: 'untouched', sourceId: 'source-1', timelineStartFrame: 1_500, sourceStartFrame: 1_400,
		durationFrames: 100, gain: 1, fadeInFrames: 0, fadeOutFrames: 0, reversed: false,
	});

	project = apply(project, { type: 'clip/overwrite', clipId: 'active', trackId: 'track-1', changes: {
		timelineStartFrame: 0,
		durationFrames: 1_000,
	} });
	assert.deepEqual(project.tracks[0].clipIds, ['active', 'untouched']);
	assert.equal(findClip(project, 'backing'), null);
	assert.equal(findClip(project, 'backing-right'), null);
	assert.notEqual(findClip(project, 'untouched'), null);
	assert.equal(validateAudioEditorProject(project), true);
});

test('splits preserve forward and reversed source regions with stable replay IDs', () => {
	let project = createFixture();
	project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'forward', sourceId: 'source-1', timelineStartFrame: 100, sourceStartFrame: 50,
		durationFrames: 400, fadeInFrames: 20, fadeOutFrames: 30,
	} });
	const split = prepareSplitCommand('forward', 250, () => 'forward-right');
	assert.equal(JSON.parse(JSON.stringify(split)).rightClipId, 'forward-right');
	project = apply(project, split);
	assert.deepEqual(coreClip(findClip(project, 'forward')), {
		id: 'forward', sourceId: 'source-1', timelineStartFrame: 100, sourceStartFrame: 50,
		durationFrames: 150, gain: 1, fadeInFrames: 20, fadeOutFrames: 0, reversed: false,
	});
	assert.deepEqual(coreClip(findClip(project, 'forward-right')), {
		id: 'forward-right', sourceId: 'source-1', timelineStartFrame: 250, sourceStartFrame: 200,
		durationFrames: 250, gain: 1, fadeInFrames: 0, fadeOutFrames: 30, reversed: false,
	});

	project = apply(project, { type: 'clip/add', trackId: 'track-2', clip: {
		id: 'reverse', sourceId: 'source-1', timelineStartFrame: 0, sourceStartFrame: 50,
		durationFrames: 400, reversed: true,
	} });
	project = apply(project, { type: 'clip/split', clipId: 'reverse', atFrame: 150, rightClipId: 'reverse-right' });
	assert.equal(findClip(project, 'reverse').sourceStartFrame, 300);
	assert.equal(findClip(project, 'reverse').durationFrames, 150);
	assert.equal(findClip(project, 'reverse-right').sourceStartFrame, 50);
	assert.equal(findClip(project, 'reverse-right').durationFrames, 250);
});

test('lift and ripple deletes retain nondestructive source segments', () => {
	function withLongClip() {
		let project = createFixture({ frameCount: 2_000 });
		return apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
			id: 'clip-1', sourceId: 'source-1', timelineStartFrame: 0, sourceStartFrame: 0,
			durationFrames: 1_000, fadeInFrames: 50, fadeOutFrames: 60,
		} });
	}

	let lifted = withLongClip();
	lifted = apply(lifted, prepareRangeDeleteCommand(lifted, {
		startFrame: 300, endFrame: 600, trackIds: ['track-1'],
	}, () => 'right-lift'));
	assert.deepEqual(lifted.tracks[0].clipIds, ['clip-1', 'right-lift']);
	assert.deepEqual(
		lifted.tracks[0].clipIds.map((id) => {
			const clip = findClip(lifted, id);
			return [clip.timelineStartFrame, clip.sourceStartFrame, clip.durationFrames];
		}),
		[[0, 0, 300], [600, 600, 400]],
	);

	let rippled = withLongClip();
	rippled = apply(rippled, prepareRangeDeleteCommand(rippled, {
		startFrame: 300, endFrame: 600, trackIds: ['track-1'], ripple: true,
	}, () => 'right-ripple'));
	assert.deepEqual(
		rippled.tracks[0].clipIds.map((id) => {
			const clip = findClip(rippled, id);
			return [clip.timelineStartFrame, clip.sourceStartFrame, clip.durationFrames];
		}),
		[[0, 0, 300], [300, 600, 400]],
	);
});

test('clipboard descriptors paste atomically and punch-in replaces only the selected material', () => {
	let project = createFixture({ frameCount: 2_000 });
	project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'clip-1', sourceId: 'source-1', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 1_000,
	} });
	const clipboard = createClipboardDescriptor(project, { startFrame: 100, endFrame: 300, trackIds: ['track-1'] });
	assert.deepEqual(clipboard.tracks[0].clips.map((clip) => [clip.offsetFrame, clip.sourceStartFrame, clip.durationFrames]), [[0, 100, 200]]);
	project = apply(project, preparePasteCommand(clipboard, { atFrame: 1_200 }, () => 'pasted'));
	assert.deepEqual(coreClip(findClip(project, 'pasted')), {
		id: 'pasted', sourceId: 'source-1', timelineStartFrame: 1_200, sourceStartFrame: 100,
		durationFrames: 200, gain: 1, fadeInFrames: 0, fadeOutFrames: 0, reversed: false,
	});
	assert.throws(() => apply(project, preparePasteCommand(clipboard, { atFrame: 900 }, () => 'collision')), /overlaps/);
	assert.equal(findClip(project, 'collision'), null);

	project = apply(project, { type: 'source/add', source: {
		id: 'take', name: 'take.wav', storageKey: 'pcm/take', frameCount: 200, channelCount: 1,
	} });
	project = apply(project, preparePunchCommand(project, {
		trackId: 'track-1', startFrame: 400, endFrame: 600, sourceId: 'take', clipId: 'take-clip',
	}, () => 'punch-right'));
	assert.deepEqual(
		project.tracks[0].clipIds.map((id) => {
			const clip = findClip(project, id);
			return [id, clip.timelineStartFrame, clip.sourceStartFrame, clip.durationFrames];
		}),
		[
			['clip-1', 0, 0, 400],
			['take-clip', 400, 0, 200],
			['punch-right', 600, 600, 400],
			['pasted', 1_200, 100, 200],
		],
	);
});

test('range replacements preserve surrounding segments, ripple one track, and replay stable IDs', () => {
	let project = createFixture({ frameCount: 4_000 });
	project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'main', sourceId: 'source-1', timelineStartFrame: 100, sourceStartFrame: 200,
		durationFrames: 1_000, fadeInFrames: 50, fadeOutFrames: 60,
	} });
	project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'later', sourceId: 'source-1', timelineStartFrame: 1_400, sourceStartFrame: 1_500,
		durationFrames: 200,
	} });
	project = apply(project, { type: 'clip/add', trackId: 'track-2', clip: {
		id: 'other-track', sourceId: 'source-1', timelineStartFrame: 500, sourceStartFrame: 2_000,
		durationFrames: 200,
	} });

	const generated = ['processed-source', 'processed-clip', 'main-right'];
	const prefixes = [];
	const command = prepareRangeReplacementCommand(project, {
		trackId: 'track-1',
		startFrame: 400,
		endFrame: 700,
		source: { name: 'processed.wav', storageKey: 'pcm/processed', frameCount: 500, channelCount: 2 },
	}, (prefix) => {
		prefixes.push(prefix);
		return generated.shift();
	});
	assert.deepEqual(prefixes, ['source', 'clip', 'clip']);
	assert.deepEqual(JSON.parse(JSON.stringify(command)), command);
	assert.equal(command.source.id, 'processed-source');
	assert.equal(command.clipId, 'processed-clip');
	assert.deepEqual(command.splitClipIds, { main: 'main-right' });

	const before = project;
	let history = executeEditorCommand(createEditorHistory(project), command, { now: NOW });
	project = history.present;
	assert.deepEqual(
		project.tracks[0].clipIds.map((id) => {
			const clip = findClip(project, id);
			return [id, clip.timelineStartFrame, clip.sourceStartFrame, clip.durationFrames, clip.fadeInFrames, clip.fadeOutFrames];
		}),
		[
			['main', 100, 200, 300, 50, 0],
			['processed-clip', 400, 0, 500, 0, 0],
			['main-right', 900, 800, 400, 0, 60],
			['later', 1_600, 1_500, 200, 0, 0],
		],
	);
	assert.deepEqual(project.tracks[1].clipIds, ['other-track']);
	assert.equal(findClip(project, 'other-track').timelineStartFrame, 500);
	assert.equal(project.sources.at(-1).id, 'processed-source');
	assert.equal(project.sources.at(-1).frameCount, 500);

	history = undoEditorCommand(history, { now: NOW });
	assert.deepEqual(history.present.sources.map((source) => source.id), before.sources.map((source) => source.id));
	assert.deepEqual(history.present.tracks[0].clipIds, ['main', 'later']);
	assert.equal(findClip(history.present, 'main').durationFrames, 1_000);
	assert.equal(findClip(history.present, 'later').timelineStartFrame, 1_400);
	history = redoEditorCommand(history, { now: NOW });
	assert.deepEqual(history.present.tracks[0].clipIds, ['main', 'processed-clip', 'main-right', 'later']);
	assert.equal(findClip(history.present, 'processed-clip').sourceId, 'processed-source');
	assert.equal(findClip(history.present, 'later').timelineStartFrame, 1_600);
});

test('shorter range replacements preserve reversed source regions and close later gaps', () => {
	let project = createFixture({ frameCount: 3_000 });
	project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'reverse', sourceId: 'source-1', timelineStartFrame: 100, sourceStartFrame: 50,
		durationFrames: 800, fadeInFrames: 20, fadeOutFrames: 30, reversed: true,
	} });
	project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'later', sourceId: 'source-1', timelineStartFrame: 1_100, sourceStartFrame: 1_000,
		durationFrames: 100,
	} });
	const command = prepareRangeReplacementCommand(project, {
		trackId: 'track-1', startFrame: 300, endFrame: 700,
		source: { id: 'short-source', name: 'short.wav', storageKey: 'pcm/short', frameCount: 100, channelCount: 1 },
		clipId: 'short-clip',
	}, () => 'reverse-right');
	project = apply(project, command);

	assert.deepEqual(
		project.tracks[0].clipIds.map((id) => {
			const clip = findClip(project, id);
			return [id, clip.timelineStartFrame, clip.sourceStartFrame, clip.durationFrames, clip.reversed];
		}),
		[
			['reverse', 100, 650, 200, true],
			['short-clip', 300, 0, 100, false],
			['reverse-right', 400, 50, 200, true],
			['later', 800, 1_000, 100, false],
		],
	);
	assert.equal(findClip(project, 'reverse').fadeInFrames, 20);
	assert.equal(findClip(project, 'reverse').fadeOutFrames, 0);
	assert.equal(findClip(project, 'reverse-right').fadeInFrames, 0);
	assert.equal(findClip(project, 'reverse-right').fadeOutFrames, 30);
});

test('range replacements reject zero output, reused IDs, and incomplete replay commands atomically', () => {
	let project = createFixture({ frameCount: 2_000 });
	project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'spanning', sourceId: 'source-1', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 1_000,
	} });
	const before = structuredClone(project);
	const source = { id: 'replacement-source', name: 'replacement.wav', storageKey: 'pcm/replacement', frameCount: 200, channelCount: 1 };

	assert.throws(() => prepareRangeReplacementCommand(project, {
		trackId: 'track-1', startFrame: 300, endFrame: 600,
		source: { ...source, id: 'empty-source', frameCount: 0 }, clipId: 'replacement-clip',
	}), /at least one frame/);
	assert.throws(() => prepareRangeReplacementCommand(project, {
		trackId: 'track-1', startFrame: 300, endFrame: 600,
		source: { ...source, id: 'source-1' }, clipId: 'replacement-clip',
	}), /Duplicate source ID/);
	assert.throws(() => prepareRangeReplacementCommand(project, {
		trackId: 'track-1', startFrame: 300, endFrame: 600,
		source, clipId: 'spanning',
	}), /Duplicate clip ID/);

	assert.throws(() => apply(project, {
		type: 'range/replace', trackId: 'track-1', startFrame: 300, endFrame: 600,
		source: { ...source, id: '' }, clipId: 'replacement-clip', splitClipIds: { spanning: 'right' },
	}), /stable replacement source ID/);
	assert.throws(() => apply(project, {
		type: 'range/replace', trackId: 'track-1', startFrame: 300, endFrame: 600,
		source, splitClipIds: { spanning: 'right' },
	}), /stable replacement clip ID/);
	assert.throws(() => apply(project, {
		type: 'range/replace', trackId: 'track-1', startFrame: 300, endFrame: 600,
		source, clipId: 'replacement-clip', splitClipIds: {},
	}), /stable right segment for spanning ID/);
	assert.deepEqual(project, before);
});
