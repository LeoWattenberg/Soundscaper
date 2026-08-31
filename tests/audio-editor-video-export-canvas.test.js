/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoExportPlan,
	resolveExactVideoExportCanvas,
	resolveVideoExportCanvas,
} from '../src/common/editor/video-export.js';
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

test('canvas derivation skips product visual clips on a mixed video track', () => {
	const mixed = project();
	mixed.clips.unshift({
		kind: 'still', id: 'still-clip', sourceId: 'still-source', title: 'Still',
		timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 1_000, durationFrames: 1_000,
	});
	mixed.tracks[0].clipIds.unshift('still-clip');
	const canvas = resolveVideoExportCanvas(mixed, {});
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

test('a stated frame rate is delivered, not capped to the automatic 30', () => {
	// The automatic ceiling exists to keep a derived canvas modest. A delivery
	// that names 60 asked for 60; capping it to 30 and saying nothing is the same
	// hidden decision the size ceiling used to make.
	assert.deepEqual(
		resolveExactVideoExportCanvas(project(), { frameRate: 60 }).frameRate,
		{ num: 60, den: 1 },
	);
	assert.deepEqual(
		resolveExactVideoExportCanvas(project(), { frameRate: { num: 60_000, den: 1_001 } }).frameRate,
		{ num: 60_000, den: 1_001 },
	);
	// A rate the source states is still derived, and still capped.
	assert.deepEqual(
		resolveExactVideoExportCanvas(project()).frameRate,
		{ num: 30, den: 1 },
	);
});

test('stating a frame rate and also capping it is refused rather than silently resolved', () => {
	assert.throws(
		() => resolveExactVideoExportCanvas(project(), { frameRate: 60, maximumFrameRate: 30 }),
		/canvas\.maximumFrameRate cannot also apply/u,
	);
	assert.throws(
		() => resolveExactVideoExportCanvas(project(), { frameRate: 1_001 }),
		/at most 1000/u,
	);
});

test('an unusable background colour is refused at plan build, not after the render', () => {
	// The encoder validated the colour when it assembled its arguments, which is
	// after the audio mix has been rendered and staged: the delivery failed at the
	// most expensive possible moment for a typo in a colour field.
	for (const backgroundColor of ['not a colour; --evil', '#12345', 'rgb(1,2,3)', '#zzzzzz', '  ']) {
		assert.throws(
			() => resolveVideoExportCanvas(project(), { backgroundColor }),
			/canvas\.backgroundColor/u,
			`${backgroundColor} must not reach a plan`,
		);
	}
});

test('the background colours a delivery can actually state are accepted verbatim', () => {
	for (const backgroundColor of ['#000000', '#ffffffff', '0xAABBCC', 'black', 'white@0.5']) {
		assert.equal(
			resolveVideoExportCanvas(project(), { backgroundColor }).backgroundColor,
			backgroundColor,
			'the plan states the colour it was given, and the adapter renders it',
		);
	}
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

test('the composed plan counts exact CFR frames without floating-point overstatement', () => {
	const value = project();
	const durationFrames = 776_776;
	value.sampleRate = 48_000;
	value.sources[0].sampleRate = 48_000;
	value.sources[0].frameCount = durationFrames;
	value.clips[0].sourceDurationFrames = durationFrames;
	value.clips[0].durationFrames = durationFrames;

	const plan = createVideoExportPlan(value, {
		includeAudio: false,
		range: { startFrame: 0, endFrame: durationFrames },
		canvas: { frameRate: { num: 30_000, den: 1_001 } },
	});

	assert.equal(plan.outputFrameCount, 485);
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

test('the derived canvas comes from the clips the delivered range contains', () => {
	// The canvas was derived from the whole project while the intervals beside it
	// were resolved against the range, so exporting a selection could be framed
	// and timed by a clip the delivery never shows.
	const twoClips = () => {
		const value = project();
		value.sources.push({
			...value.sources[0], id: 'source-2', storageKey: 'media/source-2',
			width: 640, height: 480, frameRate: 25,
		});
		value.clips.push({
			kind: 'video', id: 'clip-2', sourceId: 'source-2', title: 'Late',
			timelineStartFrame: 10_000, sourceStartFrame: 0,
			sourceDurationFrames: 10_000, durationFrames: 10_000,
		});
		value.tracks[0].clipIds.push('clip-2');
		return value;
	};

	const late = createVideoExportPlan(twoClips(), { range: { startFrame: 10_000, endFrame: 20_000 } });
	assert.equal(late.canvas.referenceClipId, 'clip-2');
	assert.deepEqual([late.canvas.width, late.canvas.height], [640, 480]);
	assert.equal(late.canvas.frameRate, 25);

	// The whole project still resolves against its earliest visible clip.
	const whole = createVideoExportPlan(twoClips(), { range: 'project' });
	assert.equal(whole.canvas.referenceClipId, 'clip-1');
	assert.deepEqual([whole.canvas.width, whole.canvas.height], [1_280, 720]);

	// A caller's own visibility predicate reaches the canvas as well as the
	// intervals, so a canvas cannot be sized from a track the delivery excludes.
	const hidden = createVideoExportPlan(twoClips(), {
		range: 'project',
		isTrackVisible: (track) => track.id === 'track-1' && false,
	});
	assert.equal(hidden.canvas.referenceClipId, null);
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
