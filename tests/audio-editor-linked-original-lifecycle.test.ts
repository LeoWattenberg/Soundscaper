/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
	type LinkedOriginalBindingInput,
} from '../src/common/editor/storage/linked-original-binding.ts';
import {
	LinkedOriginalLifecycleCoordinator,
	type LocalStoreClearAdmission,
} from '../src/common/editor/storage/linked-original-lifecycle-coordinator.ts';
import { LinkedOriginalRepository } from '../src/common/editor/storage/linked-original-repository.ts';
import type { LinkedOriginalLocatorReference } from '../src/common/editor/storage/linked-original-repository.ts';
import { LinkedOriginalResolver } from '../src/common/editor/storage/linked-original-resolver.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';

const LOCATOR_ID = 'shared_locator_0000000001';
const AUDIO_REVISION = 'audio_revision_00000001';
const VIDEO_REVISION = 'video_revision_00000001';
const FIRST_BINDING_TOKEN = 'binding_token_00000001';
const SECOND_BINDING_TOKEN = 'binding_token_00000002';

test('project cleanup identities aliases by kind before exact release', async () => {
	const fixture = createFixture();
	await seedBinding(fixture, 'audio-project', 'audio-source', 'audio');
	await seedBinding(fixture, 'video-project', 'video-source', 'video');

	await fixture.lifecycle.deleteProject('audio-project', async () => {
		await deleteBinding(fixture, 'audio-project', 'audio-source');
	});
	assert.deepEqual(fixture.releases, [{
		kind: 'audio', locatorId: LOCATOR_ID, locatorRevision: AUDIO_REVISION,
	}]);
	assert.ok(await fixture.bindings.get('video-project', 'video-source'));

	await fixture.lifecycle.deleteProject('video-project', async () => {
		await deleteBinding(fixture, 'video-project', 'video-source');
	});
	assert.deepEqual(fixture.releases, [
		{ kind: 'audio', locatorId: LOCATOR_ID, locatorRevision: AUDIO_REVISION },
		{ kind: 'video', locatorId: LOCATOR_ID, locatorRevision: VIDEO_REVISION },
	]);
});

test('save maintenance clears an exact transient binding only when the prune settles it', async () => {
	const fixture = createFixture();
	await fixture.lifecycle.bind(
		'project-a',
		{ kind: 'audio', sourceId: 'source-a' },
		async () => bindResult('project-a', 'source-a', FIRST_BINDING_TOKEN),
	);
	const transientBindings: unknown[] = [];

	await fixture.lifecycle.saveProject('project-a', async (maintain) => {
		await maintain();
		return true;
	}, async (transient) => {
		transientBindings.push(transient);
		return {
			durableSourceReferences: Object.freeze([{ kind: 'audio', sourceId: 'source-a' }]),
			removedLocatorReferences: Object.freeze([]),
			settledTransientBindings: transient,
		};
	});
	await fixture.lifecycle.saveProject('project-a', async () => true, async (transient) => {
		transientBindings.push(transient);
		return {
			durableSourceReferences: Object.freeze([]),
			removedLocatorReferences: Object.freeze([]),
			settledTransientBindings: Object.freeze([]),
		};
	});

	assert.deepEqual(transientBindings, [[{
		kind: 'audio', sourceId: 'source-a', bindingToken: FIRST_BINDING_TOKEN,
	}], []]);
});

test('rebind replaces the remembered token and stale settlement cannot clear it', async () => {
	const fixture = createFixture();
	await fixture.lifecycle.bind(
		'project-a',
		{ kind: 'audio', sourceId: 'same-source' },
		async () => bindResult('project-a', 'same-source', FIRST_BINDING_TOKEN),
	);
	await fixture.lifecycle.bind(
		'project-a',
		{ kind: 'audio', sourceId: 'same-source' },
		async () => bindResult('project-a', 'same-source', SECOND_BINDING_TOKEN),
	);
	const observed: unknown[] = [];
	const stale = Object.freeze([{
		kind: 'audio' as const, sourceId: 'same-source', bindingToken: FIRST_BINDING_TOKEN,
	}]);

	await fixture.lifecycle.saveProject('project-a', async () => true, async (transient) => {
		observed.push(transient);
		return {
			durableSourceReferences: Object.freeze([]),
			removedLocatorReferences: Object.freeze([]),
			settledTransientBindings: stale,
		};
	});
	await fixture.lifecycle.saveProject('project-a', async () => true, async (transient) => {
		observed.push(transient);
		return {
			durableSourceReferences: Object.freeze([]),
			removedLocatorReferences: Object.freeze([]),
			settledTransientBindings: transient,
		};
	});
	await fixture.lifecycle.saveProject('project-a', async () => true, async (transient) => {
		observed.push(transient);
		return {
			durableSourceReferences: Object.freeze([]),
			removedLocatorReferences: Object.freeze([]),
			settledTransientBindings: Object.freeze([]),
		};
	});

	assert.deepEqual(observed, [
		[{ kind: 'audio', sourceId: 'same-source', bindingToken: SECOND_BINDING_TOKEN }],
		[{ kind: 'audio', sourceId: 'same-source', bindingToken: SECOND_BINDING_TOKEN }],
		[],
	]);
});

