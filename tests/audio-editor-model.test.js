import test from 'node:test';
import assert from 'node:assert/strict';

import {
	AUDIO_EDITOR_HISTORY_LIMIT,
	AUDIO_EDITOR_SAMPLE_RATE,
	aggregateStereoMinutes,
	analyzeAudioChannels,
	applyEditorCommand,
	canRedo,
	canUndo,
	chooseRenderStrategy,
	collectClipTransformIds,
	collectHistorySourceIds,
	compactEditorHistorySourceMetadata,
	createClipboardDescriptor,
	createEditorHistory,
	createEffect,
	createExportPlan,
	createStreamingAudioAnalyzer,
	executeEditorCommand,
	evictUnreferencedSourceCaches,
	findClip,
	preparePasteCommand,
	preparePunchCommand,
	prepareOverwriteClipCommand,
	prepareRangeDeleteCommand,
	prepareRangeReplacementCommand,
	prepareSplitCommand,
	prepareTransformClipsCommand,
	projectDurationFrames,
	projectEnvelope,
	redoEditorCommand,
	sanitizeExportName,
	undoEditorCommand,
	validateAudioEditorProject,
} from '../src/lib/tools/audio-editor/index.js';
import { createAudioEditorProjectV2 } from '../src/lib/tools/audio-editor/project-v2.js';

const NOW = '2026-07-12T10:00:00.000Z';

function apply(project, command) {
	return applyEditorCommand(project, command, { now: NOW });
}

function coreClip(clip) {
	if (!clip) return clip;
	return {
		id: clip.id,
		sourceId: clip.sourceId,
		timelineStartFrame: clip.timelineStartFrame,
		sourceStartFrame: clip.sourceStartFrame,
		durationFrames: clip.durationFrames,
		gain: clip.gain,
		fadeInFrames: clip.fadeInFrames,
		fadeOutFrames: clip.fadeOutFrames,
		reversed: clip.reversed,
	};
}

function createFixture(options = {}) {
	let project = createAudioEditorProjectV2({ id: 'project-1', title: 'Studio Test', now: NOW });
	project = apply(project, {
		type: 'source/add',
		source: {
			id: 'source-1', name: 'source.wav', storageKey: 'pcm/source-1', mimeType: 'audio/wav',
			frameCount: options.frameCount ?? 4_800, channelCount: options.channelCount ?? 2,
		},
	});
	project = apply(project, { type: 'track/add', track: { id: 'track-1', name: 'Voice' } });
	project = apply(project, { type: 'track/add', track: { id: 'track-2', name: 'Music' } });
	return project;
}

test('audio editor projects use a normalized, frame-accurate v2 document', () => {
	const project = createFixture();
	assert.equal(project.schemaVersion, 2);
	assert.equal(project.sampleRate, 48_000);
	assert.equal(project.masterChannels, 2);
	assert.deepEqual(project.tracks.map((track) => track.clipIds), [[], []]);
	assert.equal(project.revision, 3);
	assert.equal(validateAudioEditorProject(project), true);
	assert.throws(() => apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'bad', sourceId: 'source-1', timelineStartFrame: 0.5, sourceStartFrame: 0, durationFrames: 100,
	} }), /safe integer greater than or equal to 0/);
});

