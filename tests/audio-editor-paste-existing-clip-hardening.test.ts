/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand, preparePasteCommand } from '../src/common/editor/commands.js';
import type { AudioEditorClipboard, AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	commitPasteIntoExistingClipCommand,
	type ExistingClipPasteDerivedSourcesPort,
} from '../src/common/editor/controller/edit/paste-existing-clip-service.ts';
import type {
	ControllerClip,
	ControllerProject,
	ControllerSource,
	DerivedSourceRecord,
} from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { projectForCommand } from '../src/common/editor/project-command-projection.ts';

const NOW = '2026-09-10T12:00:00.000Z';
type PasteCommand = Extract<AudioEditorCommand, { readonly type: 'clipboard/paste' }>;

function source(id: string, frameCount: number, sampleRate = 48_000): ControllerSource {
	return {
		id, storageKey: id, name: id, mimeType: 'audio/wav', frameCount,
		channelCount: 1, sampleRate, originalSampleRate: sampleRate,
	};
}

function clip(id: string, timelineStartFrame: number, durationFrames: number): ControllerClip {
	return {
		id, sourceId: 'existing-source', timelineStartFrame,
		sourceStartFrame: 0, sourceDurationFrames: durationFrames, durationFrames,
	};
}

function controllerProject(options: Readonly<{
	readonly existing?: Partial<ControllerClip>;
	readonly neighbors?: readonly ControllerClip[];
	readonly pasteSampleRate?: number;
}> = {}): ControllerProject {
	const existing = {
		...clip('existing', 10, 4), sourceStartFrame: 2,
		...options.existing,
	};
	const clips = [existing, ...(options.neighbors ?? [])];
	return {
		schemaVersion: 17, id: 'project', title: 'Project', sampleRate: 48_000,
		sources: [source('existing-source', 8), source('paste-source', 2, options.pasteSampleRate)],
		tracks: [{ id: 'track', name: 'Track', type: 'audio', clipIds: clips.map(({ id }) => id) }],
		clips,
		mixer: { groups: [], sends: [], routes: {} },
	};
}

function clipboard(
	clipChanges: Readonly<Record<string, unknown>> = {},
	options: Readonly<{ sampleRate?: number; durationFrames?: number }> = {},
): AudioEditorClipboard {
	return {
		schemaVersion: 2,
		sampleRate: options.sampleRate ?? 48_000,
		durationFrames: options.durationFrames ?? 2,
		tracks: [{
			sourceTrackId: 'copied', sourceTrackName: 'Copied', sourceTrackType: 'audio',
			clips: [{
				key: 'copied:clip', kind: 'audio', sourceId: 'paste-source',
				offsetFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 2, durationFrames: 2,
				...clipChanges,
			}],
		}],
	};
}

function paste(descriptor = clipboard(), mode: 'overlap' | 'insert-track' = 'overlap'): PasteCommand {
	return {
		type: 'clipboard/paste', clipboard: descriptor, atFrame: 12, mode,
		pasteIntoExistingClip: true, trackMap: { copied: 'track' },
		clipIds: { 'copied:clip': 'pasted' }, collisionClipIds: ['existing'],
		collisionTrackIds: ['track'], splitClipIds: { existing: 'right' },
	};
}

function request(command: AudioEditorCommand, project = controllerProject()) {
	const commits: AudioEditorCommand[] = [];
	const events: string[] = [];
	const persisted: DerivedSourceRecord[] = [];
	const channels = {
		'existing-source': [Float32Array.of(0, 0, 1, 2, 3, 4, 0, 0)],
		'paste-source': [Float32Array.of(9, 8)],
	};
	const derivedSources: ExistingClipPasteDerivedSourcesPort = {
		sourceChannelsForEdit(value) {
			events.push(`load:${value.id}`);
			return Promise.resolve(channels[value.id as keyof typeof channels].map((channel) => channel.slice()));
		},
		persistDerivedSource(template, output, name) {
			events.push('persist');
			const record: DerivedSourceRecord = {
				source: { ...template, id: 'joined-source', storageKey: 'joined-source', name, frameCount: output[0]!.length },
				buffer: null, channels: output.map((channel) => channel.slice()),
			};
			persisted.push(record);
			return Promise.resolve(record);
		},
		rollbackDerivedSources: () => Promise.resolve(),
	};
	return {
		commits, events, persisted,
		input: {
			command, project, derivedSources,
			preflightStorage: () => Promise.resolve(),
			assertCurrent: () => undefined,
			commit: (prepared: AudioEditorCommand) => { commits.push(prepared); return 'committed'; },
		},
	};
}

async function expectFallback(command: AudioEditorCommand, project = controllerProject()): Promise<void> {
	const fixture = request(command, project);
	assert.equal(await commitPasteIntoExistingClipCommand(fixture.input), 'committed');
	assert.equal(fixture.commits[0], command);
	assert.deepEqual(fixture.events, []);
}

