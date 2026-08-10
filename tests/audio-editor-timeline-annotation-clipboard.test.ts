/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyEditorCommand,
	createClipboardDescriptor,
	preparePasteCommand,
} from '../src/common/editor/commands.js';
import type {
	AudioEditorClipboard,
	AudioEditorCommand,
} from '../src/common/editor/commands/protocol.ts';
import { assertEditorCommandCapabilities } from '../src/common/editor/controller/command-capability-policy.ts';
import {
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import {
	createAudioClipV10,
	createAudioEditorProjectV10,
	createAudioSourceV10,
	createAudioTrackV10,
} from '../src/common/editor/project-v10.ts';
import { projectV10ForCommand } from '../src/common/editor/project-v10-command-projection.ts';
import { createAudioEditorProjectV11 } from '../src/common/editor/project-v11.ts';
import type { TimelineAnnotationV11 } from '../src/common/editor/timeline-annotation.ts';

const NOW = '2026-08-09T12:00:00.000Z';

test('V3 copy/paste remaps sequences, item and batch IDs while scaling only sample offsets', () => {
	const source = annotationProject({
		id: 'source',
		sampleRate: 48_000,
		sequenceId: 'source-sequence',
		trackId: 'source-track',
		annotations: [
			sampleMarker('sample', 'source-sequence', 12_000, 'mixed-batch'),
			musicalMarker('musical', 'source-sequence', rational(3, 2), 'mixed-batch'),
			sampleRegion('sample-region', 'source-sequence', 24_000, 36_000),
			musicalRegion('musical-region', 'source-sequence', rational(2), rational(3)),
		],
		selectedAnnotationIds: ['musical-region'],
	});
	const clipboard = createClipboardDescriptor(commandProject(source), {
		startFrame: 0, endFrame: 48_000, trackIds: ['source-track'],
	});
	assert.equal(clipboard.schemaVersion, 3);
	assert.equal(clipboard.tracks[0]?.sourceSequenceId, 'source-sequence');
	assert.equal(clipboard.annotations?.length, 4);

	const target = annotationProject({
		id: 'target', sampleRate: 96_000, sequenceId: 'target-sequence', trackId: 'target-track', annotations: [],
	});
	const command = preparePasteCommand(clipboard, {
		atFrame: 96_000,
		trackMap: { 'source-track': 'target-track' },
		project: commandProject(target),
	}, sequentialIds()) as PasteCommand;
	assert.deepEqual(command.sequenceMap, { 'source-sequence': 'target-sequence' });
	assert.notEqual(command.annotationIds?.sample, 'sample');
	assert.equal(command.annotationBatchIds?.['mixed-batch'], command.annotationBatchIds?.['mixed-batch']);

	const pasted = applyEditorCommand(target, command, { now: NOW });
	assert.deepEqual(annotationCoordinates(pasted.timelineAnnotations), [
		['timeline-annotation-0', 'target-sequence', 'sample', 120_000, 'timeline-annotation-batch-1'],
		['timeline-annotation-2', 'target-sequence', 'musical', rational(7, 2), 'timeline-annotation-batch-1'],
		['timeline-annotation-3', 'target-sequence', 'sample-region', [144_000, 168_000], null],
		['timeline-annotation-4', 'target-sequence', 'musical-region', [rational(4), rational(5)], null],
	]);
});

test('V3 remains lossless for rich media descriptors while annotations are empty', () => {
	const source = createAudioSourceV10({ id: 'source', frameCount: 48_000, channelCount: 1 });
	const clip = createAudioClipV10({
		id: 'clip', sourceId: 'source', timelineStartFrame: 0,
		durationFrames: 1_000, sourceStartFrame: 100, sourceDurationFrames: 1_000,
		groupId: 'group', gain: 0.5, fadeInFrames: 10, fadeOutFrames: 20,
		envelope: [{ frame: 0, value: 0.5 }, { frame: 1_000, value: 1 }],
	});
	const project = createAudioEditorProjectV11({
		id: 'rich-media', now: NOW, sources: [source], clips: [clip],
		sequences: [{ id: 'main', name: 'Main', rate: { num: 24, den: 1 }, trackIds: ['track'] }],
		primarySequenceId: 'main',
		tracks: [createAudioTrackV10({ id: 'track', clipIds: ['clip'] })],
	});
	const clipboard = createClipboardDescriptor(commandProject(project), {
		startFrame: 0, endFrame: 1_000, trackIds: ['track'],
	});
	assert.equal(clipboard.schemaVersion, 3);
	assert.deepEqual(clipboard.annotations, []);
	const descriptor = clipboard.tracks[0]?.clips[0];
	assert.deepEqual(
		[descriptor?.gain, descriptor?.fadeInFrames, descriptor?.fadeOutFrames, descriptor?.envelope],
		[0.5, 10, 20, [{ frame: 0, value: 0.5 }, { frame: 1_000, value: 1 }]],
	);
	const command = preparePasteCommand(clipboard, {
		atFrame: 2_000, project: commandProject(project),
	}, sequentialIds()) as PasteCommand;
	const pasted = applyEditorCommand(project, command, { now: NOW });
	const result = pasted.clips.find(({ id }) => id === 'clip-0');
	assert.ok(result);
	assert.deepEqual(
		[result.gain, result.fadeInFrames, result.fadeOutFrames, result.envelope],
		[0.5, 10, 20, [{ frame: 0, value: 0.5 }, { frame: 1_000, value: 1 }]],
	);
});

test('copy includes selected annotations outside the range and overlapping regions without clipping them', () => {
	const project = createAudioEditorProjectV11({
		id: 'selection-copy', now: NOW,
		sequences: [
			{ id: 'main', name: 'Main', rate: { num: 24, den: 1 }, trackIds: ['track'] },
			{ id: 'secondary', name: 'Secondary', rate: { num: 24, den: 1 }, trackIds: ['secondary-track'] },
		],
		primarySequenceId: 'main',
		tracks: [
			createAudioTrackV10({ id: 'track', clipIds: [] }),
			createAudioTrackV10({ id: 'secondary-track', clipIds: [] }),
		],
		timelineAnnotations: [
			sampleMarker('outside-selected', 'secondary', 90),
			sampleRegion('overlap', 'main', 5, 15),
			sampleMarker('outside', 'main', 80),
		],
		selection: { annotationIds: ['outside-selected'] },
	});
	const clipboard = createClipboardDescriptor(commandProject(project), {
		startFrame: 10, endFrame: 20, trackIds: ['track'],
	});
	assert.deepEqual(clipboard.annotations?.map(({ key }) => key), ['outside-selected', 'overlap']);
	assert.equal(clipboard.annotations?.[0]?.sourceSequenceId, 'secondary');
	assert.deepEqual(clipboard.annotations?.[1], {
		key: 'overlap', sourceSequenceId: 'main', name: 'overlap', color: 'auto', batchId: null,
		opaqueExtensions: {}, kind: 'region', anchor: 'sample', startOffsetFrame: -5, endOffsetFrame: 5,
	});
});

test('annotation-only V3 paste uses an explicit source-to-target sequence map', () => {
	const project = annotationProject({ id: 'annotation-only', sequenceId: 'target', trackId: 'track', annotations: [] });
	const clipboard: AudioEditorClipboard = {
		schemaVersion: 3,
		sampleRate: 48_000,
		durationFrames: 100,
		tracks: [],
		annotations: [sampleMarkerDescriptor('source', 'source-only', 25)],
	};
	const command = preparePasteCommand(clipboard, {
		atFrame: 100,
		sequenceMap: { 'source-only': 'target' },
		project: commandProject(project),
	}, sequentialIds()) as PasteCommand;
	assert.deepEqual(command.sequenceMap, { 'source-only': 'target' });
	const pasted = applyEditorCommand(project, command, { now: NOW });
	assert.equal(samplePosition(pasted.timelineAnnotations, 'timeline-annotation-0'), 125);
});

test('overlap and insert-track place annotations without rippling unrelated existing annotations', () => {
	for (const mode of ['overlap', 'insert-track'] as const) {
		const project = annotationProject({
			id: `no-ripple-${mode}`, sequenceId: 'main', trackId: 'track',
			annotations: [sampleMarker('existing', 'main', 5_000)],
		});
		const clipboard = annotationClipboard({
			durationFrames: 1_000,
			annotations: [sampleMarkerDescriptor('source', 'main', 100)],
		});
		const command = preparePasteCommand(clipboard, {
			atFrame: 1_000, mode, project: commandProject(project),
		}, sequentialIds()) as PasteCommand;
		const pasted = applyEditorCommand(project, command, { now: NOW });
		assert.equal(samplePosition(pasted.timelineAnnotations, 'existing'), 5_000);
		assert.equal(samplePosition(pasted.timelineAnnotations, 'timeline-annotation-0'), 1_100);
	}
});

test('V3 preparation maps a not-yet-created target track to the primary sequence for an atomic batch paste', () => {
	const project = annotationProject({ id: 'new-track', sequenceId: 'main', trackId: 'existing', annotations: [] });
	const clipboard = annotationClipboard({ annotations: [sampleMarkerDescriptor('source', 'main', 10)] });
	const paste = preparePasteCommand(clipboard, {
		atFrame: 100,
		trackMap: { track: 'created-track' },
		project: commandProject(project),
	}, sequentialIds()) as PasteCommand;
	assert.deepEqual(paste.sequenceMap, { main: 'main' });
	const command: AudioEditorCommand = {
		type: 'batch',
		commands: [{
			type: 'track/add',
			track: createAudioTrackV10({ id: 'created-track', name: 'Created', clipIds: [] }),
		}, paste],
	};
	const pasted = applyEditorCommand(project, command, { now: NOW });
	assert.equal(samplePosition(pasted.timelineAnnotations, 'timeline-annotation-0'), 110);
	assert.ok((pasted.sequences[0]?.trackIds as readonly string[]).includes('created-track'));
});

test('insert-all expands sample and musical points and spans using the conformed media insertion span', () => {
	const project = annotationProject({
		id: 'insert-all', sequenceId: 'main', trackId: 'video-track', trackType: 'video',
		annotations: [
			sampleMarker('sample-after', 'main', 3_000),
			sampleRegion('sample-spanning', 'main', 500, 3_000),
			musicalMarker('musical-after', 'main', rational(1, 8)),
			musicalRegion('musical-spanning', 'main', rational(1, 48), rational(1, 8)),
		],
	});
	const clipboard = annotationClipboard({
		durationFrames: 1_000,
		trackType: 'video',
		annotations: [sampleMarkerDescriptor('pasted', 'main', 0)],
	});
	const command = preparePasteCommand(clipboard, {
		atFrame: 1_900, mode: 'insert-all', project: commandProject(project),
	}, sequentialIds()) as PasteCommand;
	const pasted = applyEditorCommand(project, command, { now: NOW });

	assert.equal(samplePosition(pasted.timelineAnnotations, 'sample-after'), 5_000);
	assert.deepEqual(sampleRange(pasted.timelineAnnotations, 'sample-spanning'), [500, 5_000]);
	assert.deepEqual(musicalPosition(pasted.timelineAnnotations, 'musical-after'), rational(5, 24));
	assert.deepEqual(musicalRange(pasted.timelineAnnotations, 'musical-spanning'), [rational(1, 48), rational(5, 24)]);
	assert.equal(samplePosition(pasted.timelineAnnotations, 'timeline-annotation-0'), 2_000);
});

test('every paste mode rejects missing annotation maps and malformed descriptors atomically', () => {
	for (const mode of ['reject', 'overlap', 'insert-track', 'insert-all'] as const) {
		const project = annotationProject({
			id: `atomic-${mode}`, sequenceId: 'main', trackId: 'track',
			annotations: [sampleMarker('existing', 'main', 5_000)],
		});
		const before = structuredClone(project);
		const prepared = preparePasteCommand(annotationClipboard({
			annotations: [sampleMarkerDescriptor('source', 'main', 0, 'batch')],
		}), { atFrame: 1_000, mode, project: commandProject(project) }, sequentialIds()) as PasteCommand;
		const annotationIds = { ...prepared.annotationIds };
		delete annotationIds.source;
		assert.throws(
			() => applyEditorCommand(project, { ...prepared, annotationIds }, { now: NOW }),
			/paste\.annotationIds\.source is required/iu,
		);
		const annotationBatchIds = { ...prepared.annotationBatchIds };
		delete annotationBatchIds.batch;
		assert.throws(
			() => applyEditorCommand(project, { ...prepared, annotationBatchIds }, { now: NOW }),
			/paste\.annotationBatchIds\.batch is required/iu,
		);
		const sequenceMap = { ...prepared.sequenceMap };
		delete sequenceMap.main;
		assert.throws(
			() => applyEditorCommand(project, { ...prepared, sequenceMap }, { now: NOW }),
			/paste\.sequenceMap\.main is required/iu,
		);
		assert.deepEqual(project, before);
	}

	const malformed = annotationClipboard({ annotations: [sampleMarkerDescriptor('source', 'main', 0)] }) as unknown as Record<string, unknown>;
	(malformed.annotations as Record<string, unknown>[])[0].positionOffsetFrame = 1.5;
	assert.throws(() => preparePasteCommand(malformed), /positionOffsetFrame.*safe integer/iu);
	let getterCalls = 0;
	const accessor = annotationClipboard({ annotations: [sampleMarkerDescriptor('source', 'main', 0)] }) as unknown as Record<string, unknown>;
	Object.defineProperty(accessor, 'sampleRate', { enumerable: true, get: () => { getterCalls += 1; return 48_000; } });
	assert.throws(() => preparePasteCommand(accessor), /sampleRate.*data property/iu);
	assert.equal(getterCalls, 0);
});

test('paste rejects annotation map accessors without invoking them or mutating the project', () => {
	for (const field of ['sequenceMap', 'annotationIds', 'annotationBatchIds'] as const) {
		const project = annotationProject({
			id: `map-accessor-${field}`, sequenceId: 'main', trackId: 'track',
			annotations: [sampleMarker('existing', 'main', 5_000)],
		});
		const before = structuredClone(project);
		const command = preparePasteCommand(annotationClipboard({
			annotations: [sampleMarkerDescriptor('source', 'main', 0, 'batch')],
		}), { atFrame: 1_000, project: commandProject(project) }, sequentialIds()) as PasteCommand;
		let getterCalls = 0;
		Object.defineProperty(command, field, {
			enumerable: true,
			get: () => {
				getterCalls += 1;
				return {};
			},
		});
		assert.throws(
			() => applyEditorCommand(project, command, { now: NOW }),
			new RegExp(`${field}.*own enumerable data property`, 'iu'),
		);
		assert.equal(getterCalls, 0);
		assert.deepEqual(project, before);
	}
});

test('V3 clip payload admission rejects hostile nested structures without executing them', () => {
	let getterCalls = 0;
	const accessorPoint = { frame: 0 } as Record<string, unknown>;
	Object.defineProperty(accessorPoint, 'value', {
		enumerable: true,
		get: () => {
			getterCalls += 1;
			return 1;
		},
	});
	assert.throws(() => preparePasteCommand(mediaClipboardWithPayload([accessorPoint])), /enumerable data propert/iu);
	assert.equal(getterCalls, 0);

	const symbolPoint = { frame: 0, value: 1 } as Record<PropertyKey, unknown>;
	symbolPoint[Symbol('hidden')] = true;
	assert.throws(() => preparePasteCommand(mediaClipboardWithPayload([symbolPoint])), /string keys/iu);
	const hiddenPoint = { frame: 0, value: 1 };
	Object.defineProperty(hiddenPoint, 'hidden', { enumerable: false, value: true });
	assert.throws(() => preparePasteCommand(mediaClipboardWithPayload([hiddenPoint])), /enumerable data propert/iu);
	assert.throws(() => preparePasteCommand(mediaClipboardWithPayload(new Map([['frame', 0]]))), /plain objects/iu);
	assert.throws(() => preparePasteCommand(mediaClipboardWithPayload(1n)), /JSON-serializable scalar/iu);
	const cyclic: Record<string, unknown> = {};
	cyclic.self = cyclic;
	assert.throws(() => preparePasteCommand(mediaClipboardWithPayload(cyclic)), /Cyclic/iu);
	let tooDeep: Record<string, unknown> = { leaf: true };
	for (let depth = 0; depth < 130; depth += 1) tooDeep = { next: tooDeep };
	assert.throws(() => preparePasteCommand(mediaClipboardWithPayload(tooDeep)), /depth limit/iu);
	assert.throws(
		() => preparePasteCommand(mediaClipboardWithPayload(new Array(100_000).fill(0))),
		/traversal node limit/iu,
	);
});

test('prototype-colliding annotation identities survive JSON command replay', () => {
	const project = annotationProject({ id: 'prototype-identities', sequenceId: 'target', trackId: 'track', annotations: [] });
	const clipboard: AudioEditorClipboard = {
		schemaVersion: 3,
		sampleRate: 48_000,
		durationFrames: 10,
		tracks: [],
		annotations: [sampleMarkerDescriptor('__proto__', '__proto__', 1, 'toString')],
	};
	const command = preparePasteCommand(clipboard, {
		atFrame: 100,
		project: commandProject(project),
		sequenceMap: Object.fromEntries([['__proto__', 'target']]),
	}, sequentialIds()) as PasteCommand;
	assert.ok(command.sequenceMap);
	assert.ok(command.annotationIds);
	assert.ok(command.annotationBatchIds);
	assert.equal(Object.hasOwn(command.sequenceMap, '__proto__'), true);
	assert.equal(Object.hasOwn(command.annotationIds, '__proto__'), true);
	assert.equal(Object.hasOwn(command.annotationBatchIds, 'toString'), true);
	const replayed = JSON.parse(JSON.stringify(command)) as AudioEditorCommand;
	const pasted = applyEditorCommand(project, replayed, { now: NOW });
	assert.deepEqual(annotationCoordinates(pasted.timelineAnnotations), [
		['timeline-annotation-0', 'target', '__proto__', 101, 'timeline-annotation-batch-1'],
	]);
});

test('cross-rate paste keeps positive sample regions and rejects minimum-span overflow atomically', () => {
	const project = annotationProject({
		id: 'downsample-region', sampleRate: 48_000, sequenceId: 'main', trackId: 'track', annotations: [],
	});
	const clipboard = annotationClipboard({
		sampleRate: 192_000,
		durationFrames: 4,
		annotations: [{
			key: 'region', sourceSequenceId: 'main', name: 'region', color: 'auto', batchId: null,
			opaqueExtensions: {}, kind: 'region', anchor: 'sample', startOffsetFrame: 0, endOffsetFrame: 1,
		}],
	});
	const pasted = applyEditorCommand(project, preparePasteCommand(clipboard, {
		atFrame: 100, project: commandProject(project),
	}, sequentialIds()) as AudioEditorCommand, { now: NOW });
	assert.deepEqual(sampleRange(pasted.timelineAnnotations, 'timeline-annotation-0'), [100, 101]);

	const before = structuredClone(project);
	const overflowing = annotationClipboard({
		sampleRate: 192_000,
		durationFrames: 4,
		annotations: [{
			key: 'overflow', sourceSequenceId: 'main', name: 'overflow', color: 'auto', batchId: null,
			opaqueExtensions: {}, kind: 'region', anchor: 'sample', startOffsetFrame: 4, endOffsetFrame: 5,
		}],
	});
	assert.throws(() => applyEditorCommand(project, preparePasteCommand(overflowing, {
		atFrame: Number.MAX_SAFE_INTEGER - 1, project: commandProject(project),
	}, sequentialIds()) as AudioEditorCommand, { now: NOW }), /minimum.*region.*outside.*sample timeline/iu);
	assert.deepEqual(project, before);
});

test('capability policy inspects V3 annotation payloads in every mode and permits empty V3 media', () => {
	const disabled = {
		audioEffects: true, audioRecording: true, audioSpectralEditing: true,
		timelineAnnotations: false, videoEffects: true, trackFolders: true,
	};
	for (const mode of ['reject', 'overlap', 'insert-track', 'insert-all'] as const) {
		const command = preparePasteCommand(annotationClipboard({
			annotations: [sampleMarkerDescriptor('source', 'main', 0)],
		}), { mode }, sequentialIds()) as AudioEditorCommand;
		assert.throws(
			() => assertEditorCommandCapabilities(command, disabled, 'Soundscaper'),
			/Soundscaper does not support timelineAnnotations/iu,
		);
	}
	assert.doesNotThrow(() => assertEditorCommandCapabilities(
		preparePasteCommand(annotationClipboard({ annotations: [] })) as AudioEditorCommand,
		disabled,
		'Soundscaper',
	));
});

test('paste replay fails on fresh IDs while undo and redo restore exact annotation states', () => {
	const project = annotationProject({ id: 'history', sequenceId: 'main', trackId: 'track', annotations: [] });
	const command = preparePasteCommand(annotationClipboard({
		annotations: [sampleMarkerDescriptor('source', 'main', 10, 'batch')],
	}), { atFrame: 100, project: commandProject(project) }, sequentialIds()) as PasteCommand;
	const edited = applyEditorCommand(project, command, { now: NOW });
	assert.throws(() => applyEditorCommand(edited, command, { now: NOW }), /fresh pasted annotation ID/iu);

	let history = createEditorHistory(project);
	history = executeEditorCommand(history, command, { now: NOW });
	const after = structuredClone((history.present as AnnotationProject).timelineAnnotations);
	history = undoEditorCommand(history, { now: NOW });
	assert.deepEqual((history.present as AnnotationProject).timelineAnnotations, []);
	history = redoEditorCommand(history, { now: NOW });
	assert.deepEqual((history.present as AnnotationProject).timelineAnnotations, after);
});

test('legacy V1/V2 media clipboards remain readable and carry no annotation identity maps', () => {
	const project = createAudioEditorProjectV10({
		id: 'legacy', now: NOW,
		sequences: [{ id: 'main', name: 'Main', rate: { num: 24, den: 1 }, trackIds: ['track'] }],
		primarySequenceId: 'main',
		tracks: [createAudioTrackV10({ id: 'track', clipIds: [] })],
	});
	for (const schemaVersion of [1, 2] as const) {
		const clipboard = {
			schemaVersion, sampleRate: 48_000, durationFrames: 1, tracks: [{
				sourceTrackId: 'track', sourceTrackName: 'Track',
				...(schemaVersion === 2 ? { sourceTrackType: 'audio' as const, sourceLaneGroupId: null } : {}),
				clips: [],
			}],
		};
		const command = preparePasteCommand(clipboard, { project });
		assert.equal(Object.hasOwn(command, 'annotationIds'), false);
		assert.equal(Object.hasOwn(command, 'sequenceMap'), false);
		assert.doesNotThrow(() => applyEditorCommand(project, command as AudioEditorCommand, { now: NOW }));
	}
	const currentMediaOnly = preparePasteCommand(annotationClipboard({ annotations: [] }), { project });
	assert.doesNotThrow(() => applyEditorCommand(project, currentMediaOnly as AudioEditorCommand, { now: NOW }));
});

type AnnotationProject = ReturnType<typeof createAudioEditorProjectV11>;
type PasteCommand = Extract<AudioEditorCommand, { readonly type: 'clipboard/paste' }>;

function annotationProject(options: Readonly<{
	id: string;
	sequenceId: string;
	trackId: string;
	annotations: readonly TimelineAnnotationV11[];
	sampleRate?: number;
	trackType?: 'audio' | 'video';
	selectedAnnotationIds?: readonly string[];
}>): AnnotationProject {
	return createAudioEditorProjectV11({
		id: options.id,
		now: NOW,
		sampleRate: options.sampleRate ?? 48_000,
		sequences: [{ id: options.sequenceId, name: options.sequenceId, rate: { num: 24, den: 1 }, trackIds: [options.trackId] }],
		primarySequenceId: options.sequenceId,
		tracks: [{
			...createAudioTrackV10({ id: options.trackId, name: options.trackId, clipIds: [] }, options.sampleRate ?? 48_000),
			type: options.trackType ?? 'audio',
		}],
		timelineAnnotations: options.annotations,
		selection: { annotationIds: options.selectedAnnotationIds ?? [] },
	});
}

function annotationClipboard(options: Readonly<{
	sampleRate?: number;
	durationFrames?: number;
	trackType?: 'audio' | 'video';
	annotations: readonly Record<string, unknown>[];
}>): AudioEditorClipboard {
	const type = options.trackType ?? 'audio';
	return {
		schemaVersion: 3,
		sampleRate: options.sampleRate ?? 48_000,
		durationFrames: options.durationFrames ?? 100,
		tracks: [{
			sourceTrackId: type === 'video' ? 'video-track' : 'track',
			sourceTrackName: 'Track',
			sourceTrackType: type,
			sourceLaneGroupId: null,
			sourceSequenceId: 'main',
			clips: [],
		}],
		annotations: options.annotations as AudioEditorClipboard['annotations'],
	};
}

function mediaClipboardWithPayload(payload: unknown): AudioEditorClipboard {
	return {
		schemaVersion: 3,
		sampleRate: 48_000,
		durationFrames: 100,
		tracks: [{
			sourceTrackId: 'track', sourceTrackName: 'Track', sourceTrackType: 'audio',
			sourceLaneGroupId: null, sourceSequenceId: 'main',
			clips: [{
				key: 'clip', kind: 'audio', sourceId: 'source', offsetFrame: 0,
				sourceStartFrame: 0, durationFrames: 100, envelope: payload,
			}],
		}],
		annotations: [],
	};
}

function sampleMarkerDescriptor(
	key: string,
	sourceSequenceId: string,
	positionOffsetFrame: number,
	batchId: string | null = null,
): NonNullable<AudioEditorClipboard['annotations']>[number] {
	return {
		key, sourceSequenceId, name: key, color: 'auto', batchId, opaqueExtensions: {},
		kind: 'marker', anchor: 'sample', positionOffsetFrame,
	};
}

function common(id: string, sequenceId: string, batchId: string | null = null) {
	return { id, sequenceId, name: id, color: 'auto' as const, batchId, opaqueExtensions: {} };
}

function sampleMarker(id: string, sequenceId: string, positionFrame: number, batchId: string | null = null): TimelineAnnotationV11 {
	return { ...common(id, sequenceId, batchId), kind: 'marker', anchor: 'sample', positionFrame };
}

function musicalMarker(id: string, sequenceId: string, positionBeat: { num: number; den: number }, batchId: string | null = null): TimelineAnnotationV11 {
	return { ...common(id, sequenceId, batchId), kind: 'marker', anchor: 'musical', positionBeat };
}

function sampleRegion(id: string, sequenceId: string, startFrame: number, endFrame: number): TimelineAnnotationV11 {
	return { ...common(id, sequenceId), kind: 'region', anchor: 'sample', startFrame, endFrame };
}

function musicalRegion(id: string, sequenceId: string, startBeat: { num: number; den: number }, endBeat: { num: number; den: number }): TimelineAnnotationV11 {
	return { ...common(id, sequenceId), kind: 'region', anchor: 'musical', startBeat, endBeat };
}

function rational(num: number, den = 1) {
	return { num, den };
}

function commandProject(project: AnnotationProject) {
	return projectV10ForCommand(project as unknown as Record<string, unknown>);
}

function sequentialIds() {
	let next = 0;
	return (prefix = 'id') => `${prefix}-${String(next++)}`;
}

function annotationCoordinates(annotations: readonly TimelineAnnotationV11[]) {
	return annotations.map((annotation) => {
		if (annotation.kind === 'marker' && annotation.anchor === 'sample') return [annotation.id, annotation.sequenceId, annotation.name, annotation.positionFrame, annotation.batchId];
		if (annotation.kind === 'marker') return [annotation.id, annotation.sequenceId, annotation.name, annotation.positionBeat, annotation.batchId];
		if (annotation.anchor === 'sample') return [annotation.id, annotation.sequenceId, annotation.name, [annotation.startFrame, annotation.endFrame], annotation.batchId];
		return [annotation.id, annotation.sequenceId, annotation.name, [annotation.startBeat, annotation.endBeat], annotation.batchId];
	});
}

function findAnnotation(annotations: readonly TimelineAnnotationV11[], id: string): TimelineAnnotationV11 {
	const annotation = annotations.find((candidate) => candidate.id === id);
	if (!annotation) throw new ReferenceError(`Missing annotation ${id}.`);
	return annotation;
}

function samplePosition(annotations: readonly TimelineAnnotationV11[], id: string): number {
	const annotation = findAnnotation(annotations, id);
	if (annotation.kind !== 'marker' || annotation.anchor !== 'sample') throw new TypeError('Expected a sample marker.');
	return annotation.positionFrame;
}

function sampleRange(annotations: readonly TimelineAnnotationV11[], id: string): readonly number[] {
	const annotation = findAnnotation(annotations, id);
	if (annotation.kind !== 'region' || annotation.anchor !== 'sample') throw new TypeError('Expected a sample region.');
	return [annotation.startFrame, annotation.endFrame];
}

function musicalPosition(annotations: readonly TimelineAnnotationV11[], id: string) {
	const annotation = findAnnotation(annotations, id);
	if (annotation.kind !== 'marker' || annotation.anchor !== 'musical') throw new TypeError('Expected a musical marker.');
	return annotation.positionBeat;
}

function musicalRange(annotations: readonly TimelineAnnotationV11[], id: string) {
	const annotation = findAnnotation(annotations, id);
	if (annotation.kind !== 'region' || annotation.anchor !== 'musical') throw new TypeError('Expected a musical region.');
	return [annotation.startBeat, annotation.endBeat];
}