test('V2 clip commands preserve layered overlaps and source bounds while moving and trimming', () => {
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
	const overwrite = prepareOverwriteClipCommand(project, 'active', {
		trackId: 'track-1',
		changes: { timelineStartFrame: 300 },
	}, () => 'backing-right');
	assert.deepEqual(overwrite.splitClipIds, { backing: 'backing-right' });
	project = apply(project, overwrite);
	assert.deepEqual(project.tracks[0].clipIds, ['backing', 'active', 'backing-right']);
	assert.deepEqual(coreClip(findClip(project, 'backing')), {
		id: 'backing', sourceId: 'source-1', timelineStartFrame: 100, sourceStartFrame: 0, durationFrames: 200,
		gain: 1, fadeInFrames: 0, fadeOutFrames: 0, reversed: false,
	});
	assert.deepEqual(coreClip(findClip(project, 'backing-right')), {
		id: 'backing-right', sourceId: 'source-1', timelineStartFrame: 500, sourceStartFrame: 400, durationFrames: 400,
		gain: 1, fadeInFrames: 0, fadeOutFrames: 0, reversed: false,
	});

	project = apply(project, { type: 'clip/overwrite', clipId: 'active', trackId: 'track-1', changes: {
		timelineStartFrame: 0,
		durationFrames: 1_000,
	} });
	assert.deepEqual(project.tracks[0].clipIds, ['active']);
	assert.equal(findClip(project, 'backing'), null);
	assert.equal(findClip(project, 'backing-right'), null);
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

test('effect racks validate their core studio parameters and audio tracks can be armed independently', () => {
	let project = createFixture();
	const compressor = createEffect('compressor', { id: 'compressor-1' });
	assert.equal(compressor.params.threshold, -24);
	assert.equal(createEffect('eq', { id: 'eq-1' }).params.bands.length, 4);
	assert.throws(() => createEffect('delay', { id: 'bad', params: { feedback: 1 } }), /between 0 and 0.95/);

	project = apply(project, { type: 'effect/add', scope: 'track', trackId: 'track-1', effect: compressor });
	project = apply(project, { type: 'effect/add', scope: 'track', trackId: 'track-1', effect: createEffect('delay', { id: 'delay-1' }) });
	project = apply(project, { type: 'effect/reorder', scope: 'track', trackId: 'track-1', effectId: 'delay-1', toIndex: 0 });
	project = apply(project, { type: 'effect/update', scope: 'track', trackId: 'track-1', effectId: 'delay-1', changes: { enabled: false } });
	assert.deepEqual(project.tracks[0].effects.map((effect) => [effect.id, effect.enabled]), [['delay-1', false], ['compressor-1', true]]);

	project = apply(project, { type: 'track/update', trackId: 'track-1', changes: { armed: true } });
	project = apply(project, { type: 'track/update', trackId: 'track-2', changes: { armed: true } });
	project = apply(project, { type: 'track/add', track: { id: 'track-3', name: 'Room', armed: true } });
	assert.deepEqual(project.tracks.map((track) => track.armed), [true, true, true]);
	assert.equal(validateAudioEditorProject(project), true);
});

test('mixer group and send buses persist validated routing and clean up removed buses', () => {
	let project = createFixture();
	project = apply(project, {
		type: 'mixer/bus-add', busType: 'group', bus: { id: 'group-vocals', name: 'Vocals', gain: 0.8 },
	});
	project = apply(project, {
		type: 'mixer/bus-add', busType: 'send', bus: { id: 'send-reverb', name: 'Reverb' },
	});
	project = apply(project, {
		type: 'mixer/route-update', trackId: 'track-1', changes: {
			groupId: 'group-vocals', sends: { 'send-reverb': 0.25 },
		},
	});
	project = apply(project, {
		type: 'effect/add', scope: 'send', busId: 'send-reverb', effect: createEffect('reverb', { id: 'send-reverb-effect' }),
	});
	assert.deepEqual(project.mixer.routes['track-1'], {
		groupId: 'group-vocals', sends: { 'send-reverb': 0.25 },
	});
	assert.equal(project.mixer.groups[0].gain, 0.8);
	assert.equal(project.mixer.sends[0].effects[0].type, 'reverb');
	assert.equal(validateAudioEditorProject(project), true);
	assert.throws(() => apply(project, {
		type: 'mixer/route-update', trackId: 'track-2', changes: { groupId: 'missing' },
	}), /Unknown group bus/);

	project = apply(project, { type: 'mixer/bus-remove', busType: 'group', busId: 'group-vocals' });
	project = apply(project, { type: 'mixer/bus-remove', busType: 'send', busId: 'send-reverb' });
	assert.deepEqual(project.mixer.routes['track-1'], { groupId: null, sends: {} });
	assert.equal(validateAudioEditorProject(project), true);
});

test('session history caps snapshots, clears redo on edits, and keeps revisions monotonic', () => {
	let history = createEditorHistory(createFixture());
	for (let index = 0; index < AUDIO_EDITOR_HISTORY_LIMIT + 5; index += 1) {
		history = executeEditorCommand(history, { type: 'project/rename', title: `Project ${index}` }, { now: NOW });
	}
	assert.equal(history.undoStack.length, 200);
	assert.equal(canUndo(history), true);
	const revision = history.present.revision;
	history = undoEditorCommand(history, { now: NOW });
	assert.equal(history.present.title, 'Project 203');
	assert.equal(history.present.revision, revision + 1);
	assert.equal(canRedo(history), true);
	history = redoEditorCommand(history, { now: NOW });
	assert.equal(history.present.title, 'Project 204');
	assert.equal(history.present.revision, revision + 2);
	history = executeEditorCommand(history, { type: 'project/rename', title: 'New branch' }, { now: NOW });
	assert.equal(canRedo(history), false);
});

test('source retention follows present, undo, and redo clip roots and evicts only unreachable caches', () => {
	let project = createFixture({ frameCount: 1_000 });
	project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'original-clip', sourceId: 'source-1', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 1_000,
	} });
	let history = createEditorHistory(project);
	const replacement = prepareRangeReplacementCommand(project, {
		trackId: 'track-1', startFrame: 0, endFrame: 1_000,
		source: {
			id: 'processed-source', storageKey: 'processed-source', name: 'processed.wav', mimeType: 'audio/wav',
			frameCount: 1_000, channelCount: 2,
		},
		clipId: 'processed-clip',
	});
	history = compactEditorHistorySourceMetadata(executeEditorCommand(history, replacement, { now: NOW }));
	assert.deepEqual(history.present.sources.map((source) => source.id), ['processed-source']);
	assert.deepEqual(history.undoStack[0].project.sources.map((source) => source.id), ['source-1']);
	assert.deepEqual([...collectHistorySourceIds(history)].sort(), ['processed-source', 'source-1']);

	const buffers = new Map([['source-1', {}], ['processed-source', {}], ['stale-source', {}]]);
	const peaks = new Map([['source-1', {}], ['processed-source', {}], ['stale-source', {}]]);
	assert.deepEqual(evictUnreferencedSourceCaches(buffers, peaks, collectHistorySourceIds(history)), ['stale-source']);
	assert.deepEqual([...buffers.keys()].sort(), ['processed-source', 'source-1']);

	history = compactEditorHistorySourceMetadata(undoEditorCommand(history, { now: NOW }));
	assert.deepEqual(history.present.sources.map((source) => source.id), ['source-1']);
	assert.deepEqual(history.redoStack[0].project.sources.map((source) => source.id), ['processed-source']);
	history = compactEditorHistorySourceMetadata(redoEditorCommand(history, { now: NOW }));
	assert.equal(findClip(history.present, 'processed-clip').sourceId, 'processed-source');
	assert.equal(validateAudioEditorProject(history.present), true);

	history = compactEditorHistorySourceMetadata(undoEditorCommand(history, { now: NOW }));
	history = compactEditorHistorySourceMetadata(executeEditorCommand(history, { type: 'project/rename', title: 'Branched' }, { now: NOW }));
	assert.deepEqual([...collectHistorySourceIds(history)], ['source-1']);
	assert.equal(history.redoStack.length, 0);
	assert.deepEqual(evictUnreferencedSourceCaches(buffers, peaks, collectHistorySourceIds(history)), ['processed-source']);
});

