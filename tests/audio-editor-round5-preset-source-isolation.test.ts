/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { normalizeVideoGeneratorClipV1, normalizeVideoGeneratorSourceV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { createFramescaperSelectedVisualAuthoringModelFinishing } from '../src/framescaper/editor-selected-finishing-visual-authoring-model.ts';
import { prepareFramescaperSelectedVisualAuthoringFinishing } from '../src/framescaper/editor-selected-finishing-visual-authoring-commands.ts';
import { applyFramescaperOwnedVisualCommandVisual, snapshotFramescaperOwnedVisualCommandVisual } from '../src/framescaper/editor-project-visual-visual-command.ts';
import type { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('selected generator source editing keeps its shared producer in the optional surface owner', () => {
	const path = 'src/common/editor/selected-generator-source-command.ts';
	assert.equal(chunkGroupForModulePath(path), 'editor-optional-surfaces');
	assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), 'editor-optional-surfaces');
});

for (const placement of ['timeline', 'project-bin'] as const) {
	test(`selected preset Apply retains an unselected ${placement} generator and replays one stable batch`, async () => {
		const before = projectFor(placement);
		const project = structuredClone(before);
		const prepared = await preparePreset(project);
		apply(project, prepared.command);
		assert.deepEqual(project.sources.find(({ id }) => id === 'title-source'), before.sources[0]);
		assert.ok(prepared.command !== null && typeof prepared.command === 'object'
			&& 'type' in prepared.command && prepared.command.type === 'batch', 'one history command owns source and selected clip');
		const left = placement === 'timeline' ? project.clips.find(({ id }) => id === 'left') : project.projectBin.clips[0];
		assert.equal(left?.sourceId, 'title-source');
		const selected = project.clips.find(({ id }) => id === 'right');
		assert.ok(selected);
		assert.notEqual(selected.sourceId, 'title-source');
		const replacement = project.sources.find(({ id }) => id === selected.sourceId);
		assert.ok(replacement?.generator.kind === 'title');
		assert.deepEqual(replacement, { ...before.sources[0], id: selected.sourceId,
			generator: before.sources[1]?.generator });
		assert.deepEqual(project.videoVisualPresets, before.videoVisualPresets);
		assert.deepEqual(project.tracks, before.tracks);
		const replay = structuredClone(before);
		apply(replay, prepared.command);
		assert.deepEqual(replay, project, 'replay uses the source ID allocated during preparation');
	});
}

test('a sole selected generator applies its preset without unnecessary source allocation', async () => {
	const project = projectFor('timeline');
	project.clips = project.clips.filter(({ id }) => id !== 'left');
	project.tracks[0]!.clipIds = ['right'];
	const prepared = await preparePreset(project);
	apply(project, prepared.command);
	assert.equal(project.sources.length, 2);
	assert.equal(project.clips[0]?.sourceId, 'title-source');
	assert.ok(project.sources[0]?.generator.kind === 'title');
	assert.equal(project.sources[0].generator.text, 'Saved replacement');
});

async function preparePreset(project: ReturnType<typeof projectFor>) {
	const model = createFramescaperSelectedVisualAuthoringModelFinishing({
		surface: 'video-visual-preset', project, selectedClipId: 'right', playheadSample: 0,
	});
	return prepareFramescaperSelectedVisualAuthoringFinishing({
		surface: 'video-visual-preset', project, store: {} as AudioEditorProjectStore,
		request: { fence: model.fence, operation: 'apply-visual', clipId: 'right', presetId: 'replacement' },
	});
}

function apply(project: Record<string, unknown>, command: unknown): void {
	const children = command !== null && typeof command === 'object' && 'type' in command && command.type === 'batch'
		&& 'commands' in command && Array.isArray(command.commands) ? command.commands as unknown[] : [command];
	for (const child of children) applyFramescaperOwnedVisualCommandVisual(project, snapshotFramescaperOwnedVisualCommandVisual(child));
}

function projectFor(placement: 'timeline' | 'project-bin') {
	const source = normalizeVideoGeneratorSourceV1({ schemaVersion: 1, kind: 'generator', id: 'title-source',
		name: 'Title', width: 128, height: 72, frameRate: { num: 30, den: 1 }, frameCount: 150,
		generator: { kind: 'title', text: 'Original title', fontFamily: 'soundscaper-sans', fontSize: 36,
			color: '#ffffffff', horizontalAlign: 'start', verticalAlign: 'middle' } });
	const donor = normalizeVideoGeneratorSourceV1({ ...source, id: 'preset-model', name: 'Replacement model',
		generator: { ...source.generator, text: 'Saved replacement' } });
	const clips = ['left', 'right'].map((id, index) => normalizeVideoGeneratorClipV1({ schemaVersion: 1,
		kind: 'generator', id, sourceId: source.id, sequenceId: 'sequence', sequenceStartFrame: index * 75,
		sequenceFrameCount: 75, sourceInFrame: index * 75, sourceFrameCount: 75 }));
	const left = clips[0]!;
	return { schemaFamily: 'framescaper', schemaVersion: 1, id: 'project', revision: 0, sampleRate: 48_000,
		primarySequenceId: 'sequence', sequences: [{ id: 'sequence', rate: { num: 30, den: 1 }, trackIds: ['picture'] }],
		selection: { clipIds: ['right'] }, sources: [source, donor], clips: placement === 'timeline' ? clips : clips.slice(1),
		tracks: [{ id: 'picture', type: 'video', clipIds: placement === 'timeline' ? ['left', 'right'] : ['right'] }],
		projectBin: { clips: placement === 'project-bin' ? [left] : [] as typeof clips },
		videoVisualPresentations: [], videoMaskMattes: [], videoAdjustmentLayers: [], videoFreezeFallbacks: [], videoFinishingPresets: [],
		videoVisualPresets: [{ schemaVersion: 1, kind: 'video-preset', id: 'replacement', name: 'Replacement',
			modelKind: 'generator', authoredStateSha256: fingerprintNativeMediaPlan(donor).sha256 }],
	};
}
