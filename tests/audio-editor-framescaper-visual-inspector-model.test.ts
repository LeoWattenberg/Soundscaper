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

test('the visualizer inspector offers audio sources used in its sequence and commits source and view edits', () => {
	const value = visualizerProject();
	const model = createFramescaperVisualInspectorModel({ project: value, selectedClipId: 'clip-visualizer' });
	assert.equal(model.kind, 'sound-visualizer');
	assert.deepEqual(model.audioSources, [
		{ id: 'source-bass', name: 'Bass source' }, { id: 'source-lead', name: 'Lead source' },
	]);
	const command = createFramescaperVisualInspectorCommand(value, model.clipId, {
		generator: {
			kind: 'sound-visualizer', mode: 'spectrum', sourceIds: ['source-bass'],
			windowSeconds: 0.25, backgroundColor: '#101820ff', foregroundColor: '#19c7ffff',
		},
		opacity: model.opacity, blendMode: model.blendMode, maskId: model.maskId,
		maskWidth: model.maskWidth, presetId: null,
	}) as { readonly type: string; readonly commands: readonly Readonly<Record<string, unknown>>[] };
	const sourceCommand = command.commands.find(({ type }) => type === 'video-visual-source/set');
	assert.ok(sourceCommand);
	assert.deepEqual((sourceCommand.source as Record<string, unknown>).generator, {
		kind: 'sound-visualizer', mode: 'spectrum', sourceIds: ['source-bass'],
		windowSeconds: 0.25, backgroundColor: '#101820ff', foregroundColor: '#19c7ffff',
	});
});

test('the visualizer inspector can clear a source filter after that source leaves its sequence', () => {
	const original = visualizerProject();
	const value = {
		...original,
		sources: original.sources.map((source) => source.id === 'source-visualizer'
			? { ...source, generator: {
				kind: 'sound-visualizer', mode: 'waveform', sourceIds: ['source-other'], windowSeconds: 1,
				backgroundColor: '#00000000', foregroundColor: '#ffffffff',
			} } : source),
	};
	const model = createFramescaperVisualInspectorModel({ project: value, selectedClipId: 'clip-visualizer' });
	assert.deepEqual(model.audioSources.map(({ id }) => id), ['source-bass', 'source-lead']);
	assert.deepEqual(model.generator, {
		kind: 'sound-visualizer', mode: 'waveform', sourceIds: ['source-other'], windowSeconds: 1,
		backgroundColor: '#00000000', foregroundColor: '#ffffffff',
	});
	const command = createFramescaperVisualInspectorCommand(value, model.clipId, {
		generator: {
			kind: 'sound-visualizer', mode: 'waveform', sourceIds: [], windowSeconds: 1,
			backgroundColor: '#00000000', foregroundColor: '#ffffffff',
		},
		opacity: model.opacity, blendMode: model.blendMode, maskId: model.maskId,
		maskWidth: model.maskWidth, presetId: null,
	}) as { readonly commands: readonly Readonly<Record<string, unknown>>[] };
	const sourceCommand = command.commands.find(({ type }) => type === 'video-visual-source/set');
	assert.ok(sourceCommand);
	assert.deepEqual((sourceCommand.source as { readonly generator: { readonly sourceIds: readonly string[] } })
		.generator.sourceIds, []);
});

function visualizerProject() {
	const original = project([]);
	return {
		...original,
		selection: { clipIds: ['clip-visualizer'] },
		sequences: [
			{ id: 'main-sequence', trackIds: ['visual-track', 'audio-track'] },
			{ id: 'other-sequence', trackIds: ['other-track'] },
		],
		tracks: [
			{ id: 'visual-track', type: 'video', clipIds: ['clip-visualizer'] },
			{ id: 'audio-track', type: 'audio', clipIds: ['audio-a', 'audio-b', 'audio-c'] },
			{ id: 'other-track', type: 'audio', clipIds: ['audio-other'] },
		],
		sources: [{
			schemaVersion: 1, kind: 'generator', id: 'source-visualizer', name: 'Sound Visualizer',
			width: 1_920, height: 1_080, frameRate: { num: 24, den: 1 }, frameCount: 240,
			generator: {
				kind: 'sound-visualizer', mode: 'waveform', sourceIds: [], windowSeconds: 1,
				backgroundColor: '#00000000', foregroundColor: '#ffffffff',
			},
		}, {
			id: 'source-lead', kind: 'audio', name: 'Lead source',
		}, {
			id: 'source-bass', kind: 'audio', name: 'Bass source',
		}, {
			id: 'source-other', kind: 'audio', name: 'Other source',
		}],
		clips: [{
			schemaVersion: 1, kind: 'generator', id: 'clip-visualizer', sourceId: 'source-visualizer',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 120,
			sourceInFrame: 0, sourceFrameCount: 120,
		}, { kind: 'audio', id: 'audio-a', sourceId: 'source-lead', title: 'Lead' },
		{ kind: 'audio', id: 'audio-b', sourceId: 'source-bass', title: 'Bass' },
		{ kind: 'audio', id: 'audio-c', sourceId: 'source-lead', title: 'Lead reprise' },
		{ kind: 'audio', id: 'audio-other', sourceId: 'source-other', title: 'Other' }],
		videoVisualPresentations: [],
	};
}

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
