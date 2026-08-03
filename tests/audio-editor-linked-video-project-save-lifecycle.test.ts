/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	LinkedVideoOriginalLifecycleCoordinator,
} from '../src/common/editor/storage/linked-video-original-lifecycle-coordinator.ts';
import { LinkedVideoOriginalRepository } from '../src/common/editor/storage/linked-video-original-repository.ts';
import { LinkedVideoOriginalResolver } from '../src/common/editor/storage/linked-video-original-resolver.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';

const LOCATOR_ID = 'locator_0000000000000001';
const LOCATOR_REVISION = 'snapshot_0000000000000001';
const BINDING_TOKEN = 'binding_token_00000001';

test('save maintenance protects a new binding until one durable snapshot reaches it', async () => {
	const fixture = lifecycleFixture();
	await fixture.lifecycle.bind(
		'project-a', 'source-a', async () => bindResult('project-a', 'source-a'),
	);
	const transientBindings: unknown[] = [];

	await fixture.lifecycle.saveProject(
		'project-a',
		async (maintain) => {
			await maintain();
			return 'saved';
		},
		async (transient) => {
			transientBindings.push(transient);
			return {
				durableVideoSourceIds: Object.freeze(['source-a']),
				removedLocatorReferences: Object.freeze([]),
				settledTransientBindings: transient,
			};
		},
	);
	await fixture.lifecycle.saveProject(
		'project-a',
		async () => 'saved-again',
		async (transient) => {
			transientBindings.push(transient);
			return {
				durableVideoSourceIds: Object.freeze([]),
				removedLocatorReferences: Object.freeze([]),
				settledTransientBindings: Object.freeze([]),
			};
		},
	);

	assert.deepEqual(transientBindings, [[{
		kind: 'video', sourceId: 'source-a', bindingToken: BINDING_TOKEN,
	}], []]);
});

test('suppressed and failed save cleanup retain transient binding protection', async () => {
	const reported: unknown[] = [];
	const fixture = lifecycleFixture({ onCleanupError: (error) => { reported.push(error); } });
	await fixture.lifecycle.bind(
		'project-a', 'source-a', async () => bindResult('project-a', 'source-a'),
	);
	const roots: unknown[] = [];

	assert.equal(await fixture.lifecycle.saveProject(
		'project-a',
		async (maintain) => { await maintain(); return 'suppressed'; },
		async (transient) => { roots.push(transient); return null; },
	), 'suppressed');
	assert.equal(await fixture.lifecycle.saveProject(
		'project-a',
		async (maintain) => { await maintain(); return 'cleanup-failed'; },
		async (transient) => {
			roots.push(transient);
			throw new Error('planned binding cleanup failure');
		},
	), 'cleanup-failed');

	assert.deepEqual(roots, [
		[{ kind: 'video', sourceId: 'source-a', bindingToken: BINDING_TOKEN }],
		[{ kind: 'video', sourceId: 'source-a', bindingToken: BINDING_TOKEN }],
	]);
	assert.deepEqual(pickProjectCleanupError(reported[0]), {
		name: 'LinkedVideoOriginalProjectBindingCleanupError',
		committed: true,
		operation: 'save-project',
		projectId: 'project-a',
	});
});

test('a rejected save before post-commit maintenance does not prune bindings', async () => {
	const fixture = lifecycleFixture();
	const failure = new Error('planned project commit failure');
	let pruneCalls = 0;

	await assert.rejects(fixture.lifecycle.saveProject(
		'project-a',
		async () => { throw failure; },
		async () => { pruneCalls += 1; return null; },
	), (error) => error === failure);
	assert.equal(pruneCalls, 0);
});

test('post-commit maintenance is idempotent and falls back when a repository ignores it', async () => {
	const fixture = lifecycleFixture();
	let pruneCalls = 0;
	const prune = async () => {
		pruneCalls += 1;
		return {
			durableVideoSourceIds: Object.freeze([]),
			removedLocatorReferences: Object.freeze([]),
			settledTransientBindings: Object.freeze([]),
		};
	};

	await fixture.lifecycle.saveProject('project-a', async (maintain) => {
		await Promise.all([maintain(), maintain()]);
		return true;
	}, prune);
	await fixture.lifecycle.saveProject('project-a', async () => true, prune);

	assert.equal(pruneCalls, 2);
});

test('save cleanup exact-releases a removed locator only after rechecking aliases', async () => {
	const fixture = lifecycleFixture();
	const removed = Object.freeze([{ locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION }]);
	await fixture.lifecycle.saveProject('project-a', async (maintain) => {
		await maintain();
		return true;
	}, async () => ({
		durableVideoSourceIds: Object.freeze([]),
		removedLocatorReferences: removed,
		settledTransientBindings: Object.freeze([]),
	}));
	assert.deepEqual(fixture.releases, [removed[0]]);

	await fixture.bindings.putIfCurrent(bindingInput('project-b', 'source-b'), null);
	await fixture.lifecycle.saveProject('project-a', async (maintain) => {
		await maintain();
		return true;
	}, async () => ({
		durableVideoSourceIds: Object.freeze([]),
		removedLocatorReferences: removed,
		settledTransientBindings: Object.freeze([]),
	}));
	assert.deepEqual(fixture.releases, [removed[0]], 'a surviving alias must suppress a second release');
});

function lifecycleFixture(options: Readonly<{
	onCleanupError?: (error: unknown) => void;
}> = {}) {
	const memory = getMemoryDatabase(`save-lifecycle-${Date.now()}-${Math.random()}`);
	const bindings = new LinkedVideoOriginalRepository({ memory, database: async () => null });
	const releases: Array<{ locatorId: string; locatorRevision: string }> = [];
	const resolver = new LinkedVideoOriginalResolver(bindings, {
		load: async () => null,
		release: async (reference) => { releases.push(reference); return true; },
	});
	const lifecycle = new LinkedVideoOriginalLifecycleCoordinator(bindings, resolver, {
		onCleanupError: options.onCleanupError,
	});
	return { bindings, lifecycle, releases };
}

function bindingInput(projectId: string, sourceId: string) {
	return {
		schemaVersion: 1 as const,
		projectId,
		sourceId,
		storageKey: sourceId,
		locatorId: LOCATOR_ID,
		locatorRevision: LOCATOR_REVISION,
		mimeType: 'video/mp4',
		byteLength: 1,
		sha256: '0'.repeat(64),
		sourceShape: {
			frameCount: 1, sampleRate: 48_000, width: 16, height: 9,
			frameRate: 30, videoCodec: 'h264', audioCodec: null, hasAudio: false,
		},
	};
}

function bindResult(projectId: string, sourceId: string) {
	return Object.freeze({ projectId, sourceId, bindingToken: BINDING_TOKEN });
}

function pickProjectCleanupError(value: unknown) {
	const error = value as Record<string, unknown>;
	return {
		name: error.name,
		committed: error.committed,
		operation: error.operation,
		projectId: error.projectId,
	};
}
