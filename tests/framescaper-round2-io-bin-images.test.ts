/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { bindFramescaperProjectBinVisualActions, createFramescaperProjectBinVisualActions } from '../src/framescaper/editor-project-bin-visual-actions.ts';
import { createEditorProjectBinActionGroup } from '../src/common/editor/controller/composition/project-bin-action-group.ts';
import { guardEditorControllerActions } from '../src/common/editor/controller/composition/internal/controller-action-guard.ts';
import { formatProjectBinSource } from '../src/common/editor/ui/workspace/project-bin-model.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';

test('owned image bin transfers retain the source and place an independent copy at the playhead', () => {
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	assert.equal(formatProjectBinSource(fixture.source, {}), 'APNG · 2×1');
	let project = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, fixture.project, {
		type: 'selection/set', startFrame: 0, endFrame: 0, clipIds: [fixture.clip.id], trackIds: [],
	});
	const before = project;
	const commits: unknown[] = [];
	let id = 0;
	const actions = createFramescaperProjectBinVisualActions({
		get project() { return project; },
		getSnapshot: () => ({ selectedClipId: fixture.clip.id, readOnly: false }),
		getTelemetrySnapshot: () => ({ positionFrame: 96_000 }), selectClips: () => undefined,
		actions: { projectBin: {}, edit: { commit: command => {
			commits.push(command);
			project = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, project, command);
		} } },
	}, prefix => `${prefix}-copy-${String(++id)}`);
	assert.deepEqual(actions.moveFromTimeline(fixture.clip.id), [fixture.clip.id]);
	assert.equal(project.clips.some(clip => clip.id === fixture.clip.id), false);
	assert.equal(project.projectBin.clips.some(clip => clip.id === fixture.clip.id), true);
	assert.deepEqual(project.selection.clipIds, []);
	assert.equal(before.clips.some(clip => clip.id === fixture.clip.id), true, 'the undo snapshot stays intact');
	const binned = project;
	const placedId = actions.place(fixture.clip.id);
	const placed = project.clips.find(clip => clip.id === placedId);
	assert.ok(placed);
	assert.equal(placed.kind, 'image');
	assert.equal(placed.sourceId, fixture.source.id);
	assert.equal(placed.sequenceStartFrame, 20, 'two seconds on the fixture’s authored 10 fps sequence');
	assert.equal(placed.sequenceFrameCount, 150);
	assert.equal(project.projectBin.clips.some(clip => clip.id === fixture.clip.id), true);
	assert.equal(binned.clips.some(clip => clip.id === placedId), false, 'undo removes only the independent instance');
	assert.equal(commits.length, 2, 'each user transfer is one atomic history operation');
});

test('owned image bin transfer preserves read-only admission and falls back for audio', () => {
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	let committed = false;
	const actions = createFramescaperProjectBinVisualActions({ project: fixture.project,
		getSnapshot: () => ({ readOnly: true }), getTelemetrySnapshot: () => ({ positionFrame: 0 }), selectClips: () => undefined,
		actions: { projectBin: {}, edit: { commit: () => { committed = true; } } },
	});
	assert.equal(actions.moveFromTimeline(fixture.clip.id), null);
	const audio = fixture.project.clips.find(clip => clip.kind === 'audio');
	assert.ok(audio);
	assert.equal(actions.moveFromTimeline(audio.id), undefined);
	assert.equal(committed, false);
});

