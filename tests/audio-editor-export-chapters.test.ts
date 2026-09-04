/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createExportPlan } from '../src/common/editor/export.js';
import {
	createExportChapterPlan,
	exportChapterCount,
	resolveExportChapters,
} from '../src/common/editor/export-chapters.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

const SAMPLE_RATE = 48_000;
const NOW = '2026-09-04T00:00:00.000Z';

function labelledProject(labels: readonly Record<string, unknown>[]) {
	return createCurrentAudioEditorProject({
		id: 'chaptered-project',
		title: 'Chaptered',
		now: NOW,
		sampleRate: SAMPLE_RATE,
		tracks: [
			{ type: 'audio', id: 'music', name: 'Music' },
			{ type: 'label', id: 'labels', name: 'Chapters', labels },
		],
	});
}

function annotatedProject(annotations: readonly Record<string, unknown>[]) {
	const created = createCurrentAudioEditorProject({
		id: 'annotated-project',
		title: 'Annotated',
		now: NOW,
		sampleRate: SAMPLE_RATE,
		tracks: [{ type: 'audio', id: 'music', name: 'Music' }],
	});
	return createCurrentAudioEditorProject({
		id: 'annotated-project',
		title: 'Annotated',
		now: NOW,
		sampleRate: SAMPLE_RATE,
		tracks: [{ type: 'audio', id: 'music', name: 'Music' }],
		timelineAnnotations: annotations.map((annotation) => ({
			sequenceId: created.primarySequenceId,
			color: 'auto',
			batchId: null,
			opaqueExtensions: {},
			anchor: 'sample',
			...annotation,
		})),
	});
}

const RANGE = Object.freeze({ startFrame: 0, endFrame: 10 * SAMPLE_RATE });

test('region labels deliver exactly their own spans', () => {
	const chapters = resolveExportChapters(labelledProject([
		{ id: 'a', title: 'Intro', startFrame: 0, endFrame: 2 * SAMPLE_RATE },
		{ id: 'b', title: 'Verse', startFrame: 4 * SAMPLE_RATE, endFrame: 6 * SAMPLE_RATE },
	]), RANGE);
	assert.deepEqual(chapters.map(({ name, startFrame, endFrame }) => ({ name, startFrame, endFrame })), [
		{ name: 'Intro', startFrame: 0, endFrame: 2 * SAMPLE_RATE },
		{ name: 'Verse', startFrame: 4 * SAMPLE_RATE, endFrame: 6 * SAMPLE_RATE },
	]);
});

test('a point label opens a chapter that runs to the next label, and the last one to the range end', () => {
	const chapters = resolveExportChapters(labelledProject([
		{ id: 'a', title: 'One', startFrame: 0, endFrame: 0 },
		{ id: 'b', title: 'Two', startFrame: 3 * SAMPLE_RATE, endFrame: 3 * SAMPLE_RATE },
	]), RANGE);
	assert.deepEqual(chapters.map(({ startFrame, endFrame }) => [startFrame, endFrame]), [
		[0, 3 * SAMPLE_RATE],
		[3 * SAMPLE_RATE, 10 * SAMPLE_RATE],
	]);
});

test('chapters are clipped to the delivered range and labels outside it are dropped', () => {
	const chapters = resolveExportChapters(labelledProject([
		{ id: 'a', title: 'Before', startFrame: 0, endFrame: SAMPLE_RATE },
		{ id: 'b', title: 'Straddling', startFrame: SAMPLE_RATE, endFrame: 4 * SAMPLE_RATE },
	]), { startFrame: 2 * SAMPLE_RATE, endFrame: 3 * SAMPLE_RATE });
	assert.deepEqual(chapters.map(({ name, startFrame, endFrame }) => ({ name, startFrame, endFrame })), [
		{ name: 'Straddling', startFrame: 2 * SAMPLE_RATE, endFrame: 3 * SAMPLE_RATE },
	]);
});

test('labels that share a name still deliver distinct files', () => {
	const chapters = resolveExportChapters(labelledProject([
		{ id: 'a', title: 'Take', startFrame: 0, endFrame: SAMPLE_RATE },
		{ id: 'b', title: 'Take', startFrame: SAMPLE_RATE, endFrame: 2 * SAMPLE_RATE },
		{ id: 'c', title: '', startFrame: 2 * SAMPLE_RATE, endFrame: 3 * SAMPLE_RATE },
	]), RANGE);
	assert.deepEqual(chapters.map(({ name }) => name), ['Take', 'Take-2', 'chapter-3']);
});

test('maintained timeline annotations are the chapter source when the project carries them', () => {
	const project = annotatedProject([
		{ id: 'm1', kind: 'marker', name: 'Cue', positionFrame: SAMPLE_RATE },
		{
			id: 'r1', kind: 'region', name: 'Bridge',
			startFrame: 5 * SAMPLE_RATE, endFrame: 6 * SAMPLE_RATE,
		},
	]);
	assert.equal(exportChapterCount(project), 2);
	assert.deepEqual(
		resolveExportChapters(project, RANGE).map(({ name, startFrame, endFrame }) => ({ name, startFrame, endFrame })),
		[
			{ name: 'Cue', startFrame: SAMPLE_RATE, endFrame: 5 * SAMPLE_RATE },
			{ name: 'Bridge', startFrame: 5 * SAMPLE_RATE, endFrame: 6 * SAMPLE_RATE },
		],
	);
});

