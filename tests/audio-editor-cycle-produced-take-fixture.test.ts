/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { validateCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { readPcm } from './helpers/desktop-project-library-fallback-handoff-fixture.ts';
import { createCycleProducedTakeFixture } from './helpers/cycle-produced-take-fixture.ts';

for (const productionPath of ['finalize', 'recovery'] as const) {
	test(`durable cycle ${productionPath} output reopens with two exact ordered take lanes`, async (context) => {
		const fixture = await createCycleProducedTakeFixture(productionPath);
		context.after(async () => { await fixture.store.close(); });
		assert.equal(validateCurrentAudioEditorProject(fixture.project), true);
		const group = fixture.project.takeGroups[0];
		assert.ok(group);
		assert.deepEqual(group.laneOrder, ['cycle-produced-lane-a', 'cycle-produced-lane-b']);
		assert.deepEqual(group.takes.map(({ laneId, sourceId }) => ({ laneId, sourceId })), [
			{ laneId: 'cycle-produced-lane-a', sourceId: 'cycle-produced-source-a' },
			{ laneId: 'cycle-produced-lane-b', sourceId: 'cycle-produced-source-b' },
		]);
		const reopened = await fixture.store.loadProject(fixture.project.id);
		assert.ok(reopened);
		assert.equal(serializeScapeProjectDocument(reopened), serializeScapeProjectDocument(fixture.project));
		for (const { channels, source } of fixture.pcm) {
			assert.deepEqual(await readPcm(fixture.store, String(source.storageKey)), channels);
		}
	});
}
