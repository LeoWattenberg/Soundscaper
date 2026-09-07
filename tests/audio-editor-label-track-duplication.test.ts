/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrackDuplicationService } from '../src/common/editor/controller/track-duplication-service.ts';
import { createAddClipCommand, createAddTrackCommand } from '../src/common/editor/commands/factories.ts';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createLabelTrack } from '../src/common/editor/project-media-factory.ts';

test('duplication preserves a label track without requiring a media clip inventory', () => {
	const track = createLabelTrack({ name: 'Notes', labels: [{ title: 'Start', startFrame: 0, endFrame: 0 }] });
	let project = createCurrentAudioEditorProject({ tracks: [track] });
	const service = createTrackDuplicationService({
		lifetime: { assertActive() {} },
		copySuffix: 'copy', editingBlocked: () => false,
		getProject: () => project,
		createId: prefix => `${prefix}-copy`,
		findClip: () => { assert.fail('Label tracks do not own media clips.'); },
		cloneVideoEffects: effects => effects,
		createAddTrackCommand, createAddClipCommand,
		commit(command) { project = applyEditorCommand(project, command); },
	});
	service.duplicateTrack(track);
	assert.equal(project.tracks.length, 2);
	const duplicate = project.tracks[1];
	assert.equal(duplicate?.type, 'label');
	assert.equal(duplicate?.name, 'Notes copy');
	assert.notEqual(duplicate?.id, track.id);
	if (duplicate?.type !== 'label') assert.fail('Expected a label track.');
	assert.deepEqual(duplicate.labels, track.labels);
	assert.equal(project.clips.length, 0);
});
