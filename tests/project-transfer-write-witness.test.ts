/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	projectTransferWitnessedHomeStore,
	witnessProjectTransferWrites,
	type ProjectTransferImportStore,
} from '../src/common/transfer/project-transfer-bundle-admission.ts';

interface StoredProject { readonly id: string; readonly title: string }

class PrivateStore implements ProjectTransferImportStore {
	#projects = new Map<string, StoredProject>();

	loadProject(projectId: string): StoredProject | null {
		return this.#projects.get(projectId) ?? null;
	}

	createScapeProjectIfAbsent(project: StoredProject): StoredProject | null {
		if (this.#projects.has(project.id)) return null;
		this.#projects.set(project.id, project);
		return project;
	}
}

test('write witness forwards with a private-field store receiver and records only its entry identity', async () => {
	const store = new PrivateStore();
	const witness = witnessProjectTransferWrites(store, 'expected');
	const other = { id: 'other', title: 'Another entry' };
	const expected = { id: 'expected', title: 'Imported entry' };

	assert.strictEqual(await witness.store.createScapeProjectIfAbsent?.(other), other);
	assert.strictEqual(witness.created(), null);
	assert.strictEqual(await witness.store.createScapeProjectIfAbsent?.(expected), expected);
	assert.strictEqual(witness.store.loadProject('expected'), expected);
	assert.strictEqual(witness.created(), expected);
});

test('archive home routing carries the same write witness and reuses its facade', async () => {
	const federation = new PrivateStore();
	const home = new PrivateStore();
	const witness = witnessProjectTransferWrites(federation, 'expected');
	const routed = projectTransferWitnessedHomeStore(witness.store, home) as PrivateStore;
	const published = { id: 'expected', title: 'Home publication' };

	assert.strictEqual(projectTransferWitnessedHomeStore(routed, home), routed);
	assert.strictEqual(await routed.createScapeProjectIfAbsent(published), published);
	assert.strictEqual(witness.created(), published);
	assert.strictEqual(home.loadProject('expected'), published);
	assert.strictEqual(federation.loadProject('expected'), null);
	assert.strictEqual(projectTransferWitnessedHomeStore(home, federation), federation);
});
