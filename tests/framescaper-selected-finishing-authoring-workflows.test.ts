/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_SELECTED_GENERATOR_AUTHORING_SURFACES,
	prepareFramescaperSelectedAuthoringFinishing as prepare,
} from '../src/framescaper/editor-selected-finishing-authoring-workflows.ts';

type Data = Record<string, unknown>;

interface Prepared {
	readonly command: Data;
}

function project(overrides: Data = {}): Data {
	return {
		schemaFamily: 'framescaper', schemaVersion: 1, sampleRate: 48_000,
		primarySequenceId: 'main-sequence',
		sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 } }],
		tracks: [], clips: [], selection: {},
		...overrides,
	};
}

function videoTrack(id: string, clipIds: readonly string[], locked = false): Data {
	return { id, type: 'video', locked, clipIds: [...clipIds] };
}

function videoClip(id: string, start: number, count: number, overrides: Data = {}): Data {
	return {
		kind: 'video', id, sourceId: 'video-source', sequenceId: 'main-sequence',
		sequenceStartFrame: start, sequenceFrameCount: count, ...overrides,
	};
}

async function author(surface: string, value: unknown): Promise<Prepared> {
	return await prepare(surface as never, value) as unknown as Prepared;
}

function batched(prepared: Prepared): Data[] {
	assert.equal(prepared.command.type, 'batch', 'generator authoring is committed as one batch');
	return prepared.command.commands as Data[];
}

function commandOfType(commands: readonly Data[], type: string): Data {
	const found = commands.find((command) => command.type === type);
	assert.ok(found, `the batch must carry a ${type} command`);
	return found;
}

function sourceOf(commands: readonly Data[]): Data {
	return commandOfType(commands, 'video-visual-source/set').source as Data;
}

test('the legacy workflow owns only the four directly invoked generator surfaces', () => {
	assert.deepEqual(FRAMESCAPER_SELECTED_GENERATOR_AUTHORING_SURFACES, [
		'video-title', 'video-text', 'video-shape', 'video-solid',
	]);
	assert.ok(Object.isFrozen(FRAMESCAPER_SELECTED_GENERATOR_AUTHORING_SURFACES));
});

test('a title generator authors its own video track, source, and clip in one batch', async () => {
	const commands = batched(await author('video-title', project()));
	const track = commands[0]?.track as Data;
	const source = sourceOf(commands);
	const clipCommand = commandOfType(commands, 'video-visual-clip/set');
	const clip = clipCommand.clip as Data;

	assert.deepEqual(commands.map(({ type }) => type), [
		'track/add', 'video-visual-source/set', 'video-visual-clip/set',
	]);
	assert.deepEqual(
		{ type: track.type, name: track.name, index: commands[0]?.index },
		{ type: 'video', name: 'Visuals', index: 0 },
	);
	assert.deepEqual({
		kind: source.kind, name: source.name, width: source.width, height: source.height,
		frameRate: source.frameRate, frameCount: source.frameCount,
	}, {
		kind: 'generator', name: 'Title', width: 1_920, height: 1_080,
		frameRate: { num: 10, den: 1 }, frameCount: 50,
	});
	assert.deepEqual(clipCommand.placement, { scope: 'timeline', trackId: track.id });
	assert.deepEqual({
		kind: clip.kind, sourceId: clip.sourceId, sequenceId: clip.sequenceId,
		start: clip.sequenceStartFrame, count: clip.sequenceFrameCount,
		inFrame: clip.sourceInFrame, sourceCount: clip.sourceFrameCount,
	}, {
		kind: 'generator', sourceId: source.id, sequenceId: 'main-sequence',
		start: 0, count: 50, inFrame: 0, sourceCount: 50,
	});
});

