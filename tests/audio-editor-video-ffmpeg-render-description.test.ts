/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import {
	normalizeVideoFfmpegCompositionIntervals,
	normalizeVideoFfmpegRenderDescription,
	videoFfmpegBlendExpression,
} from '../src/common/editor/video-ffmpeg-render-description.ts';
import { buildVideoFfmpegArgs } from '../src/common/editor/video-ffmpeg.js';
import {
	resolveVideoRenderDescription,
	type VideoRenderDescription,
} from '../src/common/editor/video-render-description.ts';

const CANVAS: Readonly<{ width: number; height: number }> = Object.freeze({ width: 320, height: 180 });

test('V6 renders the canonical crop, affine, authored opacity, and normal blend in order', () => {
	const description = descriptionFor({
		crop: { left: 0.1, top: 0.2, right: 0.3, bottom: 0.1 },
		transform: {
			anchorX: 0.25,
			anchorY: 0.75,
			positionX: 0.6,
			positionY: 0.4,
			scaleX: 1.5,
			scaleY: 0.75,
			rotationDegrees: 30,
			flipHorizontal: true,
			flipVertical: false,
		},
		opacity: 0.4,
	});
	const plan = v6Plan([{ trackId: 'video', clips: [singleClip(0, description)] }]);
	plan.intervals[0]!.layers[0]!.clips[0]!.videoEffects = [{
		id: 'pixel', type: 'pixelate', enabled: true, params: { blockSize: 8 },
	}];
	const graph = filterGraph(plan);
	const [outputCenterX, outputCenterY] = transformedCropCenter(description);
	const ordered = [
		'scale=w=320:h=180:flags=bicubic',
		'format=pix_fmts=rgba,fps=fps=30',
		'pixelize=w=8:h=8:mode=avg:planes=15',
		'crop=w=iw*0.6000000000000001:h=ih*0.7000000000000001:x=iw*0.1:y=ih*0.2:exact=1',
		'hflip',
		'scale=w=iw*1.5:h=ih*0.75:flags=bicubic',
		'rotate=a=0.5235987755982987:ow=rotw(0.5235987755982987):oh=roth(0.5235987755982987):c=black@0',
		'colorchannelmixer=aa=0.4',
		'premultiply=inplace=1',
		`overlay=x=${String(outputCenterX)}-overlay_w/2:y=${String(outputCenterY)}-overlay_h/2`,
		'format=pix_fmts=rgba,split=2',
		'alphaextract,format=pix_fmts=gbrp',
		"blend=all_expr='B'",
		'maskedmerge,format=pix_fmts=rgba',
	];
	let previous = -1;
	for (const operation of ordered) {
		const next = graph.indexOf(operation, previous + 1);
		assert.ok(next > previous, `${operation} must follow the preceding V6 operation.`);
		previous = next;
	}
	assert.doesNotMatch(graph, /force_original_aspect_ratio/);
	assert.doesNotMatch(graph, /blend=all_mode=/);
});

test('V6 identity uses the descriptor exact odd-parity contain placement', () => {
	const canvas = Object.freeze({ width: 1_920, height: 1_080 });
	const description = resolveVideoRenderDescription({
		composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		sourceDisplaySize: { width: 853, height: 480 },
		canvas,
	});
	const graph = filterGraph(v6Plan(
		[{ trackId: 'video', clips: [singleClip(0, description)] }],
		canvas,
	));

	assert.match(graph, /scale=w=1919:h=1080:flags=bicubic/);
	assert.match(graph, /pad=w=1920:h=1080:x=1:y=0:color=black@0/);
	assert.doesNotMatch(graph, /crop=w=/);
	assert.doesNotMatch(graph, /rotate=a=/);
	assert.match(graph, /blend=all_expr='B'/);
});

test('V6 blend modes use the shared encoded-RGB formulas without backend aliases', () => {
	assert.deepEqual({
		normal: videoFfmpegBlendExpression('normal'),
		multiply: videoFfmpegBlendExpression('multiply'),
		screen: videoFfmpegBlendExpression('screen'),
		overlay: videoFfmpegBlendExpression('overlay'),
		darken: videoFfmpegBlendExpression('darken'),
		lighten: videoFfmpegBlendExpression('lighten'),
		difference: videoFfmpegBlendExpression('difference'),
		exclusion: videoFfmpegBlendExpression('exclusion'),
	}, {
		normal: 'B',
		multiply: 'A*B/255',
		screen: 'A+B-A*B/255',
		overlay: 'if(lte(A,127.5),2*A*B/255,255-2*(255-A)*(255-B)/255)',
		darken: 'min(A,B)',
		lighten: 'max(A,B)',
		difference: 'abs(A-B)',
		exclusion: 'A+B-2*A*B/255',
	});
	assert.throws(
		() => videoFfmpegBlendExpression('unsafe' as never),
		/Unsupported FFmpeg video blend mode/,
	);
});

