/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	importFramescaperTimelineImagesTimelineImage as importImages,
} from '../src/framescaper/editor-image-import-coordinator-timeline-image.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import {
	createFramescaperProjectTimelineImage,
} from '../src/framescaper/editor-project-timeline-image.ts';

type Data = Record<string, unknown>;

function project(): Data {
	return createFramescaperProjectTimelineImage(PROFILE, {} as never) as unknown as Data;
}

function file(name = 'shot.png', size = 8): Data {
	return {
		name,
		size,
		type: 'image/png',
		arrayBuffer: async () => new Uint8Array(size).buffer,
	};
}

function request(overrides: Data = {}): never {
	let minted = 0;
	return {
		project: project(),
		files: [],
		createId: (prefix: string) => `${prefix}-${(minted += 1)}`,
		publisher: { publish: async (value: unknown) => value },
		...overrides,
	} as unknown as never;
}

async function run(overrides: Data = {}): Promise<Data> {
	return await importImages(request(overrides)) as unknown as Data;
}

test('an import gesture is bounded to between one and sixty-four files', async () => {
	await assert.rejects(() => run(), /requires 1 through 64 files/u);
	await assert.rejects(
		() => run({ files: Array.from({ length: 65 }, (_, index) => file(`shot-${index}.png`)) }),
		/requires 1 through 64 files/u,
	);
});

test('an import requires an array of files and both of its ports', async () => {
	await assert.rejects(() => run({ files: 'shot.png' }), /files must be an array/u);
	await assert.rejects(() => run({ createId: 1 }), /requires ID and publication ports/u);
	await assert.rejects(() => run({ publisher: {} }), /requires ID and publication ports/u);
});

test('an import refuses a project outside the Framescaper schema family', async () => {
	await assert.rejects(() => run({ project: { schemaFamily: 'soundscaper' } }), TypeError);
});

test('a file whose decode fails is reported without failing the whole gesture', async () => {
	const result = await run({
		files: [file('first.png'), file('second.png')],
		decode: async () => { throw new Error('the image could not be decoded'); },
	});

	assert.deepEqual((result.files as Data[]).map(({ fileName, status }) => ({ fileName, status })), [
		{ fileName: 'first.png', status: 'failed' },
		{ fileName: 'second.png', status: 'failed' },
	]);
	assert.equal(
		(result.files as Data[])[0]!.message,
		'the image could not be decoded',
		'each file carries its own reason rather than one gesture-wide error',
	);
});

test('a failed file mints no source or clip identity', async () => {
	const result = await run({
		files: [file()],
		decode: async () => { throw new Error('the image could not be decoded'); },
	});

	assert.deepEqual((result.files as Data[])[0], {
		fileName: 'shot.png', status: 'failed', sourceId: null, clipId: null,
		notices: [], message: 'the image could not be decoded',
	});
});

test('a file that changed size while being read is refused as changed', async () => {
	const result = await run({
		files: [{ ...file(), arrayBuffer: async () => new Uint8Array(3).buffer }],
		decode: async () => { throw new Error('never reached'); },
	});

	assert.match(
		String((result.files as Data[])[0]!.message),
		/changed while it was read/u,
	);
});

test('an already-cancelled import reports its files as cancelled', async () => {
	const controller = new AbortController();
	controller.abort();

	const result = await run({
		files: [file('first.png'), file('second.png')],
		signal: controller.signal,
		decode: async () => { throw new Error('never reached'); },
	});

	assert.equal((result.files as Data[]).length, 2);
	for (const entry of result.files as Data[]) {
		assert.notEqual(entry.status, 'imported');
	}
});

test('an import returns the project alongside its per-file results', async () => {
	const result = await run({
		files: [file()],
		decode: async () => { throw new Error('the image could not be decoded'); },
	});

	assert.deepEqual(Object.keys(result), ['project', 'files']);
	assert.equal((result.project as Data).schemaFamily, 'framescaper');
});
