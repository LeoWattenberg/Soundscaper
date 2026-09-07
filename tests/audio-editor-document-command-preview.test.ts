/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocumentCommandPreview } from '../src/common/editor/controller/document-command-preview.ts';

void test('preview validates the authored owner even when each view read creates a projection', () => {
	let document = { revision: 1 };
	const preview = createDocumentCommandPreview(() => document, () => ({ resolved: true }),
		(owner, command: string) => ({ owner, command }));
	const view = preview.getProject();
	assert.notEqual(view, preview.getProject());
	assert.deepEqual(preview.previewCommand(view, 'edit'), { owner: document, command: 'edit' });
	assert.throws(() => preview.previewCommand({ resolved: true }, 'edit'), /project changed/);
	document = { revision: 2 };
	assert.throws(() => preview.previewCommand(view, 'edit'), /project changed/);
});
