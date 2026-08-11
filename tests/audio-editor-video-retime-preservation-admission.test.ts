/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoRetimePreservationAdmission,
} from '../src/common/editor/commands/video-retime-preservation-admission.ts';
import { createClipboardDescriptor } from '../src/common/editor/commands/clipboard-runtime.js';
import { normalizeAudioEditorClipboardDescriptor } from '../src/common/editor/commands/clipboard-codec.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

type DataRecord = Record<string, unknown>;

const RETIME = Object.freeze({
	feature: 'video-retime',
	version: 2,
	points: Object.freeze([
		Object.freeze({ outerFrame: 0, sourceFrame: Object.freeze({ num: 0, den: 1 }) }),
		Object.freeze({ outerFrame: 10, sourceFrame: Object.freeze({ num: 10, den: 1 }) }),
	]),
	segments: Object.freeze([Object.freeze({ mode: 'constant-forward' })]),
});

function persistedProject(schemaVersion = 16): DataRecord {
	return {
		schemaVersion,
		sampleRate: 48_000,
		primarySequenceId: 'main',
		tempoMap: {
			mode: 'sampleLocked',
			events: [{ id: 'tempo-root', beat: { num: 0, den: 1 }, samplePosition: 0, bpm: { num: 120, den: 1 } }],
		},
		sequences: [{ id: 'main', rate: { num: 24, den: 1 }, trackIds: ['video-track'] }],
		sources: [
			{ id: 'video-source', kind: 'video', sampleFrameCount: 480_000, opaqueExtensions: {} },
			{ id: 'peer-source', kind: 'video', sampleFrameCount: 480_000, opaqueExtensions: {} },
		],
		tracks: [{ id: 'video-track', type: 'video', name: 'Video', laneGroupId: null, clipIds: ['retimed', 'peer'] }],
		timelineAnnotations: [],
		clips: [
			videoClip('retimed', 'video-source', RETIME, { groupId: 'group' }),
			videoClip('peer', 'peer-source', null, { sequenceStartFrame: 20, groupId: 'group' }),
		],
		projectBin: {
			clips: [videoClip('bin-retimed', 'video-source', RETIME, { binItemId: 'bin-item' })],
		},
	};
}

function videoClip(
	id: string,
	sourceId: string,
	retimeMap: unknown,
	overrides: DataRecord = {},
): DataRecord {
	return {
		id,
		kind: 'video',
		sourceId,
		sequenceId: 'main',
		sequenceStartFrame: 0,
		sequenceFrameCount: 10,
		sourceInFrame: 0,
		sourceFrameCount: 10,
		retimeMap,
		title: id,
		trimStartFrames: 0,
		trimEndFrames: 0,
		color: null,
		speedRatio: 1,
		groupId: null,
		avLinkId: null,
		binItemId: null,
		opaqueExtensions: {},
		...overrides,
	};
}

function commandProjection(project: DataRecord): DataRecord {
	const projected = structuredClone(project);
	projected.sources = (projected.sources as DataRecord[]).map((source) => ({
		...source,
		frameCount: source.sampleFrameCount,
	}));
	projected.clips = (projected.clips as DataRecord[]).map(resolveClip);
	const projectBin = projected.projectBin as DataRecord;
	projectBin.clips = (projectBin.clips as DataRecord[]).map(resolveClip);
	return projected;
}

function resolveClip(clip: DataRecord): DataRecord {
	const sequenceStartFrame = Number(clip.sequenceStartFrame);
	const sequenceFrameCount = Number(clip.sequenceFrameCount);
	const timelineStartFrame = sequenceStartFrame * 2_000;
	const durationFrames = sequenceFrameCount * 2_000;
	return {
		...clip,
		timelineStartFrame,
		timelineEndFrame: timelineStartFrame + durationFrames,
		durationFrames,
		sourceStartFrame: Number(clip.sourceInFrame),
		sourceEndFrame: Number(clip.sourceInFrame) + Number(clip.sourceFrameCount),
		sourceDurationFrames: Number(clip.sourceFrameCount),
		sequenceEndFrame: sequenceStartFrame + sequenceFrameCount,
		coordinateDomain: 'resolved-samples',
	};
}

test('V16 preservation accepts byte-identical raw and reconciled projects and ignores older maps', () => {
	const base = persistedProject();
	const raw = commandProjection(base);
	const admission = createVideoRetimePreservationAdmission(base, raw);

	assert.doesNotThrow(() => admission.afterCommand(raw));
	assert.doesNotThrow(() => admission.assertPersistedResult(structuredClone(base)));

	const legacy = persistedProject(15);
	const legacyRaw = commandProjection(legacy);
	const legacyAdmission = createVideoRetimePreservationAdmission(legacy, legacyRaw);
	(legacyRaw.clips as DataRecord[])[0]!.sequenceFrameCount = 4;
	assert.doesNotThrow(() => legacyAdmission.afterCommand(legacyRaw));
});

