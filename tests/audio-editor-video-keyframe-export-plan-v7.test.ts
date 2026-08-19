/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertVideoKeyframeExportPlanV7,
	createVideoKeyframeExportPlanV7,
	isVideoKeyframeExportPlanV7,
} from '../src/common/editor/video-keyframe-export-plan-v7.ts';

test('creates a recursively frozen exact MP4 plan that survives detached JSON admission', () => {
	const plan = createVideoKeyframeExportPlanV7(request({
		durationFrames: 48_048,
		frameRate: { num: 30_000, den: 1_001 },
	}));

	assert.equal(plan.version, 7);
	assert.equal(plan.strategy, 'framescaper-keyframed-rgba-v1');
	assert.deepEqual(plan.duration, { num: 1_001, den: 1_000 });
	assert.deepEqual(plan.canvas.frameRate, { num: 30_000, den: 1_001 });
	assert.equal(plan.outputFrameCount, 30);
	assert.equal(createVideoKeyframeExportPlanV7(request({
		durationFrames: 48_049,
		frameRate: { num: 30_000, den: 1_001 },
	})).outputFrameCount, 31);
	assert.deepEqual(plan.codecs, {
		video: 'h264', videoEncoder: 'libx264', audio: 'aac', audioEncoder: 'aac',
		pixelFormat: 'yuv420p',
	});
	assert.deepEqual(plan.inputs.at(-1), {
		kind: 'staged-audio-mix', inputIndex: 2, fileName: 'audio-mix.wav',
		sampleRate: 48_000, startFrame: 96_000, durationFrames: 48_048,
		channelLayout: 'preserve',
	});
	assertRecursivelyFrozen(plan);

	const detached: unknown = JSON.parse(JSON.stringify(plan));
	assert.equal(isVideoKeyframeExportPlanV7(detached), true);
	assert.doesNotThrow(() => assertVideoKeyframeExportPlanV7(detached));
});

test('orders canonical source inputs by first active encounter and represents silent WebM exactly', () => {
	const plan = createVideoKeyframeExportPlanV7(request({
		format: 'webm',
		includeAudio: false,
		activeSourceIds: ['source-b', 'source-a'],
		sources: [source('source-a', '12'), source('source-b', '34')],
		referenceClipId: 'clip-b',
		referenceSourceId: 'source-b',
	}));

	assert.deepEqual(plan.activeSourceIds, ['source-b', 'source-a']);
	assert.deepEqual(plan.inputs, [
		{
			kind: 'video-source', inputIndex: 0, sourceId: 'source-b',
			storageKey: 'storage-source-b', mimeType: 'video/mp4', contentSha256: '34'.repeat(32),
		},
		{
			kind: 'video-source', inputIndex: 1, sourceId: 'source-a',
			storageKey: 'storage-source-a', mimeType: 'video/mp4', contentSha256: '12'.repeat(32),
		},
	]);
	assert.deepEqual(plan.codecs, {
		video: 'vp9', videoEncoder: 'libvpx-vp9', audio: null, audioEncoder: null,
		pixelFormat: 'yuv420p',
	});
});

