/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import type {
	AudioEditorClipboard,
	AudioEditorCommand,
} from '../src/common/editor/commands/protocol.ts';
import {
	commitPasteIntoExistingClipCommand,
	type ExistingClipPasteDerivedSourcesPort,
} from '../src/common/editor/controller/edit/paste-existing-clip-service.ts';
import type {
	ControllerProject,
	ControllerSource,
	DerivedSourceRecord,
} from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { projectForCommand } from '../src/common/editor/project-command-projection.ts';

const NOW = '2026-09-10T12:00:00.000Z';

function source(id: string, frameCount: number, channelCount = 1): ControllerSource {
	return {
		id,
		storageKey: id,
		name: id,
		mimeType: 'audio/wav',
		frameCount,
		channelCount,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
	};
}

function project(options: Readonly<{
	readonly secondTrack?: boolean;
	readonly laterClip?: boolean;
}> = {}): ControllerProject {
	const sources = [source('existing-source', 8), source('paste-source', 2)];
	const clips = [
		{
			id: 'existing', sourceId: 'existing-source', timelineStartFrame: 10,
			sourceStartFrame: 2, sourceDurationFrames: 4, durationFrames: 4,
		},
		...(options.laterClip ? [{
			id: 'later', sourceId: 'existing-source', timelineStartFrame: 20,
			sourceStartFrame: 0, sourceDurationFrames: 2, durationFrames: 2,
		}] : []),
		...(options.secondTrack ? [{
			id: 'existing-two', sourceId: 'existing-source', timelineStartFrame: 10,
			sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4,
		}] : []),
	];
	return {
		schemaVersion: 17,
		id: 'project',
		title: 'Project',
		sampleRate: 48_000,
		sources,
		tracks: [
			{ id: 'track', name: 'Track', type: 'audio', clipIds: options.laterClip ? ['existing', 'later'] : ['existing'] },
			...(options.secondTrack
				? [{ id: 'track-two', name: 'Track two', type: 'audio' as const, clipIds: ['existing-two'] }]
				: []),
		],
		clips,
		mixer: { groups: [], sends: [], routes: {} },
	};
}

function clipboard(tracks: readonly Readonly<{
	readonly sourceTrackId: string;
	readonly sourceId?: string;
}>[] = [{ sourceTrackId: 'copied' }]): AudioEditorClipboard {
	return {
		schemaVersion: 2,
		sampleRate: 48_000,
		durationFrames: 2,
		tracks: tracks.map(({ sourceTrackId, sourceId = 'paste-source' }) => ({
			sourceTrackId,
			sourceTrackName: sourceTrackId,
			sourceTrackType: 'audio',
			clips: [{
				key: `${sourceTrackId}:clip`, kind: 'audio', sourceId,
				offsetFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 2,
				durationFrames: 2,
			}],
		})),
	};
}

function paste(
	descriptor = clipboard(),
	trackMap: Readonly<Record<string, string>> = { copied: 'track' },
	atFrame = 12,
): Extract<AudioEditorCommand, { readonly type: 'clipboard/paste' }> {
	return {
		type: 'clipboard/paste',
		clipboard: descriptor,
		atFrame,
		trackMap,
		clipIds: Object.fromEntries(descriptor.tracks.flatMap((track) => (
			track.clips.map((clip) => [String(clip.key), `pasted-${track.sourceTrackId}`])
		))),
		mode: 'overlap',
		pasteIntoExistingClip: true,
		collisionClipIds: ['existing'],
		collisionTrackIds: ['track'],
		splitClipIds: { existing: 'right' },
	};
}

interface DerivedFixture {
	readonly port: ExistingClipPasteDerivedSourcesPort;
	readonly events: string[];
	readonly persisted: DerivedSourceRecord[];
	readonly rollbacks: Array<readonly Pick<DerivedSourceRecord, 'source'>[]>;
}

function derivedFixture(overrides: Partial<ExistingClipPasteDerivedSourcesPort> = {}): DerivedFixture {
	const channels: Readonly<Record<string, readonly Float32Array[]>> = {
		'existing-source': [Float32Array.of(0, 0, 1, 2, 3, 4, 0, 0)],
		'paste-source': [Float32Array.of(9, 8)],
		'mono-paste-source': [Float32Array.of(7, 6)],
	};
	const events: string[] = [];
	const persisted: DerivedSourceRecord[] = [];
	const rollbacks: Array<readonly Pick<DerivedSourceRecord, 'source'>[]> = [];
	const port: ExistingClipPasteDerivedSourcesPort = {
		async sourceChannelsForEdit(value) {
			events.push(`load:${value.id}`);
			const result = channels[value.id];
			if (!result) throw new Error(`Missing fixture channels for ${value.id}.`);
			return result.map((channel) => channel.slice());
		},
		async persistDerivedSource(template, output, name, prefix) {
			events.push(`persist:${template.id}:${String(prefix)}`);
			const id = persisted.length === 0 ? 'joined-source' : `joined-source-${persisted.length + 1}`;
			const record: DerivedSourceRecord = {
				source: { ...template, id, storageKey: id, name, frameCount: output[0]!.length },
				buffer: null,
				channels: output.map((channel) => channel.slice()),
			};
			persisted.push(record);
			return record;
		},
		async rollbackDerivedSources(records) {
			events.push(`rollback:${records.map(({ source: value }) => value.id).join(',')}`);
			rollbacks.push(records);
		},
		...overrides,
	};
	return { port, events, persisted, rollbacks };
}