test('a stale successful unlink cannot forget a newer transient binding', async () => {
	const fixture = createFixture();
	await fixture.lifecycle.bind(
		'project-a',
		{ kind: 'video', sourceId: 'source-a' },
		async () => bindResult('project-a', 'source-a', FIRST_BINDING_TOKEN),
	);
	await fixture.lifecycle.bind(
		'project-a',
		{ kind: 'video', sourceId: 'source-a' },
		async () => bindResult('project-a', 'source-a', SECOND_BINDING_TOKEN),
	);
	assert.equal(await fixture.lifecycle.unlink(
		'project-a',
		{ kind: 'video', sourceId: 'source-a', bindingToken: FIRST_BINDING_TOKEN },
		async () => true,
	), true);

	await fixture.lifecycle.saveProject('project-a', async () => true, async (transient) => {
		assert.deepEqual(transient, [{
			kind: 'video', sourceId: 'source-a', bindingToken: SECOND_BINDING_TOKEN,
		}]);
		return {
			durableSourceReferences: Object.freeze([]),
			removedLocatorReferences: Object.freeze([]),
			settledTransientBindings: transient,
		};
	});
});

test('failed exact releases retry per kind after rechecking live aliases', async () => {
	let attempts = 0;
	const fixture = createFixture({
		release: async (reference) => {
			attempts += 1;
			if (attempts === 1) throw new Error('planned audio release failure');
			fixture.releases.push(reference);
			return true;
		},
	});
	await seedBinding(fixture, 'project-a', 'audio-a', 'audio');
	await fixture.lifecycle.deleteProject('project-a', async () => {
		await deleteBinding(fixture, 'project-a', 'audio-a');
	});
	assert.equal(attempts, 1);

	await seedBinding(fixture, 'project-b', 'audio-b', 'audio');
	await fixture.lifecycle.run(async () => undefined);
	assert.equal(attempts, 1, 'the rebound exact audio alias suppresses pending cleanup');
	await fixture.lifecycle.deleteProject('project-b', async () => {
		await deleteBinding(fixture, 'project-b', 'audio-b');
	});
	assert.equal(attempts, 2);
	assert.deepEqual(fixture.releases, [{
		kind: 'audio', locatorId: LOCATOR_ID, locatorRevision: AUDIO_REVISION,
	}]);
});

test('a repeatedly rejected pending release does not starve unrelated open maintenance or retry twice', async () => {
	const stuckLocatorId = 'stuck_locator_0000000001';
	const freshLocatorId = 'fresh_locator_0000000001';
	const attempts: string[] = [];
	const fixture = createFixture({
		release: async (reference) => {
			attempts.push(reference.locatorId);
			if (reference.locatorId === stuckLocatorId) throw new Error('planned persistent release failure');
			fixture.releases.push(reference);
			return true;
		},
	});
	const result = (locatorId: string) => ({
		durableSourceReferences: Object.freeze([]),
		removedLocatorReferences: Object.freeze([{
			kind: 'audio' as const, locatorId, locatorRevision: AUDIO_REVISION,
		}]),
		settledTransientBindings: Object.freeze([]),
	});

	assert.equal(await fixture.lifecycle.maintainOpenedProject('project-a', async () => result(stuckLocatorId)), true);
	let pruned = false;
	assert.equal(await fixture.lifecycle.maintainOpenedProject('project-b', async () => {
		pruned = true;
		return result(freshLocatorId);
	}), true);
	assert.equal(pruned, true);
	assert.deepEqual(attempts, [stuckLocatorId, stuckLocatorId, freshLocatorId]);
	assert.deepEqual(fixture.releases, [{
		kind: 'audio', locatorId: freshLocatorId, locatorRevision: AUDIO_REVISION,
	}]);
});

