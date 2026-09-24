/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixture } from './helpers/audio-editor-project-switch-fixture.ts';

test('adopting an externally published revision verifies and records that exact stored project', async () => {
	const fixture = createFixture();
	const active = fixture.getProject();
	assert.ok(active);
	const published = { ...active, revision: active.revision + 1 };
	fixture.replaceTabHistory(active.id, { present: published });
	let recorded: unknown = null;
	Object.assign(fixture.runtime, {
		isPersistedSnapshotCurrent: async () => false,
		isActivatedProjectCurrent: async (candidate: unknown) => candidate === published,
		recordPersistedSnapshot: (candidate: unknown) => { recorded = candidate; },
	});

	await fixture.service.switchProject(published, { adoptSessionRevision: true });

	assert.equal(fixture.state.readOnly, false);
	assert.strictEqual(recorded, published);
	assert.strictEqual(fixture.getProject(), published);
});

test('adoption cannot refresh the save baseline when the stored revision differs', async () => {
	const fixture = createFixture();
	const active = fixture.getProject();
	assert.ok(active);
	const published = { ...active, revision: active.revision + 1 };
	fixture.replaceTabHistory(active.id, { present: published });
	let recorded = false;
	Object.assign(fixture.runtime, {
		isPersistedSnapshotCurrent: async () => true,
		isActivatedProjectCurrent: async () => false,
		recordPersistedSnapshot: () => { recorded = true; },
	});

	await fixture.service.switchProject(published, { adoptSessionRevision: true });

	assert.equal(fixture.state.readOnly, true);
	assert.equal(recorded, false);
});
