/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { saveProjectWithLinkedOriginalReachability } from '../src/common/editor/storage/linked-original-project-save.ts';

test('project save protects kindful transient audio and live video roots through post-commit cleanup', async () => {
	const roots: unknown[] = [];
	const durable: unknown[] = [];
	const project = { id: 'project-a', title: 'Project A' };
	const saved = await saveProjectWithLinkedOriginalReachability({
		store: {
			backend: 'memory',
			async ready() {},
			async estimateStorage() { return { usage: null, quota: null }; },
		},
		projects: {
			async save(value: unknown, postCommit?: () => Promise<void>) {
				await postCommit?.();
				return value;
			},
		} as never,
		lifecycle: {
			async saveProject(_projectId: string, operation: (maintain: () => Promise<void>) => Promise<unknown>, prune: (references: readonly unknown[]) => Promise<unknown>) {
				return operation(async () => {
					const result = await prune([{ kind: 'audio', sourceId: 'source-audio' }]);
					durable.push(result);
				});
			},
		} as never,
		reachability: {
			async pruneProjectBindings(_projectId: string, references: readonly unknown[]) {
				roots.push(references);
				return {
					durableSourceReferences: Object.freeze([{ kind: 'audio', sourceId: 'source-audio' }]),
					removedLocatorReferences: Object.freeze([]),
				};
			},
		} as never,
	}, project, {
		protectedLinkedVideoSourceIds: ['source-video'],
	});

	assert.equal(saved, project);
	assert.deepEqual(roots, [[
		{ kind: 'audio', sourceId: 'source-audio' },
		{ kind: 'video', sourceId: 'source-video' },
	]]);
	assert.deepEqual(durable, [{
		durableSourceReferences: [
			{ kind: 'audio', sourceId: 'source-audio' },
			{ kind: 'video', sourceId: 'source-video' },
		],
		removedLocatorReferences: [],
	}]);
});