test('V6 render-description validation is exact and fail closed', () => {
	const description = descriptionFor({});
	const normalize = (value: unknown): VideoRenderDescription => (
		normalizeVideoFfmpegRenderDescription(value, 'description', CANVAS)
	);
	const canonical = normalize(description);
	assert.deepEqual(canonical, description);
	assert.equal(Object.isFrozen(canonical), true);
	assert.equal(Object.isFrozen(canonical.crop), true);
	assert.throws(() => normalize({ ...description, injected: true }), /unsupported field/);
	assert.throws(() => normalize({ ...description, opacityStart: -0 }), /negative zero/);
	assert.throws(() => normalize({ ...description, blendMode: 'unsafe' }), /unsupported/);
	assert.throws(() => normalize({
		...description,
		crop: {
			...description.crop,
			sourcePixels: { ...description.crop.sourcePixels, x: 1 },
		},
	}), /disagrees with the normalized aperture/);
	assert.throws(() => normalize({
		...description,
		sourceDisplayToCanvas: [1, 0, 0.25, 1, 0, 0],
	}), /only scale, reflection, and rotation/);
});

test('V6 plans reject omitted or contradictory descriptors and layer order', () => {
	const normal = descriptionFor({});
	const multiply = descriptionFor({ blendMode: 'multiply' });
	const orderOne = descriptionFor({ compositingOrder: 1 });
	const orderZero = descriptionFor({ compositingOrder: 0 });
	const missing = v6Plan([{ trackId: 'video', clips: [singleClip(0, normal)] }]);
	delete missing.intervals[0]!.layers[0]!.clips[0]!.renderDescription;
	assert.throws(() => filterGraph(missing), /renderDescription/);

	const contradictory = v6Plan([{ trackId: 'video', clips: [singleClip(0, normal)] }]);
	contradictory.intervals[0]!.layers[0]!.clips[0]!.opacityEnd = 1 - Number.EPSILON;
	assert.throws(() => filterGraph(contradictory), /opacity endpoints must match/);

	const transition = v6Plan([{
		trackId: 'video',
		clips: [
			transitionClip(0, 'outgoing', normal, 1, 0),
			transitionClip(1, 'incoming', multiply, 0, 1),
		],
	}]);
	assert.throws(() => filterGraph(transition), /must share blend and order/);

	const unsorted = v6Plan([
		{ trackId: 'upper', clips: [singleClip(0, orderOne)] },
		{ trackId: 'lower', clips: [singleClip(1, orderZero)] },
	]);
	assert.throws(() => filterGraph(unsorted), /ascending compositing order/);
});

test('V6 plans require unique project track indexes and their canonical tie order', () => {
	const tied = descriptionFor({ compositingOrder: 4 });
	const valid = v6Plan([
		{ trackId: 'background', trackIndex: 2, clips: [singleClip(0, tied)] },
		{ trackId: 'foreground', trackIndex: 0, clips: [singleClip(1, tied)] },
	]);
	const intervals = normalizeVideoFfmpegCompositionIntervals(valid, valid.inputs, 1, CANVAS);
	const layers = intervals[0]!.layers as readonly PlanLayer[];
	assert.deepEqual(layers.map(({ trackIndex }) => trackIndex), [2, 0]);

	const missing = v6Plan([{ trackId: 'video', clips: [singleClip(0, tied)] }]);
	delete (missing.intervals[0]!.layers[0]! as { trackIndex?: number }).trackIndex;
	assert.throws(() => filterGraph(missing), /trackIndex/);

	const fractional = v6Plan([{
		trackId: 'video', trackIndex: 0.5, clips: [singleClip(0, tied)],
	}]);
	assert.throws(() => filterGraph(fractional), /trackIndex.*non-negative safe integer/);
	const textual = v6Plan([{ trackId: 'video', clips: [singleClip(0, tied)] }]);
	textual.intervals[0]!.layers[0]!.trackIndex = '0' as never;
	assert.throws(() => filterGraph(textual), /trackIndex.*finite/);

	const duplicate = v6Plan([
		{ trackId: 'background', trackIndex: 1, clips: [singleClip(0, tied)] },
		{ trackId: 'foreground', trackIndex: 1, clips: [singleClip(1, tied)] },
	]);
	assert.throws(() => filterGraph(duplicate), /duplicate track index 1/);

	const reversedTie = v6Plan([
		{ trackId: 'background', trackIndex: 0, clips: [singleClip(0, tied)] },
		{ trackId: 'foreground', trackIndex: 1, clips: [singleClip(1, tied)] },
	]);
	assert.throws(() => filterGraph(reversedTie), /descending track index tie order/);
});

