/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeVideoGeneratorClipV1, normalizeVideoGeneratorSourceV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { createFramescaperVisualInspectorCommand, createFramescaperVisualInspectorModel } from '../src/common/editor/ui/framescaper-visual-inspector-model.ts';
import { applyFramescaperOwnedVisualCommandVisual, snapshotFramescaperOwnedVisualCommandVisual } from '../src/framescaper/editor-project-visual-visual-command.ts';
import { applyFramescaperOwnedFinishingCommandFinishing, snapshotFramescaperOwnedFinishingCommandFinishing } from '../src/framescaper/editor-project-finishing-finishing-command.ts';

test('selected generator editing forks a shared source and preserves the unselected split', () => {
	const project = projectFor(true);
	const originalSource = structuredClone(project.sources[0]);
	const originalClip = structuredClone(project.clips[0]);
	applyInspector(project);
	assert.deepEqual(project.clips.find(({ id }) => id === 'left'), originalClip);
	assert.deepEqual(project.sources.find(({ id }) => id === 'title-source'), originalSource);
	const selected = project.clips.find(({ id }) => id === 'right');
	assert.ok(selected);
	assert.notEqual(selected.sourceId, 'title-source');
	const source = project.sources.find(({ id }) => id === selected.sourceId);
	assert.ok(source);
	assert.deepEqual(source, { ...originalSource, id: selected.sourceId, generator: {
		...originalSource?.generator, text: 'Independent title',
	} });
	assert.deepEqual([...(project.tracks[0]?.clipIds ?? [])].sort(), ['left', 'right']);
});

test('a project-bin owner also retains the original generator source', () => {
	const project = projectFor(true);
	const left = project.clips.shift();
	assert.ok(left);
	project.projectBin.clips.push(left);
	project.tracks[0]!.clipIds = ['right'];
	applyInspector(project);
	assert.equal(project.projectBin.clips[0]?.sourceId, 'title-source');
	const retained = project.sources.find(({ id }) => id === 'title-source');
	assert.ok(retained?.generator.kind === 'title');
	assert.equal(retained.generator.text, 'Title');
	assert.notEqual(project.clips[0]?.sourceId, 'title-source');
});

test('a sole generator remains on its source and a presentation-only edit does not fork', () => {
	const sole = projectFor(false);
	applyInspector(sole);
	assert.equal(sole.sources.length, 1);
	assert.equal(sole.clips[0]?.sourceId, 'title-source');
	assert.ok(sole.sources[0]?.generator.kind === 'title');
	assert.equal(sole.sources[0].generator.text, 'Independent title');
	const shared = projectFor(true);
	applyInspector(shared, false);
	assert.equal(shared.sources.length, 1);
	assert.deepEqual(shared.clips.map(({ sourceId }) => sourceId), ['title-source', 'title-source']);
});

function applyInspector(project: ReturnType<typeof projectFor>, editGenerator = true): void {
	const model = createFramescaperVisualInspectorModel({ project, selectedClipId: 'right' });
	assert.equal(model.generator?.kind, 'title');
	const command = createFramescaperVisualInspectorCommand(project, 'right', {
		generator: editGenerator && model.generator?.kind === 'title'
			? { ...model.generator, text: 'Independent title' } : model.generator,
		opacity: 0.75, blendMode: model.blendMode, maskId: model.maskId,
		maskWidth: model.maskWidth, presetId: null,
	}) as { readonly type: string; readonly commands?: readonly unknown[] };
	for (const child of command.type === 'batch' ? command.commands ?? [] : [command]) {
		if ((child as { type: string }).type === 'video-visual-presentation/set') {
			applyFramescaperOwnedFinishingCommandFinishing(project, snapshotFramescaperOwnedFinishingCommandFinishing(child));
		} else applyFramescaperOwnedVisualCommandVisual(project, snapshotFramescaperOwnedVisualCommandVisual(child));
	}
}

function projectFor(shared: boolean) {
	const source = normalizeVideoGeneratorSourceV1({
		schemaVersion: 1, kind: 'generator', id: 'title-source', name: 'Title',
		width: 1920, height: 1080, frameRate: { num: 30, den: 1 }, frameCount: 150,
		generator: { kind: 'title', text: 'Title', fontFamily: 'soundscaper-sans', fontSize: 96,
			color: '#ffffffff', horizontalAlign: 'center', verticalAlign: 'middle' },
	});
	const clips = (shared ? ['left', 'right'] : ['right']).map((id, index) => normalizeVideoGeneratorClipV1({
		schemaVersion: 1, kind: 'generator', id, sourceId: source.id, sequenceId: 'sequence',
		sequenceStartFrame: index * 75, sequenceFrameCount: 75, sourceInFrame: index * 75,
		sourceFrameCount: 75,
	}));
	return { schemaFamily: 'framescaper', schemaVersion: 1, selection: { clipIds: ['right'] },
		sources: [source], clips, tracks: [{ id: 'picture', type: 'video', clipIds: clips.map(({ id }) => id) }],
		projectBin: { clips: [] as typeof clips }, videoVisualPresentations: [], videoMaskMattes: [], videoVisualPresets: [],
	};
}
