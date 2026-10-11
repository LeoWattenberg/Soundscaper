/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rename, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMotionSavedFileAuthority } from '../desktop/motion-saved-file-authority.ts';
import type { MotionSavedFileSnapshot } from '../src/common/editor/motion-saved-file-contract.ts';
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), 'motionscaper-watch-')), path = join(directory, 'Selected.mscape');
	await writeFile(path, 'saved-one'); const authority = createMotionSavedFileAuthority({ chooseFile: () => Promise.resolve(path) });
	return { directory, path, authority, dispose: async () => { await authority.dispose(); await rm(directory, { recursive: true, force: true }); } };
}
async function snapshot(f: Awaited<ReturnType<typeof fixture>>, watchId: string, generation: number): Promise<MotionSavedFileSnapshot> {
	const result = await f.authority.poll({ watchId, afterGeneration: generation }); assert.equal(result.state, 'snapshot');
	if (result.state !== 'snapshot') throw new Error('Expected snapshot.'); return result.snapshot;
}
test('selected saved file watches reopen atomic replacement while pinned old snapshots retain their original bytes', async () => {
	const f = await fixture(); try {
		const selected = await f.authority.select(); assert.ok(selected); assert.deepEqual(Object.keys(selected).sort(), ['name', 'watchId']);
		const first = await snapshot(f, selected.watchId, 0); assert.equal(first.name, 'Selected.mscape'); assert.equal(first.generation, 1);
		await writeFile(join(f.directory, 'replacement.tmp'), 'saved-two'); await rename(join(f.directory, 'replacement.tmp'), f.path);
		const second = await snapshot(f, selected.watchId, first.generation); assert.equal(second.generation, 2); assert.notEqual(second.token, first.token);
		assert.equal(Buffer.from(await f.authority.read({ token: first.token, offset: 0, length: 9 })).toString(), 'saved-one');
		assert.equal(Buffer.from(await f.authority.read({ token: second.token, offset: 0, length: 9 })).toString(), 'saved-two');
		await f.authority.release({ token: first.token }); await f.authority.release({ token: second.token });
		assert.deepEqual(await f.authority.poll({ watchId: selected.watchId, afterGeneration: 2 }), { state: 'unchanged', generation: 2 });
		await f.authority.cancel({ watchId: selected.watchId }); await assert.rejects(f.authority.poll({ watchId: selected.watchId, afterGeneration: 2 }), /unknown|closed/iu);
	} finally { await f.dispose(); }
});
test('missing or symlink replacements never receive file permission, and a restored selected file renews discovery', async () => {
	const f = await fixture(); try {
		const selected = (await f.authority.select())!, first = await snapshot(f, selected.watchId, 0); await f.authority.release({ token: first.token });
		await rm(f.path); assert.deepEqual(await f.authority.poll({ watchId: selected.watchId, afterGeneration: 1 }), { state: 'unavailable', generation: 2 });
		await writeFile(join(f.directory, 'secret.txt'), 'not selected'); await symlink(join(f.directory, 'secret.txt'), f.path);
		assert.equal((await f.authority.poll({ watchId: selected.watchId, afterGeneration: 2 })).state, 'unavailable');
		await rm(f.path); await writeFile(f.path, 'saved-new'); const latest = await snapshot(f, selected.watchId, 2); assert.equal(latest.generation, 3);
		await f.authority.cancel({ watchId: selected.watchId }); await assert.rejects(f.authority.read({ token: latest.token, offset: 0, length: 1 }), /unknown|closed/iu);
	} finally { await f.dispose(); }
});
test('saved file capability refuses changed in-place bytes, oversized reads, unknown tokens and closed authority', async () => {
	const f = await fixture(); try {
		const selected = (await f.authority.select())!, first = await snapshot(f, selected.watchId, 0);
		await assert.rejects(f.authority.read({ token: first.token, offset: 0, length: 4 * 1024 * 1024 + 1 }), /bounded|range/iu);
		await assert.rejects(f.authority.read({ token: 'unknown', offset: 0, length: 1 }), /unknown/iu);
		await writeFile(f.path, 'changed-in-place'); await assert.rejects(f.authority.read({ token: first.token, offset: 0, length: 9 }), /changed/iu);
		await f.authority.dispose(); await assert.rejects(f.authority.select(), /closed/iu);
	} finally { await f.dispose(); }
});
test('concurrent discoveries cannot exceed the finite pinned snapshot budget', async () => {
	const f = await fixture(); try {
		const first = (await f.authority.select())!, second = (await f.authority.select())!;
		for (let index = 0; index < 15; index++) await snapshot(f, first.watchId, 0);
		const results = await Promise.allSettled([f.authority.poll({ watchId: first.watchId, afterGeneration: 0 }), f.authority.poll({ watchId: second.watchId, afterGeneration: 0 })]);
		assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(results.filter(result => result.status === 'rejected').length, 1);
	} finally { await f.dispose(); }
});