test('selected silence keeps the complete overlap and insert span', async () => {
	const selected = { ...clipboard(), durationFrames: 4 };
	await expectFallback(paste(clipboard(
		{ durationFrames: 1, sourceDurationFrames: 1 },
		{ sampleRate: 96_000, durationFrames: 2 },
	)));
	for (const mode of ['overlap', 'insert-track'] as const) {
		const document = currentProject(mode === 'overlap' ? 15 : 20, mode === 'overlap' ? 3 : 2);
		const projected = projectForCommand(document as unknown as Record<string, unknown>) as unknown as ControllerProject;
		let sequence = 0;
		const command = preparePasteCommand(selected, {
			atFrame: 12, mode, pasteAsNewClip: false, project: projected, trackMap: { copied: 'track' },
		}, (prefix) => `${prefix}-${mode}-${String(++sequence)}`) as AudioEditorCommand;
		const fixture = request(command, projected);
		assert.equal(await commitPasteIntoExistingClipCommand(fixture.input), 'committed');
		assert.equal(fixture.commits[0], command);
		assert.equal(onlyPaste(command).clipboard.durationFrames, 4);
		const result = applyEditorCommand(document, command, { now: NOW });
		const later = result.clips.find(({ id }) => id === 'later');
		const inserted = result.clips.find(({ id }) => id !== 'existing' && id !== 'later');
		if (mode === 'overlap') {
			assert.deepEqual(inserted && {
				timelineStartFrame: inserted.timelineStartFrame, durationFrames: inserted.durationFrames,
			}, { timelineStartFrame: 12, durationFrames: 2 });
			assert.equal(later?.timelineStartFrame, 15);
		} else assert.equal(later?.timelineStartFrame, 24);
	}
});

test('cross-rate fades and envelopes fall back while gain and reversal remain joinable', async () => {
	const project = controllerProject({ pasteSampleRate: 24_000 });
	for (const processing of [
		{ fadeInFrames: 1 }, { fadeOutFrames: 1 }, { envelope: [{ frame: 1, value: 0.5 }] },
	]) await expectFallback(paste(clipboard(processing, { sampleRate: 24_000 })), project);
	const command = paste(clipboard({ gain: 0.5, reversed: true }, { sampleRate: 24_000 }));
	const fixture = request(command, project);
	await commitPasteIntoExistingClipCommand(fixture.input);
	assert.notEqual(fixture.commits[0], command);
	assert.deepEqual(Array.from(fixture.persisted[0]?.channels?.[0] ?? []), [1, 2, 4, 4, 4.5, 4.5, 3, 4]);
});

test('grouped descriptors and trimmed destinations remain separate clips', async () => {
	const grouped = paste(clipboard({ groupId: 'copied-group' }));
	await expectFallback({ ...grouped, groupIds: { 'copied-group': 'pasted-group' } });
	for (const trim of [{ trimStartFrames: 1 }, { trimEndFrames: 1 }]) {
		await expectFallback(paste(), controllerProject({ existing: trim }));
	}
});

test('ambiguous and overlapping destination geometry refuses both join modes', async () => {
	for (const neighbor of [clip('containing', 11, 2), clip('tail-neighbor', 13, 2)]) {
		for (const mode of ['overlap', 'insert-track'] as const) {
			await expectFallback(paste(clipboard(), mode), controllerProject({ neighbors: [neighbor] }));
		}
	}
});

test('current-schema sequence maps retain only remaining track and annotation owners', async () => {
	for (const withAnnotation of [false, true]) {
		const document = currentProject();
		const projected = projectForCommand(document as unknown as Record<string, unknown>) as unknown as ControllerProject;
		const base = clipboard();
		const descriptor: AudioEditorClipboard = {
			...base, schemaVersion: 4,
			tracks: base.tracks.map((track) => ({ ...track, sourceSequenceId: 'copied-sequence' })),
			annotations: withAnnotation ? [{
				key: 'marker', sourceSequenceId: 'copied-sequence', name: 'Marker', color: 'auto',
				batchId: null, opaqueExtensions: {}, kind: 'marker', anchor: 'sample', positionOffsetFrame: 1,
			}] : [],
			takeGroups: [],
		};
		let sequence = 0;
		const command = preparePasteCommand(descriptor, {
			atFrame: 12, mode: 'overlap', pasteAsNewClip: false,
			project: projected, trackMap: { copied: 'track' },
		}, (prefix) => `${prefix}-${String(++sequence)}`) as AudioEditorCommand;
		const fixture = request(command, projected);
		await commitPasteIntoExistingClipCommand(fixture.input);
		const rewritten = onlyPaste(fixture.commits[0]!);
		assert.deepEqual(rewritten.sequenceMap, withAnnotation ? onlyPaste(command).sequenceMap : {});
		assert.equal(applyEditorCommand(document, fixture.commits[0]!, { now: NOW }).revision, document.revision + 1);
	}
});

function onlyPaste(command: AudioEditorCommand): PasteCommand {
	if (command.type === 'clipboard/paste') return command;
	if (command.type === 'batch') {
		for (const child of command.commands) {
			try { return onlyPaste(child); } catch { /* keep searching */ }
		}
	}
	throw new Error('Missing clipboard/paste command.');
}

function currentProject(laterStartFrame = 20, laterDurationFrames = 2) {
	const existingSource = createAudioSource({ id: 'existing-source', frameCount: 8, channelCount: 1 });
	const pastedSource = createAudioSource({ id: 'paste-source', frameCount: 2, channelCount: 1 });
	const context = {
		projectSampleRate: 48_000,
		tempoMap: { mode: 'musical' as const, events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
	};
	const existing = createAudioClip({
		id: 'existing', sourceId: existingSource.id, timelineStartFrame: 10,
		sourceStartFrame: 2, sourceDurationFrames: 4, durationFrames: 4,
	}, context);
	const later = createAudioClip({
		id: 'later', sourceId: existingSource.id, timelineStartFrame: laterStartFrame,
		sourceStartFrame: 0, sourceDurationFrames: laterDurationFrames, durationFrames: laterDurationFrames,
	}, context);
	return createCurrentAudioEditorProject({
		id: 'project', now: NOW, sampleRate: 48_000,
		sources: [existingSource, pastedSource], clips: [existing, later],
		tracks: [createAudioTrack({ id: 'track', clipIds: [existing.id, later.id] }, 48_000)],
		sequences: [{ id: 'sequence', name: 'Sequence', rate: { num: 24, den: 1 }, trackIds: ['track'] }],
		primarySequenceId: 'sequence',
	});
}
