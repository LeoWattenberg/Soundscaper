/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createScapeReplaceWriteAuthority } from '../src/common/editor/controller/document/project-lock-service.ts';
import type { ProjectLifecycleLock } from '../src/common/editor/controller/document/project-lifecycle-types.ts';

function lock(projectId: string, writeFence: string, readOnly = false) {
	let releases = 0;
	const value: ProjectLifecycleLock = {
		projectId, writeFence, readOnly, method: 'test', release() { releases += 1; },
	};
	return { value, releases: () => releases };
}

test('Scape replace borrows the active physical lock and rejects an identity change', async () => {
	const first = lock('project-a', 'token-a');
	const next = lock('project-a', 'token-b');
	let active = first.value;
	let acquisitions = 0;
	const acquire = createScapeReplaceWriteAuthority({
		getActiveProjectId: () => 'project-a', getActiveReadOnly: () => false,
		getActiveLock: () => active,
		async acquireProjectLock() { acquisitions += 1; return next.value; },
	});
	const authority = await acquire('project-a');
	assert.equal(authority.writeFence, 'token-a');
	authority.assertCurrent();
	assert.equal(acquisitions, 0);
	active = next.value;
	assert.throws(() => authority.assertCurrent(), /lost write authority/iu);
	await authority.release();
	assert.equal(first.releases(), 0, 'borrowed controller lock stays with the controller');
});

test('Scape replace releases a contended inactive lock and rejects a lost acquired lock', async () => {
	const contended = lock('project-b', '', true);
	let acquired = contended.value;
	const acquire = createScapeReplaceWriteAuthority({
		getActiveProjectId: () => 'project-a', getActiveReadOnly: () => false,
		getActiveLock: () => null,
		async acquireProjectLock() { return acquired; },
	});
	await assert.rejects(acquire('project-b'), /could not acquire write authority/iu);
	assert.equal(contended.releases(), 1);
	const writable = lock('project-b', 'token-b');
	acquired = writable.value;
	const authority = await acquire('project-b');
	assert.equal(authority.writeFence, 'token-b');
	writable.value.writeFence = 'token-c';
	assert.throws(() => authority.assertCurrent(), /lost write authority/iu);
	await authority.release();
	assert.equal(writable.releases(), 1);
});
