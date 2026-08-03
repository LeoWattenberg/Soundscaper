/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { saveProjectWithLinkedOriginalReachability } from '../src/common/editor/storage/linked-original-project-save.ts';
import { saveProjectWithLinkedVideoOriginalReachability } from '../src/common/editor/storage/linked-video-original-project-save.ts';

test('project save keeps exact transient bindings separate from caller-protected wildcard roots', async () => {
	const roots: unknown[] = [];
	const transientBindings: unknown[] = [];
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
					const result = await prune([{
						kind: 'audio',
						sourceId: 'source-audio',
						bindingToken: 'binding_token_00000001',
					}]);
					durable.push(result);
				});
			},
		} as never,
		reachability: {
			async pruneProjectBindings(
				_projectId: string,
				references: readonly unknown[],
				transient: readonly unknown[],
			) {
				roots.push(references);
				transientBindings.push(transient);
				return {
					durableSourceReferences: Object.freeze([{ kind: 'audio', sourceId: 'source-audio' }]),
					removedLocatorReferences: Object.freeze([]),
					settledTransientBindings: transient,
				};
			},
		} as never,
	}, project, {
		protectedLinkedOriginalSourceReferences: [
			{ kind: 'audio', sourceId: 'source-caller-audio' },
			{ kind: 'video', sourceId: 'source-video' },
		],
		protectedLinkedVideoSourceIds: ['source-video'],
	});

	assert.equal(saved, project);
	assert.deepEqual(roots, [[
		{ kind: 'audio', sourceId: 'source-caller-audio' },
		{ kind: 'video', sourceId: 'source-video' },
	]]);
	assert.deepEqual(transientBindings, [[{
		kind: 'audio',
		sourceId: 'source-audio',
		bindingToken: 'binding_token_00000001',
	}]]);
	assert.deepEqual(durable, [{
		durableSourceReferences: [
			{ kind: 'audio', sourceId: 'source-audio' },
			{ kind: 'audio', sourceId: 'source-caller-audio' },
			{ kind: 'video', sourceId: 'source-video' },
		],
		removedLocatorReferences: [],
		settledTransientBindings: [{
			kind: 'audio',
			sourceId: 'source-audio',
			bindingToken: 'binding_token_00000001',
		}],
	}]);
});

test('project save protection never retains the wrong media kind for a matching source ID', async () => {
	const roots: unknown[] = [];
	const durable: unknown[] = [];
	await saveProjectWithLinkedOriginalReachability({
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
			async saveProject(
				_projectId: string,
				operation: (maintain: () => Promise<void>) => Promise<unknown>,
				prune: (references: readonly unknown[]) => Promise<unknown>,
			) {
				return operation(async () => {
					const result = await prune([]);
					durable.push(result);
				});
			},
		} as never,
		reachability: {
			async pruneProjectBindings(_projectId: string, references: readonly unknown[]) {
				roots.push(references);
				return {
					durableSourceReferences: Object.freeze([]),
					removedLocatorReferences: Object.freeze([]),
					settledTransientBindings: Object.freeze([]),
				};
			},
		} as never,
	}, { id: 'project-a', title: 'Project A' }, {
		protectedLinkedOriginalSourceReferences: [{ kind: 'audio', sourceId: 'same-source' }],
	});

	assert.deepEqual(roots, [[{ kind: 'audio', sourceId: 'same-source' }]]);
	assert.deepEqual(durable, [{
		durableSourceReferences: [{ kind: 'audio', sourceId: 'same-source' }],
		removedLocatorReferences: [],
		settledTransientBindings: [],
	}]);
});

test('the video-only save facade carries exact transient tokens separately from protected IDs', async () => {
	const protectedIds: unknown[] = [];
	const transientBindings: unknown[] = [];
	const transient = Object.freeze([{
		kind: 'video' as const,
		sourceId: 'transient-video',
		bindingToken: 'binding_token_00000001',
	}]);
	await saveProjectWithLinkedVideoOriginalReachability({
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
			async saveProject(
				_projectId: string,
				operation: (maintain: () => Promise<void>) => Promise<unknown>,
				prune: (bindings: typeof transient) => Promise<unknown>,
			) {
				return operation(async () => { await prune(transient); });
			},
		} as never,
		reachability: {
			async pruneProjectBindings(
				_projectId: string,
				ids: readonly string[],
				bindings: readonly unknown[],
			) {
				protectedIds.push(ids);
				transientBindings.push(bindings);
				return {
					durableVideoSourceIds: Object.freeze([]),
					removedLocatorReferences: Object.freeze([]),
					settledTransientBindings: bindings,
				};
			},
		} as never,
	}, { id: 'project-video', title: 'Project Video' }, {
		protectedLinkedVideoSourceIds: ['caller-video'],
	});

	assert.deepEqual(protectedIds, [['caller-video']]);
	assert.deepEqual(transientBindings, [transient]);
});
