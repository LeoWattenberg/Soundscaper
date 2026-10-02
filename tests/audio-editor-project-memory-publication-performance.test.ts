/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ProjectCompareAndSwapRepository } from '../src/common/editor/storage/project-compare-and-swap-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { ProjectRepository } from '../src/common/editor/storage/project-repository.ts';

test('memory compare-and-swap shares its owned publication snapshot without duplicate project clones', async () => {
	const memory = getMemoryDatabase(`publication-clones-${globalThis.crypto.randomUUID()}`);
	const port = { memory, database: async () => null };
	const delegate = new ProjectRepository(port, 2);
	const repository = new ProjectCompareAndSwapRepository(delegate, port, 2);
	const initial = { id: 'clone-test', revision: 0, metadata: { title: 'Initial' } };
	await repository.save(initial);
	const next = { ...initial, revision: 1, metadata: { title: 'Next' } };
	const nativeClone = globalThis.structuredClone;
	let projectClones = 0;
	globalThis.structuredClone = (value, options) => {
		if (value && typeof value === 'object' && ('id' in value && value.id === initial.id
			|| 'project' in value && value.project?.id === initial.id)) projectClones += 1;
		return nativeClone(value, options);
	};
	let committed;
	try {
		committed = await repository.saveIfCurrent(initial, next);
		assert.equal(projectClones, 3, 'detach expected, detach incoming, and detach the returned committed snapshot');
	} finally { globalThis.structuredClone = nativeClone; }
	assert.ok(committed);
	next.metadata.title = 'Caller mutation';
	(committed.metadata as { title: string }).title = 'Returned snapshot mutation';
	assert.deepEqual(await repository.load(initial.id), { ...initial, revision: 1, metadata: { title: 'Next' } });
	assert.deepEqual(await repository.load(initial.id, { revision: 1 }), { ...initial, revision: 1, metadata: { title: 'Next' } });
});

test('memory publication still rolls back both project stores when a batch write fails', async () => {
	const memory = getMemoryDatabase(`publication-rollback-${globalThis.crypto.randomUUID()}`);
	const port = { memory, database: async () => null };
	const repository = new ProjectCompareAndSwapRepository(new ProjectRepository(port, 2), port, 2);
	const initial = { id: 'rollback-test', revision: 0 };
	await repository.save(initial);
	const nativeSet = memory.revisions.set;
	memory.revisions.set = () => { throw new Error('Planned publication failure'); };
	try {
		await assert.rejects(repository.saveIfCurrent(initial, { ...initial, revision: 1 }), /Planned publication failure/u);
		assert.deepEqual(await repository.load(initial.id), initial);
		assert.equal(await repository.load(initial.id, { revision: 1 }), null);
	} finally { memory.revisions.set = nativeSet; }
});
