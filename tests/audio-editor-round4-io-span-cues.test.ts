/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportPlan } from '../src/common/editor/export.js';
import { createExportChapterPlan } from '../src/common/editor/export-chapters.ts';
import { inspectWavLayout } from '../src/common/editor/wav.js';
import { inspectAiffLayout } from '../src/common/editor/aiff.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

function markedProject() {
	const base = createSoundscaperProject({ id: 'marked', now: '2026-10-07T00:00:00Z',
		tracks: [{ id: 'track', type: 'audio', name: 'Programme' }] });
	return createSoundscaperProject({ ...base, mixer: undefined,
		sources: [{ id: 'source', kind: 'audio', name: 'Marked.wav', sampleRate: 48_000,
			frameCount: 48_000, channelCount: 1, sampleFormat: 'float32', storageKey: 'source' }],
		tracks: [{ id: 'track', type: 'audio', name: 'Programme', clipIds: ['clip'] }],
		clips: [{ id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0,
			sourceStartFrame: 0, durationFrames: 48_000 }],
		timelineAnnotations: [
			{ id: 'first', sequenceId: base.primarySequenceId, kind: 'marker', anchor: 'sample', name: 'First',
				positionFrame: 0, color: 'auto', batchId: null, opaqueExtensions: {} },
			{ id: 'second', sequenceId: base.primarySequenceId, kind: 'marker', anchor: 'sample', name: 'Second',
				positionFrame: 24_000, color: 'auto', batchId: null, opaqueExtensions: {} },
		],
	});
}

test('each archived chapter derives and hands off the markers in its own file clock', () => {
	const project = markedProject();
	const plan = createExportPlan(project, { format: 'wav', mode: 'chapters', chapterSource: 'markers', sampleRate: 96_000 });
	assert.equal(plan.outputs.length, 2);
	const first = createExportChapterPlan(plan, plan.outputs[0]!);
	const second = createExportChapterPlan(plan, plan.outputs[1]!);
	assert.deepEqual(second.markers.map(({ label, sampleOffset }) => ({ label, sampleOffset })), [{ label: 'Second', sampleOffset: 0 }]);
	assert.deepEqual(first.markers.map(({ label, sampleOffset }) => ({ label, sampleOffset })), [{ label: 'First', sampleOffset: 0 }]);
	assert.equal(second.markerInterchangeReport.source, 'timeline-annotations');
	assert.deepEqual(second.markerInterchangeReport.items.filter(item => item.code === 'RIFF_ANNOTATION_OUTSIDE_EXPORT_RANGE')
		.map(item => item.annotationId), ['first']);
	const bitDepth = second.encoding.bitDepth;
	assert.ok(bitDepth === 16 || bitDepth === 20 || bitDepth === 24 || bitDepth === 32);
	assert.equal(second.outputFileBytesPerRender, inspectWavLayout({ sampleRate: second.sampleRate,
		channelCount: second.channelCount, totalFrames: second.outputFrames, bitDepth,
		float: second.encoding.floatingPoint, metadata: second.metadata, markers: second.markers }).byteLength);
	assert.equal(project.timelineAnnotations[1]?.kind === 'marker' && project.timelineAnnotations[1].anchor === 'sample'
		? project.timelineAnnotations[1].positionFrame : null, 24_000);
});

test('individual clip WAVs retain markers and explicit marker exclusion still applies', () => {
	const plan = createExportPlan(markedProject(), { format: 'wav', mode: 'clips' });
	const clip = createExportChapterPlan(plan, plan.outputs[0]!);
	assert.deepEqual(clip.markers.map(({ sampleOffset }) => sampleOffset), [0, 24_000]);
	const excluded = createExportPlan(markedProject(), { format: 'wav', mode: 'chapters', chapterSource: 'markers', markerSource: 'none' });
	assert.deepEqual(createExportChapterPlan(excluded, excluded.outputs[0]!).markers, []);
});

test('AIFF chapter size admission counts exactly the per-file marker chunks', () => {
	const plan = createExportPlan(markedProject(), { format: 'aiff', mode: 'chapters', chapterSource: 'markers' });
	const chapter = createExportChapterPlan(plan, plan.outputs[1]!);
	assert.deepEqual(chapter.markers.map(({ label, sampleOffset }) => ({ label, sampleOffset })), [{ label: 'Second', sampleOffset: 0 }]);
	assert.equal(chapter.outputFileBytesPerRender, inspectAiffLayout({ sampleRate: chapter.sampleRate,
		channelCount: chapter.channelCount, totalFrames: chapter.outputFrames, sampleFormat: chapter.encoding.sampleFormat,
		metadata: chapter.metadata, markers: chapter.markers }).byteLength);
});
