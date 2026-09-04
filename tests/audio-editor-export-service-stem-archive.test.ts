/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorExportService } from '../src/common/editor/controller/export-service.ts';
import { createFixture, defaultPlan } from './helpers/export-service-fixture.ts';

// The two deliveries that stream many rendered outputs into one archive, which
// is the whole of src/common/editor/controller/streaming-stem-archive-export.ts:
// a stem is one track over the delivery's range, a chapter is the whole mix
// over a span of its own, and both are conformed per file before they join.

test('stem exports archive each output, report progress, and abort failed archives', async () => {
	const fixture = createFixture();
	const renderRanges: Array<Record<string, unknown>> = [];
	const renderSnapshot = fixture.renderOptions.renderSnapshot!;
	fixture.renderOptions.renderSnapshot = async (...args: unknown[]) => {
		renderRanges.push(args[1] as Record<string, unknown>);
		return renderSnapshot(...args);
	};
	const stems = defaultPlan();
	stems.mode = 'stems';
	stems.outputs = [
		{ fileName: 'one.wav', trackId: 'one', includeMaster: false, respectMuteSolo: false },
		{ fileName: 'two.wav', trackId: 'two', includeMaster: false, respectMuteSolo: false },
	];
	stems.requiredTemporaryBytes = 768;
	stems.archive = {
		format: '7z',
		fileName: 'stems.7z',
		mimeType: 'application/x-7z-compressed',
		expectedByteLength: 512,
		entries: stems.outputs.map(({ fileName }) => ({ fileName, expectedByteLength: 128 })),
	};
	fixture.setPlan(stems);
	const result = await createEditorExportService(fixture.runtime).handleExportAction('export');
	assert.equal(result.fileName, 'stems.7z');
	assert.equal(result.mimeType, 'application/x-7z-compressed');
	assert.equal(fixture.calls.includes('archive-create:7z:stems.7z'), true);
	assert.equal(fixture.preflightBytes[0], 768);
	assert.deepEqual(fixture.progress, [0.5, 1]);
	assert.equal(fixture.calls.filter((entry) => entry.startsWith('archive-add')).length, 2);
	assert.deepEqual(renderRanges.map(({ trackId, includeMaster, respectMuteSolo }) => ({
		trackId, includeMaster, respectMuteSolo,
	})), [
		{ trackId: 'one', includeMaster: false, respectMuteSolo: false },
		{ trackId: 'two', includeMaster: false, respectMuteSolo: false },
	]);
	assert.equal(renderRanges.some((range) => 'fileName' in range || 'kind' in range), false);

	const realtime = createFixture();
	const realtimeStems = structuredClone(stems);
	realtimeStems.outputs = [stems.outputs[0]!];
	realtimeStems.archive!.entries = [stems.archive.entries[0]!];
	realtimeStems.render = { strategy: 'realtime-stream' };
	realtime.setPlan(realtimeStems);
	await createEditorExportService(realtime.runtime).handleExportAction('export');
	assert.deepEqual(realtime.realtimeRenderOptions.map(({ trackId, includeMaster, respectMuteSolo }) => ({
		trackId, includeMaster, respectMuteSolo,
	})), [{ trackId: 'one', includeMaster: false, respectMuteSolo: false }]);
	assert.equal(realtime.realtimeRenderOptions.some((range) => 'fileName' in range || 'kind' in range), false);

	const failed = createFixture();
	failed.setPlan(stems);
	failed.setArchiveAddFails(true);
	assert.equal(await createEditorExportService(failed.runtime).handleExportAction('export'), undefined);
	assert.equal(failed.calls.includes('archive-abort'), true);
	assert.match((failed.errors[0] as Error).message, /archive add failed/u);
});

test('chapter exports render the whole mix once per label span into one archive', async () => {
	const fixture = createFixture();
	const renderRanges: Array<Record<string, unknown>> = [];
	const renderSnapshot = fixture.renderOptions.renderSnapshot!;
	fixture.renderOptions.renderSnapshot = async (...args: unknown[]) => {
		renderRanges.push(args[1] as Record<string, unknown>);
		return renderSnapshot(...args);
	};
	const chapters = defaultPlan();
	chapters.mode = 'chapters';
	chapters.tailFrames = 0;
	chapters.outputs = [
		{
			fileName: '01-Intro.wav', trackId: null, kind: 'chapter',
			includeMaster: true, respectMuteSolo: true,
			range: { startFrame: 0, endFrame: 6, durationFrames: 6 },
			outputFrames: 6, outputFileBytes: 128,
		},
		{
			fileName: '02-Outro.wav', trackId: null, kind: 'chapter',
			includeMaster: true, respectMuteSolo: true,
			range: { startFrame: 6, endFrame: 12, durationFrames: 6 },
			outputFrames: 6, outputFileBytes: 128,
		},
	];
	chapters.requiredTemporaryBytes = 768;
	chapters.archive = {
		format: 'zip',
		fileName: 'chapters.zip',
		mimeType: 'application/zip',
		expectedByteLength: null,
		entries: chapters.outputs.map(({ fileName }) => ({ fileName, expectedByteLength: null })),
	};
	fixture.setPlan(chapters);
	const result = await createEditorExportService(fixture.runtime).handleExportAction('export');
	assert.equal(result.fileName, 'chapters.zip');
	assert.equal(fixture.calls.includes('archive-create:zip:chapters.zip'), true);
	assert.equal(fixture.calls.filter((entry) => entry.startsWith('archive-add')).length, 2);
	assert.deepEqual(fixture.progress, [0.5, 1]);
	// Each chapter is the master mix over its own span, not a track of it.
	assert.deepEqual(renderRanges.map(({ startFrame, endFrame, trackId, includeMaster }) => ({
		startFrame, endFrame, trackId, includeMaster,
	})), [
		{ startFrame: 0, endFrame: 6, trackId: null, includeMaster: true },
		{ startFrame: 6, endFrame: 12, trackId: null, includeMaster: true },
	]);
	assert.deepEqual(renderRanges.map(({ includeTail }) => includeTail), [false, false]);
});
