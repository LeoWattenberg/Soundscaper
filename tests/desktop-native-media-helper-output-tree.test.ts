/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { NativeMediaHelperFilesystem } from '../desktop/native-media-helper-filesystem.ts';
import { createNativeMediaOutputTreeIdentity } from '../desktop/native-media-output-tree.ts';

const FRAME = Buffer.from('rgba-alpha-frame');

test('helper filesystem seals, revalidates, and retains one exact output directory', async (context) => {
	const fixture = await harness();
	context.after(fixture.cleanup);
	const filesystem = new NativeMediaHelperFilesystem();
	await filesystem.authenticateDirectory({ path: fixture.root, identity: await identity(fixture.root) });
	await filesystem.expectOutputTree({
		path: fixture.output, maximumBytes: 1_024 * 1_024,
		insideReservation: false, identity: fixture.treeIdentity,
	});
	await writeNativeTree(fixture.output);
	await filesystem.sealOutputTree();
	const inspected = await filesystem.inspectOutput();
	assert.equal('kind' in inspected ? inspected.kind : null, 'directory');
	if (!('kind' in inspected) || inspected.kind !== 'directory') throw new Error('Expected directory output');
	assert.equal(inspected.tree.identity.jobId, fixture.treeIdentity.jobId);
	await filesystem.revalidate();
	await filesystem.finish({ retainOutput: true });
	assert.equal((await lstat(fixture.output)).isDirectory(), true);
});

test('helper abort removes an incomplete output directory after host crash or cancellation', async (context) => {
	for (const contents of ['partial', 'empty'] as const) {
		const fixture = await harness();
		context.after(fixture.cleanup);
		const filesystem = new NativeMediaHelperFilesystem();
		await filesystem.authenticateDirectory({ path: fixture.root, identity: await identity(fixture.root) });
		await filesystem.expectOutputTree({
			path: fixture.output, maximumBytes: 1_024 * 1_024,
			insideReservation: false, identity: fixture.treeIdentity,
		});
		await mkdir(fixture.output);
		if (contents === 'partial') await writeFile(join(fixture.output, 'frame-00000000.png.part'), FRAME);
		await filesystem.abort();
		await assert.rejects(access(fixture.output), /ENOENT/u);
	}
});

test('helper cleanup refuses a substituted symlink and never follows it', async (context) => {
	const fixture = await harness();
	context.after(fixture.cleanup);
	const outside = join(fixture.root, 'outside');
	await mkdir(outside);
	await writeFile(join(outside, 'keep.bin'), FRAME);
	const filesystem = new NativeMediaHelperFilesystem();
	await filesystem.authenticateDirectory({ path: fixture.root, identity: await identity(fixture.root) });
	await filesystem.expectOutputTree({
		path: fixture.output, maximumBytes: 1_024 * 1_024,
		insideReservation: false, identity: fixture.treeIdentity,
	});
	await symlink(outside, fixture.output, 'dir');
	await assert.rejects(() => filesystem.abort(), /cleanup|directory|symbolic|authority/iu);
	assert.equal((await lstat(join(outside, 'keep.bin'))).isFile(), true);
});

async function harness() {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-helper-tree-'));
	const output = join(root, '.alpha.partial');
	return Object.freeze({
		root, output,
		treeIdentity: createNativeMediaOutputTreeIdentity({
			jobId: 'ab'.repeat(20), planFingerprint: '12'.repeat(32), rootGrantId: 'cd'.repeat(16),
			relativeDestination: 'alpha',
			sources: [{ sourceId: 'video-source', contentSha256: '34'.repeat(32) }],
			profileId: 'encode-png-sequence', frameCount: 1,
		}),
		cleanup: () => rm(root, { recursive: true, force: true }),
	});
}

async function writeNativeTree(path: string): Promise<void> {
	await mkdir(path);
	await writeFile(join(path, 'frame-00000000.png'), FRAME);
	await writeFile(join(path, 'manifest.json'), JSON.stringify({
		schemaVersion: 1, profileId: 'encode-png-sequence', frameCount: 1,
		frames: [{ ordinal: 0, fileName: 'frame-00000000.png',
			byteLength: FRAME.byteLength, sha256: digest(FRAME) }],
	}));
}

async function identity(path: string) {
	const stat = await lstat(path);
	return Object.freeze({ dev: stat.dev, ino: stat.ino });
}

function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
