/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createControllerProjectQueries, createCommandProjectReader } from '../src/common/editor/controller/controller-project-queries.ts';

function fixture(project: Readonly<Record<string, unknown>> | null) {
	return createControllerProjectQueries({ getProject: () => project, projectSampleRate: () => 48000 });
}

void test('active selection preserves an admitted range and its extension fields by identity', () => {
	const selection = { startFrame: 1, endFrame: 5, trackIds: ['track'], clipIds: ['clip'],
		frequencyRange: { minimumFrequency: 20, maximumFrequency: 20000 }, extension: 'retained' };
	assert.equal(fixture({ selection }).activeSelection(), selection);
});

void test('inactive and opaque malformed selections do not become controller ranges', () => {
	for (const selection of [null, {}, { startFrame: 1, endFrame: 1 }, { startFrame: '1', endFrame: '5' },
		{ startFrame: -1, endFrame: 5 }, { startFrame: 0, endFrame: Infinity },
		{ startFrame: 0, endFrame: 5, clipIds: [17] },
		{ startFrame: 0, endFrame: 5, frequencyRange: { minimumFrequency: '20', maximumFrequency: 20000 } }]) {
		assert.equal(fixture({ selection }).activeSelection(), null);
	}
	assert.equal(fixture(null).activeSelection(), null);
});

void test('export defaults work before activation and preserve explicit metadata choices', () => {
	assert.equal(fixture(null).normalizeExportSettings().sampleRate, 48000);
	const tags = { title: 'Stored title' };
	const queries = fixture({ metadata: { tags } });
	assert.equal(queries.normalizeExportSettings().metadata, tags);
	const explicit = { title: 'Export title' };
	assert.equal(queries.normalizeExportSettings({ metadata: explicit }).metadata, explicit);
	assert.deepEqual(fixture({ metadata: 17 }).normalizeExportSettings().metadata, {});
});

void test('command readers require activation and retain the projection owner result type', () => {
	let project: { id: string } | null = null;
	let reads = 0;
	const reader = createCommandProjectReader(() => project, value => {
		reads += 1;
		return { ...value, resolvedFrame: 42 };
	});
	assert.throws(reader, /open project/u);
	assert.equal(reads, 0);
	project = { id: 'activated' };
	const frame: number = reader().resolvedFrame;
	assert.equal(frame, 42);
	assert.equal(reads, 1);
});