function request(
	command: AudioEditorCommand,
	value = project(),
	overrides: Readonly<Record<string, unknown>> = {},
	derivedOverrides: Partial<ExistingClipPasteDerivedSourcesPort> = {},
) {
	const derived = derivedFixture(derivedOverrides);
	const commits: AudioEditorCommand[] = [];
	const preflights: number[] = [];
	return {
		derived,
		commits,
		preflights,
		input: {
			command,
			project: value,
			derivedSources: derived.port,
			preflightStorage: async (bytes: number) => { preflights.push(bytes); },
			assertCurrent: () => undefined,
			commit: (prepared: AudioEditorCommand) => {
				commits.push(prepared);
				return 'committed';
			},
			...overrides,
		},
	};
}

test('a different-source paste in the middle renders one extended existing clip', async () => {
	const fixture = request(paste(), project({ laterClip: true }));
	const result = await commitPasteIntoExistingClipCommand(fixture.input);

	assert.equal(result, 'committed');
	assert.deepEqual(fixture.preflights, [6 * Float32Array.BYTES_PER_ELEMENT]);
	assert.deepEqual(Array.from(fixture.derived.persisted[0]?.channels?.[0] ?? []), [1, 2, 9, 8, 3, 4]);
	assert.deepEqual(fixture.derived.events, [
		'load:existing-source', 'load:paste-source',
		'persist:existing-source:joined-paste-source',
	]);
	const prepared = fixture.commits[0];
	assert.ok(prepared);
	const replacement = commandsOfType(prepared, 'clip/render-replace-many')[0];
	assert.equal(replacement?.entries[0]?.clipId, 'existing');
	assert.equal(replacement?.entries[0]?.source.id, 'joined-source');
	const rewrittenPaste = commandsOfType(prepared, 'clipboard/paste')[0];
	assert.deepEqual(rewrittenPaste?.clipboard.tracks, []);
	assert.deepEqual(rewrittenPaste?.collisionClipIds, []);
	assert.deepEqual(rewrittenPaste?.collisionTrackIds, []);
});

test('the prepared batch atomically extends the clip without moving later nonoverlapping material', async () => {
	const document = currentProject();
	const fixture = request(
		paste(),
		projectForCommand(document as unknown as Record<string, unknown>) as unknown as ControllerProject,
	);
	await commitPasteIntoExistingClipCommand(fixture.input);
	const result = applyEditorCommand(document, fixture.commits[0]!, { now: NOW });

	assert.deepEqual(result.tracks[0]?.clipIds, ['existing', 'later']);
	assert.deepEqual(result.clips.map(({ id, sourceId, timelineStartFrame, durationFrames }) => ({
		id, sourceId, timelineStartFrame, durationFrames,
		})), [
			{ id: 'existing', sourceId: 'joined-source', timelineStartFrame: 10, durationFrames: 6 },
			{ id: 'later', sourceId: 'existing-source', timelineStartFrame: 20, durationFrames: 2 },
		]);
	assert.ok(result.sources.some(({ id }) => id === 'joined-source'));
});

test('an insert-track join still ripples later material by the inserted duration', async () => {
	const document = currentProject();
	const fixture = request(
		{ ...paste(), mode: 'insert-track' },
		projectForCommand(document as unknown as Record<string, unknown>) as unknown as ControllerProject,
	);
	await commitPasteIntoExistingClipCommand(fixture.input);
	const prepared = fixture.commits[0]!;
	const result = applyEditorCommand(document, prepared, { now: NOW });

	assert.equal(commandsOfType(prepared, 'clip/render-replace-many')[0]?.rippleMode, 'track');
	assert.deepEqual(result.clips.map(({ id, timelineStartFrame, durationFrames }) => ({
		id, timelineStartFrame, durationFrames,
	})), [
		{ id: 'existing', timelineStartFrame: 10, durationFrames: 6 },
		{ id: 'later', timelineStartFrame: 22, durationFrames: 2 },
	]);
});

