/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoExportPlan, resolveVideoExportCanvas } from '../src/common/editor/video-export.js';
import { CANONICAL_VIDEO_EXPORT_PLAN_VERSION } from '../src/common/editor/video-export-plan-version.ts';

test('the derived canvas is unchanged, and now says which fit it was derived under', () => {
	const canvas = resolveVideoExportCanvas(project(), {});

	assert.equal(canvas.width, 1_280);
	assert.equal(canvas.height, 720);
	assert.equal(canvas.maximumWidth, 1_280);
	assert.equal(canvas.maximumHeight, 720);
	assert.equal(canvas.fit, 'contain', 'the placement every export has always used');
});

test('a stated canvas is delivered exactly, leaving the 1280x720 default behind', () => {
	const canvas = resolveVideoExportCanvas(project(), { size: { width: 1_080, height: 1_920 }, fit: 'cover' });

	assert.equal(canvas.width, 1_080);
	assert.equal(canvas.height, 1_920);
	assert.equal(canvas.fit, 'cover');
	// A stated canvas answers to itself rather than to the automatic ceiling,
	// which is the entire point of stating one.
	assert.equal(canvas.maximumWidth, 1_080);
	assert.equal(canvas.maximumHeight, 1_920);
});

test('a stated canvas still reports the reference the project resolved it against', () => {
	const canvas = resolveVideoExportCanvas(project(), { size: { width: 1_080, height: 1_920 } });

	assert.equal(canvas.referenceClipId, 'clip-1');
	assert.equal(canvas.referenceSourceId, 'source-1');
});

test('an odd or oversized canvas extent is a refusal at plan build, never an encoder surprise', () => {
	assert.throws(
		() => resolveVideoExportCanvas(project(), { size: { width: 1_081, height: 1_920 } }),
		/canvas\.size\.width must be even/u,
	);
	assert.throws(
		() => resolveVideoExportCanvas(project(), { size: { width: 1_080, height: 1_921 } }),
		/canvas\.size\.height must be even/u,
	);
	assert.throws(
		() => resolveVideoExportCanvas(project(), { size: { width: 65_536, height: 1_080 } }),
		/at most 16384/u,
	);
	assert.throws(
		() => resolveVideoExportCanvas(project(), { size: { width: 0, height: 1_080 } }),
		/positive safe integer/u,
	);
});

test('stating a canvas and also capping it is refused rather than silently resolved', () => {
	for (const conflicting of ['width', 'height', 'maximumWidth', 'maximumHeight']) {
		assert.throws(
			() => resolveVideoExportCanvas(project(), {
				size: { width: 1_080, height: 1_920 },
				[conflicting]: 720,
			}),
			new RegExp(`canvas\\.${conflicting} cannot also apply`, 'u'),
			`canvas.${conflicting} contradicts a stated size`,
		);
	}
	assert.throws(
		() => resolveVideoExportCanvas(project(), { size: { width: 1_080, height: 1_920, fit: 'cover' } }),
		/Unsupported canvas\.size option: fit/u,
	);
});

test('an unrecognized fit is refused rather than treated as the default', () => {
	assert.throws(
		() => resolveVideoExportCanvas(project(), { fit: 'fill' }),
		/canvas\.fit must be one of contain, cover, stretch/u,
	);
});

test('the plan carries its canvas fit under the canonical version that can state one', () => {
	const plan = createVideoExportPlan(project(), {
		includeAudio: false,
		range: { startFrame: 0, endFrame: 1_000 },
		canvas: { size: { width: 1_080, height: 1_920 }, fit: 'cover' },
	});

	assert.equal(plan.version, CANONICAL_VIDEO_EXPORT_PLAN_VERSION);
	assert.equal(plan.canvas.fit, 'cover');
	assert.equal(plan.canvas.width, 1_080);
	assert.equal(plan.canvas.height, 1_920);
});

test('each fit states the operation that reaches the canvas, and contain states the one it always did', () => {
	const operations = (fit) => createVideoExportPlan(project(), {
		includeAudio: false,
		range: { startFrame: 0, endFrame: 1_000 },
		canvas: { size: { width: 1_080, height: 1_920 }, ...(fit === undefined ? {} : { fit }) },
	}).filterPlan.intervals[0].layers[0].clips[0].operations.filter(
		({ name }) => name === 'scale' || name === 'pad' || name === 'crop',
	);

	assert.deepEqual(operations(undefined), [
		{ name: 'scale', width: 1_080, height: 1_920, forceOriginalAspectRatio: 'decrease' },
		{ name: 'pad', width: 1_080, height: 1_920, x: '(ow-iw)/2', y: '(oh-ih)/2', color: 'black@0' },
	]);
	assert.deepEqual(operations('cover'), [
		{ name: 'scale', width: 1_080, height: 1_920, forceOriginalAspectRatio: 'increase' },
		{ name: 'crop', width: 1_080, height: 1_920, x: '(iw-ow)/2', y: '(ih-oh)/2', exact: true },
	]);
	assert.deepEqual(operations('stretch'), [
		{ name: 'scale', width: 1_080, height: 1_920 },
	]);
});

function project() {
	return {
		sampleRate: 1_000,
		selection: { startFrame: 0, endFrame: 0 },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [{
			kind: 'video',
			id: 'source-1',
			name: 'Source',
			mimeType: 'video/mp4',
			storageKey: 'media/source-1',
			frameCount: 10_000,
			sampleRate: 1_000,
			width: 1_920,
			height: 1_080,
			frameRate: 30,
			videoCodec: 'h264',
			audioCodec: 'aac',
			hasAudio: false,
			posterStorageKey: null,
			thumbnailStorageKey: null,
		}],
		clips: [{
			kind: 'video',
			id: 'clip-1',
			sourceId: 'source-1',
			title: 'Clip',
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			sourceDurationFrames: 10_000,
			durationFrames: 10_000,
		}],
		tracks: [{ id: 'track-1', type: 'video', clipIds: ['clip-1'] }],
	};
}
