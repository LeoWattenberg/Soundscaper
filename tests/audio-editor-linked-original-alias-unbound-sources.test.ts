/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
	type LinkedOriginalBinding,
	type LinkedOriginalBindingInput,
} from '../src/common/editor/storage/linked-original-binding.ts';
import { LinkedOriginalProjectAliasRepository } from '../src/common/editor/storage/linked-original-project-alias-repository.ts';
import { LinkedOriginalRepository } from '../src/common/editor/storage/linked-original-repository.ts';
import type { LinkedOriginalSource } from '../src/common/editor/storage/linked-original-resolver.ts';
import { getMemoryDatabase, type EditorMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';

const SOURCE_PROJECT_ID = 'unbound-alias-source-project';
const DESTINATION_PROJECT_ID = 'unbound-alias-destination-project';
const SEED_NOW = '2026-09-07T10:00:00.000Z';
const ALIAS_NOW = '2026-09-07T11:00:00.000Z';

test('an unlinked int16 audio source does not block duplicating a project', async () => {
	const fixture = createFixture('unbound-int16');
	const linked = audioSource('linked-audio');
	const unlinked = declaredSampleFormat(audioSource('imported-aup4-audio'), 'int16');
	const original = await seedBinding(fixture, linked);

	const aliases = await fixture.aliases.copyReachableAliases(
		SOURCE_PROJECT_ID,
		DESTINATION_PROJECT_ID,
		[linked, unlinked],
	);

	assert.deepEqual(aliases.map(({ sourceId }) => sourceId), [linked.id]);
	assert.equal(aliases[0].projectId, DESTINATION_PROJECT_ID);
	assert.notEqual(aliases[0].bindingToken, original.bindingToken);
	assert.equal(await fixture.bindings.get(DESTINATION_PROJECT_ID, unlinked.id), null);
});

test('an unlinked audio source declaring a container mime type is skipped, not rejected', async () => {
	const fixture = createFixture('unbound-container-mime');
	const linked = audioSource('linked-audio');
	const unlinked = containerMimeType(audioSource('imported-mp4-audio'), 'video/mp4');
	await seedBinding(fixture, linked);

	const aliases = await fixture.aliases.copyReachableAliases(
		SOURCE_PROJECT_ID,
		DESTINATION_PROJECT_ID,
		[linked, unlinked],
	);

	assert.deepEqual(aliases.map(({ sourceId }) => sourceId), [linked.id]);
});

test('a source that still holds a stored binding must match its shape exactly', async () => {
	const fixture = createFixture('bound-drifted');
	const linked = audioSource('linked-audio');
	await seedBinding(fixture, linked);

	await assert.rejects(
		fixture.aliases.copyReachableAliases(
			SOURCE_PROJECT_ID,
			DESTINATION_PROJECT_ID,
			[declaredSampleFormat(linked, 'int16')],
		),
		/linked original binding/iu,
	);
	assert.equal(await fixture.bindings.get(DESTINATION_PROJECT_ID, linked.id), null);
});

test('duplicate source identities are still rejected when one of them is unbindable', async () => {
	const fixture = createFixture('duplicate-unbindable');
	const linked = audioSource('linked-audio');

	await assert.rejects(
		fixture.aliases.copyReachableAliases(
			SOURCE_PROJECT_ID,
			DESTINATION_PROJECT_ID,
			[declaredSampleFormat(linked, 'int16'), linked],
		),
		/duplicate source identity/iu,
	);
});

test('a structurally malformed source is still rejected outright', async () => {
	const fixture = createFixture('malformed-source');

	await assert.rejects(
		fixture.aliases.copyReachableAliases(
			SOURCE_PROJECT_ID,
			DESTINATION_PROJECT_ID,
			[{ kind: 'audio' } as unknown as LinkedOriginalSource],
		),
		/enumerable data field/iu,
	);
});

interface Fixture {
	readonly aliases: LinkedOriginalProjectAliasRepository;
	readonly bindings: LinkedOriginalRepository;
	readonly memory: EditorMemoryDatabase;
}

function createFixture(label: string): Fixture {
	const memory = getMemoryDatabase(`linked-original-unbound-${label}-${Date.now()}-${Math.random()}`);
	const port: StorageRepositoryPort = { memory, database: async () => null };
	let seedToken = 0;
	let aliasToken = 0;
	return {
		aliases: new LinkedOriginalProjectAliasRepository(port, {
			now: () => new Date(ALIAS_NOW),
			createBindingToken: () => {
				aliasToken += 1;
				return `alias_binding_${String(aliasToken).padStart(8, '0')}`;
			},
		}),
		bindings: new LinkedOriginalRepository(port, {
			now: () => new Date(SEED_NOW),
			createBindingToken: () => {
				seedToken += 1;
				return `seed_binding_${String(seedToken).padStart(8, '0')}`;
			},
		}),
		memory,
	};
}

async function seedBinding(
	fixture: Fixture,
	source: LinkedOriginalSource,
): Promise<LinkedOriginalBinding> {
	const binding = await fixture.bindings.putIfCurrent(bindingInput(source), null);
	assert.ok(binding);
	return binding;
}

function bindingInput(source: LinkedOriginalSource): LinkedOriginalBindingInput {
	assert.equal(source.kind, 'audio');
	return {
		schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
		kind: 'audio',
		projectId: SOURCE_PROJECT_ID,
		sourceId: source.id,
		storageKey: source.storageKey,
		locatorId: `${source.id}_locator_0001`,
		locatorRevision: `${source.id}_revision_0001`,
		mimeType: source.mimeType,
		byteLength: 65_536,
		sha256: 'ab'.repeat(32),
		sourceShape: {
			frameCount: 120,
			channelCount: 2,
			sampleRate: 48_000,
			originalSampleRate: 48_000,
			sampleFormat: 'float32',
			chunkFrames: 65_536,
		},
	};
}

function audioSource(id: string): LinkedOriginalSource {
	return {
		kind: 'audio', id, storageKey: `${id}-storage`, mimeType: 'audio/wav',
		frameCount: 120, channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	};
}

/** Project sources keep the imported container's declared format; duplication must tolerate it. */
function declaredSampleFormat(source: LinkedOriginalSource, sampleFormat: string): LinkedOriginalSource {
	return { ...source, sampleFormat } as unknown as LinkedOriginalSource;
}

function containerMimeType(source: LinkedOriginalSource, mimeType: string): LinkedOriginalSource {
	return { ...source, mimeType };
}
