/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	createAddSignatureEventCommand,
	createAddTempoEventCommand,
	createRemoveSignatureEventCommand,
	createRemoveTempoEventCommand,
	createSetTempoMapModeCommand,
	createUpdateSignatureEventCommand,
	createUpdateTempoEventCommand,
} from '../src/common/editor/commands/factories.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createEditorHistory,
	executeEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createLabel,
	createLabelTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	createCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../src/common/editor/project-current.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';

const CREATED_AT = '2026-08-09T14:00:00.000Z';
const EDITED_AT = '2026-08-09T14:01:00.000Z';
const UNDONE_AT = '2026-08-09T14:02:00.000Z';

test('tempo and signature factories preserve caller-owned stable IDs and exact coordinates', () => {
	const commands = [
		createSetTempoMapModeCommand('sampleLocked'),
		createAddTempoEventCommand({ id: 'tempo-2', samplePosition: 96_000, bpm: { num: 90, den: 1 } }),
		createUpdateTempoEventCommand('tempo-2', { bpm: { num: 180, den: 2 } }),
		createRemoveTempoEventCommand('tempo-2'),
		createAddSignatureEventCommand({ id: 'signature-2', bar: 8, numerator: 7, denominator: 8 }),
		createUpdateSignatureEventCommand('signature-2', { bar: 4 }),
		createRemoveSignatureEventCommand('signature-2'),
	] satisfies readonly AudioEditorCommand[];

	assert.deepEqual(commands.map(({ type }) => type), [
		'tempo-map/mode-set',
		'tempo-event/add',
		'tempo-event/update',
		'tempo-event/remove',
		'signature-event/add',
		'signature-event/update',
		'signature-event/remove',
	]);
	assert.deepEqual(commands[1], {
		type: 'tempo-event/add',
		event: { id: 'tempo-2', samplePosition: 96_000, bpm: { num: 90, den: 1 } },
	});
	assert.throws(() => createUpdateTempoEventCommand('', { bpm: { num: 90, den: 1 } }), /tempo event ID/u);
	assert.throws(() => createRemoveSignatureEventCommand(' '), /signature event ID/u);
});