test('duration, aggregate stereo minutes, and supported envelopes do not count clip reuse twice', () => {
	const sourceFrames = AUDIO_EDITOR_SAMPLE_RATE * 60 * 31;
	let project = createFixture({ frameCount: sourceFrames });
	project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'long', sourceId: 'source-1', timelineStartFrame: 100, sourceStartFrame: 0, durationFrames: 1_000,
	} });
	project = apply(project, { type: 'clip/add', trackId: 'track-2', clip: {
		id: 'reuse', sourceId: 'source-1', timelineStartFrame: 3_000, sourceStartFrame: 2_000, durationFrames: 1_000,
	} });
	assert.equal(projectDurationFrames(project), 4_000);
	assert.equal(aggregateStereoMinutes(project), 31);
	assert.deepEqual(projectEnvelope(project).exceeded, { tracks: false, stereoMinutes: true });
	assert.equal(projectEnvelope(project, { mobile: true }).limits.trackCount, 4);
});

test('capacity envelopes accept the documented desktop and mobile boundaries and reject one step beyond them', () => {
	const atLimit = ({ stereoMinutes, trackCount, mobile }) => {
		const frameCount = AUDIO_EDITOR_SAMPLE_RATE * 60 * stereoMinutes;
		let project = createFixture({ frameCount });
		project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
			id: `capacity-${stereoMinutes}`, sourceId: 'source-1', timelineStartFrame: 0,
			sourceStartFrame: 0, durationFrames: frameCount,
		} });
		for (let index = 3; index <= trackCount; index += 1) {
			project = apply(project, { type: 'track/add', track: { id: `track-${index}`, name: `Track ${index}` } });
		}
		const envelope = projectEnvelope(project, { mobile });
		assert.equal(envelope.actual.trackCount, trackCount);
		assert.equal(envelope.actual.stereoMinutes, stereoMinutes);
		assert.equal(envelope.supported, true);
		project = apply(project, { type: 'track/add', track: { id: 'over-limit', name: 'Over limit' } });
		assert.equal(projectEnvelope(project, { mobile }).exceeded.tracks, true);
	};

	atLimit({ stereoMinutes: 30, trackCount: 8, mobile: false });
	atLimit({ stereoMinutes: 10, trackCount: 4, mobile: true });
});

