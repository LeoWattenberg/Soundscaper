/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyEditorCommand,
	createAddTrackCommand,
	createClipboardDescriptor,
	prepareKeepRangeCommand,
	prepareLinkedSplitCommand,
	prepareRangeDeleteCommand,
	resolveEditingSelection,
} from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createClipTransformService } from '../src/common/editor/controller/clip-transform-service.ts';
import { createEditorEditService } from '../src/common/editor/controller/edit-service.ts';
import { findClip, findClipTrack, findTrack } from '../src/common/editor/project.js';
import { normalizeAudioWarpMap } from '../src/common/editor/audio-warp-domain.ts';
import { projectForCommandConsumers } from '../src/common/editor/project-current-runtime.ts';
import {
	createCurrentAudioEditorProject,
	loadCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../src/common/editor/project-current.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';

const NOW = '2026-08-12T15:00:00.000Z';
const TEMPO_MAP = {
	mode: 'musical' as const,
	events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
};

/** Outer 0..100 over source 100..300: only every fifth frame is a whole source sample. */
const SAMPLE_WARP = {
	feature: 'audio-warp' as const,
	points: [
		{ outer: 0, source: 100, mode: 'forward' as const },
		{ outer: 50, source: 180, mode: 'forward' as const },
		{ outer: 100, source: 300, mode: 'forward' as const },
	],
};

test('a lift-delete through a warped clip gives both survivors their own exact map', () => {
	const project = sampleProject();
	const edited = applyEditorCommand(project, prepareRangeDeleteCommand(projectForCommandConsumers(project), {
		startFrame: 1_020, endFrame: 1_040, trackIds: ['track'],
	}, stableIds()) as AudioEditorCommand, { now: NOW });
	const [left, right] = orderedClips(edited);

	assert.deepEqual(bounds(left), { timelineStartFrame: 1_000, durationFrames: 20, sourceStartFrame: 100, sourceDurationFrames: 32 });
	assert.deepEqual(bounds(right), { timelineStartFrame: 1_040, durationFrames: 60, sourceStartFrame: 164, sourceDurationFrames: 136 });
	assert.deepEqual(left.warpMap, canonical({
		feature: 'audio-warp', points: [
			{ outer: 0, source: 100, mode: 'forward' },
			{ outer: 20, source: 132, mode: 'forward' },
		],
	}));
	assert.deepEqual(right.warpMap, canonical({
		feature: 'audio-warp', points: [
			{ outer: 0, source: 164, mode: 'forward' },
			{ outer: 10, source: 180, mode: 'forward' },
			{ outer: 60, source: 300, mode: 'forward' },
		],
	}));
	assert.deepEqual(reopened(edited), edited);
});

test('a ripple delete and a keep range narrow the map instead of carrying the whole one', () => {
	const project = sampleProject();
	const rippled = applyEditorCommand(project, prepareRangeDeleteCommand(projectForCommandConsumers(project), {
		startFrame: 1_020, endFrame: 1_040, trackIds: ['track'], rippleMode: 'track',
	}, stableIds()) as AudioEditorCommand, { now: NOW });
	const [rippledLeft, rippledRight] = orderedClips(rippled);
	assert.equal(rippledRight.timelineStartFrame, 1_020);
	assert.deepEqual([rippledLeft.sourceDurationFrames, rippledRight.sourceDurationFrames], [32, 136]);

	const kept = applyEditorCommand(project, prepareKeepRangeCommand(projectForCommandConsumers(project), {
		startFrame: 1_015, endFrame: 1_085, trackIds: ['track'],
	}) as AudioEditorCommand, { now: NOW });
	const [only] = orderedClips(kept);
	assert.deepEqual(bounds(only), { timelineStartFrame: 1_015, durationFrames: 70, sourceStartFrame: 124, sourceDurationFrames: 140 });
	assert.deepEqual(only.warpMap, canonical({
		feature: 'audio-warp', points: [
			{ outer: 0, source: 124, mode: 'forward' },
			{ outer: 35, source: 180, mode: 'forward' },
			{ outer: 70, source: 264, mode: 'forward' },
		],
	}));
});

test('a clipboard copy of part of a warped clip carries the narrowed map', () => {
	const project = sampleProject();
	const descriptor = createClipboardDescriptor(projectForCommandConsumers(project), {
		startFrame: 1_020, endFrame: 1_040, trackIds: ['track'],
	}) as { tracks: readonly { clips: readonly Record<string, unknown>[] }[] };
	const copied = descriptor.tracks[0]?.clips[0];

	assert.ok(copied);
	assert.deepEqual(
		[copied.sourceStartFrame, copied.sourceDurationFrames, copied.durationFrames],
		[132, 32, 20],
	);
	assert.deepEqual(copied.warpMap, canonical({
		feature: 'audio-warp', points: [
			{ outer: 0, source: 132, mode: 'forward' },
			{ outer: 20, source: 164, mode: 'forward' },
		],
	}));
});

test('a musical warped clip survives a range delete in beat outer units', () => {
	const project = musicalProject();
	const edited = applyEditorCommand(project, prepareRangeDeleteCommand(projectForCommandConsumers(project), {
		startFrame: 12_000, endFrame: 24_000, trackIds: ['track'],
	}, stableIds()) as AudioEditorCommand, { now: NOW });
	const [left, right] = orderedClips(edited);

	assert.deepEqual(left.musicalDurationBeats, { num: 1, den: 2 });
	assert.deepEqual(right.musicalStartBeat, { num: 1, den: 1 });
	assert.deepEqual([left.sourceStartFrame, left.sourceDurationFrames], [0, 20]);
	assert.deepEqual([right.sourceStartFrame, right.sourceDurationFrames], [40, 60]);
	assert.deepEqual(right.warpMap, canonical({
		feature: 'audio-warp', points: [
			{ outer: 0, source: 40, mode: 'forward' },
			{ outer: 1, source: 100, mode: 'forward' },
		],
	}));
});

test('an interactive trim leaves the source range to the map instead of rounding one', () => {
	const fixture = transformFixture(sampleProject());
	fixture.service.trimClips('clip', { durationFrames: 50 });

	assert.deepEqual(fixture.commands, [{
		type: 'clip/trim', clipId: 'clip', durationFrames: 50, fadeInFrames: 0, fadeOutFrames: 0,
	}]);
	const [trimmed] = orderedClips(fixture.present());
	assert.deepEqual(bounds(trimmed), { timelineStartFrame: 1_000, durationFrames: 50, sourceStartFrame: 100, sourceDurationFrames: 80 });
});

test('an interactive trim edge lands on the nearest frame the map can cut', () => {
	const trailing = transformFixture(sampleProject());
	trailing.service.trimClips('clip', { durationFrames: 47 });
	const [trailingClip] = orderedClips(trailing.present());
	assert.deepEqual(bounds(trailingClip), { timelineStartFrame: 1_000, durationFrames: 45, sourceStartFrame: 100, sourceDurationFrames: 72 });

	const leading = transformFixture(sampleProject());
	leading.service.trimClips('clip', { timelineStartFrame: 1_023 });
	const [leadingClip] = orderedClips(leading.present());
	assert.deepEqual(bounds(leadingClip), { timelineStartFrame: 1_025, durationFrames: 75, sourceStartFrame: 140, sourceDurationFrames: 160 });
	assert.deepEqual(leadingClip.warpMap, canonical({
		feature: 'audio-warp', points: [
			{ outer: 0, source: 140, mode: 'forward' },
			{ outer: 25, source: 180, mode: 'forward' },
			{ outer: 75, source: 300, mode: 'forward' },
		],
	}));
});

test('an unwarped clip keeps the proportional source range the trim producer computes', () => {
	const fixture = transformFixture(sampleProject(null));
	fixture.service.trimClips('clip', { durationFrames: 47 });

	assert.deepEqual(fixture.commands, [{
		type: 'clip/trim', clipId: 'clip', sourceStartFrame: 100, sourceDurationFrames: 94,
		durationFrames: 47, trimStartFrames: 0, trimEndFrames: 106, fadeInFrames: 0, fadeOutFrames: 0,
	}]);
});

test('an interactive split resolves the nearest frame the warp authority can cut', () => {
	const project = sampleProject();
	const command = prepareLinkedSplitCommand(projectForCommandConsumers(project), 'clip', 1_023, stableIds());
	assert.equal((command as { atFrame: number }).atFrame, 1_025);

	const edited = applyEditorCommand(project, command as AudioEditorCommand, { now: NOW });
	const [left, right] = orderedClips(edited);
	assert.deepEqual([left.sourceStartFrame, left.sourceDurationFrames], [100, 40]);
	assert.deepEqual([right.sourceStartFrame, right.sourceDurationFrames], [140, 160]);
	assert.deepEqual(reopened(edited), edited);
});

test('splitting a warped clip onto a new track snaps like the ordinary split', () => {
	const fixture = editFixture(sampleProject(), 1_023);
	fixture.handleEdit('split-new-track');

	assert.deepEqual(fixture.errors, []);
	const command = fixture.commands[0];
	assert.equal(command?.type, 'batch');
	const addTrack = command?.type === 'batch' ? command.commands[0] : null;
	assert.equal(addTrack?.type, 'track/add');
	if (addTrack?.type === 'track/add') assert.equal(Object.hasOwn(addTrack.track, 'schemaVersion'), false);
	const [left, right] = orderedClips(fixture.present());
	assert.deepEqual(bounds(left), { timelineStartFrame: 1_000, durationFrames: 25, sourceStartFrame: 100, sourceDurationFrames: 40 });
	assert.deepEqual(bounds(right), { timelineStartFrame: 1_025, durationFrames: 75, sourceStartFrame: 140, sourceDurationFrames: 160 });
	assert.deepEqual(
		fixture.present().tracks.map((track) => track.clipIds),
		[[left.id], [right.id]],
	);
	assert.deepEqual(reopened(fixture.present()), fixture.present());
});

test('an overwrite trim narrows the map of the active warped clip, not only of the clips it cuts', () => {
	const fixture = transformFixture(sampleProject());
	fixture.service.trimClips('clip', { durationFrames: 47 }, { overwrite: true });

	assert.equal((fixture.commands[0] as { type: string }).type, 'clip/overwrite');
	const [trimmed] = orderedClips(fixture.present());
	assert.deepEqual(bounds(trimmed), { timelineStartFrame: 1_000, durationFrames: 45, sourceStartFrame: 100, sourceDurationFrames: 72 });
	assert.deepEqual(trimmed.warpMap, canonical({
		feature: 'audio-warp', points: [
			{ outer: 0, source: 100, mode: 'forward' },
			{ outer: 45, source: 172, mode: 'forward' },
		],
	}));
	assert.deepEqual(reopened(fixture.present()), fixture.present());
});

test('a grouped trim narrows the warped member through the transform runtime', () => {
	const fixture = transformFixture(groupedProject());
	fixture.service.trimClips('clip', { timelineStartFrame: 1_023 });

	assert.equal((fixture.commands[0] as { type: string }).type, 'clip/transform-many');
	const edited = fixture.present();
	const warped = edited.clips.find((clip) => clip.id === 'clip')!;
	const plain = edited.clips.find((clip) => clip.id === 'plain')!;
	assert.deepEqual(bounds(warped), { timelineStartFrame: 1_025, durationFrames: 75, sourceStartFrame: 140, sourceDurationFrames: 160 });
	assert.deepEqual(bounds(plain), { timelineStartFrame: 1_025, durationFrames: 75, sourceStartFrame: 425, sourceDurationFrames: 75 });
	assert.deepEqual(warped.warpMap, canonical({
		feature: 'audio-warp', points: [
			{ outer: 0, source: 140, mode: 'forward' },
			{ outer: 25, source: 180, mode: 'forward' },
			{ outer: 75, source: 300, mode: 'forward' },
		],
	}));
	assert.deepEqual(reopened(edited), edited);
});

test('a transform that names its own source range for a warped clip is refused', () => {
	const project = groupedProject();
	assert.throws(() => applyEditorCommand(project, {
		type: 'clip/transform-many',
		transforms: [{
			clipId: 'clip', trackId: 'track',
			changes: { durationFrames: 50, sourceStartFrame: 100, sourceDurationFrames: 100 },
		}],
		overwrite: false, splitClipIds: {},
	}, { now: NOW }), /Audio warp trim source duration must match the exact map boundaries/u);
	assert.throws(() => applyEditorCommand(project, {
		type: 'clip/transform-many',
		transforms: [{ clipId: 'clip', trackId: 'track', changes: { durationFrames: 47 } }],
		overwrite: false, splitClipIds: {},
	}, { now: NOW }), /the nearest editable frame is 1045/u);
});

test('a boundary no frame can serve is refused with the editable frame named', () => {
	const project = sampleProject({
		feature: 'audio-warp', points: [
			{ outer: 0, source: 100, mode: 'forward' },
			{ outer: 49, source: 199, mode: 'forward' },
			{ outer: 100, source: 300, mode: 'forward' },
		],
	});
	assert.equal((prepareLinkedSplitCommand(projectForCommandConsumers(project), 'clip', 1_049, stableIds()) as { atFrame: number }).atFrame, 1_049);
	assert.throws(() => applyEditorCommand(project, {
		type: 'clip/split', clipId: 'clip', atFrame: 1_050, rightClipId: 'right',
	}, { now: NOW }), /whole source-sample boundary: timeline frame 1050 .*the nearest editable frame is 1049/u);
	assert.throws(() => applyEditorCommand(project, prepareRangeDeleteCommand(projectForCommandConsumers(project), {
		startFrame: 1_050, endFrame: 1_060, trackIds: ['track'],
	}, stableIds()) as AudioEditorCommand, { now: NOW }), /the nearest editable frame is 1049/u);
});

test('a clip whose map reaches no nearby boundary keeps the request and says so plainly', () => {
	const project = stretchedProject();
	const command = prepareLinkedSplitCommand(projectForCommandConsumers(project), 'clip', 2_500, stableIds());
	assert.equal((command as { atFrame: number }).atFrame, 2_500);
	assert.equal(
		(prepareLinkedSplitCommand(projectForCommandConsumers(project), 'clip', 10, stableIds()) as { atFrame: number }).atFrame,
		10,
		'a boundary resolved onto the clip edge is not a split',
	);
	assert.throws(
		() => applyEditorCommand(project, command as AudioEditorCommand, { now: NOW }),
		/whole source-sample boundary: timeline frame 2500 resolves inside a source sample\.$/u,
	);
	const fixture = transformFixture(stretchedProject());
	assert.throws(
		() => fixture.service.trimClips('clip', { durationFrames: 2_500 }),
		/whole source-sample boundary/u,
	);
});

test('a long warp span refuses an unusable boundary by naming it, not the rational domain', () => {
	// Interpolating inside a span puts the span itself in the denominator, so a
	// thirty-second warp at a ratio that does not reduce evaluates to a source
	// position outside the stored rational domain. Building the trimmed map before
	// admitting the boundary reported that as a bare rational-domain error, which
	// says nothing about where the user may actually cut.
	const project = longSpanProject();
	assert.throws(() => applyEditorCommand(project, {
		type: 'clip/split', clipId: 'clip', atFrame: 700_001, rightClipId: 'right',
	}, { now: NOW }), /whole source-sample boundary: timeline frame 700001 resolves inside a source sample\.$/u);
	assert.throws(() => applyEditorCommand(project, prepareRangeDeleteCommand(projectForCommandConsumers(project), {
		startFrame: 700_001, endFrame: 800_003, trackIds: ['track'],
	}, stableIds()) as AudioEditorCommand, { now: NOW }), /whole source-sample boundary/u);
	// The boundaries the span does serve still cut, so the admission did not simply
	// become stricter.
	const edited = applyEditorCommand(project, {
		type: 'clip/split', clipId: 'clip', atFrame: 1_200_000, rightClipId: 'right',
	}, { now: NOW });
	const [left, right] = orderedClips(edited);
	assert.deepEqual([left.sourceStartFrame, left.sourceDurationFrames], [0, 1_200_001]);
	assert.deepEqual([right.sourceStartFrame, right.sourceDurationFrames], [1_200_001, 1_200_001]);
});

function orderedClips(project: object): Readonly<Record<string, unknown>>[] {
	return [...(project as AudioEditorProjectCurrent).clips]
		.sort((left, right) => Number(left.timelineStartFrame) - Number(right.timelineStartFrame));
}

function bounds(clip: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
	return {
		timelineStartFrame: clip.timelineStartFrame,
		durationFrames: clip.durationFrames,
		sourceStartFrame: clip.sourceStartFrame,
		sourceDurationFrames: clip.sourceDurationFrames,
	};
}

function canonical(value: unknown): ReturnType<typeof normalizeAudioWarpMap> {
	return normalizeAudioWarpMap(value);
}

function reopened(project: object): unknown {
	return loadCurrentAudioEditorProject(JSON.parse(JSON.stringify(project)) as unknown).project;
}

function stableIds(): (prefix?: string) => string {
	let index = 0;
	return (prefix = 'id') => `${prefix}-${String(index += 1)}`;
}

function transformFixture(initial: AudioEditorProjectCurrent): {
	readonly service: ReturnType<typeof createClipTransformService>;
	readonly commands: AudioEditorCommand[];
	present(): AudioEditorProjectCurrent;
} {
	let present = initial;
	const commands: AudioEditorCommand[] = [];
	const service = createClipTransformService({
		lifetime: { assertActive: () => undefined },
		copy: { audioClipNotFound: 'missing clip', track: 'Track', timelineFramesFinite: 'finite frames' },
		getProject: () => projectForCommandConsumers(present) as never,
		getSelectedClipId: () => 'clip',
		editingBlocked: () => false,
		createId: stableIds(),
		snapTimelineFrame: (frame) => Math.round(Number(frame)),
		activeSelection: () => null,
		commit(command) {
			commands.push(command);
			present = applyEditorCommand(present, command, { now: NOW });
			return present;
		},
	});
	return { service, commands, present: () => present };
}

function editFixture(initial: AudioEditorProjectCurrent, positionFrames: number): {
	handleEdit(action: string): unknown;
	readonly errors: unknown[];
	readonly commands: AudioEditorCommand[];
	present(): AudioEditorProjectCurrent;
} {
	let present = initial;
	const errors: unknown[] = [];
	const commands: AudioEditorCommand[] = [];
	const handleEdit = createEditorEditService({
		activeSelection: () => null,
		commit(command: AudioEditorCommand) {
			commands.push(command);
			present = applyEditorCommand(present, command, { now: NOW });
			return present;
		},
		copy: { timeSelectionRequired: 'range required', track: 'Track' },
		createAddTrackCommand,
		createStableId: stableIds(),
		editingBlocked: () => false,
		engine: { getPositionFrames: () => positionFrames },
		findClip, findClipTrack, findTrack,
		getProject: () => projectForCommandConsumers(present),
		handleError: (error: unknown) => errors.push(error),
		prepareLinkedSplitCommand,
		projectChanged: () => undefined,
		publishDocumentSnapshot: () => undefined,
		resolveEditingSelection,
		state: { history: {}, selectedClipId: 'clip', selectedTrackId: 'track' },
	});
	return { handleEdit, errors, commands, present: () => present };
}

function sampleProject(warpMap: unknown = SAMPLE_WARP): AudioEditorProjectCurrent {
	const source = createAudioSource({
		id: 'source', storageKey: 'source', name: 'Source',
		frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'clip', sourceId: source.id, title: 'Clip', anchor: 'sample',
		timelineStartFrame: 1_000, durationFrames: 100,
		sourceStartFrame: 100, sourceDurationFrames: 200,
		warpMap,
	});
	return createCurrentAudioEditorProject({
		id: 'warp-project', now: NOW, tempoMap: TEMPO_MAP,
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', name: 'Track', clipIds: ['clip'] })],
	});
}

/** A warped clip grouped with a plain clip on another track, so a trim routes through transform-many. */
function groupedProject(): AudioEditorProjectCurrent {
	const source = createAudioSource({
		id: 'source', storageKey: 'source', name: 'Source',
		frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
	});
	const warped = createAudioClip({
		id: 'clip', sourceId: source.id, anchor: 'sample', groupId: 'group',
		timelineStartFrame: 1_000, durationFrames: 100,
		sourceStartFrame: 100, sourceDurationFrames: 200,
		warpMap: SAMPLE_WARP,
	});
	const plain = createAudioClip({
		id: 'plain', sourceId: source.id, anchor: 'sample', groupId: 'group',
		timelineStartFrame: 1_000, durationFrames: 100,
		sourceStartFrame: 400, sourceDurationFrames: 100,
	});
	return createCurrentAudioEditorProject({
		id: 'grouped-warp-project', now: NOW, tempoMap: TEMPO_MAP,
		sources: [source], clips: [warped, plain],
		tracks: [
			createAudioTrack({ id: 'track', name: 'Track', clipIds: ['clip'] }),
			createAudioTrack({ id: 'track-2', name: 'Track 2', clipIds: ['plain'] }),
		],
	});
}

/** Three source samples stretched over 5000 frames: only the clip edges are whole samples. */
function stretchedProject(): AudioEditorProjectCurrent {
	const source = createAudioSource({
		id: 'source', storageKey: 'source', frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'clip', sourceId: source.id, anchor: 'sample',
		timelineStartFrame: 0, durationFrames: 5_000,
		sourceStartFrame: 0, sourceDurationFrames: 3,
		warpMap: {
			feature: 'audio-warp', points: [
				{ outer: 0, source: 0, mode: 'forward' },
				{ outer: 5_000, source: 3, mode: 'forward' },
			],
		},
	});
	return createCurrentAudioEditorProject({
		id: 'stretched-warp-project', now: NOW, tempoMap: TEMPO_MAP,
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
	});
}

/**
 * Fifty seconds of warp in one span, at a ratio that reduces to a denominator
 * larger than the stored rational domain. Its midpoint is a whole source sample
 * and nothing within a thousand frames of the other cuts is.
 */
function longSpanProject(): AudioEditorProjectCurrent {
	const source = createAudioSource({
		id: 'source', storageKey: 'source', frameCount: 3_000_000, channelCount: 1, sampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'clip', sourceId: source.id, anchor: 'sample',
		timelineStartFrame: 0, durationFrames: 2_400_000,
		sourceStartFrame: 0, sourceDurationFrames: 2_400_002,
		warpMap: {
			feature: 'audio-warp', points: [
				{ outer: 0, source: 0, mode: 'forward' },
				{ outer: 2_400_000, source: 2_400_002, mode: 'forward' },
			],
		},
	});
	return createCurrentAudioEditorProject({
		id: 'long-span-warp-project', now: NOW, tempoMap: TEMPO_MAP,
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
	});
}

function musicalProject(): AudioEditorProjectCurrent {
	const source = createAudioSource({
		id: 'source', storageKey: 'source', frameCount: 100, channelCount: 1, sampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'clip', sourceId: source.id, anchor: 'musical',
		musicalStartBeat: 0, musicalExtent: 'beat', musicalDurationBeats: 2,
		sourceStartFrame: 0, sourceDurationFrames: 100,
		warpMap: {
			feature: 'audio-warp', points: [
				{ outer: 0, source: 0, mode: 'forward' },
				{ outer: 1, source: 40, mode: 'forward' },
				{ outer: 2, source: 100, mode: 'forward' },
			],
		},
	}, { projectSampleRate: 48_000, tempoMap: TEMPO_MAP });
	return createCurrentAudioEditorProject({
		id: 'musical-warp-project', now: NOW, tempoMap: TEMPO_MAP,
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
	});
}
