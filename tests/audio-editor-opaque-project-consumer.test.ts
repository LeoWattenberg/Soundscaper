/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpaqueProjectConsumer } from '../src/common/editor/project-opaque-consumer.ts';

test('opaque consumers retain envelope identity without reading the domain or invoking getters', () => {
	const raw = {
		id: 'future', title: 'Future edit', sampleRate: 96_000,
		get tracks(): never { throw new Error('Opaque domain read'); },
		get sources(): never { throw new Error('Opaque domain read'); },
	};
	const shell = createOpaqueProjectConsumer(raw, { schemaFamily: 'framescaper', schemaVersion: 999 });
	const futureVersion: typeof shell.schemaVersion = 1000;
	assert.equal(typeof futureVersion, 'number');
	assert.equal(shell.id, 'future');
	assert.equal(shell.title, 'Future edit');
	assert.equal(shell.schemaVersion, 999);
	assert.equal(shell.schemaFamily, 'framescaper');
	assert.equal(shell.sampleRate, 96_000);
	assert.deepEqual(shell.sources, []);
	assert.deepEqual(shell.tracks, []);
	assert.deepEqual(shell.clips, []);
	assert.deepEqual(shell.takeGroups, []);
	assert.ok(Object.isFrozen(shell));
	assert.ok(Object.isFrozen(shell.tracks));
});

test('opaque envelope getters use inert defaults', () => {
	const shell = createOpaqueProjectConsumer({
		get id(): never { throw new Error('Identity getter'); },
		get title(): never { throw new Error('Title getter'); },
		get sampleRate(): never { throw new Error('Rate getter'); },
	}, { schemaVersion: 999 });
	assert.equal(shell.id, 'foreign-project');
	assert.equal(shell.title, 'Read-only project');
	assert.equal(shell.sampleRate, 48_000);
});