test('extending a joined clip trims only material that collides with its new tail', async () => {
	const document = currentProject({ laterStartFrame: 15, laterDurationFrames: 3 });
	const fixture = request(
		paste(),
		projectForCommand(document as unknown as Record<string, unknown>) as unknown as ControllerProject,
	);
	await commitPasteIntoExistingClipCommand(fixture.input);
	const result = applyEditorCommand(document, fixture.commits[0]!, { now: NOW });

	assert.deepEqual(result.clips.map(({
		id, sourceId, timelineStartFrame, sourceStartFrame, durationFrames,
	}) => ({ id, sourceId, timelineStartFrame, sourceStartFrame, durationFrames })), [
		{
			id: 'existing', sourceId: 'joined-source', timelineStartFrame: 10,
			sourceStartFrame: 0, durationFrames: 6,
		},
		{
			id: 'later', sourceId: 'existing-source', timelineStartFrame: 16,
			sourceStartFrame: 1, durationFrames: 2,
		},
	]);
});

test('an overlap join falls back when clearing its extended tail would break a clip group', () => {
	const base = project({ laterClip: true });
	const groupedCollision: ControllerProject = {
		...base,
		clips: base.clips.map((clip) => clip.id === 'later' ? {
			...clip,
			timelineStartFrame: 15,
			durationFrames: 3,
			sourceDurationFrames: 3,
			groupId: 'later-group',
		} : clip),
	};
	const command = paste();
	const fixture = request(command, groupedCollision);
	const result = commitPasteIntoExistingClipCommand(fixture.input);

	assert.equal(result, 'committed');
	assert.equal(fixture.commits[0], command);
	assert.deepEqual(fixture.derived.events, []);
});

test('pasting at an existing clip start prepends the copied interval', async () => {
	const fixture = request(paste(clipboard(), { copied: 'track' }, 10));
	await commitPasteIntoExistingClipCommand(fixture.input);

	assert.deepEqual(Array.from(fixture.derived.persisted[0]?.channels?.[0] ?? []), [9, 8, 1, 2, 3, 4]);
});

test('a time-range clipboard joins one interval into each mapped destination track', async () => {
	const descriptor = clipboard([{ sourceTrackId: 'one' }, { sourceTrackId: 'two' }]);
	const command = paste(descriptor, { one: 'track', two: 'track-two' });
	const fixture = request(command, project({ secondTrack: true }));
	const result = await commitPasteIntoExistingClipCommand(fixture.input);

	assert.equal(result, 'committed');
	assert.deepEqual(fixture.preflights, [12 * Float32Array.BYTES_PER_ELEMENT]);
	assert.deepEqual(fixture.derived.persisted.map(({ channels }) => Array.from(channels?.[0] ?? [])), [
		[1, 2, 9, 8, 3, 4],
		[0, 0, 9, 8, 1, 2],
	]);
	const prepared = fixture.commits[0]!;
	assert.deepEqual(commandsOfType(prepared, 'clip/render-replace-many')[0]?.entries.map((entry) => ({
		clipId: entry.clipId,
		sourceId: entry.source.id,
	})), [
		{ clipId: 'existing', sourceId: 'joined-source' },
		{ clipId: 'existing-two', sourceId: 'joined-source-2' },
	]);
	assert.deepEqual(commandsOfType(prepared, 'clipboard/paste')[0]?.clipboard.tracks, []);
});

test('a clipboard with multiple intervals on one track conservatively keeps separate clips', async () => {
	const one = clipboard();
	const firstTrack = one.tracks[0]!;
	const firstClip = firstTrack.clips[0]!;
	const descriptor: AudioEditorClipboard = {
		...one,
		durationFrames: 6,
		tracks: [{
			...firstTrack,
			clips: [firstClip, { ...firstClip, key: 'copied:second', offsetFrame: 4 }],
		}],
	};
	const command = paste(descriptor);
	const fixture = request(command);
	const result = commitPasteIntoExistingClipCommand(fixture.input);

	assert.equal(result, 'committed');
	assert.equal(fixture.commits[0], command);
	assert.deepEqual(fixture.derived.events, []);
	assert.equal(await result, 'committed');
});

test('a mono-converted source/add is available to the join and remains in the atomic command', async () => {
	const mono = source('mono-paste-source', 2);
	const command: AudioEditorCommand = {
		type: 'batch',
		commands: [
			{ type: 'source/add', source: mono },
			paste(clipboard([{ sourceTrackId: 'copied', sourceId: mono.id }])),
		],
	};
	const fixture = request(command);
	await commitPasteIntoExistingClipCommand(fixture.input);

	assert.deepEqual(Array.from(fixture.derived.persisted[0]?.channels?.[0] ?? []), [1, 2, 7, 6, 3, 4]);
	assert.equal(commandsOfType(fixture.commits[0]!, 'source/add')[0]?.source.id, mono.id);
});

