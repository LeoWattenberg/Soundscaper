/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { workspaceStatusPresentation } from '../src/common/editor/ui/workspace/workspace-status-presentation.ts';

test('errors move to toasts without expanding or duplicating the status toolbar', () => {
	assert.deepEqual(workspaceStatusPresentation({ message: 'Import failed', state: 'error' }, null, 'Ready'), {
		statusMessage: '', statusState: 'info', statusError: 'Import failed',
	});
	assert.deepEqual(workspaceStatusPresentation({ message: 'Import failed', state: 'error' }, 'Disk unavailable', 'Ready'), {
		statusMessage: '', statusState: 'info', statusError: null,
	});
});

test('ordinary progress and completion remain in the status toolbar', () => {
	assert.deepEqual(workspaceStatusPresentation({ message: 'Exporting', state: 'info' }, null, 'Ready'), {
		statusMessage: 'Exporting', statusState: 'info', statusError: null,
	});
	assert.deepEqual(workspaceStatusPresentation({ message: 'Saved', state: 'success' }, null, 'Ready'), {
		statusMessage: 'Saved', statusState: 'success', statusError: null,
	});
});