test('export plans define mix/stem policy, encoding defaults, tails, names, and memory strategy', () => {
	let project = createFixture({ frameCount: 96_000 });
	project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'clip-1', sourceId: 'source-1', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 48_000,
	} });
	project = apply(project, { type: 'effect/add', scope: 'track', trackId: 'track-1', effect: createEffect('reverb', {
		id: 'reverb-1', params: { decay: 2, preDelay: 0.25 },
	}) });
	project = apply(project, { type: 'effect/add', scope: 'master', effect: createEffect('delay', {
		id: 'delay-1', params: { time: 0.5, feedback: 0.5 },
	}) });
	const mix = createExportPlan(project, { format: 'wav', date: NOW });
	assert.equal(mix.encoding.bitDepth, 24);
	assert.equal(mix.dither, true);
	assert.equal(mix.outputs[0].respectMuteSolo, true);
	assert.equal(mix.outputs[0].includeMaster, true);
	assert.equal(mix.outputs[0].fileName, 'Studio-Test-mix-2026-07-12.wav');
	assert.ok(mix.tailFrames > 2 * AUDIO_EDITOR_SAMPLE_RATE);
	assert.equal(mix.render.strategy, 'offline');

	const stems = createExportPlan(project, { mode: 'stems', format: 'opus', bitRate: 160, date: NOW });
	assert.equal(stems.outputs.length, 2);
	assert.deepEqual(stems.outputs.map((output) => output.fileName), ['01-Voice.opus', '02-Music.opus']);
	assert.equal(stems.outputs.every((output) => !output.includeMaster && !output.respectMuteSolo), true);
	assert.equal(stems.archiveName, 'Studio-Test-stems-2026-07-12.zip');
	assert.equal(sanitizeExportName('  A/B: “Mix”  '), 'A-B-Mix');
	assert.deepEqual(chooseRenderStrategy({ mobile: true, outputBytes: 97 * 1024 ** 2, livePcmBytes: 0 }).strategy, 'realtime-stream');
	assert.throws(() => createExportPlan(project, { format: 'mp3', bitRate: 129 }), /bitrate/);
});