test('rejects hostile creator input and non-canonical detached plans without invoking accessors', () => {
	let reads = 0;
	const hostile = Object.defineProperty(request(), 'format', {
		enumerable: true,
		get() { reads += 1; return 'mp4'; },
	});
	assert.throws(() => createVideoKeyframeExportPlanV7(hostile), /data property/iu);
	assert.equal(reads, 0);

	const malformed = request();
	(malformed.sources[0] as Record<string, unknown>).contentSha256 = 'AB'.repeat(32);
	assert.throws(() => createVideoKeyframeExportPlanV7(malformed), /sha-256|digest/iu);

	const plan = JSON.parse(JSON.stringify(createVideoKeyframeExportPlanV7(request()))) as Record<string, unknown>;
	plan.unexpected = true;
	assert.equal(isVideoKeyframeExportPlanV7(plan), false);
	assert.throws(() => assertVideoKeyframeExportPlanV7(plan), /canonical|unsupported|field/iu);

	const reordered = JSON.parse(JSON.stringify(createVideoKeyframeExportPlanV7(request()))) as Record<string, unknown>;
	const version = reordered.version;
	delete reordered.version;
	reordered.version = version;
	assert.equal(isVideoKeyframeExportPlanV7(reordered), false);
	assert.throws(() => assertVideoKeyframeExportPlanV7(reordered), /canonical field order/iu);

	const unsafeColor = request();
	(unsafeColor.canvas as { backgroundColor: string }).backgroundColor = 'color(display-p3 0 0 0)';
	assert.throws(() => createVideoKeyframeExportPlanV7(unsafeColor), /backgroundColor/iu);
	// A hex background is what the compositor can clear to, so it is delivered
	// rather than refused; a colour name is FFmpeg's palette, which this path has
	// no way to resolve, and it says so instead of quietly rendering black.
	const nonblack = request();
	(nonblack.canvas as { backgroundColor: string }).backgroundColor = '#ffffff';
	assert.equal(createVideoKeyframeExportPlanV7(nonblack).canvas.backgroundColor, '#ffffff');
	const named = request();
	(named.canvas as { backgroundColor: string }).backgroundColor = 'papayawhip';
	assert.throws(
		() => createVideoKeyframeExportPlanV7(named),
		/hex colour the compositor can clear to/iu,
	);

	assert.throws(() => createVideoKeyframeExportPlanV7(request({
		frameRate: { num: 31, den: 1 },
	})), /frame rate.*encoder ceiling/iu);
	assert.throws(() => createVideoKeyframeExportPlanV7(request({
		includeAudio: false,
		frameRate: { num: 31, den: 1 },
	})), /frame rate.*encoder ceiling/iu);
	assert.throws(() => createVideoKeyframeExportPlanV7(request({
		frameRate: { num: 1, den: 2 },
	})), /frame rate.*encoder ceiling/iu);
	for (const sampleRate of [7_999, 768_001]) {
		assert.throws(
			() => createVideoKeyframeExportPlanV7(request({ sampleRate })),
			/sample rate.*8,?000.*768,?000/iu,
		);
	}
});

interface RequestOverrides {
	readonly activeSourceIds?: string[];
	readonly durationFrames?: number;
	readonly fit?: 'contain' | 'cover' | 'stretch';
	readonly format?: 'mp4' | 'webm';
	readonly frameRate?: Readonly<{ num: number; den: number }>;
	readonly includeAudio?: boolean;
	readonly referenceClipId?: string | null;
	readonly referenceSourceId?: string | null;
	readonly sampleRate?: number;
	readonly sources?: Array<Record<string, unknown>>;
}

function request(overrides: RequestOverrides = {}) {
	const durationFrames = overrides.durationFrames ?? 48_000;
	const activeSourceIds = overrides.activeSourceIds ?? ['source-a', 'source-b'];
	const sources = overrides.sources ?? [source('source-a', '12'), source('source-b', '34')];
	return {
		format: overrides.format ?? 'mp4',
		sampleRate: overrides.sampleRate ?? 48_000,
		range: { startFrame: 96_000, endFrame: 96_000 + durationFrames, durationFrames },
		canvas: {
			width: 1_280, height: 720,
			frameRate: overrides.frameRate ?? { num: 30, den: 1 },
			fit: overrides.fit ?? 'contain',
			pixelFormat: 'yuv420p', backgroundColor: '#000000',
			referenceClipId: overrides.referenceClipId === undefined ? 'clip-a' : overrides.referenceClipId,
			referenceSourceId: overrides.referenceSourceId === undefined
				? activeSourceIds[0] : overrides.referenceSourceId,
		},
		activeClipIds: ['clip-a', 'clip-b'],
		activeSourceIds,
		sources,
		includeAudio: overrides.includeAudio ?? true,
		...(overrides.includeAudio === false ? {} : { audioFileName: 'audio-mix.wav' }),
	};
}

function source(id: string, digestByte: string): Record<string, unknown> {
	return {
		kind: 'video', id, storageKey: `storage-${id}`, mimeType: 'video/mp4',
		contentSha256: digestByte.repeat(32),
	};
}

function assertRecursivelyFrozen(value: unknown): void {
	if (!value || typeof value !== 'object') return;
	assert.equal(Object.isFrozen(value), true);
	for (const nested of Object.values(value)) assertRecursivelyFrozen(nested);
}
