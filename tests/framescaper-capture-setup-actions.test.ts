/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperCaptureSetupActions } from '../src/common/editor/controller/capture/framescaper-capture-setup-actions.ts';

test('flyout setup loads capture without opening its dock or requesting source permissions', () => {
	const calls: string[] = [];
	const original = { openSetup: () => calls.push('load'), requestPreview: () => calls.push('permission') };
	const actions = createFramescaperCaptureSetupActions(original,
		async (panelId, visible) => { calls.push(`${panelId}:${String(visible)}`); },
		() => { calls.push('error'); });
	actions.openSetup({ showPanel: false });
	assert.deepEqual(calls, ['load']);
	assert.equal(actions.requestPreview, original.requestPreview);
	actions.openSetup();
	assert.deepEqual(calls, ['load', 'load', 'recording-setup:true']);
});

test('explicit dock setup reports visibility failures without requesting source permissions', async () => {
	const failure = new Error('Workspace persistence failed');
	const errors: unknown[] = [];
	let permissions = 0;
	const actions = createFramescaperCaptureSetupActions({ openSetup: () => undefined, requestPreview: () => { permissions += 1; } },
		() => Promise.reject(failure), (error) => { errors.push(error); });
	actions.openSetup({ showPanel: true });
	await Promise.resolve();
	assert.deepEqual(errors, [failure]);
	assert.equal(permissions, 0);
});