test('the guarded public bin group preserves owned routing and its lifetime fence', () => {
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	let project = fixture.project;
	const group = createEditorProjectBinActionGroup({
		getProjectBin: () => { throw new Error('Owned visual actions must not resolve the A/V service.'); },
		getProjectVisual: () => { throw new Error('No source preview requested.'); },
	});
	let disposed = false;
	const publicGroup = guardEditorControllerActions(group, () => { if (disposed) throw new Error('Disposed'); });
	bindFramescaperProjectBinVisualActions({
		get project() { return project; }, getSnapshot: () => ({ selectedClipId: fixture.clip.id }),
		getTelemetrySnapshot: () => ({ positionFrame: 0 }), selectClips: ids => {
			project = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, project, {
				type: 'selection/set', ...project.selection, clipIds: [...ids],
			});
		},
		actions: { projectBin: publicGroup, edit: { commit: command => {
			project = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, project, command);
		} } },
	});
	assert.deepEqual(publicGroup.moveFromTimeline(fixture.clip.id), [fixture.clip.id]);
	assert.equal(publicGroup.instanceCount(fixture.clip.id), 0);
	const placed = publicGroup.place(fixture.clip.id);
	assert.equal(publicGroup.instanceCount(fixture.clip.id), 1);
	assert.deepEqual(publicGroup.selectInstances(fixture.clip.id), [placed]);
	assert.equal(publicGroup.rename(fixture.clip.id, 'Renamed poster'), 'Renamed poster');
	assert.equal(project.sources.find(source => source.id === fixture.source.id)?.name, 'Renamed poster');
	const beforeRemove = project;
	assert.deepEqual(new Set(publicGroup.removeFromProject(fixture.clip.id)), new Set([fixture.clip.id, placed]));
	assert.equal(project.sources.some(source => source.id === fixture.source.id), false);
	assert.equal(project.clips.some(clip => clip.sourceId === fixture.source.id), false);
	assert.equal(beforeRemove.sources.some(source => source.id === fixture.source.id), true, 'undo snapshot retains the complete source');
	disposed = true;
	assert.throws(() => publicGroup.instanceCount(fixture.clip.id), /Disposed/u);
});

test('removing an image bin card preserves its independent timeline instance', () => {
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	let project = fixture.project;
	const actions = createFramescaperProjectBinVisualActions({
		get project() { return project; }, getSnapshot: () => ({}), getTelemetrySnapshot: () => ({ positionFrame: 0 }), selectClips: ids => {
			project = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, project, {
				type: 'selection/set', ...project.selection, clipIds: [...ids],
			});
		},
		actions: { projectBin: {}, edit: { commit: command => {
			project = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, project, command);
		} } },
	});
	actions.moveFromTimeline(fixture.clip.id);
	const placed = actions.place(fixture.clip.id);
	assert.equal(actions.removeFromBin?.(fixture.clip.id), fixture.clip.id);
	assert.equal(project.projectBin.clips.some(clip => clip.id === fixture.clip.id), false);
	assert.equal(project.clips.some(clip => clip.id === placed), true);
	assert.equal(project.sources.some(source => source.id === fixture.source.id), true);
});

test('a mixed header selection transfers its image when invoked from its audio clip', () => {
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const audio = fixture.project.clips.find(clip => clip.kind === 'audio');
	assert.ok(audio);
	let project = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, fixture.project, {
		type: 'selection/set', startFrame: 0, endFrame: 0,
		clipIds: [audio.id, fixture.clip.id], trackIds: [],
	});
	const actions = createFramescaperProjectBinVisualActions({
		get project() { return project; }, getSnapshot: () => ({}), getTelemetrySnapshot: () => ({ positionFrame: 0 }), selectClips: ids => {
			project = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, project, {
				type: 'selection/set', ...project.selection, clipIds: [...ids],
			});
		},
		actions: { projectBin: {}, edit: { commit: command => {
			project = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, project, command);
		} } },
	});
	assert.deepEqual(new Set(actions.moveFromTimeline(audio.id)), new Set([audio.id, fixture.clip.id]));
	assert.equal(project.clips.some(clip => clip.id === audio.id || clip.id === fixture.clip.id), false);
	assert.equal(project.projectBin.clips.some(clip => clip.id === audio.id), true);
	assert.equal(project.projectBin.clips.some(clip => clip.id === fixture.clip.id), true);
});
