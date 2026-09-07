/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { loadNativeEditableProject } from '../src/common/editor/controller/native-project-admission.ts';

test('native decoding publishes the history-admitted document rather than the loader input', () => {
	const stored = { id: 'decoded' };
	const admitted = { id: 'decoded', sources: [] };
	const result = loadNativeEditableProject({
		loadProject: () => ({ project: stored, readOnly: false }),
		createHistory(project) { assert.equal(project, stored); return { present: admitted }; },
	}, {});
	assert.equal(result.project, admitted);
});

test('native decoding cannot publish PCM into a read-only loader result', () => {
	for (const flags of [{ readOnly: true }, { readOnly: false, intrinsicReadOnly: true }]) {
		assert.throws(() => loadNativeEditableProject({
			loadProject: () => ({ project: {}, ...flags }),
			createHistory() { assert.fail('Read-only input must not be admitted for native publication.'); },
		}, {}), /current editable project/);
	}
});
