/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { projectBinReplacementShortensClip } from '../src/common/editor/controller/import/internal/project-bin/project-bin-runtime.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createVideoClip, createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { registerVideoTimingIndex, unregisterVideoTimingIndex } from '../src/common/editor/video-source-time.ts';
import { createVideoTimingAssetPublication, validateVideoTimingAssetBytes } from '../src/common/editor/video-timing-asset.ts';

function fixture() {
	const sequence = { id: 'sequence', name: 'Sequence', rate: { num: 30, den: 1 }, trackIds: ['track'] };
	const oldSource = createVideoSource({ id: 'old', name: 'long.webm', storageKey: 'long', sampleFrameCount: 96_000, sourceFrameCount: 48, frameRate: { num: 24, den: 1 }, width: 96, height: 54 });
	const newSource = createVideoSource({ id: 'new', name: 'short.mp4', storageKey: 'short', sampleFrameCount: 24_000, sourceFrameCount: 15, frameRate: { num: 30, den: 1 }, width: 96, height: 54 });
	const context = { projectSampleRate: 48_000, sequence, source: oldSource };
	const base = { sourceId: oldSource.id, sourceInFrame: 0, sourceFrameCount: 48, sequenceStartFrame: 0, sequenceFrameCount: 60, title: 'Long video', color: 'green' };
	const first = createVideoClip({ ...base, id: 'first' }, context);
	const later = createVideoClip({ ...base, id: 'later', sequenceStartFrame: 90 }, context);
	const bin = createVideoClip({ ...base, id: 'bin', binItemId: 'item' }, context);
	const template = createVideoClip({ ...base, id: 'template', sourceId: 'new', sourceFrameCount: 15, sequenceFrameCount: 15, binItemId: 'imported' }, { ...context, source: newSource });
	const project = createCurrentAudioEditorProject({ id: 'project', sources: [oldSource], clips: [first, later], tracks: [createVideoTrack({ id: 'track', name: 'Video', clipIds: ['first', 'later'] })], sequences: [sequence], primarySequenceId: sequence.id, projectBin: { clips: [bin] } });
	return { project, oldSource, newSource, bin, template };
}

test('replacement staging compares native video spans in their actual source clock', () => {
	const { project, bin, oldSource, newSource } = fixture();
	assert.equal(projectBinReplacementShortensClip(project, bin, oldSource, newSource), true);
});

for (const mode of ['keep-spacing', 'contract-gaps'] as const) {
	test(`a normal shorter video replacement preserves canonical clips with ${mode}`, () => {
		const { project, newSource, template } = fixture();
		const result = applyEditorCommand(project, { type: 'batch', commands: [
			{ type: 'source/add', source: newSource },
			{ type: 'project-bin/replace-media', clipId: 'bin', replacements: [{ oldSourceId: 'old', newSourceId: 'new' }], templates: [template], shortfallMode: mode },
		] });
		assert.deepEqual(result.clips.map(clip => ({ id: clip.id, source: clip.sourceId, start: clip.sequenceStartFrame, duration: clip.sequenceFrameCount, in: clip.sourceInFrame, count: clip.sourceFrameCount })), [
			{ id: 'first', source: 'new', start: 0, duration: 15, in: 0, count: 15 },
			{ id: 'later', source: 'new', start: mode === 'contract-gaps' ? 45 : 90, duration: 15, in: 0, count: 15 },
		]);
		const item = result.projectBin.clips[0]!;
		assert.equal(item.sourceFrameCount, 15);
		assert.equal(item.sequenceFrameCount, 15);
		assert.equal(item.title, 'Long video');
		assert.equal(item.color, 'green');
		assert.equal(result.sources.length, 1);
	});
}

test('verified variable frame timing determines whether replacement media is shorter', () => {
	const { project, bin, oldSource, newSource } = fixture();
	const publication = createVideoTimingAssetPublication('4'.repeat(64), { timescale: 1_000, presentationTicks: [0n, 100n, 300n, 700n], finalFrameDurationTicks: 100n });
	const source = { ...newSource, sourceFrameCount: 4, contentSha256: '4'.repeat(64), timingAsset: publication.reference, timingDecision: { mode: 'exact' as const, rate: newSource.frameRate } };
	registerVideoTimingIndex(source, validateVideoTimingAssetBytes(publication.reference, publication.bytes));
	try {
		assert.equal(projectBinReplacementShortensClip(project, { ...bin, sourceInFrame: 0, sourceFrameCount: 12, sequenceFrameCount: 15 }, oldSource, source), false, 'the exact 0.8-second media contains a half-second source span');
		assert.equal(projectBinReplacementShortensClip(project, bin, oldSource, source), true);
	} finally { unregisterVideoTimingIndex(source); }
});