test('V16 preservation freezes curve clips, sources, ownership, rates, and relation membership', () => {
	const cases: ReadonlyArray<{
		name: string;
		mutate(project: DataRecord): void;
	}> = [
		{ name: 'clip', mutate: (project) => { (project.clips as DataRecord[])[0]!.title = 'changed'; } },
		{ name: 'source', mutate: (project) => { (project.sources as DataRecord[])[0]!.sampleFrameCount = 1; } },
		{ name: 'track ownership', mutate: (project) => { (project.tracks as DataRecord[])[0]!.clipIds = ['peer']; } },
		{ name: 'sequence rate', mutate: (project) => {
			(project.sequences as DataRecord[])[0]!.rate = { num: 25, den: 1 };
		} },
		{ name: 'group membership', mutate: (project) => {
			(project.clips as DataRecord[])[1]!.groupId = null;
		} },
		{ name: 'bin ownership', mutate: (project) => {
			const bin = project.projectBin as DataRecord;
			(bin.clips as DataRecord[])[0]!.binItemId = 'other-item';
		} },
	];
	for (const row of cases) {
		const base = persistedProject();
		const raw = commandProjection(base);
		const admission = createVideoRetimePreservationAdmission(base, raw);
		row.mutate(raw);
		assert.throws(
			() => admission.afterCommand(raw),
			/retime.*protected/iu,
			row.name,
		);
	}
});

test('V16 preservation compares protected opaque source bytes without expanding them', () => {
	const base = persistedProject();
	const source = (base.sources as DataRecord[])[0]!;
	source.opaqueExtensions = {
		bytes: Uint8Array.of(0, 1, 254, 255),
		buffer: Uint8Array.of(4, 3, 2, 1).buffer,
	};
	const raw = commandProjection(base);
	const admission = createVideoRetimePreservationAdmission(base, raw);
	const opaque = (raw.sources as DataRecord[])[0]!.opaqueExtensions as {
		bytes: Uint8Array;
		buffer: ArrayBuffer;
	};
	opaque.bytes[2] = 7;
	assert.throws(() => admission.afterCommand(raw), /retime.*protected/iu);
});

test('V16 preservation rejects introduced, removed, and change-restored curve identities', () => {
	const empty = persistedProject();
	(empty.clips as DataRecord[])[0]!.retimeMap = null;
	const rawEmpty = commandProjection(empty);
	const emptyAdmission = createVideoRetimePreservationAdmission(empty, rawEmpty);
	(rawEmpty.clips as DataRecord[])[0]!.retimeMap = structuredClone(RETIME);
	assert.throws(() => emptyAdmission.afterCommand(rawEmpty), /retime.*protected/iu);

	const base = persistedProject();
	const raw = commandProjection(base);
	const admission = createVideoRetimePreservationAdmission(base, raw);
	(raw.clips as DataRecord[])[0]!.retimeMap = null;
	assert.throws(() => admission.afterCommand(raw), /retime.*protected/iu);

	const restored = commandProjection(base);
	const nestedAdmission = createVideoRetimePreservationAdmission(base, restored);
	(restored.clips as DataRecord[])[0]!.sequenceFrameCount = 9;
	assert.throws(() => nestedAdmission.afterCommand(restored), /retime.*protected/iu);
	(restored.clips as DataRecord[])[0]!.sequenceFrameCount = 10;
	assert.doesNotThrow(() => nestedAdmission.assertPersistedResult(structuredClone(base)));
});

test('V16 preservation preflights protected clip and source drivers but allows selection', () => {
	const base = persistedProject();
	const raw = commandProjection(base);
	const admission = createVideoRetimePreservationAdmission(base, raw);
	const commands = [
		{ type: 'clip/overwrite', clipId: 'retimed', timelineStartFrame: 0 },
		{ type: 'project-bin/place', binClipId: 'bin-retimed', timelineStartFrame: 0 },
		{ type: 'source/reprobe', sourceId: 'video-source', changes: {} },
	] as unknown as AudioEditorCommand[];
	for (const command of commands) {
		assert.throws(() => admission.beforeCommand(raw, command), /retime.*protected/iu);
	}
	assert.doesNotThrow(() => admission.beforeCommand(raw, {
		type: 'selection/set',
		startFrame: 0,
		endFrame: 1,
		clipIds: ['retimed'],
	}));
});

test('V16 clipboard copy and codec preserve the exact V2 wire without legacy point aliases', () => {
	const project = commandProjection(persistedProject());
	const clipboard = createClipboardDescriptor(project, {
		startFrame: 0,
		endFrame: 20_000,
		trackIds: ['video-track'],
		clipIds: ['retimed'],
	});
	const descriptor = clipboard.tracks[0]?.clips[0] as DataRecord;

	assert.deepEqual(descriptor.retimeMap, RETIME);
	assert.equal(Object.hasOwn(((descriptor.retimeMap as DataRecord).points as DataRecord[])[0]!, 'outer'), false);
	assert.equal(Object.hasOwn(((descriptor.retimeMap as DataRecord).points as DataRecord[])[0]!, 'source'), false);
	assert.deepEqual(
		(normalizeAudioEditorClipboardDescriptor(clipboard).tracks[0]?.clips[0] as DataRecord).retimeMap,
		RETIME,
	);
});
