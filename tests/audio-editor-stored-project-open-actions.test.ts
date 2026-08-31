/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createStoredProjectOpenActions } from
	'../src/common/editor/controller/stored-project-open-actions.ts';

test('openById forwards explicit active-session revision adoption to an open tab', async () => {
	const project = Object.freeze({ id: 'project-a' });
	const switches: Array<Readonly<{ project: typeof project; options: unknown }>> = [];
	const actions = createStoredProjectOpenActions({
		copy: { projectNotFound: 'Not found' },
		state: { recentProjectIds: [], projects: [] },
		store: { loadProject: async () => null },
		sessionTab: () => ({ history: { present: project } }),
		switchProject(value, options) {
			switches.push({ project: value, options });
		},
		openProject: () => undefined,
	});

	await actions.openById(project.id, { adoptSessionRevision: true });

	assert.deepEqual(switches, [{ project, options: { adoptSessionRevision: true } }]);
});
