/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { importProjectTransferBundle } from '../src/common/transfer/project-transfer-bundle.ts';
import { archiveBytes, createFakeArchive, FakeStore } from './project-transfer-bundle-fixture.ts';

test('cancelling after a partial import clears only the project that import published', async () => {
	const archive = createFakeArchive();
	const receiving = new FakeStore([{ id: 'existing', title: 'Keep' }]);
	const controller = new AbortController();
	const result = await importProjectTransferBundle({
		store: receiving,
		inspectProject: archive.inspectProject,
		importProject: async (input, store, options) => {
			await archive.importProject(input, store, options);
			controller.abort(new DOMException('The receive window closed.', 'AbortError'));
			throw controller.signal.reason;
		},
		entries: [{ bytes: archiveBytes({ id: 'project-a', title: 'A' }) }],
		signal: controller.signal,
	});

	assert.equal(result.completed, false);
	assert.equal(result.stopped?.code, 'aborted');
	assert.equal(result.stopped?.index, 0);
	assert.deepEqual(result.entries, []);
	assert.deepEqual([...receiving.projects.keys()], ['existing']);
	assert.deepEqual(receiving.deletions, ['project-a']);
});
