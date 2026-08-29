/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createProjectAdminService,
	type ProjectAdminServiceRuntime,
} from '../src/common/editor/controller/project-admin-service.ts';
import {
	createFixture,
	deferred,
	type Project,
} from './audio-editor-project-admin-service-fixture.ts';

test('closing a dirty inactive tab reserves its history while the snapshot is persisted', async () => {
	const fixture = createFixture();
	const other = { id: 'project-b', title: 'Project B', revision: 2 };
	fixture.tabs.set(other.id, {
		projectId: other.id, dirty: true, readOnly: false, history: { present: other },
	});
	const saveStarted = deferred();
	const saveGate = deferred();
	const runtime = {
		...fixture.runtime,
		store: {
			...fixture.runtime.store,
			async saveProject(
				value: Project,
				options: Parameters<typeof fixture.runtime.store.saveProject>[1] = {},
			) {
				saveStarted.resolve();
				await saveGate.promise;
				return fixture.runtime.store.saveProject(value, options);
			},
		},
	} satisfies ProjectAdminServiceRuntime;
	const closing = createProjectAdminService(runtime).closeProjectTab(other.id);
	await saveStarted.promise;
	try {
		assert.equal(fixture.reservationActive(), true);
		assert.throws(
			() => runtime.sessionController.switchProject(other.id),
			/reserved for activation/iu,
		);
	} finally {
		saveGate.resolve();
		await closing;
	}
	assert.equal(fixture.reservationActive(), false);
	assert.ok(fixture.calls.indexOf(`release-history:${other.id}`) < fixture.calls.indexOf(`close:${other.id}`));
});
