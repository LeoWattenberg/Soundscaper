/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocumentTrackFolderSnapshot } from '../src/common/editor/controller/document/document-track-folder-snapshot.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { planTrackListRows, trackFolderRowTabIndex } from '../src/common/editor/ui/timeline/track-folder-ui-model.ts';

test('a hidden active folder yields the roving tab stop to its visible ancestor', () => {
	const project = createCurrentAudioEditorProject({
		id: 'folder-focus', primarySequenceId: 'main', now: '2026-10-06T10:00:00.000Z',
		tracks: [createAudioTrack({ id: 'audio' })],
		trackFolders: [{ id: 'parent', name: 'Parent', collapsed: true },
			{ id: 'child', name: 'Child' }, { id: 'other', name: 'Other' }],
		sequences: [{ id: 'main', trackNodes: [
			{ kind: 'folder', id: 'parent', parentFolderId: null },
			{ kind: 'folder', id: 'child', parentFolderId: 'parent' },
			{ kind: 'track', id: 'audio', parentFolderId: 'child' },
			{ kind: 'folder', id: 'other', parentFolderId: null },
		] }],
	});
	const plan = planTrackListRows(createDocumentTrackFolderSnapshot(project), project.tracks, project.trackFolders);
	const [parent, child, other] = plan.folderRows;
	assert.ok(parent && child && other);
	assert.equal(trackFolderRowTabIndex(parent, 'child', plan), 0);
	assert.equal(trackFolderRowTabIndex(child, 'child', plan), -1);
	assert.equal(trackFolderRowTabIndex(other, 'child', plan), -1);
	assert.equal(trackFolderRowTabIndex(parent, 'removed-folder', plan), 0);
	assert.equal(trackFolderRowTabIndex(other, 'other', plan), 0);
	assert.equal(trackFolderRowTabIndex(parent, 'other', plan), -1);
});
