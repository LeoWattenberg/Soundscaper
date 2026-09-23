/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectVisualService } from '../src/common/editor/controller/document/project-visual-service.ts';

test('project visuals expose only project- and source-matched frequency windows', () => {
	const source = { id: 'source', kind: 'audio', storageKey: 'stored', frameCount: 100,
		channelCount: 1, sampleRate: 48_000 };
	const clip = { id: 'clip', kind: 'audio', sourceId: source.id, timelineStartFrame: 0,
		durationFrames: 100 };
	const project = { id: 'project', schemaVersion: 1, sources: [source], clips: [clip], tracks: [] };
	const frequencyAnalysis = { frameCount: 100, channelCount: 1, sampleRate: 48_000 };
	const frequencyWindow = { startFrame: 4, frameCount: 8, channelCount: 1, sampleRate: 48_000 };
	const sourceFrequencyAnalyses = new Map([[source.id, {
		projectId: project.id,
		storageKey: source.storageKey,
		analysis: frequencyAnalysis,
	}]]);
	const sourceFrequencyWindows = new Map([['clip', {
		projectId: project.id,
		sourceId: source.id,
		storageKey: source.storageKey,
		window: frequencyWindow,
	}]]);
	const service = createProjectVisualService({
		getProject: () => project,
		captureProject: (projectId) => projectId,
		assertProject() {},
		missingSourceIds: new Set(),
		sourceBuffers: new Map(),
		sourcePeaks: new Map(),
		waveformPcmWindows: new Map(),
		sourceFrequencyAnalyses,
		sourceFrequencyWindows,
		store: {
			async loadMediaAsset() { return null; },
			async listVideoDerivatives() { return []; },
			async loadVideoDerivative() { return null; },
		},
		projectDurationFrames: () => 100,
		url: { createObjectURL: () => null, revokeObjectURL() {} },
	});

	assert.equal(service.getClipVisualData(clip.id)?.frequencyAnalysis, frequencyAnalysis);
	assert.equal(service.getClipVisualData(clip.id)?.frequencyWindow, frequencyWindow);
	sourceFrequencyWindows.set(clip.id, {
		...sourceFrequencyWindows.get(clip.id)!,
		projectId: 'stale-project',
	});
	assert.equal(service.getClipVisualData(clip.id)?.frequencyWindow, undefined);
	sourceFrequencyAnalyses.clear();
	const ordinaryVisual = service.getClipVisualData(clip.id);
	assert.ok(ordinaryVisual);
	assert.equal(Object.hasOwn(ordinaryVisual, 'frequencyAnalysis'), false);
	assert.equal(Object.hasOwn(ordinaryVisual, 'frequencyWindow'), false);
});
