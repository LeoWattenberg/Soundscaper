/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperCaptureAdminInterlock,
	FramescaperCaptureAdminInterlockConflictError,
} from '../src/common/editor/controller/framescaper-capture-admin-interlock.ts';

test('an admitted delete blocks capture until its exact lease finishes', () => {
	const interlock = createFramescaperCaptureAdminInterlock();
	const deletion = interlock.beginAdminOperation({ kind: 'delete', projectId: 'project-a' });
	assert.throws(
		() => interlock.beginCaptureAdmission('project-a'),
		(error) => error instanceof FramescaperCaptureAdminInterlockConflictError
			&& error.blockedOperation === 'capture'
			&& error.activeOperation === 'delete',
	);
	deletion.assertCurrent();
	assert.equal(deletion.release(), true);
	assert.equal(deletion.release(), false, 'lease release is idempotent');
	assert.throws(() => deletion.assertCurrent(), /no longer current/iu);
	interlock.beginCaptureAdmission('project-a').release();
});

test('capture admission blocks same-origin handoff and global clear before mutation', () => {
	const interlock = createFramescaperCaptureAdminInterlock();
	const capture = interlock.beginCaptureAdmission('project-a');
	for (const request of [
		{ kind: 'handoff' as const, projectId: 'project-a' },
		{ kind: 'clear' as const, projectId: null },
	]) {
		assert.throws(
			() => interlock.beginAdminOperation(request),
			(error) => error instanceof FramescaperCaptureAdminInterlockConflictError
				&& error.blockedOperation === request.kind
				&& error.activeOperation === 'capture',
		);
	}
	const otherClose = interlock.beginAdminOperation({ kind: 'close', projectId: 'project-b' });
	otherClose.assertCurrent();
	otherClose.release();
	capture.assertCurrent();
	capture.release();
	interlock.beginAdminOperation({ kind: 'handoff', projectId: 'project-a' }).release();
});

test('every admitted admin lease must finish before same-project capture admission', () => {
	const interlock = createFramescaperCaptureAdminInterlock();
	const closing = interlock.beginAdminOperation({ kind: 'close', projectId: 'project-a' });
	const deleting = interlock.beginAdminOperation({ kind: 'delete', projectId: 'project-a' });
	closing.release();
	assert.throws(() => interlock.beginCaptureAdmission('project-a'), /delete/iu);
	deleting.release();
	interlock.beginCaptureAdmission('project-a').release();

	const clearing = interlock.beginAdminOperation({ kind: 'clear', projectId: null });
	assert.throws(() => interlock.beginCaptureAdmission('project-b'), /clear/iu);
	clearing.release();
});

test('admin request scope is closed and project identities are stable', () => {
	const interlock = createFramescaperCaptureAdminInterlock();
	assert.throws(
		() => interlock.beginAdminOperation({ kind: 'delete', projectId: null }),
		/project ID/iu,
	);
	assert.throws(
		() => interlock.beginAdminOperation({ kind: 'clear', projectId: 'project-a' }),
		/global/iu,
	);
	assert.throws(() => interlock.beginCaptureAdmission(''), /project ID/iu);
	assert.throws(() => interlock.beginCaptureAdmission(' project-a'), /project ID/iu);
	assert.throws(() => interlock.beginCaptureAdmission('project-a\n'), /project ID/iu);
});
