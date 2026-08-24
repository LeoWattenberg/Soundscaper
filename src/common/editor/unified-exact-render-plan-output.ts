/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed output-shape normalization shared by every unified exact render generation. */

import { readClosedDomainRecord } from './closed-domain-value.ts';
import { isVideoCanvasFit } from './video-canvas-fit.ts';
import { isVideoDeliveryAudioLayout, type VideoDeliveryAudioLayout } from './video-delivery-audio-layout.ts';
import { isVideoDeliveryQuality } from './video-delivery-quality.ts';
import type {
	UnifiedExactRenderPlan,
	UnifiedExactRenderPlanVersion,
} from './unified-exact-render-plan.ts';
import {
	exactRenderField as field,
	exactRenderInteger as integer,
	exactRenderRational as rational,
	exactRenderText as text,
} from './unified-exact-render-plan-primitives.ts';

const OUTPUT_FIELDS = Object.freeze([
	'frameRate', 'frameCount', 'quality', 'canvas', 'includeAudio', 'audioLayout',
]);
const CANVAS_FIELDS = Object.freeze(['width', 'height', 'fit', 'pixelFormat', 'backgroundColor']);

export function normalizeUnifiedExactRenderOutput(
	value: unknown,
	codecs: UnifiedExactRenderPlan['codecs'],
	version: UnifiedExactRenderPlanVersion,
): UnifiedExactRenderPlan['output'] {
	const record = readClosedDomainRecord(value, 'unified render output', OUTPUT_FIELDS);
	const canvasRecord = readClosedDomainRecord(
		field(record, 'canvas', 'unified render output'), 'unified render canvas', CANVAS_FIELDS,
	);
	const fit = field(canvasRecord, 'fit', 'unified render canvas');
	if (!isVideoCanvasFit(fit)) throw new RangeError('Unified render canvas fit is unsupported.');
	const pixelFormat = text(field(canvasRecord, 'pixelFormat', 'unified render canvas'), 'canvas.pixelFormat');
	if (pixelFormat !== codecs.pixelFormat) {
		throw new RangeError('Unified render canvas and codec pixel formats disagree.');
	}
	const includeAudio = field(record, 'includeAudio', 'unified render output');
	const audioLayout = field(record, 'audioLayout', 'unified render output');
	const quality = field(record, 'quality', 'unified render output');
	if (!isVideoDeliveryQuality(quality)) throw new RangeError('Unified render quality is unsupported.');
	if (typeof includeAudio !== 'boolean') throw new TypeError('Unified render includeAudio must be boolean.');
	if (includeAudio ? (!isVideoDeliveryAudioLayout(audioLayout) || codecs.audio === null)
		: (audioLayout !== null || codecs.audio !== null)) {
		throw new RangeError('Unified render audio metadata is inconsistent.');
	}
	if (includeAudio && version !== 14 && version !== 15) {
		throw new RangeError('Unified plans V9-V13 cannot include audio until an exact audio media graph is represented.');
	}
	const backgroundColor = field(canvasRecord, 'backgroundColor', 'unified render canvas');
	if (typeof backgroundColor !== 'string' || !/^#[a-fA-F0-9]{6}(?:[a-fA-F0-9]{2})?$/u.test(backgroundColor)) {
		throw new RangeError('Unified render background color is not canonical hexadecimal RGB/RGBA.');
	}
	return Object.freeze({
		frameRate: rational(field(record, 'frameRate', 'unified render output'), 'output.frameRate'),
		frameCount: integer(field(record, 'frameCount', 'unified render output'), 'output.frameCount', 1),
		quality,
		canvas: Object.freeze({
			width: integer(field(canvasRecord, 'width', 'unified render canvas'), 'canvas.width', 1),
			height: integer(field(canvasRecord, 'height', 'unified render canvas'), 'canvas.height', 1),
			fit,
			pixelFormat,
			backgroundColor,
		}),
		includeAudio,
		audioLayout: audioLayout as VideoDeliveryAudioLayout | null,
	});
}