test('a final atomic commit failure rolls the joined source back', async () => {
	const failure = new Error('commit failed');
	const fixture = request(paste(), project(), {
		commit: () => { throw failure; },
	});

	await assert.rejects(async () => {
		await commitPasteIntoExistingClipCommand(fixture.input);
	}, (error: unknown) => error === failure);
	assert.deepEqual(fixture.derived.events, [
		'load:existing-source', 'load:paste-source',
		'persist:existing-source:joined-paste-source', 'rollback:joined-source',
	]);
	assert.equal(fixture.derived.rollbacks[0]?.[0], fixture.derived.persisted[0]);
});

test('a later multi-track persistence failure rolls every completed joined source back', async () => {
	const failure = new Error('second persistence failed');
	let persistenceCount = 0;
	let firstRecord: DerivedSourceRecord | null = null;
	const descriptor = clipboard([{ sourceTrackId: 'one' }, { sourceTrackId: 'two' }]);
	const fixture = request(
		paste(descriptor, { one: 'track', two: 'track-two' }),
		project({ secondTrack: true }),
		{},
		{
			async persistDerivedSource(template, output, name) {
				persistenceCount += 1;
				if (persistenceCount === 2) throw failure;
				firstRecord = {
					source: {
						...template,
						id: 'first-joined-source', storageKey: 'first-joined-source', name,
						frameCount: output[0]!.length,
					},
					buffer: null,
					channels: output.map((channel) => channel.slice()),
				};
				return firstRecord;
			},
		},
	);

	await assert.rejects(async () => {
		await commitPasteIntoExistingClipCommand(fixture.input);
	}, (error: unknown) => error === failure);
	assert.equal(fixture.derived.rollbacks.length, 1);
	assert.equal(fixture.derived.rollbacks[0]?.[0], firstRecord);
	assert.deepEqual(fixture.commits, []);
});

test('storage refusal happens before PCM is loaded or persisted', async () => {
	const failure = new Error('capacity refused');
	const fixture = request(paste(), project(), {
		preflightStorage: async () => { throw failure; },
	});

	await assert.rejects(async () => {
		await commitPasteIntoExistingClipCommand(fixture.input);
	}, (error: unknown) => error === failure);
	assert.deepEqual(fixture.derived.events, []);
	assert.deepEqual(fixture.commits, []);
});

type CommandType = AudioEditorCommand['type'];
type CommandOfType<Type extends CommandType> = Extract<AudioEditorCommand, { readonly type: Type }>;

function commandsOfType<Type extends CommandType>(
	command: AudioEditorCommand,
	type: Type,
): CommandOfType<Type>[] {
	const result: CommandOfType<Type>[] = [];
	visit(command);
	return result;

	function visit(candidate: AudioEditorCommand): void {
		if (candidate.type === type) result.push(candidate as CommandOfType<Type>);
		if (candidate.type === 'batch') candidate.commands.forEach(visit);
	}
}

function currentProject(options: Readonly<{
	readonly laterStartFrame?: number;
	readonly laterDurationFrames?: number;
}> = {}) {
	const existingSource = createAudioSource({
		id: 'existing-source', frameCount: 8, channelCount: 1,
		sampleRate: 48_000, originalSampleRate: 48_000,
	});
	const pastedSource = createAudioSource({
		id: 'paste-source', frameCount: 2, channelCount: 1,
		sampleRate: 48_000, originalSampleRate: 48_000,
	});
	const context = {
		projectSampleRate: 48_000,
		tempoMap: {
			mode: 'musical' as const,
			events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
		},
	};
	const existing = createAudioClip({
		id: 'existing', sourceId: existingSource.id, timelineStartFrame: 10,
		sourceStartFrame: 2, sourceDurationFrames: 4, durationFrames: 4,
	}, context);
	const later = createAudioClip({
		id: 'later', sourceId: existingSource.id,
		sourceStartFrame: 0,
		sourceDurationFrames: options.laterDurationFrames ?? 2,
		durationFrames: options.laterDurationFrames ?? 2,
		timelineStartFrame: options.laterStartFrame ?? 20,
	}, context);
	return createCurrentAudioEditorProject({
		id: 'project', now: NOW, sampleRate: 48_000,
		sources: [existingSource, pastedSource],
		clips: [existing, later],
		tracks: [createAudioTrack({ id: 'track', clipIds: [existing.id, later.id] }, 48_000)],
	});
}