test('musical tempo CRUD is stable-ID based, ordered, hold-only, and exact-rational', () => {
	let project = createCurrentAudioEditorProject({ id: 'musical-crud', now: CREATED_AT });
	project = apply(project, createAddTempoEventCommand({
		id: 'tempo-outro', beat: { num: 8, den: 1 }, bpm: { num: 90, den: 1 },
	}));
	project = apply(project, createAddTempoEventCommand({
		id: 'tempo-middle', beat: { num: 8, den: 2 }, bpm: { num: 225, den: 2 },
	}));

	assert.deepEqual(tempoEvents(project), [
		{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
		{ id: 'tempo-middle', beat: { num: 4, den: 1 }, bpm: { num: 225, den: 2 } },
		{ id: 'tempo-outro', beat: { num: 8, den: 1 }, bpm: { num: 90, den: 1 } },
	]);

	project = apply(project, createUpdateTempoEventCommand('tempo-outro', {
		beat: { num: 6, den: 1 }, bpm: { num: 75, den: 1 },
	}));
	assert.deepEqual(tempoEvents(project).map(({ id }) => id), ['tempo-1', 'tempo-middle', 'tempo-outro']);
	assert.deepEqual(tempoEvents(project)[2], {
		id: 'tempo-outro', beat: { num: 6, den: 1 }, bpm: { num: 75, den: 1 },
	});

	assert.throws(() => apply(project, createAddTempoEventCommand({
		id: 'tempo-middle', beat: { num: 10, den: 1 }, bpm: { num: 90, den: 1 },
	})), /tempo event ID.*already exists/u);
	assert.throws(() => apply(project, createAddTempoEventCommand({
		id: 'tempo-duplicate-beat', beat: { num: 4, den: 1 }, bpm: { num: 90, den: 1 },
	})), /tempo event beat.*already exists/u);
	assert.throws(() => apply(project, {
		type: 'tempo-event/add',
		event: { id: 'tempo-float', beat: 10, bpm: { num: 90, den: 1 } },
	} as unknown as AudioEditorCommand), /exact rational/u);
	assert.throws(() => apply(project, {
		type: 'tempo-event/add',
		event: {
			id: 'tempo-ramp', beat: { num: 10, den: 1 }, bpm: { num: 90, den: 1 }, curve: 'linear',
		},
	} as unknown as AudioEditorCommand), /unsupported field.*curve/u);
	assert.throws(() => apply(project, createUpdateTempoEventCommand('tempo-outro', {
		beat: { num: 4, den: 1 },
	})), /tempo event beat.*already exists/u);
	assert.throws(() => apply(project, createUpdateTempoEventCommand('tempo-1', {
		bpm: { num: 1, den: 2 },
	})), /root tempo event.*1 BPM/iu);
	assert.throws(() => apply(project, createRemoveTempoEventCommand('tempo-1')), /beat zero.*cannot be removed/u);

	project = apply(project, createRemoveTempoEventCommand('tempo-middle'));
	assert.deepEqual(tempoEvents(project).map(({ id }) => id), ['tempo-1', 'tempo-outro']);
});

test('sample-locked tempo CRUD derives exact beats from authoritative sample positions', () => {
	let project = createCurrentAudioEditorProject({
		id: 'sample-locked-crud', now: CREATED_AT, sampleRate: 48_000,
		tempoMap: { mode: 'musical', events: [
			{ id: 'tempo-root', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
			{ id: 'tempo-second', beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 } },
		] },
	});
	project = apply(project, createSetTempoMapModeCommand('sampleLocked'));
	assert.deepEqual(tempoEvents(project), [
		{ id: 'tempo-root', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 }, samplePosition: 0 },
		{ id: 'tempo-second', beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 }, samplePosition: 96_000 },
	]);

	project = apply(project, createAddTempoEventCommand({
		id: 'tempo-third', samplePosition: 144_000, bpm: { num: 90, den: 1 },
	}));
	assert.deepEqual(tempoEvents(project)[2], {
		id: 'tempo-third', beat: { num: 5, den: 1 }, bpm: { num: 90, den: 1 }, samplePosition: 144_000,
	});

	project = apply(project, createUpdateTempoEventCommand('tempo-root', { bpm: { num: 60, den: 1 } }));
	assert.deepEqual(tempoEvents(project).map(({ beat }) => beat), [
		{ num: 0, den: 1 }, { num: 2, den: 1 }, { num: 3, den: 1 },
	]);
	project = apply(project, createUpdateTempoEventCommand('tempo-third', { samplePosition: 192_000 }));
	assert.deepEqual(tempoEvents(project)[2]?.beat, { num: 4, den: 1 });

	assert.throws(() => apply(project, createAddTempoEventCommand({
		id: 'tempo-duplicate-sample', samplePosition: 96_000, bpm: { num: 90, den: 1 },
	})), /sample position.*already exists/u);
	assert.throws(() => apply(project, createUpdateTempoEventCommand('tempo-third', {
		beat: { num: 8, den: 1 },
	})), /sample-locked.*beat/u);
	assert.throws(() => apply(project, {
		type: 'tempo-event/add',
		event: { id: 'tempo-missing-sample', bpm: { num: 90, den: 1 } },
	} as AudioEditorCommand), /samplePosition/u);

	project = apply(project, createSetTempoMapModeCommand('musical'));
	assert.equal(project.tempoMap.mode, 'musical');
	assert.equal(tempoEvents(project).some((event) => Object.hasOwn(event, 'samplePosition')), false);
});

