/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';

void test('the current Framescaper document retains its inherited identity and selection contracts', () => {
	const project = createFramescaperProject(undefined, { id: 'typed-document', title: 'Typed project' });
	const identity: Readonly<{ id: string; title: string; sampleRate: number }> = project;
	const selectedClipIds: readonly string[] = project.selection.clipIds;
	const tracks: readonly Readonly<{ id: string; type: string; clipIds: readonly string[] }>[] = project.tracks;
	assert.equal(identity.id, 'typed-document');
	assert.equal(identity.title, 'Typed project');
	assert.ok(identity.sampleRate > 0);
	assert.deepEqual(selectedClipIds, []);
	assert.deepEqual(tracks, []);
});
