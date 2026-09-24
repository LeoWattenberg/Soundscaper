/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixture } from './helpers/audio-editor-project-switch-fixture.ts';

test('adopting a committed same-ID replacement installs its document and resets old undo history', async () => {
	const fixture = createFixture();
	const active = fixture.getProject();
	assert.ok(active);
	fixture.replaceTabHistory(active.id, {
		present: active,
		undoStack: [{ project: active, command: { type: 'old/edit' } }],
	} as Parameters<typeof fixture.replaceTabHistory>[1]);
	const replacement = { ...active, title: 'Imported replacement', revision: active.revision + 1 };
	let verified: unknown = null;
	let recorded: unknown = null;
	Object.assign(fixture.runtime, {
		isActivatedProjectCurrent: async (candidate: unknown) => { verified = candidate; return candidate === replacement; },
		recordPersistedSnapshot: (candidate: unknown) => { recorded = candidate; },
	});

	await fixture.service.switchProject(replacement, {
		adoptSessionRevision: true, replaceSessionHistory: true, skipFlush: true,
	});

	assert.strictEqual(verified, replacement);
	assert.equal(fixture.getProject()?.title, 'Imported replacement');
	assert.equal(fixture.getTab(active.id)?.history.present.title, 'Imported replacement');
	assert.deepEqual(fixture.getTab(active.id)?.history, { present: replacement });
	assert.equal((recorded as typeof replacement | null)?.title, replacement.title);
	assert.equal(fixture.state.readOnly, false);
	assert.equal(fixture.events.includes('save-now'), false);
});
