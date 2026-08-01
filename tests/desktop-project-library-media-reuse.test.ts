/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { link, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { reuseDesktopLibraryMediaBody } from '../desktop/project-library-media-reuse.ts';

const EXPECTED = Uint8Array.of(3, 1, 4, 1, 5, 9);

test('reuse propagates operational donor-verification failures', async (context) => {
	const fixture = await reuseFixture(context);
	const failure = linkError('EIO');
	await assert.rejects(reuseDesktopLibraryMediaBody({
		...fixture.options,
		sourcePaths: [fixture.firstSource],
		verifySourcePath: async () => { throw failure; },
	}), (error: unknown) => error === failure);
	assert.deepEqual(await readdir(fixture.directory), ['first.bin', 'second.bin']);
});

test('reuse treats an exhausted donor link count as local and tries the next donor', async (context) => {
	const fixture = await reuseFixture(context);
	const attempts: string[] = [];
	const reused = await reuseDesktopLibraryMediaBody({
		...fixture.options,
		hardLink: async (source, target) => {
			attempts.push(source);
			if (source === fixture.firstSource) throw linkError('EMLINK');
			await link(source, target);
		},
		sourcePaths: [fixture.firstSource, fixture.secondSource],
	});

	assert.equal(reused, true);
	assert.deepEqual(attempts.slice(0, 2), [fixture.firstSource, fixture.secondSource]);
	assert.deepEqual(new Uint8Array(await readFile(fixture.finalPath)), EXPECTED);
});

test('reuse never overwrites a target that wins the promotion race', async (context) => {
	const fixture = await reuseFixture(context);
	const winner = Uint8Array.of(2, 7, 1, 8);
	let links = 0;
	await assert.rejects(reuseDesktopLibraryMediaBody({
		...fixture.options,
		hardLink: async (source, target) => {
			links += 1;
			if (links === 2) await writeFile(fixture.finalPath, winner, { flag: 'wx' });
			await link(source, target);
		},
		sourcePaths: [fixture.firstSource],
	}), /target body changed/iu);

	assert.deepEqual(new Uint8Array(await readFile(fixture.finalPath)), winner);
	assert.deepEqual((await readdir(fixture.directory)).sort(), ['first.bin', 'managed.bin', 'second.bin']);
});

test('reuse propagates access denial instead of relabeling it as unsupported', async (context) => {
	const fixture = await reuseFixture(context);
	await assert.rejects(reuseDesktopLibraryMediaBody({
		...fixture.options,
		hardLink: async () => { throw linkError('EACCES'); },
		sourcePaths: [fixture.firstSource],
	}), (error: unknown) => errorCode(error) === 'EACCES');
});

async function reuseFixture(context: TestContext) {
	const directory = await mkdtemp(join(tmpdir(), 'scape-media-reuse-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const firstSource = join(directory, 'first.bin');
	const secondSource = join(directory, 'second.bin');
	const finalPath = join(directory, 'managed.bin');
	await Promise.all([writeFile(firstSource, EXPECTED), writeFile(secondSource, EXPECTED)]);
	const verifyBytes = async (path: string): Promise<boolean> => {
		assert.deepEqual(new Uint8Array(await readFile(path)), EXPECTED);
		return true;
	};
	return Object.freeze({
		directory,
		finalPath,
		firstSource,
		secondSource,
		options: Object.freeze({
			directory,
			finalPath,
			randomId: () => 'a'.repeat(32),
			sourcePaths: Object.freeze([]) as readonly string[],
			syncDirectory: async () => undefined,
			verifySourcePath: verifyBytes,
			verifyTargetPath: async (path: string) => {
				const actual = new Uint8Array(await readFile(path));
				if (actual.length !== EXPECTED.length
					|| actual.some((value, index) => value !== EXPECTED[index])) {
					throw new Error('Managed-media target body changed');
				}
			},
		}),
	});
}

function linkError(code: string): Error & Readonly<{ code: string }> {
	return Object.assign(new Error(`Injected hard-link ${code}`), { code });
}

function errorCode(error: unknown): string | undefined {
	return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
		? error.code
		: undefined;
}