test('each generator surface carries its own kind and default styling', async () => {
	const generators = new Map<string, Data>();
	for (const surface of FRAMESCAPER_SELECTED_GENERATOR_AUTHORING_SURFACES) {
		const source = sourceOf(batched(await author(surface, project())));
		generators.set(String(source.name), source.generator as Data);
	}

	assert.deepEqual([...generators.keys()], ['Title', 'Text', 'Shape', 'Solid']);
	assert.deepEqual(generators.get('Title'), {
		kind: 'title', text: 'Title', fontFamily: 'soundscaper-sans', fontSize: 96,
		color: '#ffffffff', horizontalAlign: 'center', verticalAlign: 'middle',
	});
	assert.deepEqual(generators.get('Text'), {
		kind: 'text', text: 'Text', fontFamily: 'soundscaper-sans', fontSize: 64,
		color: '#ffffffff', horizontalAlign: 'start', verticalAlign: 'middle',
	});
	assert.deepEqual(generators.get('Shape'), {
		kind: 'shape', shape: 'rectangle', fillColor: '#ffffffff',
		strokeColor: null, strokeWidth: 0,
	});
	assert.deepEqual(generators.get('Solid'), { kind: 'solid', color: '#000000ff' });
});

test('a generator follows the selected unlocked track and lands after its existing clips', async () => {
	const placed = project({
		tracks: [
			videoTrack('locked', ['locked-clip'], true),
			videoTrack('track-a', ['a1']), videoTrack('track-b', ['b1', 'b2']),
		],
		clips: [
			videoClip('locked-clip', 0, 500), videoClip('a1', 0, 120),
			videoClip('b1', 0, 4), videoClip('b2', 10, 6, { sequenceId: 'other-sequence' }),
		],
	});
	const placement = async (surface: string, trackIds: readonly string[]): Promise<Data> => commandOfType(
		batched(await author(surface, { ...placed, selection: { trackIds: [...trackIds] } })),
		'video-visual-clip/set',
	);

	const selected = await placement('video-shape', ['track-b']);
	const fallback = await placement('video-solid', ['locked']);

	assert.deepEqual(selected.placement, { scope: 'timeline', trackId: 'track-b' });
	assert.equal((selected.clip as Data).sequenceStartFrame, 4);
	assert.deepEqual(fallback.placement, { scope: 'timeline', trackId: 'track-a' });
	assert.equal((fallback.clip as Data).sequenceStartFrame, 120);
});

test('generator placement refuses an unresolvable sequence and an unsafe clip range', async () => {
	const missing = /Framescaper visual authoring requires a primary sequence/u;
	await assert.rejects(() => author('video-title', project({ primarySequenceId: 'ghost' })), missing);
	await assert.rejects(() => author('video-title', project({ primarySequenceId: 42, sequences: [] })), missing);
	await assert.rejects(() => author('video-title', project({
		tracks: [videoTrack('track-a', ['huge'])],
		clips: [videoClip('huge', Number.MAX_SAFE_INTEGER, 1)],
	})), /The visual clip range exceeds safe integers/u);
});

test('the sequence rate sets generator duration and must be a positive integer pair', async () => {
	const withRate = async (rate: unknown): Promise<Prepared> => author('video-text', project({
		sequences: [{ id: 'main-sequence', ...(rate === null ? {} : { rate }) }],
	}));

	const source = sourceOf(batched(await withRate({ num: 30_000, den: 1_001 })));
	assert.deepEqual(source.frameRate, { num: 30_000, den: 1_001 });
	assert.equal(source.frameCount, 150);
	await assert.rejects(() => withRate(null), /sequence rate must be an object/u);
	await assert.rejects(() => withRate({ num: 0, den: 1 }), /sequence rate numerator must be positive/u);
	await assert.rejects(() => withRate({ num: 10, den: 0 }), /sequence rate denominator must be positive/u);
});

test('generator authoring requires the current Framescaper project family', async () => {
	await assert.rejects(
		() => author('video-title', project({ schemaVersion: 2 })),
		/cannot author a future project/u,
	);
	await assert.rejects(
		() => author('video-title', project({ schemaFamily: 'soundscaper' })),
		/cannot author a foreign project/u,
	);
	await assert.rejects(() => author('video-title', []), TypeError);
});
