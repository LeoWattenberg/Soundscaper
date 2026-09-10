/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { DocumentProject } from '../src/common/editor/controller/document/document-composition-types.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createOpaqueProjectConsumer } from '../src/common/editor/project-opaque-consumer.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';

test('validated current documents and constructed opaque views satisfy the document port', () => {
	const current: DocumentProject = createCurrentAudioEditorProject({ id: 'current' });
	const opaque: DocumentProject = createOpaqueProjectConsumer({ id: 'future' }, { schemaVersion: 999 });
	assert.equal(current.id, 'current');
	assert.equal(opaque.id, 'future');
	assert.equal(opaque.schemaVersion, 999);
	assert.deepEqual(opaque.tracks, []);
	assert.equal(current.selection.startFrame, 0);
});

test('Framescaper retains its own identity while satisfying the shared document port', () => {
	const frame: DocumentProject = createFramescaperProject();
	assert.equal(frame.schemaFamily, 'framescaper');
	assert.equal(frame.schemaVersion, 1);
	assert.equal(frame.selection.startFrame, 0);
});
