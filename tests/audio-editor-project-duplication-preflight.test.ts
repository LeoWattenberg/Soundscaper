/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	duplicateProjectWithLinkedOriginals,
	duplicateProjectWithLinkedVideoOriginals,
	type ProjectDuplicationPort,
} from '../src/common/editor/storage/project-duplication.ts';

for (const duplicate of [duplicateProjectWithLinkedOriginals, duplicateProjectWithLinkedVideoOriginals]) {
	test(`${duplicate.name} refuses absent or occupied catalog entries before alias/publication work`, async () => {
		for (const scenario of ['missing-source', 'missing-catalog', 'occupied-destination'] as const) {
			const calls: string[] = [];
			const source = { id: 'source', revision: 0 };
			const port = {
				aliases: null,
				loadProject: () => { calls.push('load'); return scenario === 'missing-source' ? null : source; },
				listProjects: () => {
					calls.push('list');
					return scenario === 'missing-catalog' ? [] : [source, { id: 'copy', revision: 0 }];
				},
				createProjectIfAbsent: () => { throw new Error('preflight must precede publication'); },
			} satisfies ProjectDuplicationPort;
			await assert.rejects(duplicate(port, {
				sourceProjectId: 'source', copyProjectId: 'copy', timestamp: '2026-10-01T12:00:00.000Z',
			}), new RegExp(scenario === 'missing-source' ? 'could not be found'
				: scenario === 'missing-catalog' ? 'no longer in the current catalog' : 'destination already exists', 'u'));
			assert.deepEqual(calls, scenario === 'missing-source' ? ['load'] : ['load', 'list']);
		}
	});
}