test('export tails include the longest active routed group or send rack', () => {
	let project = createFixture({ frameCount: 96_000 });
	project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'tail-clip', sourceId: 'source-1', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 48_000,
	} });
	project = apply(project, {
		type: 'mixer/bus-add', busType: 'group', bus: { id: 'tail-group', name: 'Tail group' },
	});
	project = apply(project, {
		type: 'mixer/bus-add', busType: 'send', bus: { id: 'tail-send', name: 'Tail send' },
	});
	project = apply(project, {
		type: 'effect/add', scope: 'group', busId: 'tail-group',
		effect: createEffect('delay', {
			id: 'group-delay', params: { time: 0.5, feedback: 0, mix: 1 },
		}),
	});
	project = apply(project, {
		type: 'effect/add', scope: 'send', busId: 'tail-send',
		effect: createEffect('reverb', {
			id: 'send-reverb', params: { decay: 0.75, preDelay: 0.25, mix: 1 },
		}),
	});
	project = apply(project, {
		type: 'mixer/route-update', trackId: 'track-1',
		changes: { groupId: 'tail-group', sends: { 'tail-send': 0.5 } },
	});

	assert.equal(createExportPlan(project).tailFrames, 48_000);
	assert.equal(createExportPlan(project, { mode: 'stems' }).tailFrames, 48_000);

	project = apply(project, {
		type: 'mixer/bus-update', busType: 'send', busId: 'tail-send',
		changes: { effectsActive: false },
	});
	assert.equal(createExportPlan(project).tailFrames, 24_000);
});

test('streaming analysis is chunk-invariant and reports channel-aware production levels', () => {
	const sampleRate = 8_000;
	const frames = sampleRate * 4;
	const left = Float32Array.from({ length: frames }, (_, index) => 0.5 * Math.sin(2 * Math.PI * 440 * index / sampleRate));
	const right = left.slice();
	const oneShot = analyzeAudioChannels([left, right], sampleRate);
	const streaming = createStreamingAudioAnalyzer({ sampleRate, channelCount: 2 });
	for (let start = 0; start < frames; start += 777) {
		const end = Math.min(frames, start + 777);
		streaming.push([left.subarray(start, end), right.subarray(start, end)]);
	}
	const chunked = streaming.finish();
	assert.ok(Math.abs(oneShot.peakDbfs + 6.0206) < 0.01);
	assert.ok(Math.abs(oneShot.rmsDbfs + 9.0309) < 0.01);
	assert.ok(oneShot.truePeakDbtp >= oneShot.peakDbfs);
	assert.equal(oneShot.stereoCorrelation, 1);
	assert.equal(oneShot.clippedSamples, 0);
	assert.ok(Number.isFinite(oneShot.momentaryLufs));
	assert.ok(Number.isFinite(oneShot.shortTermLufs));
	assert.ok(Number.isFinite(oneShot.integratedLufs));
	assert.ok(Math.abs(chunked.integratedLufs - oneShot.integratedLufs) < 1e-9);
	assert.ok(Math.abs(chunked.truePeakDbtp - oneShot.truePeakDbtp) < 1e-9);
	assert.deepEqual(streaming.finish(), chunked);
	assert.throws(() => streaming.push([left, right]), /finished/);
});

test('streaming analysis handles silence, anti-phase stereo, clipping, and short programs explicitly', () => {
	const sampleRate = 8_000;
	const silence = new Float32Array(sampleRate * 3);
	const silent = analyzeAudioChannels([silence, silence], sampleRate);
	assert.equal(silent.integratedLufs, null);
	assert.equal(silent.momentaryLufs, null);
	assert.equal(silent.shortTermLufs, null);
	assert.equal(silent.loudnessRangeLufs, null);
	assert.equal(silent.peakDbfs, -120);

	const left = Float32Array.from({ length: sampleRate }, (_, index) => Math.sin(2 * Math.PI * 200 * index / sampleRate));
	const right = Float32Array.from(left, (sample) => -sample);
	left[5] = 1.2;
	right[5] = -1.2;
	const antiPhase = analyzeAudioChannels([left, right], sampleRate);
	assert.ok(Math.abs(antiPhase.stereoCorrelation + 1) < 1e-12);
	assert.equal(antiPhase.clippedSamples >= 2, true);
	assert.equal(antiPhase.clippedFrames >= 1, true);
	assert.equal(antiPhase.shortTermLufs, null);
});
