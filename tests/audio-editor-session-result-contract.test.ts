/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorSessionController } from '../src/common/editor/session.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import type { ProjectAdminServiceRuntime } from '../src/common/editor/controller/document/internal/project/project-admin-runtime.ts';

void test('session close retains its result fields through source retirement', () => {
	const session = createAudioEditorSessionController() satisfies
		Pick<ProjectAdminServiceRuntime['sessionController'], 'closeProject'>;
	const project = createCurrentAudioEditorProject({ id: 'close-result' });
	session.openProject(project);
	const result = session.closeProject(project.id, { force: true });
	assert.equal(result.closed, true);
	assert.equal(result.reason, null);
	assert.deepEqual(result.releasedSourceIds, []);
	assert.equal(session.getSnapshot().activeProjectId, null);
	assert.equal(session.dispose().disposed, true);
});
