/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { normalizeAudioWarpMap } from '../src/common/editor/audio-warp-domain.ts';
import {
	createAudioWarpClipAuthority,
} from '../src/common/editor/audio-warp-clip-authority.ts';
import {
	createAudioWarpAuthoringService,
} from '../src/common/editor/controller/audio-warp-authoring-service.ts';
import {
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import {
	cloneCurrentAudioEditorProject,
	createCurrentAudioEditorProject,
	loadCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../src/common/editor/project-current.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { applySoundscaperProjectCommandV21 } from '../src/soundscaper/editor-project-v21-commands.ts';
import {
	createSoundscaperProjectV21,
	type SoundscaperProjectV21,
} from '../src/soundscaper/editor-project-v21.ts';

const NOW = '2026-08-12T15:00:00.000Z';
const TEMPO_MAP = {
	mode: 'musical' as const,
	events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
};
const SAMPLE_WARP = {
	feature: 'audio-warp' as const,
	points: [
		{ outer: 0, source: 100, mode: 'forward' as const },
		{ outer: 50, source: 180, mode: 'forward' as const },
		{ outer: 100, source: 300, mode: 'forward' as const },
	],
};
const IDENTITY_WARP = {
	feature: 'audio-warp' as const,
	points: [
		{ outer: 0, source: 0, mode: 'forward' as const },
		{ outer: 10, source: 10, mode: 'forward' as const },
	],
};

test('the persisted service sets and clears exact maps with deterministic undo, redo, and reopen', () => {
	let history = createEditorHistory(sampleProject(null));
	const commands: AudioEditorCommand[] = [];
	const service = createAudioWarpAuthoringService({
		lifetime: { assertActive: () => undefined },
		getProject: () => history.present as AudioEditorProjectCurrent,
		editingBlocked: () => false,
		commit(command) {
			commands.push(command);
			history = executeEditorCommand(history, command, { now: NOW });
			return history.present;
		},
	});

	service.setWarpMap(service.prepareClipEdit('clip'), SAMPLE_WARP);
	assert.deepEqual(clipOf(history.present).warpMap, canonical(SAMPLE_WARP));
	assert.equal(commands[0]?.type, 'audio-warp/set');
	history = undoEditorCommand(history, { now: NOW });
	assert.equal(clipOf(history.present).warpMap, null);
	history = redoEditorCommand(history, { now: NOW });
	assert.deepEqual(clipOf(history.present).warpMap, canonical(SAMPLE_WARP));

	service.clearWarpMap(service.prepareClipEdit('clip'));
	assert.equal(clipOf(history.present).warpMap, null);
	assert.equal(commands[1]?.type, 'audio-warp/clear');
	const cloned = cloneCurrentAudioEditorProject(history.present as AudioEditorProjectCurrent);
	assert.deepEqual(loadCurrentAudioEditorProject(JSON.parse(JSON.stringify(cloned)) as unknown), {
		project: cloned, readOnly: false, reason: null,
	});
});

test('the persisted service authors an exact Soundscaper V21 project', () => {
	let project = soundscaperProject();
	const service = createAudioWarpAuthoringService({
		lifetime: { assertActive: () => undefined },
		getProject: () => project,
		editingBlocked: () => false,
		commit(command) {
			project = applySoundscaperProjectCommandV21(project, command, { now: NOW });
			return project;
		},
	});

	service.setWarpMap(service.prepareClipEdit('clip'), SAMPLE_WARP);
	assert.equal(project.schemaVersion, 21);
	assert.deepEqual(clipOf(project).warpMap, canonical(SAMPLE_WARP));
});

test('transient quantization persists exact zero, one, and intermediate strength', () => {
	const rows = [
		{ strength: 0, expected: null },
		{ strength: { num: 1, den: 2 }, expected: { num: 7, den: 2 } },
		{ strength: 1, expected: { num: 4, den: 1 } },
	] as const;
	for (const row of rows) {
		const fixture = serviceFixture(identityProject());
		fixture.service.quantizeTransients(
			fixture.service.prepareClipEdit('clip'),
			[3],
			{ grid: { origin: 0, interval: 2 }, strength: row.strength },
		);
		const map = clipOf(fixture.present()).warpMap as typeof IDENTITY_WARP;
		if (row.expected === null) {
			assert.deepEqual(map, canonical(IDENTITY_WARP));
		} else {
			assert.deepEqual(map.points[1]?.outer, row.expected);
			assert.deepEqual(map.points[1]?.source, { num: 3, den: 1 });
		}
		assert.equal(fixture.commands[0]?.type, 'audio-warp/quantize');
	}
});

test('one canonical groove template is reusable with independently adjustable depth', () => {
	const first = serviceFixture(identityProject());
	const second = serviceFixture(identityProject());
	const template = first.service.createGrooveTemplate({ offsets: [0, { num: 1, den: 3 }] });
	const snapshot = structuredClone(template);
	first.service.applyGrooveTemplate(first.service.prepareClipEdit('clip'), [1], {
		grid: { origin: 0, interval: 1 }, strength: 1,
		template, grooveStrength: { num: 1, den: 2 },
	});
	second.service.applyGrooveTemplate(second.service.prepareClipEdit('clip'), [1], {
		grid: { origin: 0, interval: 1 }, strength: 1,
		template, grooveStrength: { num: 1, den: 2 },
	});
	for (const fixture of [first, second]) {
		const map = clipOf(fixture.present()).warpMap as typeof IDENTITY_WARP;
		assert.deepEqual(map.points[1]?.outer, { num: 7, den: 6 });
		assert.equal(fixture.commands[0]?.type, 'audio-warp/quantize');
	}
	assert.deepEqual(template, snapshot);
	assert.ok(Object.isFrozen(template));
});

test('prepared edits reject stale clip authority atomically', () => {
	const fixture = serviceFixture(sampleProject(null));
	const preparation = fixture.service.prepareClipEdit('clip');
	fixture.replacePresent(applyEditorCommand(fixture.present(), {
		type: 'clip/move', clipId: 'clip', timelineStartFrame: 2_000,
	}, { now: NOW }));
	const before = structuredClone(fixture.present());
	assert.throws(
		() => fixture.service.setWarpMap(preparation, SAMPLE_WARP),
		/clip authority changed after the warp edit was prepared/iu,
	);
	assert.deepEqual(fixture.present(), before);
	assert.equal(fixture.commands.length, 1, 'the stale command reaches the atomic persisted boundary');
});

test('write admission refuses blocked and locked authoring at service and command boundaries', () => {
	const blocked = serviceFixture(sampleProject(null));
	const preparation = blocked.service.prepareClipEdit('clip');
	blocked.setEditingBlocked(true);
	assert.throws(() => blocked.service.setWarpMap(preparation, SAMPLE_WARP), /Editing is blocked/u);
	assert.equal(blocked.commands.length, 0);

	const lockedProject = sampleProject(null, true);
	const locked = serviceFixture(lockedProject);
	assert.throws(() => locked.service.prepareClipEdit('clip'), /Track track is locked/u);
	const authority = createAudioWarpClipAuthority(lockedProject, 'clip');
	const commands: AudioEditorCommand[] = [
		{
			type: 'audio-warp/set', clipId: 'clip',
			expectedClipAuthority: commandObject(authority),
			warpMap: commandObject(canonical(SAMPLE_WARP)),
		},
		{
			type: 'audio-warp/clear', clipId: 'clip',
			expectedClipAuthority: commandObject(authority),
		},
		{
			type: 'audio-warp/quantize', clipId: 'clip',
			expectedClipAuthority: commandObject(authority),
			transientSources: [{ num: 150, den: 1 }],
			options: { grid: { origin: 0, interval: 1 }, strength: 1 },
		},
	];
	for (const command of commands) {
		assert.throws(
			() => applyEditorCommand(lockedProject, command, { now: NOW }),
			/Track track is locked/u,
		);
	}
});

test('sample-anchored trim rebases exact outer units and derives source bounds from the map', () => {
	const original = sampleProject(SAMPLE_WARP);
	const edited = applyEditorCommand(original, {
		type: 'clip/trim', clipId: 'clip', timelineStartFrame: 1_025, durationFrames: 50,
	}, { now: NOW });
	const clip = clipOf(edited);
	assert.equal(clip.timelineStartFrame, 1_025);
	assert.equal(clip.durationFrames, 50);
	assert.equal(clip.sourceStartFrame, 140);
	assert.equal(clip.sourceDurationFrames, 100);
	assert.deepEqual(clip.warpMap, canonical({
		feature: 'audio-warp', points: [
			{ outer: 0, source: 140, mode: 'forward' },
			{ outer: 25, source: 180, mode: 'forward' },
			{ outer: 50, source: 240, mode: 'forward' },
		],
	}));
	assert.deepEqual(clipOf(original).warpMap, SAMPLE_WARP);
});

test('split gives both children exact independently valid warp maps and is one-step undoable', () => {
	const original = sampleProject(SAMPLE_WARP);
	let history = createEditorHistory(original);
	history = executeEditorCommand(history, {
		type: 'clip/split', clipId: 'clip', atFrame: 1_050, rightClipId: 'right',
	}, { now: NOW });
	const left = clipOf(history.present, 'clip');
	const right = clipOf(history.present, 'right');
	assert.deepEqual([left.sourceStartFrame, left.sourceDurationFrames], [100, 80]);
	assert.deepEqual([right.sourceStartFrame, right.sourceDurationFrames], [180, 120]);
	assert.deepEqual(left.warpMap, canonical({
		feature: 'audio-warp', points: [
			{ outer: 0, source: 100, mode: 'forward' },
			{ outer: 50, source: 180, mode: 'forward' },
		],
	}));
	assert.deepEqual(right.warpMap, canonical({
		feature: 'audio-warp', points: [
			{ outer: 0, source: 180, mode: 'forward' },
			{ outer: 50, source: 300, mode: 'forward' },
		],
	}));
	assert.deepEqual(trackOf(history.present).clipIds, ['clip', 'right']);
	history = undoEditorCommand(history, { now: NOW });
	assert.deepEqual((history.present as AudioEditorProjectCurrent).clips, original.clips);
	history = redoEditorCommand(history, { now: NOW });
	assert.deepEqual(trackOf(history.present).clipIds, ['clip', 'right']);
});

test('musical split trims in beat outer units while retaining absolute source samples', () => {
	const original = musicalProject();
	const edited = applyEditorCommand(original, {
		type: 'clip/split', clipId: 'clip', atFrame: 24_000, rightClipId: 'right',
	}, { now: NOW });
	const left = clipOf(edited, 'clip');
	const right = clipOf(edited, 'right');
	assert.deepEqual(left.musicalStartBeat, { num: 0, den: 1 });
	assert.deepEqual(left.musicalDurationBeats, { num: 1, den: 1 });
	assert.deepEqual(right.musicalStartBeat, { num: 1, den: 1 });
	assert.deepEqual(right.musicalDurationBeats, { num: 1, den: 1 });
	assert.deepEqual([left.sourceStartFrame, left.sourceDurationFrames], [0, 40]);
	assert.deepEqual([right.sourceStartFrame, right.sourceDurationFrames], [40, 60]);
	assert.deepEqual((right.warpMap as typeof IDENTITY_WARP).points, [
		{ outer: { num: 0, den: 1 }, source: { num: 40, den: 1 }, mode: 'forward' },
		{ outer: { num: 1, den: 1 }, source: { num: 100, den: 1 }, mode: 'forward' },
	]);
});

test('trim and split refuse a fractional source boundary instead of rounding away exactness', () => {
	const project = sampleProject({
		feature: 'audio-warp', points: [
			{ outer: 0, source: 100, mode: 'forward' },
			{ outer: 49, source: 199, mode: 'forward' },
			{ outer: 100, source: 300, mode: 'forward' },
		],
	});
	assert.throws(() => applyEditorCommand(project, {
		type: 'clip/split', clipId: 'clip', atFrame: 1_050, rightClipId: 'right',
	}, { now: NOW }), /whole source-sample boundary/iu);
	assert.throws(() => applyEditorCommand(project, {
		type: 'clip/trim', clipId: 'clip', timelineStartFrame: 1_050, durationFrames: 50,
	}, { now: NOW }), /whole source-sample boundary/iu);
});

function sampleProject(
	warpMap: unknown = SAMPLE_WARP,
	locked = false,
): AudioEditorProjectCurrent {
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
		tracks: [createAudioTrack({ id: 'track', name: 'Track', locked, clipIds: ['clip'] })],
	});
}

