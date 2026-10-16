/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareMixRenderOperationCommit } from '../src/common/editor/controller/track-audio/internal/mix-render/mix-render-commit.ts';
import { normalizeMixRenderOptions } from '../src/common/editor/controller/track-audio/mix-render-options.ts';
import type { ControllerProject, ControllerSource } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { createAddClipCommand } from '../src/common/editor/commands/factories.ts';
import { createEditorHistory, executeEditorCommand, undoEditorCommand, redoEditorCommand } from '../src/common/editor/history.js';
import { apply, createFixture } from './helpers/audio-editor-model-harness.js';

for (const mixDown of [true, false]) for (const grouped of [true, false])
	test(`${mixDown ? 'combined' : 'individual'} track print preserves ${grouped ? 'grouped' : 'independent'} unselected recordings`, () => {
		let project = createFixture({ frameCount: 4800, channelCount: 1 });
		for (const [index, id] of ['lead', 'peer'].entries()) project = apply(project, createAddClipCommand(`track-${index + 1}`, {
			id, sourceId: 'source-1', title: id, sourceStartFrame: 0, sourceDurationFrames: 4800,
			timelineStartFrame: 0, durationFrames: 4800, gain: index ? 0.5 : 1,
		}));
		if (grouped) project = apply(project, { type: 'clip/group', clipIds: ['lead', 'peer'], groupId: 'authored-group' });
		project = apply(project, { type: 'selection/set', startFrame: 0, endFrame: 4800, trackIds: ['track-1'], clipIds: [] });
		const original = project;
		const projection = project as unknown as ControllerProject;
		const source = { ...projection.sources[0], id: 'print', storageKey: 'print' } as ControllerSource;
		let sequence = 0;
		const prepared = prepareMixRenderOperationCommit(projection, [{ targetTracks: [projection.tracks[0]!],
			source, startFrame: 0, name: 'Printed' }], normalizeMixRenderOptions({ mixDown, renderEffects: true, replaceOriginals: true }),
		{ createId: prefix => `${prefix}-${++sequence}` });
		let history = executeEditorCommand(createEditorHistory(project), prepared.command);
		const changed = history.present as unknown as ControllerProject;
		assert.equal(changed.clips.length, 2, 'a track print must not remove recordings on unselected tracks');
		assert.deepEqual(changed.clips.find(clip => clip.id === 'peer'), projection.clips.find(clip => clip.id === 'peer'));
		assert.deepEqual(changed.tracks[1], projection.tracks[1]);
		assert.equal(changed.clips.find(clip => clip.id === prepared.results[0]?.clipId)?.sourceId, 'print');
		assert.equal(history.undoStack.length, 1);
		history = undoEditorCommand(history);
		assert.deepEqual(history.present.clips, original.clips);
		assert.deepEqual(history.present.tracks, original.tracks);
		history = redoEditorCommand(history);
		assert.deepEqual(history.present.clips, changed.clips);
		assert.deepEqual(history.present.tracks, changed.tracks);
	});
