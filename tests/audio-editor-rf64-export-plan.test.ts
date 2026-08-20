/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createExportPlan, estimatePcmBytes } from '../src/common/editor/export.js';
import {
	createCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import { encodeWav, inspectWavLayout } from '../src/common/editor/wav.js';

const UINT32_SENTINEL = 0xffff_ffff;

test('export byte estimates reject unsafe derived sizes', () => {
	assert.equal(estimatePcmBytes(Number.MAX_SAFE_INTEGER, 1, 1), Number.MAX_SAFE_INTEGER);
	assert.throws(
		() => estimatePcmBytes(Number.MAX_SAFE_INTEGER, 2, 1),
		/safe integer range/u,
	);
	assert.throws(() => estimatePcmBytes(1, 1, 0), /bytes per sample must be positive/u);
});

function stemProject() {
	return createCurrentAudioEditorProject({
		id: 'large-stem-project',
		title: 'Large stems',
		now: '2026-07-28T00:00:00.000Z',
		sampleRate: 48_000,
		tracks: [
			{ type: 'audio', id: 'one', name: 'One' },
			{ type: 'audio', id: 'two', name: 'Two' },
		],
	});
}

test('native stem plans keep ZIP until exact ZIP32 limits require 7z', () => {
	const project = stemProject();
	const small = createExportPlan(project, {
		mode: 'stems',
		format: 'wav',
		channelCount: 1,
		bitDepth: 24,
		includeTail: false,
		range: { startFrame: 0, endFrame: 48_000 },
		date: '2026-07-28',
	});
	if (!small.archive) throw new Error('Expected a stem archive plan.');
	assert.equal(small.archive.format, 'zip');
	assert.match(small.archive.fileName, /\.zip$/u);
	assert.equal(small.archive.entries.every((entry) => entry.expectedByteLength === small.outputFileBytesPerRender), true);
	assert.equal(small.requiredTemporaryBytes, small.archive.requiredTemporaryBytes);
	assert.equal(
		small.outputFileBytesPerRender,
		encodeWav([new Float32Array(48_000)], { sampleRate: 48_000, bitDepth: 24, dither: 'none' }).byteLength,
	);

	// Each file remains a classic RIFF below 4 GiB, but their combined local
	// ZIP region crosses the 32-bit central-directory offset sentinel.
	const aggregateFrames = 715_827_870;
	const aggregate = createExportPlan(project, {
		mode: 'stems',
		format: 'wav',
		channelCount: 1,
		bitDepth: 24,
		includeTail: false,
		range: { startFrame: 0, endFrame: aggregateFrames },
		date: '2026-07-28',
	});
	assert.equal(inspectWavLayout({
		channelCount: 1,
		totalFrames: aggregateFrames,
		bitDepth: 24,
	}).container, 'riff');
	if (aggregate.outputFileBytesPerRender === null || !aggregate.archive) {
		throw new Error('Expected exact native stem sizing.');
	}
	assert.ok(aggregate.outputFileBytesPerRender < UINT32_SENTINEL);
	assert.equal(aggregate.archive.format, '7z');
	assert.match(aggregate.archive.fileName, /\.7z$/u);
});

test('the first unrepresentable WAV layout is planned as RF64 inside 7z', () => {
	const firstRf64Frame = ((UINT32_SENTINEL - 36) / 3) + 1;
	const plan = createExportPlan(stemProject(), {
		mode: 'stems',
		format: 'wav',
		channelCount: 1,
		bitDepth: 24,
		includeTail: false,
		range: { startFrame: 0, endFrame: firstRf64Frame },
		date: '2026-07-28',
	});
	const layout = inspectWavLayout({ channelCount: 1, totalFrames: firstRf64Frame, bitDepth: 24 });
	if (!plan.archive || plan.archive.expectedByteLength === null) {
		throw new Error('Expected an exact RF64 stem archive plan.');
	}
	assert.equal(layout.container, 'rf64');
	assert.equal(plan.outputFileBytesPerRender, layout.byteLength);
	assert.equal(plan.archive.format, '7z');
	assert.equal(plan.archive.mimeType, 'application/x-7z-compressed');
	assert.equal(
		plan.requiredTemporaryBytes,
		plan.archive.expectedByteLength + layout.byteLength,
	);
});

test('nondeterministic compressed stems stay ZIP with runtime size checks', () => {
	const plan = createExportPlan(stemProject(), {
		mode: 'stems',
		format: 'mp3',
		includeTail: false,
		range: { startFrame: 0, endFrame: 48_000 },
		date: '2026-07-28',
	});
	if (!plan.archive) throw new Error('Expected a compressed stem archive plan.');
	assert.equal(plan.outputFileBytesPerRender, null);
	assert.equal(plan.archive.format, 'zip');
	assert.equal(plan.archive.expectedByteLength, null);
	assert.equal(plan.archive.entries.every((entry) => entry.expectedByteLength === null), true);
	assert.equal(plan.archive.requiredTemporaryBytes, plan.outputBytesPerRender * plan.outputs.length);
	assert.equal(plan.requiredTemporaryBytes, plan.archive.requiredTemporaryBytes);
});
