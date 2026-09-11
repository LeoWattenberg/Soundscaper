/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	commitMonoConvertingPasteCommand,
	prepareMonoConvertingPasteCommand,
	type PasteMonoDerivedSourcesPort,
} from '../src/common/editor/controller/edit/paste-mono-conversion-service.ts';
import type {
	AudioEditorClipboard,
	AudioEditorCommand,
} from '../src/common/editor/commands/protocol.ts';
import type {
	ControllerProject,
	ControllerSource,
	DerivedSourceRecord,
} from '../src/common/editor/controller/track-audio/track-domain-types.ts';

function source(id: string, channelCount: number, frameCount = 4): ControllerSource {
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

function project(sources: readonly ControllerSource[]): ControllerProject {
	return {
		schemaVersion: 2,
		id: 'project',
		title: 'Project',
		sampleRate: 48_000,
		sources,
		tracks: [
			{ id: 'mono-a', name: 'Mono A', type: 'audio', clipIds: ['mono-clip-a'] },
			{ id: 'mono-b', name: 'Mono B', type: 'audio', clipIds: ['mono-clip-b'] },
			{ id: 'empty', name: 'Empty', type: 'audio', clipIds: [] },
		],
		clips: [
			{
				id: 'mono-clip-a', sourceId: 'mono', timelineStartFrame: 0,
				sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4,
			},
			{
				id: 'mono-clip-b', sourceId: 'mono', timelineStartFrame: 0,
				sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4,
			},
		],
		mixer: { groups: [], sends: [], routes: {} },
	};
}

function clipboard(
	tracks: readonly Readonly<{
		readonly id: string;
		readonly sourceIds: readonly string[];
	}>[] = [{ id: 'copied', sourceIds: ['stereo'] }],
): AudioEditorClipboard {
	return {
		schemaVersion: 2,
		sampleRate: 48_000,
		durationFrames: 4,
		tracks: tracks.map(({ id, sourceIds }) => ({
			sourceTrackId: id,
			sourceTrackName: id,
			sourceTrackType: 'audio',
			clips: sourceIds.map((sourceId, index) => ({
				key: `${id}:${String(index)}`,
				kind: 'audio',
				sourceId,
				offsetFrame: index * 4,
				sourceStartFrame: 0,
				durationFrames: 4,
			})),
		})),
	};
}

function paste(
	descriptor = clipboard(),
	trackMap: Readonly<Record<string, string>> = { copied: 'mono-a' },
): Extract<AudioEditorCommand, { readonly type: 'clipboard/paste' }> {
	return {
		type: 'clipboard/paste',
		clipboard: descriptor,
		atFrame: 0,
		trackMap,
	};
}

interface DerivedFixture {
	readonly events: string[];
	readonly port: PasteMonoDerivedSourcesPort;
	readonly persisted: DerivedSourceRecord[];
	readonly rolledBack: Array<readonly DerivedSourceRecord[]>;
}

function derivedFixture(
	channels: Readonly<Record<string, readonly Float32Array[]>>,
	overrides: Partial<PasteMonoDerivedSourcesPort> = {},
): DerivedFixture {
	const events: string[] = [];
	const persisted: DerivedSourceRecord[] = [];
	const rolledBack: Array<readonly DerivedSourceRecord[]> = [];
	const port: PasteMonoDerivedSourcesPort = {
		async sourceChannelsForEdit(template) {
			events.push(`load:${template.id}`);
			const value = channels[template.id];
			if (!value) throw new Error(`No channels for ${template.id}.`);
			return value.map((channel) => channel.slice());
		},
		async persistDerivedSource(template, monoChannels) {
			events.push(`persist:${template.id}`);
			const id = `mono-${template.id}`;
			const record: DerivedSourceRecord = {
				source: { ...template, id, storageKey: id, channelCount: 1 },
				buffer: null,
				channels: monoChannels.map((channel) => channel.slice()),
			};
			persisted.push(record);
			return record;
		},
		async rollbackDerivedSources(records) {
			events.push(`rollback:${records.map(({ source: value }) => value.id).join(',')}`);
			rolledBack.push(records as readonly DerivedSourceRecord[]);
		},
		...overrides,
	};
	return { events, port, persisted, rolledBack };
}

test('a compatible paste is returned unchanged without invoking any async port', async () => {
	const command = paste(clipboard([{ id: 'copied', sourceIds: ['mono'] }]));
	const derived = derivedFixture({});
	const result = await prepareMonoConvertingPasteCommand({
		command,
		project: project([source('mono', 1)]),
		alwaysConvertToMono: false,
		confirmConversion: async () => { throw new Error('confirmation should not run'); },
		derivedSources: derived.port,
		preflightStorage: async () => { throw new Error('preflight should not run'); },
		updateAlwaysConvertToMono: () => { throw new Error('preference update should not run'); },
	});

	assert.equal(result?.command, command);
	assert.deepEqual(result?.derivedRecords, []);
	assert.deepEqual(derived.events, []);
});

test('the commit owner preserves synchronous commits when conversion is unnecessary', async () => {
	const command = paste(clipboard([{ id: 'copied', sourceIds: ['mono'] }]));
	const derived = derivedFixture({});
	const events: string[] = [];
	const result = commitMonoConvertingPasteCommand({
		command,
		project: project([source('mono', 1)]),
		alwaysConvertToMono: false,
		confirmConversion: async () => { throw new Error('confirmation should not run'); },
		derivedSources: derived.port,
		preflightStorage: async () => { throw new Error('preflight should not run'); },
		updateAlwaysConvertToMono: () => { throw new Error('preference update should not run'); },
		assertCurrent: () => { events.push('current'); },
		commit: (value) => {
			events.push('commit');
			assert.equal(value, command);
			return 'committed';
		},
	});

	assert.equal(result, 'committed');
	assert.deepEqual(events, ['current', 'commit']);
	assert.deepEqual(derived.events, []);
	assert.equal(await result, 'committed');
});

test('declining confirmation cancels before preference or storage work', async () => {
	const derived = derivedFixture({});
	const calls: string[] = [];
	const result = await prepareMonoConvertingPasteCommand({
		command: paste(),
		project: project([source('mono', 1), source('stereo', 2)]),
		alwaysConvertToMono: false,
		confirmConversion: async (plan) => {
			calls.push(`confirm:${plan.targets[0]?.targetTrackId}`);
			return { accepted: false, dontShowAgain: true };
		},
		derivedSources: derived.port,
		preflightStorage: async () => { calls.push('preflight'); },
		updateAlwaysConvertToMono: () => { calls.push('preference'); },
	});

	assert.equal(result, null);
	assert.deepEqual(calls, ['confirm:mono-a']);
	assert.deepEqual(derived.events, []);
});

test('accepted nested cross-project paste persists each mono root once and rewrites atomically', async () => {
	const remote = source('remote', 2);
	const spare = source('spare', 1);
	const descriptor = clipboard([
		{ id: 'copied-a', sourceIds: ['remote', 'remote'] },
		{ id: 'copied-b', sourceIds: ['remote'] },
	]);
	const originalPaste = paste(descriptor, { 'copied-a': 'mono-a', 'copied-b': 'mono-b' });
	const command: AudioEditorCommand = {
		type: 'batch',
		commands: [{
			type: 'batch',
			commands: [
				{ type: 'source/add', source: remote },
				{ type: 'source/add', source: spare },
			],
		}, originalPaste, { type: 'project/rename', title: 'After paste' }],
	};
	const derived = derivedFixture({
		remote: [Float32Array.of(1, -1, 0.5, 0), Float32Array.of(-1, 1, 0.5, 1)],
	});
	const calls: string[] = [];
	const result = await prepareMonoConvertingPasteCommand({
		command,
		project: project([source('mono', 1)]),
		alwaysConvertToMono: false,
		confirmConversion: async () => {
			calls.push('confirm');
			return { accepted: true, dontShowAgain: true };
		},
		derivedSources: derived.port,
		preflightStorage: async (bytes, category) => { calls.push(`preflight:${String(bytes)}:${category}`); },
		updateAlwaysConvertToMono: async (value) => { calls.push(`preference:${String(value)}`); },
	});

	assert.ok(result);
	assert.deepEqual(calls, ['confirm', 'preference:true', 'preflight:16:effect']);
	assert.deepEqual(derived.events, ['load:remote', 'persist:remote']);
	assert.equal(result.derivedRecords.length, 1);
	assert.deepEqual(Array.from(result.derivedRecords[0]?.channels?.[0] ?? []), [0, 0, 0.5, 0.5]);
	assert.equal(result.command.type, 'batch');
	if (result.command.type !== 'batch') return;
	assert.equal(result.command.commands[0]?.type, 'source/add');
	assert.equal(
		result.command.commands[0]?.type === 'source/add' ? result.command.commands[0].source.id : null,
		'mono-remote',
	);
	assert.deepEqual(sourceAddIds(result.command), ['mono-remote', 'spare']);
	const rewrittenPaste = onlyPaste(result.command);
	assert.deepEqual(
		rewrittenPaste.clipboard.tracks.flatMap((track) => track.clips.map((clip) => clip.sourceId)),
		['mono-remote', 'mono-remote', 'mono-remote'],
	);
	assert.deepEqual(
		originalPaste.clipboard.tracks.flatMap((track) => track.clips.map((clip) => clip.sourceId)),
		['remote', 'remote', 'remote'],
	);
});

test('only affected tracks are rewritten and a transferred root still in use is retained', async () => {
	const remote = source('remote', 2);
	const command: AudioEditorCommand = {
		type: 'batch',
		commands: [
			{ type: 'source/add', source: remote },
			paste(clipboard([
				{ id: 'affected', sourceIds: ['remote'] },
				{ id: 'empty-target', sourceIds: ['remote'] },
			]), { affected: 'mono-a', 'empty-target': 'empty' }),
		],
	};
	const derived = derivedFixture({
		remote: [Float32Array.of(1, 0, 1, 0), Float32Array.of(0, 1, 0, 1)],
	});
	const result = await prepareMonoConvertingPasteCommand({
		command,
		project: project([source('mono', 1)]),
		alwaysConvertToMono: true,
		confirmConversion: async () => { throw new Error('confirmation should not run'); },
		derivedSources: derived.port,
		preflightStorage: async () => undefined,
		updateAlwaysConvertToMono: () => { throw new Error('preference update should not run'); },
	});

	assert.ok(result);
	assert.deepEqual(sourceAddIds(result.command), ['mono-remote', 'remote']);
	assert.deepEqual(
		onlyPaste(result.command).clipboard.tracks.map((track) => track.clips[0]?.sourceId),
		['mono-remote', 'remote'],
	);
});

test('a transferred source/add is retained while an unchanged take-group take still references it', async () => {
	const remote = source('remote', 2);
	const base = clipboard([{ id: 'affected', sourceIds: ['remote'] }]);
	const descriptor: AudioEditorClipboard = {
		...base,
		schemaVersion: 4,
		tracks: base.tracks.map((track) => ({ ...track, sourceSequenceId: 'sequence' })),
		takeGroups: [{
			key: 'take-group',
			sourceSequenceId: 'sequence',
			sourceTrackId: 'affected',
			startOffsetFrame: 0,
			endOffsetFrame: 4,
			laneOrder: ['lane'],
			lanes: [{ key: 'lane' }],
			takes: [{
				key: 'take', laneKey: 'lane', sourceId: 'remote',
				startOffsetFrame: 0, endOffsetFrame: 4, sourceStartFrame: 0,
			}],
			compRegions: [{ key: 'region', takeKey: 'take', startOffsetFrame: 0, endOffsetFrame: 4 }],
		}],
	};
	const derived = derivedFixture({
		remote: [Float32Array.of(1, 0, 1, 0), Float32Array.of(0, 1, 0, 1)],
	});
	const result = await prepareMonoConvertingPasteCommand({
		command: { type: 'batch', commands: [
			{ type: 'source/add', source: remote },
			paste(descriptor, { affected: 'mono-a' }),
		] },
		project: project([source('mono', 1)]),
		alwaysConvertToMono: true,
		confirmConversion: async () => { throw new Error('confirmation should not run'); },
		derivedSources: derived.port,
		preflightStorage: async () => undefined,
		updateAlwaysConvertToMono: () => undefined,
	});

	assert.ok(result);
	assert.deepEqual(sourceAddIds(result.command), ['mono-remote', 'remote']);
	const rewritten = onlyPaste(result.command).clipboard;
	assert.equal(rewritten.tracks[0]?.clips[0]?.sourceId, 'mono-remote');
	assert.equal((rewritten.takeGroups?.[0] as { takes?: Array<{ sourceId?: string }> })
		.takes?.[0]?.sourceId, 'remote');
});

test('a transferred source/add is retained when another command still references it', async () => {
	const remote = source('remote', 2);
	const result = await prepareMonoConvertingPasteCommand({
		command: { type: 'batch', commands: [
			{ type: 'source/add', source: remote },
			paste(clipboard([{ id: 'affected', sourceIds: ['remote'] }]), { affected: 'mono-a' }),
			{ type: 'clip/add', trackId: 'empty', clip: {
				id: 'other-clip', sourceId: remote.id, timelineStartFrame: 0,
				sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4,
			} },
		] },
		project: project([source('mono', 1)]),
		alwaysConvertToMono: true,
		confirmConversion: async () => { throw new Error('confirmation should not run'); },
		derivedSources: derivedFixture({
			remote: [Float32Array.of(1, 0, 1, 0), Float32Array.of(0, 1, 0, 1)],
		}).port,
		preflightStorage: async () => undefined,
		updateAlwaysConvertToMono: () => undefined,
	});

	assert.ok(result);
	assert.deepEqual(sourceAddIds(result.command), ['mono-remote', 'remote']);
});

test('a later persistence failure rolls back every completed derived source', async () => {
	const first = source('first', 2);
	const second = source('second', 2);
	const failure = new Error('second persistence failed');
	let persistCount = 0;
	const derived = derivedFixture({
		first: [Float32Array.of(1), Float32Array.of(-1)],
		second: [Float32Array.of(0.5), Float32Array.of(0.5)],
	}, {
		async persistDerivedSource(template, channels) {
			persistCount += 1;
			derived.events.push(`persist:${template.id}`);
			if (persistCount === 2) throw failure;
			const id = `mono-${template.id}`;
			const record: DerivedSourceRecord = {
				source: { ...template, id, storageKey: id, channelCount: 1 },
				buffer: null,
				channels,
			};
			derived.persisted.push(record);
			return record;
		},
	});

	await assert.rejects(prepareMonoConvertingPasteCommand({
		command: paste(clipboard([{ id: 'copied', sourceIds: ['first', 'second'] }])),
		project: project([source('mono', 1), first, second]),
		alwaysConvertToMono: true,
		confirmConversion: async () => { throw new Error('confirmation should not run'); },
		derivedSources: derived.port,
		preflightStorage: async () => undefined,
		updateAlwaysConvertToMono: () => undefined,
	}), (error: unknown) => error === failure);
	assert.deepEqual(derived.events, [
		'load:first', 'persist:first', 'load:second', 'persist:second', 'rollback:mono-first',
	]);
	assert.equal(derived.rolledBack.length, 1);
});

test('a post-persistence command validation failure rolls back and rethrows', async () => {
	const stereo = source('stereo', 2);
	const derived = derivedFixture({
		stereo: [Float32Array.of(1, -1), Float32Array.of(-1, 1)],
	});

	await assert.rejects(prepareMonoConvertingPasteCommand({
		command: paste(),
		project: project([source('mono', 1), stereo, source('mono-stereo', 1)]),
		alwaysConvertToMono: true,
		confirmConversion: async () => { throw new Error('confirmation should not run'); },
		derivedSources: derived.port,
		preflightStorage: async () => undefined,
		updateAlwaysConvertToMono: () => undefined,
	}), /mono-stereo collides/iu);
	assert.deepEqual(derived.events, ['load:stereo', 'persist:stereo', 'rollback:mono-stereo']);
	assert.equal(derived.rolledBack[0]?.[0], derived.persisted[0]);
});

test('the commit owner rolls persisted mono sources back when the atomic commit fails', async () => {
	const stereo = source('stereo', 2);
	const derived = derivedFixture({
		stereo: [Float32Array.of(1, -1), Float32Array.of(-1, 1)],
	});
	const failure = new Error('commit failed');
	await assert.rejects(async () => {
		await commitMonoConvertingPasteCommand({
			command: paste(),
			project: project([source('mono', 1), stereo]),
			alwaysConvertToMono: true,
			confirmConversion: async () => { throw new Error('confirmation should not run'); },
			derivedSources: derived.port,
			preflightStorage: async () => undefined,
			updateAlwaysConvertToMono: () => undefined,
			assertCurrent: () => undefined,
			commit: () => { throw failure; },
		});
	}, (error: unknown) => error === failure);
	assert.deepEqual(derived.events, ['load:stereo', 'persist:stereo', 'rollback:mono-stereo']);
});

test('command discovery requires exactly one recursively nested paste before side effects', async () => {
	const derived = derivedFixture({});
	const common = {
		project: project([source('mono', 1), source('stereo', 2)]),
		alwaysConvertToMono: true,
		confirmConversion: async () => ({ accepted: true, dontShowAgain: false }),
		derivedSources: derived.port,
		preflightStorage: async () => undefined,
		updateAlwaysConvertToMono: () => undefined,
	};
	await assert.rejects(prepareMonoConvertingPasteCommand({
		...common,
		command: { type: 'project/rename', title: 'No paste' },
	}), /exactly one clipboard\/paste/iu);
	await assert.rejects(prepareMonoConvertingPasteCommand({
		...common,
		command: { type: 'batch', commands: [paste(), { type: 'batch', commands: [paste()] }] },
	}), /exactly one clipboard\/paste/iu);
	assert.deepEqual(derived.events, []);
});

function onlyPaste(command: AudioEditorCommand): Extract<AudioEditorCommand, { readonly type: 'clipboard/paste' }> {
	const found: Extract<AudioEditorCommand, { readonly type: 'clipboard/paste' }>[] = [];
	visit(command, (candidate) => {
		if (candidate.type === 'clipboard/paste') found.push(candidate);
	});
	assert.equal(found.length, 1);
	return found[0]!;
}

function sourceAddIds(command: AudioEditorCommand): string[] {
	const result: string[] = [];
	visit(command, (candidate) => {
		if (candidate.type === 'source/add') result.push(String(candidate.source.id));
	});
	return result;
}

function visit(command: AudioEditorCommand, callback: (candidate: AudioEditorCommand) => void): void {
	callback(command);
	if (command.type === 'batch') command.commands.forEach((child) => { visit(child, callback); });
}
