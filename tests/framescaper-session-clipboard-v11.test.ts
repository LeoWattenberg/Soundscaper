/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperProjectFinishing,
} from '../src/framescaper/editor-project-finishing.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import {
	prepareFramescaperSessionClipboardPasteCommandV11,
} from '../src/framescaper/editor-session-clipboard-v11-controller.ts';
import {
	createFramescaperFinishingClipboardV11,
	createFramescaperSessionClipboardV11,
	normalizeFramescaperFinishingClipboardV11,
	normalizeFramescaperSessionClipboardV11,
} from '../src/framescaper/editor-session-clipboard-v11.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

function project(): Data {
	return createFramescaperProjectFinishing(
		PROFILE,
		framescaperV20Options() as never,
	) as unknown as Data;
}

function descriptor(source: Data): Data {
	const clip = (source.clips as Data[])[0]!;
	return {
		schemaVersion: 2,
		sampleRate: source.sampleRate,
		durationFrames: 10,
		tracks: [{
			sourceTrackId: 'video-track',
			sourceTrackName: 'Video',
			sourceTrackType: 'video',
			sourceLaneGroupId: null,
			clips: [{
				key: `${String(clip.id)}:0:10`,
				kind: 'video',
				sourceId: clip.sourceId,
				offsetFrame: 0,
				sourceStartFrame: 0,
				durationFrames: 10,
			}],
		}],
	};
}

function clipboard(source: Data = project()): Data {
	return createFramescaperSessionClipboardV11(
		PROFILE,
		source,
		descriptor(source) as never,
	) as unknown as Data;
}

function wire(value: Data): Data {
	return JSON.parse(JSON.stringify(value)) as Data;
}

function pasteCommand(board: Data): Data {
	return {
		type: 'clipboard/paste',
		clipboard: board.descriptor,
		targetTrackId: 'video-track',
		startFrame: 20,
		clipIds: {},
		videoEffectIds: {},
	};
}

function createId(prefix: string): string {
	return `${prefix}-1`;
}

test('a session clipboard binds its origin, descriptor and selected sources', () => {
	const source = project();

	const board = clipboard(source);

	assert.equal(board.schemaVersion, 11);
	assert.equal(board.kind, 'framescaper-session-clipboard');
	assert.equal(board.originProjectId, source.id);
	assert.equal(board.originRevision, source.revision);
	assert.equal((board.sources as unknown[]).length, 1);
	assert.equal((board.clipBindings as unknown[]).length, 1);
});

test('a session clipboard survives a JSON round trip unchanged', () => {
	const board = clipboard();

	const restored = normalizeFramescaperSessionClipboardV11(wire(board));

	assert.deepEqual(restored, board);
});

test('a session clipboard from another schema generation demands a re-copy', () => {
	const board = wire(clipboard());

	assert.throws(
		() => normalizeFramescaperSessionClipboardV11({ ...board, schemaVersion: 10 }),
		/requires V11 re-copy/u,
	);
	assert.throws(
		() => normalizeFramescaperSessionClipboardV11({ ...board, kind: 'framescaper-other' }),
		/kind is unsupported/u,
	);
});

test('a session clipboard carrying unknown fields is refused', () => {
	const board = wire(clipboard());

	assert.throws(
		() => normalizeFramescaperSessionClipboardV11({ ...board, extra: 1 }),
		/must carry exactly its schema keys/u,
	);
});

test('the session and finishing halves must name the same origin revision', () => {
	const board = wire(clipboard());

	assert.throws(
		() => normalizeFramescaperSessionClipboardV11({
			...board,
			originRevision: Number(board.originRevision) + 1,
		}),
		/origins must match exactly/u,
	);
	assert.throws(
		() => normalizeFramescaperSessionClipboardV11({
			...board,
			finishing: { ...board.finishing as Data, originProjectId: 'another-project' },
		}),
		/origins must match exactly/u,
	);
});

test('a finishing clipboard carries every owned finishing collection', () => {
	const source = project();

	const finishing = createFramescaperFinishingClipboardV11(
		PROFILE,
		source,
		descriptor(source) as never,
	) as unknown as Data;

	assert.deepEqual(Object.keys(finishing), [
		'schemaVersion', 'kind', 'originProjectId', 'originRevision', 'visual',
		'colorContexts', 'sourceColorInterpretations', 'visualPresentations',
		'processorStacks', 'motionAnalyses', 'finishingPresets', 'captionTracks',
	]);
	assert.deepEqual(normalizeFramescaperFinishingClipboardV11(wire(finishing)), finishing);
});

test('a finishing clipboard rejects a foreign generation, kind or nested origin', () => {
	const source = project();
	const finishing = wire(createFramescaperFinishingClipboardV11(
		PROFILE,
		source,
		descriptor(source) as never,
	) as unknown as Data);

	assert.throws(
		() => normalizeFramescaperFinishingClipboardV11({ ...finishing, schemaVersion: 8 }),
		/requires V11 re-copy/u,
	);
	assert.throws(
		() => normalizeFramescaperFinishingClipboardV11({ ...finishing, kind: 'framescaper-other' }),
		/kind is unsupported/u,
	);
	assert.throws(
		() => normalizeFramescaperFinishingClipboardV11({
			...finishing,
			visual: { ...finishing.visual as Data, originProjectId: 'another-project' },
		}),
		/origins must match exactly/u,
	);
});

test('a paste needs exactly one foundation clipboard command to carry', () => {
	const source = project();
	const board = clipboard(source);
	const paste = pasteCommand(board);

	assert.throws(
		() => prepareFramescaperSessionClipboardPasteCommandV11(
			PROFILE, source, board, { type: 'project/rename', title: 'Renamed' } as never, createId,
		),
		/exactly one foundation clipboard\/paste command/u,
	);
	assert.throws(
		() => prepareFramescaperSessionClipboardPasteCommandV11(
			PROFILE, source, board, { type: 'batch', commands: [paste, paste] } as never, createId,
		),
		/exactly one foundation clipboard\/paste command/u,
	);
	assert.throws(
		() => prepareFramescaperSessionClipboardPasteCommandV11(
			PROFILE, source, board, { type: 'batch', commands: 1 } as never, createId,
		),
		/batch commands must be an array/u,
	);
});

test('a paste refuses a carrier whose descriptor drifted from the command', () => {
	const source = project();
	const board = clipboard(source);

	assert.throws(
		() => prepareFramescaperSessionClipboardPasteCommandV11(
			PROFILE,
			source,
			board,
			{
				...pasteCommand(board),
				clipboard: { ...board.descriptor as Data, durationFrames: 99 },
			} as never,
			createId,
		),
		/paste descriptors must match exactly/u,
	);
});

test('a paste requires an identity factory', () => {
	const source = project();
	const board = clipboard(source);

	assert.throws(
		() => prepareFramescaperSessionClipboardPasteCommandV11(
			PROFILE, source, board, pasteCommand(board) as never, null as never,
		),
		/requires an ID factory/u,
	);
});
