/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperVisualInspectorCommand,
	createFramescaperVisualInspectorModel,
} from '../src/common/editor/ui/framescaper-visual-inspector-model.ts';

test('visual inspector edits retain every stacked mask after the selected first mask', () => {
	const value = project(['mask-primary', 'mask-secondary']);
	const model = createFramescaperVisualInspectorModel({ project: value, selectedClipId: 'clip-title' });
	const command = createFramescaperVisualInspectorCommand(value, model.clipId, {
		generator: model.generator,
		opacity: 0.75,
		blendMode: model.blendMode,
		maskId: model.maskId,
		maskWidth: model.maskWidth,
		presetId: null,
	}) as { readonly presentation?: Readonly<{ readonly maskMatteIds: readonly string[] }> };

	assert.deepEqual(command.presentation?.maskMatteIds, ['mask-primary', 'mask-secondary']);
});

test('resizing an inspector mask changes only its width and retains its authored position', () => {
	const value = project(['mask-primary']);
	const model = createFramescaperVisualInspectorModel({ project: value, selectedClipId: 'clip-title' });
	const command = createFramescaperVisualInspectorCommand(value, model.clipId, {
		generator: model.generator,
		opacity: model.opacity,
		blendMode: model.blendMode,
		maskId: model.maskId,
		maskWidth: 0.4,
		presetId: null,
	}) as { readonly maskMatte?: Readonly<{ readonly nodes: readonly Readonly<Record<string, unknown>>[] }> };
	const output = command.maskMatte?.nodes.find(({ id }) => id === 'shape');

	assert.equal(output?.x, 0.25);
	assert.equal(output?.width, 0.4);
});

function project(maskMatteIds: readonly string[]) {
	return {
		schemaFamily: 'framescaper', schemaVersion: 1,
		selection: { clipIds: ['clip-title'] },
		sources: [{
			schemaVersion: 1, kind: 'generator', id: 'source-title', name: 'Title',
			width: 1_920, height: 1_080, frameRate: { num: 24, den: 1 }, frameCount: 240,
			generator: {
				kind: 'title', text: 'Scene', fontFamily: 'soundscaper-sans', fontSize: 72,
				color: '#ffffffff', horizontalAlign: 'center', verticalAlign: 'middle',
			},
		}],
		clips: [{
			schemaVersion: 1, kind: 'generator', id: 'clip-title', sourceId: 'source-title',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 120,
			sourceInFrame: 0, sourceFrameCount: 120,
		}],
		videoVisualPresentations: [{
			schemaVersion: 1, id: 'presentation-title', owner: { kind: 'clip', id: 'clip-title' },
			enabled: true, opacity: 1, blendMode: 'normal', grade: null,
			processorStackId: null, maskMatteIds,
		}],
		videoMaskMattes: [mask('mask-primary', 0.25), mask('mask-secondary', 0.5)],
		videoVisualPresets: [],
	};
}

function mask(id: string, x: number) {
	return {
		schemaVersion: 1, id, kind: 'mask', inputs: [],
		nodes: [{ id: 'shape', kind: 'vector-shape', shape: 'rectangle', x, y: 0.2, width: 0.6, height: 0.5 }],
		outputNodeId: 'shape',
	};
}