function identityProject(): AudioEditorProjectCurrent {
	const source = createAudioSource({
		id: 'source', storageKey: 'source', frameCount: 100, channelCount: 1, sampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'clip', sourceId: source.id, anchor: 'sample', timelineStartFrame: 0,
		durationFrames: 10, sourceStartFrame: 0, sourceDurationFrames: 10,
		warpMap: IDENTITY_WARP,
	});
	return createCurrentAudioEditorProject({
		id: 'identity-warp-project', now: NOW, tempoMap: TEMPO_MAP,
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
	});
}

function soundscaperProject(): SoundscaperProjectV21 {
	const source = createAudioSource({
		id: 'source', storageKey: 'source', name: 'Source',
		frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'clip', sourceId: source.id, title: 'Clip', anchor: 'sample',
		timelineStartFrame: 1_000, durationFrames: 100,
		sourceStartFrame: 100, sourceDurationFrames: 200, warpMap: null,
	});
	return createSoundscaperProjectV21({
		id: 'soundscaper-warp-project', now: NOW, tempoMap: TEMPO_MAP,
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', name: 'Track', clipIds: ['clip'] })],
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

function serviceFixture(initial: AudioEditorProjectCurrent): {
	readonly service: ReturnType<typeof createAudioWarpAuthoringService>;
	readonly commands: AudioEditorCommand[];
	present(): AudioEditorProjectCurrent;
	replacePresent(project: AudioEditorProjectCurrent): void;
	setEditingBlocked(value: boolean): void;
} {
	let present = initial;
	let blocked = false;
	const commands: AudioEditorCommand[] = [];
	const service = createAudioWarpAuthoringService({
		lifetime: { assertActive: () => undefined },
		getProject: () => present,
		editingBlocked: () => blocked,
		commit(command) {
			commands.push(command);
			present = applyEditorCommand(present, command, { now: NOW });
			return present;
		},
	});
	return {
		service,
		commands,
		present: () => present,
		replacePresent: (project) => { present = project; },
		setEditingBlocked: (value) => { blocked = value; },
	};
}

function clipOf(project: object, id = 'clip'): Readonly<Record<string, unknown>> {
	const clip = (project as AudioEditorProjectCurrent).clips.find((candidate) => candidate.id === id);
	if (!clip) throw new Error(`Missing clip ${id}.`);
	return clip;
}

function trackOf(project: object): Readonly<Record<string, unknown>> {
	const track = (project as AudioEditorProjectCurrent).tracks[0];
	if (!track) throw new Error('Missing track.');
	return track;
}

function canonical(value: unknown): ReturnType<typeof normalizeAudioWarpMap> {
	return normalizeAudioWarpMap(value);
}

function commandObject(value: object): Readonly<Record<string, unknown>> {
	return value as Readonly<Record<string, unknown>>;
}