test('a project with no labels cannot deliver chapters, and says so rather than delivering one file', () => {
	const project = labelledProject([]);
	assert.equal(exportChapterCount(project), 0);
	assert.throws(() => resolveExportChapters(project, RANGE), /at least one label/u);
	assert.throws(
		() => createExportPlan(project, { mode: 'chapters', format: 'wav', range: RANGE, date: '2026-09-04' }),
		/at least one label/u,
	);
});

test('a chapter plan writes one archive entry per chapter, each with its own span and size', () => {
	const project = labelledProject([
		{ id: 'a', title: 'Intro', startFrame: 0, endFrame: SAMPLE_RATE },
		{ id: 'b', title: 'Outro', startFrame: SAMPLE_RATE, endFrame: 3 * SAMPLE_RATE },
	]);
	const plan = createExportPlan(project, {
		mode: 'chapters', format: 'wav', bitDepth: 16, channelCount: 2, date: '2026-09-04',
	});
	assert.equal(plan.mode, 'chapters');
	assert.deepEqual(plan.outputs.map(({ kind, fileName }) => ({ kind, fileName })), [
		{ kind: 'chapter', fileName: '01-Intro.wav' },
		{ kind: 'chapter', fileName: '02-Outro.wav' },
	]);
	assert.deepEqual(plan.outputs.map(({ range }) => [range.startFrame, range.endFrame]), [
		[0, SAMPLE_RATE],
		[SAMPLE_RATE, 3 * SAMPLE_RATE],
	]);
	assert.deepEqual(plan.outputs.map(({ outputFrames }) => outputFrames), [SAMPLE_RATE, 2 * SAMPLE_RATE]);
	// The plan states one render, and chapters render one at a time, so the
	// longest chapter is what the strategy and the memory estimates hold.
	assert.equal(plan.outputFrames, 2 * SAMPLE_RATE);
	assert.equal(plan.tailFrames, 0);
	assert.equal(plan.outputFileBytesPerRender, null);
	assert.equal(plan.archive?.fileName, 'Chaptered-chapters-2026-09-04.zip');
	assert.deepEqual(plan.archive?.entries.map(({ fileName }) => fileName), ['01-Intro.wav', '02-Outro.wav']);
	const [first, second] = plan.archive.entries;
	assert.ok(second.expectedByteLength > first.expectedByteLength);
	assert.equal(second.expectedByteLength - first.expectedByteLength, SAMPLE_RATE * 2 * 2);
	// The labels are the split, so they are not also written into every file.
	assert.deepEqual([...plan.markers], []);
	assert.deepEqual(
		[plan.range.startFrame, plan.range.endFrame],
		[0, 3 * SAMPLE_RATE],
	);
});

test('one chapter renders under an ordinary whole-mix plan of its own span', () => {
	const project = labelledProject([
		{ id: 'a', title: 'Intro', startFrame: 0, endFrame: SAMPLE_RATE },
		{ id: 'b', title: 'Outro', startFrame: SAMPLE_RATE, endFrame: 3 * SAMPLE_RATE },
	]);
	const plan = createExportPlan(project, {
		mode: 'chapters', format: 'wav', bitDepth: 16, channelCount: 2, date: '2026-09-04',
	});
	const chapterPlan = createExportChapterPlan(plan, plan.outputs[1]);
	assert.equal(chapterPlan.mode, 'mix');
	assert.equal(chapterPlan.archive, null);
	assert.equal(chapterPlan.tailFrames, 0);
	assert.equal(chapterPlan.outputFrames, 2 * SAMPLE_RATE);
	assert.deepEqual(
		[chapterPlan.range.startFrame, chapterPlan.range.endFrame, chapterPlan.range.durationFrames],
		[SAMPLE_RATE, 3 * SAMPLE_RATE, 2 * SAMPLE_RATE],
	);
	assert.equal(chapterPlan.outputFileBytesPerRender, plan.archive.entries[1].expectedByteLength);
	assert.deepEqual(chapterPlan.outputs, [plan.outputs[1]]);
	assert.equal(chapterPlan.format, plan.format);
	assert.deepEqual(chapterPlan.encoding, plan.encoding);
});

test('a chapter delivery refuses the containers and gains that only a single mix can honor', () => {
	const project = labelledProject([{ id: 'a', title: 'Intro', startFrame: 0, endFrame: SAMPLE_RATE }]);
	assert.throws(
		() => createExportPlan(project, { mode: 'chapters', format: 'bw64', date: '2026-09-04' }),
		/BW64 \/ ADM export is mix-only/u,
	);
	assert.throws(
		() => createExportPlan(project, {
			mode: 'chapters', format: 'wav', loudnessNormalization: 'ebu-r128', date: '2026-09-04',
		}),
		/chapters normalized one by one/u,
	);
});
