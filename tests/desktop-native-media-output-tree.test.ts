/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	acquireNativeMediaOutputTreeLease,
	createNativeMediaOutputTreeIdentity,
	sealNativeMediaOutputTree,
} from '../desktop/native-media-output-tree.ts';

const FRAME = Buffer.from('frame-body');
const FRAME_SHA256 = digest(FRAME);
const IDENTITY = createNativeMediaOutputTreeIdentity({
	jobId: 'ab'.repeat(20), planFingerprint: '12'.repeat(32),
	rootGrantId: 'cd'.repeat(16), relativeDestination: 'renders/alpha-frames',
	sources: [{ sourceId: 'video-source', contentSha256: '34'.repeat(32) }],
	profileId: 'encode-png-sequence', frameCount: 1,
});

test('an output tree is sealed from exact regular frames and revalidated by held identity', async (context) => {
	const fixture = await treeFixture();
	context.after(fixture.cleanup);
	const sealed = await sealNativeMediaOutputTree({
		path: fixture.output, maximumBytes: 1_024 * 1_024, identity: IDENTITY,
	});
	assert.equal(sealed.tree.fileCount, 2);
	assert.equal(sealed.tree.identity.jobId, IDENTITY.jobId);
	assert.equal(sealed.sha256, sealed.tree.manifestSha256);
	const lease = await acquireNativeMediaOutputTreeLease({
		path: fixture.output, maximumBytes: 1_024 * 1_024, identity: IDENTITY,
		manifestSha256: sealed.sha256,
	});
	assert.deepEqual(lease.authenticated, sealed);
	await lease.revalidate();
	await lease.close();
});

test('tree sealing refuses symlinks, traversal, missing/extra files, and manifest digest drift', async (context) => {
	for (const scenario of ['symlink', 'traversal', 'missing', 'extra', 'digest'] as const) {
		const fixture = await treeFixture();
		context.after(fixture.cleanup);
		if (scenario === 'symlink') {
			await symlink(join(fixture.root, 'outside.bin'), join(fixture.output, 'unexpected-link'));
		} else if (scenario === 'extra') {
			await writeFile(join(fixture.output, 'extra.png'), FRAME);
		} else {
			const manifest = JSON.parse(String(await readFile(join(fixture.output, 'manifest.json')))) as {
				frames: Array<Record<string, unknown>>;
			};
			if (scenario === 'traversal') manifest.frames[0]!.fileName = '../outside.bin';
			if (scenario === 'missing') manifest.frames[0]!.fileName = 'frame-00000001.png';
			if (scenario === 'digest') manifest.frames[0]!.sha256 = '00'.repeat(32);
			await writeFile(join(fixture.output, 'manifest.json'), JSON.stringify(manifest));
		}
		await assert.rejects(() => sealNativeMediaOutputTree({
			path: fixture.output, maximumBytes: 1_024 * 1_024, identity: IDENTITY,
		}), /output tree|image-sequence|manifest|regular|symbolic|file inventory|authenticated identity/iu, scenario);
	}
});

test('a sealed tree detects changed contents, extra files, and directory replacement', async (context) => {
	for (const scenario of ['content', 'extra', 'replacement'] as const) {
		const fixture = await treeFixture();
		context.after(fixture.cleanup);
		const sealed = await sealNativeMediaOutputTree({
			path: fixture.output, maximumBytes: 1_024 * 1_024, identity: IDENTITY,
		});
		const lease = await acquireNativeMediaOutputTreeLease({
			path: fixture.output, maximumBytes: 1_024 * 1_024, identity: IDENTITY,
			manifestSha256: sealed.sha256,
		});
		if (scenario === 'content') await writeFile(join(fixture.output, 'frame-00000000.png'), 'changed');
		if (scenario === 'extra') await writeFile(join(fixture.output, 'extra.png'), FRAME);
		if (scenario === 'replacement') {
			const moved = `${fixture.output}-old`;
			const { rename } = await import('node:fs/promises');
			await rename(fixture.output, moved);
			await mkdir(fixture.output);
		}
		await assert.rejects(() => lease.revalidate(), /output tree|identity|manifest|file inventory/iu);
		await lease.close();
	}
});

async function treeFixture() {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-output-tree-'));
	const output = join(root, '.alpha.partial');
	await mkdir(output);
	await writeFile(join(root, 'outside.bin'), FRAME);
	await writeFile(join(output, 'frame-00000000.png'), FRAME);
	await writeFile(join(output, 'manifest.json'), JSON.stringify({
		schemaVersion: 1, profileId: 'encode-png-sequence', frameCount: 1,
		frames: [{ ordinal: 0, fileName: 'frame-00000000.png',
			byteLength: FRAME.byteLength, sha256: FRAME_SHA256 }],
	}));
	return Object.freeze({ root, output, cleanup: async () => {
		const { rm } = await import('node:fs/promises');
		await rm(root, { recursive: true, force: true });
	} });
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