test('the extracted interval normalizer preserves legacy V2-V5 numeric coercion', () => {
	const intervals = normalizeVideoFfmpegCompositionIntervals({
		version: 5,
		intervals: [{
			kind: 'composition',
			durationSeconds: '1',
			layers: [{
				trackId: 'video',
				clips: [{
					role: 'single', inputIndex: '0', sourceId: 'source-0',
					sourceStartTimeSeconds: '-0', sourceEndTimeSeconds: '1',
					playbackRate: '1', opacityStart: '1', opacityEnd: '1', videoEffects: [],
				}],
			}],
		}],
	}, [{ kind: 'video-source', inputIndex: 0, sourceId: 'source-0' }], 1, CANVAS);
	const layers = intervals[0]!.layers as readonly PlanLayer[];

	assert.deepEqual(layers[0]!.clips[0], {
		role: 'single', inputIndex: 0, sourceStartTimeSeconds: 0, sourceEndTimeSeconds: 1,
		playbackRate: 1, opacityStart: 1, opacityEnd: 1, videoEffects: [],
	});
});

function descriptionFor(changes: Readonly<Record<string, unknown>>): VideoRenderDescription {
	const crop = changes.crop as Readonly<Record<string, unknown>> | undefined;
	const transform = changes.transform as Readonly<Record<string, unknown>> | undefined;
	return resolveVideoRenderDescription({
		composition: {
			...DEFAULT_VIDEO_CLIP_COMPOSITION,
			...changes,
			crop: { ...DEFAULT_VIDEO_CLIP_COMPOSITION.crop, ...crop },
			transform: { ...DEFAULT_VIDEO_CLIP_COMPOSITION.transform, ...transform },
		},
		sourceDisplaySize: CANVAS,
		canvas: CANVAS,
	});
}

interface PlanClip {
	role: 'single' | 'outgoing' | 'incoming';
	inputIndex: number;
	sourceId: string;
	sourceStartTimeSeconds: number;
	sourceEndTimeSeconds: number;
	playbackRate: number;
	opacityStart: number;
	opacityEnd: number;
	videoEffects: readonly unknown[];
	renderDescription?: VideoRenderDescription;
}

interface PlanLayer {
	trackId: string;
	trackIndex?: number;
	clips: PlanClip[];
}

function singleClip(inputIndex: number, description: VideoRenderDescription): PlanClip {
	return transitionClip(inputIndex, 'single', description, description.opacityStart, description.opacityEnd);
}

function transitionClip(
	inputIndex: number,
	role: PlanClip['role'],
	description: VideoRenderDescription,
	opacityStart: number,
	opacityEnd: number,
): PlanClip {
	return {
		role,
		inputIndex,
		sourceId: `source-${String(inputIndex)}`,
		sourceStartTimeSeconds: 0,
		sourceEndTimeSeconds: 1,
		playbackRate: 1,
		opacityStart,
		opacityEnd,
		videoEffects: [],
		renderDescription: {
			...description,
			opacityStart,
			opacityEnd,
		},
	};
}

function v6Plan(layers: PlanLayer[], canvas = CANVAS) {
	const inputIndexes = [...new Set(layers.flatMap(({ clips }) => clips.map(({ inputIndex }) => inputIndex)))];
	return {
		version: 6,
		format: 'mp4',
		container: 'mp4',
		extension: 'mp4',
		mimeType: 'video/mp4',
		durationSeconds: 1,
		canvas: { ...canvas, frameRate: 30, pixelFormat: 'yuv420p', backgroundColor: '#000000' },
		codecs: {
			video: 'h264', videoEncoder: 'libx264', audio: null, audioEncoder: null, pixelFormat: 'yuv420p',
		},
		inputs: inputIndexes.map((inputIndex) => ({
			kind: 'video-source', inputIndex, sourceId: `source-${String(inputIndex)}`, mimeType: 'video/mp4',
		})),
		intervals: [{
			kind: 'composition',
			durationSeconds: 1,
			layers: layers.map((layer, layerIndex) => ({
				...layer,
				trackIndex: layer.trackIndex ?? layers.length - layerIndex - 1,
			})),
		}],
		filterPlan: { audio: { strategy: 'none' } },
	};
}

function filterGraph(plan: ReturnType<typeof v6Plan>): string {
	const videoInputPaths = Object.fromEntries(plan.inputs.map(({ sourceId }) => [sourceId, `/stage/${sourceId}.mp4`]));
	const args = buildVideoFfmpegArgs(plan, { videoInputPaths }, 'output.mp4');
	return String(args[args.indexOf('-filter_complex') + 1]);
}

function transformedCropCenter(description: VideoRenderDescription): readonly [number, number] {
	const { x, y, width, height } = description.crop.sourcePixels;
	const [a, b, c, d, e, f] = description.sourceDisplayToCanvas;
	const points = [[x, y], [x + width, y], [x, y + height], [x + width, y + height]];
	const mappedX = points.map(([pointX, pointY]) => a * pointX! + c * pointY! + e);
	const mappedY = points.map(([pointX, pointY]) => b * pointX! + d * pointY! + f);
	return [(Math.min(...mappedX) + Math.max(...mappedX)) / 2, (Math.min(...mappedY) + Math.max(...mappedY)) / 2];
}
