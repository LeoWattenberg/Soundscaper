/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSourceEditorEffects } from '../src/common/editor/controller/effects/internal/source-editor-effects.ts';
import type { EffectSelectionProject } from '../src/common/editor/controller/effects/effect-selection-service.ts';

function fixture(sampleRate = 48_000) {
	let project: EffectSelectionProject = {
		id: 'project', schemaVersion: 1, sampleRate: 48_000,
		sources: [{ id: 'source', kind: 'audio', storageKey: 'stored', frameCount: 6, channelCount: 1, sampleRate }],
		tracks: [{ id: 'track', type: 'audio', name: 'Recording', clipIds: ['clip'] }],
		clips: [{ id: 'clip', kind: 'audio', sourceId: 'source', sourceStartFrame: 2, sourceDurationFrames: 3, durationFrames: 3, timelineStartFrame: 400 }],
	};
	const initialProject = project;
	const channels = [Float32Array.of(1, 2, 3, 4, 5, 6)];
	const buffer = { length: 6, numberOfChannels: 1, sampleRate, getChannelData: (index: number) => channels[index]! };
	const loads: string[] = [];
	let published = 0;
	const service = createSourceEditorEffects({
		getProject: () => project,
		loadSourceBuffer: async (source) => { loads.push(source.storageKey ?? source.id); return buffer; },
		publishDocumentSnapshot: () => { published += 1; },
	});
	return { service, loads, buffer, get published() { return published; }, setProjectId: (id: string) => { project = { ...project, id }; },
		replaceSource: () => { project = { ...project,
			sources: [...project.sources!, { id: 'processed', frameCount: 7, channelCount: 1, sampleRate }],
			clips: project.clips.map((clip) => ({ ...clip, sourceId: 'processed' })),
		}; }, undo: () => { project = initialProject; },
	};
}

test('source range overrides timeline targeting without changing the project selection', () => {
	const { service } = fixture();
	service.setSourceSelection({ clipId: 'clip', startFrame: 1, endFrame: 4 });
	const target = service.target()!;
	assert.equal(target.sourceId, 'source');
	assert.equal(target.startFrame, 1);
	assert.equal(target.endFrame, 4);
	assert.equal(target.durationFrames, 3);
	assert.equal(target.sourceTrackId, 'track');
	assert.equal(target.clipId, undefined);
	service.setSourceSelection(null);
	assert.equal(service.target(), null);
});

test('source rendering reads original PCM and shared edits preserve samples outside the selection', async () => {
	const { service, loads } = fixture();
	service.setSourceSelection({ clipId: 'clip', startFrame: 1, endFrame: 4 });
	const target = service.target()!;
	assert.deepEqual(await service.renderRange(target.track.id, 1, 4), [Float32Array.of(2, 3, 4)]);
	assert.deepEqual(await service.expandResult(target, [Float32Array.of(20, 30)]), [Float32Array.of(1, 20, 30, 5, 6)]);
	assert.deepEqual(loads, ['stored', 'stored']);
});

test('source selection is project scoped, clamps dragged ranges, and exposes full source buffers', async () => {
	const harness = fixture();
	harness.service.setSourceSelection({ clipId: 'clip', startFrame: 100, endFrame: -10 });
	assert.equal(harness.service.target()!.startFrame, 0);
	assert.equal(harness.service.target()!.endFrame, 6);
	assert.equal(await harness.service.loadSourceAudio('clip'), harness.buffer);
	harness.setProjectId('other-project');
	assert.equal(harness.service.target(), null);
	assert.equal(harness.published, 1);
});

test('source effect targeting uses the native media sample rate and follows shared replacements', () => {
	const { service, replaceSource, undo } = fixture(44_100);
	assert.equal(service.readSourceSelectionDuration(), null);
	service.setSourceSelection({ clipId: 'clip', startFrame: 1, endFrame: 4 });
	assert.equal(service.target()!.sourceSampleRate, 44_100);
	assert.equal(service.readSourceSelectionDuration(), 3 / 44_100);
	replaceSource();
	assert.equal(service.target()!.sourceId, 'processed');
	assert.equal(service.target()!.startFrame, 1);
	assert.equal(service.target()!.endFrame, 5);
	assert.equal(service.readSourceSelectionDuration(), 4 / 44_100);
	undo();
	assert.equal(service.target()!.sourceId, 'source');
	assert.equal(service.target()!.endFrame, 4);
	assert.equal(service.readSourceSelectionDuration(), 3 / 44_100);
});
