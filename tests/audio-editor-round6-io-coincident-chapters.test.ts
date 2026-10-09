/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { resolveExportChapters } from '../src/common/editor/export-chapters.ts';

function chapters(labels: readonly Record<string, unknown>[]) {
	const project = createCurrentAudioEditorProject({
		id: 'coincident-chapters', title: 'Coincident chapters', now: '2026-10-08T00:00:00.000Z',
		sampleRate: 48_000, tracks: [{ type: 'label', id: 'labels', name: 'Labels', labels }],
	});
	return resolveExportChapters(project, { startFrame: 0, endFrame: 48_000 });
}

test('each coincident point label delivers its own chapter up to the next distinct boundary', () => {
	assert.deepEqual(chapters([
		{ id: 'a', title: 'Interview', startFrame: 0, endFrame: 0 },
		{ id: 'b', title: 'Transcript', startFrame: 0, endFrame: 0 },
		{ id: 'c', title: 'Conclusion', startFrame: 24_000, endFrame: 24_000 },
	]).map(({ name, startFrame, endFrame }) => [name, startFrame, endFrame]), [
		['Interview', 0, 24_000], ['Transcript', 0, 24_000], ['Conclusion', 24_000, 48_000],
	]);
});

test('a point coincident with a region keeps a chapter constrained by that region', () => {
	assert.deepEqual(chapters([
		{ id: 'a', title: 'Slate', startFrame: 0, endFrame: 0 },
		{ id: 'b', title: 'Take', startFrame: 0, endFrame: 12_000 },
		{ id: 'c', title: 'Next', startFrame: 24_000, endFrame: 24_000 },
	]).map(({ name, startFrame, endFrame }) => [name, startFrame, endFrame]), [
		['Slate', 0, 12_000], ['Take', 0, 12_000], ['Next', 24_000, 48_000],
	]);
});

test('distinct point labels retain their existing non-overlapping chapter spans', () => {
	assert.deepEqual(chapters([
		{ id: 'a', title: 'First', startFrame: 0, endFrame: 0 },
		{ id: 'b', title: 'Second', startFrame: 24_000, endFrame: 24_000 },
	]).map(({ name, startFrame, endFrame }) => [name, startFrame, endFrame]), [
		['First', 0, 24_000], ['Second', 24_000, 48_000],
	]);
});