test('signature CRUD preserves stable identity, bar ordering, and legacy first-signature projection', () => {
	let project = createCurrentAudioEditorProject({ id: 'signature-crud', now: CREATED_AT });
	project = apply(project, createAddSignatureEventCommand({
		id: 'signature-outro', bar: 12, numerator: 5, denominator: 4,
	}));
	project = apply(project, createAddSignatureEventCommand({
		id: 'signature-middle', bar: 4, numerator: 7, denominator: 8,
	}));
	assert.deepEqual(signatureEvents(project).map(({ id, bar }) => ({ id, bar })), [
		{ id: 'signature-1', bar: 0 },
		{ id: 'signature-middle', bar: 4 },
		{ id: 'signature-outro', bar: 12 },
	]);

	project = apply(project, createUpdateSignatureEventCommand('signature-outro', {
		bar: 8, numerator: 3, denominator: 2,
	}));
	assert.deepEqual(signatureEvents(project)[2], {
		id: 'signature-outro', bar: 8, numerator: 3, denominator: 2,
	});
	assert.throws(() => apply(project, createAddSignatureEventCommand({
		id: 'signature-middle', bar: 16, numerator: 4, denominator: 4,
	})), /signature event ID.*already exists/u);
	assert.throws(() => apply(project, createUpdateSignatureEventCommand('signature-outro', { bar: 4 })), /signature event bar.*already exists/u);
	assert.throws(() => apply(project, createUpdateSignatureEventCommand('signature-outro', { denominator: 3 })), /power of two/u);
	assert.throws(() => apply(project, createRemoveSignatureEventCommand('signature-1')), /bar zero.*cannot be removed/u);

	project = apply(project, createUpdateSignatureEventCommand('signature-1', { numerator: 9, denominator: 8 }));
	assert.deepEqual(legacyTempo(project).timeSignature, { numerator: 9, denominator: 8 });
	project = apply(project, createRemoveSignatureEventCommand('signature-middle'));
	assert.deepEqual(signatureEvents(project).map(({ id }) => id), ['signature-1', 'signature-outro']);
});

test('legacy tempo/set updates authoritative map roots and re-derives sample-locked beats', () => {
	let project = createCurrentAudioEditorProject({
		id: 'legacy-tempo-command', now: CREATED_AT, sampleRate: 48_000,
		tempoMap: { mode: 'sampleLocked', events: [
			{ id: 'tempo-root', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 }, samplePosition: 0 },
			{ id: 'tempo-next', beat: { num: 4, den: 1 }, bpm: { num: 90, den: 1 }, samplePosition: 96_000 },
		] },
	});
	project = apply(project, { type: 'tempo/set', bpm: 137.5, numerator: 7, denominator: 8 });
	assert.deepEqual(tempoEvents(project)[0]?.bpm, { num: 275, den: 2 });
	assert.deepEqual(tempoEvents(project)[1]?.beat, { num: 55, den: 12 });
	assert.deepEqual(signatureEvents(project)[0], {
		id: 'signature-1', bar: 0, numerator: 7, denominator: 8,
	});
	assert.equal(legacyTempo(project).bpm, 137.5);
	assert.deepEqual(legacyTempo(project).timeSignature, { numerator: 7, denominator: 8 });
});

test('tempo commands reflow musical material, preserve sample anchors, and undo atomically', () => {
	const project = reflowProject();
	const before = resolveRuntimeProjectProjection(project);
	assert.deepEqual(runtimeStarts(before), { musical: 96_000, sample: 12_000, label: 96_000 });

	let history = createEditorHistory(project);
	history = executeEditorCommand(history, createUpdateTempoEventCommand('tempo-root', {
		bpm: { num: 60, den: 1 },
	}), { now: EDITED_AT });
	const edited = history.present as AudioEditorProjectCurrent;
	assert.deepEqual(tempoEvents(edited)[0]?.bpm, { num: 60, den: 1 });
	assert.deepEqual(runtimeStarts(resolveRuntimeProjectProjection(edited)), {
		musical: 192_000, sample: 12_000, label: 192_000,
	});
	assert.deepEqual(recordById(edited.clips, 'musical-clip').musicalStartBeat, { num: 4, den: 1 });

	history = undoEditorCommand(history, { now: UNDONE_AT });
	const restored = history.present as AudioEditorProjectCurrent;
	assert.deepEqual(tempoEvents(restored)[0]?.bpm, { num: 120, den: 1 });
	assert.deepEqual(runtimeStarts(resolveRuntimeProjectProjection(restored)), {
		musical: 96_000, sample: 12_000, label: 96_000,
	});
});