test('clear releases only after the local binding commit and never owns external bodies', async () => {
	const fixture = createFixture();
	await seedBinding(fixture, 'project-a', 'audio-a', 'audio');
	await seedBinding(fixture, 'project-b', 'video-b', 'video');
	const events: string[] = [];
	const admission: LocalStoreClearAdmission = {
		begin: () => {
			const completion = (async () => {
				events.push('commit');
				await deleteBinding(fixture, 'project-a', 'audio-a');
				await deleteBinding(fixture, 'project-b', 'video-b');
			})();
			return {
				localCommit: completion.then(() => true),
				completion,
			};
		},
		cancel: () => undefined,
	};
	fixture.releaseEvent = () => { events.push('release'); };

	await fixture.lifecycle.clear(admission);

	assert.deepEqual(events, ['commit', 'release', 'release']);
	assert.deepEqual(fixture.releases, [
		{ kind: 'audio', locatorId: LOCATOR_ID, locatorRevision: AUDIO_REVISION },
		{ kind: 'video', locatorId: LOCATOR_ID, locatorRevision: VIDEO_REVISION },
	]);
});

test('an invalid post-commit cleanup reference is reported without undoing publication', async () => {
	const reported: unknown[] = [];
	const fixture = createFixture({ onCleanupError: (error) => { reported.push(error); } });
	const invalid = Object.freeze({
		kind: 'audio',
		locatorId: 'not-valid',
		locatorRevision: AUDIO_REVISION,
	}) as unknown as LinkedOriginalLocatorReference;

	assert.equal(await fixture.lifecycle.saveProject('project-a', async (maintain) => {
		await maintain();
		return 'committed';
	}, async () => ({
		durableSourceReferences: Object.freeze([]),
		removedLocatorReferences: Object.freeze([invalid]),
		settledTransientBindings: Object.freeze([]),
	})), 'committed');
	assert.equal(reported.length, 1);
	assert.equal((reported[0] as { committed?: unknown }).committed, true);
});

interface Fixture {
	readonly bindings: LinkedOriginalRepository;
	readonly lifecycle: LinkedOriginalLifecycleCoordinator;
	readonly releases: Array<{
		kind: 'audio' | 'video';
		locatorId: string;
		locatorRevision: string;
	}>;
	releaseEvent: () => void;
}

function createFixture(options: Readonly<{
	release?: (reference: Fixture['releases'][number]) => Promise<boolean>;
	onCleanupError?: (error: unknown) => void;
}> = {}): Fixture {
	const memory = getMemoryDatabase(`linked-original-lifecycle-${Date.now()}-${Math.random()}`);
	const bindings = new LinkedOriginalRepository({ memory, database: async () => null });
	const releases: Fixture['releases'] = [];
	const fixture = {} as Fixture;
	fixture.releaseEvent = () => undefined;
	const resolver = new LinkedOriginalResolver(bindings, {
		load: async () => null,
		release: options.release ?? (async (reference) => {
			fixture.releaseEvent();
			releases.push(reference);
			return true;
		}),
	});
	Object.assign(fixture, {
		bindings,
		lifecycle: new LinkedOriginalLifecycleCoordinator(bindings, resolver, {
			onCleanupError: options.onCleanupError ?? (() => undefined),
		}),
		releases,
	});
	return fixture;
}

async function seedBinding(
	fixture: Fixture,
	projectId: string,
	sourceId: string,
	kind: 'audio' | 'video',
): Promise<void> {
	assert.ok(await fixture.bindings.putIfCurrent(bindingInput(projectId, sourceId, kind), null));
}

async function deleteBinding(fixture: Fixture, projectId: string, sourceId: string): Promise<void> {
	const binding = await fixture.bindings.get(projectId, sourceId);
	assert.ok(binding);
	assert.equal(await fixture.bindings.deleteIfCurrent(projectId, sourceId, binding.bindingToken), true);
}

function bindingInput(
	projectId: string,
	sourceId: string,
	kind: 'audio' | 'video',
): LinkedOriginalBindingInput {
	const shared = {
		schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
		projectId,
		sourceId,
		storageKey: `${sourceId}-storage`,
		locatorId: LOCATOR_ID,
		locatorRevision: kind === 'audio' ? AUDIO_REVISION : VIDEO_REVISION,
		mimeType: kind === 'audio' ? 'audio/wav' : 'video/mp4',
		byteLength: 1,
		sha256: '0'.repeat(64),
	};
	return kind === 'audio' ? {
		...shared,
		kind,
		sourceShape: {
			frameCount: 1, channelCount: 1, sampleRate: 48_000,
			originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
		},
	} : {
		...shared,
		kind,
		sourceShape: {
			frameCount: 1, sampleRate: 48_000, width: 16, height: 9,
			frameRate: 30, videoCodec: 'h264', audioCodec: null, hasAudio: false,
		},
	};
}

function bindResult(projectId: string, sourceId: string, bindingToken: string) {
	return Object.freeze({ projectId, sourceId, bindingToken });
}
