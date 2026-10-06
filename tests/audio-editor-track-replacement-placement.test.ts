/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { trackReplacementPlacement } from '../src/common/editor/controller/track-audio/internal/track-replacement-placement.ts';

test('legacy tracks retain flat insertion without hierarchy placement', () => {
	assert.deepEqual(trackReplacementPlacement({ tracks: [{ id: 'audio' }] }, 'audio'), {});
});

test('replacement placement counts folder siblings instead of flattened descendants', () => {
	const project = { sequences: [{ id: 'sequence', trackNodes: [
		{ kind: 'folder', id: 'band', parentFolderId: null },
		{ kind: 'folder', id: 'drums', parentFolderId: 'band' },
		{ kind: 'track', id: 'kick', parentFolderId: 'drums' },
		{ kind: 'track', id: 'snare', parentFolderId: 'drums' },
		{ kind: 'track', id: 'audio', parentFolderId: 'band' },
	] }] };
	assert.deepEqual(trackReplacementPlacement(project, 'audio'), {
		sequenceId: 'sequence', parentFolderId: 'band', parentIndex: 1,
	});
	assert.deepEqual(trackReplacementPlacement(project, 'audio', 1), {
		sequenceId: 'sequence', parentFolderId: 'band', parentIndex: 2,
	});
	assert.deepEqual(trackReplacementPlacement({ ...project, primarySequenceId: 'sequence' }, 'audio'), {
		parentFolderId: 'band', parentIndex: 1,
	});
});