function reflowProject(): AudioEditorProjectCurrent {
	const tempoMap = { mode: 'musical', events: [
		{ id: 'tempo-root', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
	] } as const;
	const source = createAudioSource({
		id: 'source', storageKey: 'source', name: 'Audio', mimeType: 'audio/wav',
		frameCount: 480_000, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
	});
	const musical = createAudioClip({
		id: 'musical-clip', sourceId: 'source', anchor: 'musical',
		musicalStartBeat: { num: 4, den: 1 }, musicalExtent: 'fixedSamples',
		durationFrames: 24_000, sourceStartFrame: 0, sourceDurationFrames: 24_000,
	}, { projectSampleRate: 48_000, tempoMap });
	const sample = createAudioClip({
		id: 'sample-clip', sourceId: 'source', anchor: 'sample', timelineStartFrame: 12_000,
		durationFrames: 24_000, sourceStartFrame: 24_000, sourceDurationFrames: 24_000,
	});
	const label = createLabel({
		id: 'musical-label', title: 'Cue', color: 'violet', opaqueExtensions: {}, anchor: 'musical',
		startBeat: { num: 4, den: 1 }, endBeat: { num: 5, den: 1 },
	});
	return createCurrentAudioEditorProject({
		id: 'tempo-reflow', now: CREATED_AT, sampleRate: 48_000, tempoMap,
		sources: [source], clips: [musical, sample], tracks: [
			createAudioTrack({ id: 'audio-track', clipIds: ['musical-clip', 'sample-clip'] }),
			createLabelTrack({ id: 'label-track', labels: [label] }),
		],
	});
}

function apply(project: AudioEditorProjectCurrent, command: AudioEditorCommand): AudioEditorProjectCurrent {
	return applyEditorCommand(project, command, { now: EDITED_AT }) as AudioEditorProjectCurrent;
}

function tempoEvents(project: AudioEditorProjectCurrent): readonly Readonly<Record<string, unknown>>[] {
	return project.tempoMap.events as unknown as readonly Readonly<Record<string, unknown>>[];
}

function signatureEvents(project: AudioEditorProjectCurrent): readonly Readonly<Record<string, unknown>>[] {
	return project.signatureMap.events as readonly Readonly<Record<string, unknown>>[];
}

function legacyTempo(project: AudioEditorProjectCurrent): Readonly<Record<string, unknown>> {
	return project.tempo as Readonly<Record<string, unknown>>;
}

function runtimeStarts(project: Readonly<Record<string, unknown>>): Readonly<Record<string, number>> {
	const clips = project.clips as readonly Readonly<Record<string, unknown>>[];
	const tracks = project.tracks as readonly Readonly<Record<string, unknown>>[];
	const labels = tracks.find(({ id }) => id === 'label-track')?.labels as readonly Readonly<Record<string, unknown>>[];
	return {
		musical: Number(recordById(clips, 'musical-clip').timelineStartFrame),
		sample: Number(recordById(clips, 'sample-clip').timelineStartFrame),
		label: Number(recordById(labels, 'musical-label').startFrame),
	};
}

function recordById(
	values: readonly Readonly<Record<string, unknown>>[],
	id: string,
): Readonly<Record<string, unknown>> {
	const value = values.find((candidate) => candidate.id === id);
	if (!value) throw new ReferenceError(`Missing fixture ${id}.`);
	return value;
}
