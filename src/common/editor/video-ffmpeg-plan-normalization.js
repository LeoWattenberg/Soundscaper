/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Admitting a video export plan before an FFmpeg argument is built from it.
 *
 * The runner never reads a plan field directly: it reads what this module
 * admitted, so an ill-formed or version-mismatched plan is refused before any
 * staging or encoding happens rather than becoming a puzzling filter graph.
 */

import { getVideoExportFormat } from './video-export.js';
import { normalizeVideoFfmpegCompositionIntervals } from './video-ffmpeg-render-description.ts';
import {
	CANONICAL_VIDEO_EXPORT_PLAN_VERSION,
	SUPPORTED_VIDEO_EXPORT_PLAN_VERSIONS,
} from './video-export-plan-version.ts';
import { isVideoCanvasFit } from './video-canvas-fit.ts';
import {
	DEFAULT_VIDEO_DELIVERY_QUALITY,
	isVideoDeliveryQuality,
} from './video-delivery-quality.ts';
import {
	nonEmptyString,
	nonNegativeFiniteNumber,
	nonNegativeInteger,
	positiveEvenInteger,
	positiveFiniteNumber,
	positiveSafeInteger,
} from './video-ffmpeg-values.js';

export function normalizeVideoExportPlan(plan) {
	if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
		throw new TypeError('Expected a video export plan.');
	}
	if (!SUPPORTED_VIDEO_EXPORT_PLAN_VERSIONS.includes(plan.version)) {
		throw new RangeError(`Unsupported video export plan version: ${plan.version}.`);
	}
	const descriptor = getVideoExportFormat(plan.format);
	if (plan.container !== descriptor.container) {
		throw new TypeError(`Video export plan container must be ${descriptor.container}.`);
	}
	if (plan.codecs?.videoEncoder !== descriptor.videoEncoder) {
		throw new TypeError(`Video export plan encoder must be ${descriptor.videoEncoder}.`);
	}
	const width = positiveEvenInteger(plan.canvas?.width, 'plan.canvas.width');
	const height = positiveEvenInteger(plan.canvas?.height, 'plan.canvas.height');
	const fit = normalizedPlanCanvasFit(plan);
	const quality = normalizedPlanQuality(plan);
	const frameRate = positiveFiniteNumber(plan.canvas?.frameRate, 'plan.canvas.frameRate');
	const durationSeconds = positiveFiniteNumber(plan.durationSeconds, 'plan.durationSeconds');
	const pixelFormat = nonEmptyString(plan.codecs?.pixelFormat, 'plan.codecs.pixelFormat');
	if (pixelFormat !== descriptor.pixelFormat) {
		throw new TypeError(`Video export plan pixel format must be ${descriptor.pixelFormat}.`);
	}

	if (!Array.isArray(plan.inputs)) throw new TypeError('Video export plan inputs must be an array.');
	const inputs = [...plan.inputs]
		.sort((left, right) => left.inputIndex - right.inputIndex)
		.map((input, index) => (input?.kind === 'video-source'
			? {
				...input,
				// Version 5 and later state a presentation; an older plan is presented
				// exactly as its decoder decodes it.
				presentation: plan.version >= 5
					? normalizeVideoInputPresentation(input.presentation, `plan.inputs[${index}].presentation`)
					: null,
			}
			: input));
	const sourceInputIndexes = new Map();
	let audioInput = null;
	let captionInput = null;
	for (const [expectedIndex, input] of inputs.entries()) {
		if (input?.inputIndex !== expectedIndex) {
			throw new RangeError('Video export plan input indexes must be contiguous and zero-based.');
		}
		if (input.kind === 'video-source') {
			const sourceId = nonEmptyString(input.sourceId, `plan.inputs[${expectedIndex}].sourceId`);
			if (sourceInputIndexes.has(sourceId)) {
				throw new RangeError(`Video export plan contains duplicate source ${sourceId}.`);
			}
			sourceInputIndexes.set(sourceId, expectedIndex);
		} else if (input.kind === 'staged-audio-mix') {
			if (audioInput) throw new RangeError('Video export plan may contain only one staged audio mix.');
			audioInput = input;
		} else if (input.kind === 'staged-captions') {
			if (captionInput) throw new RangeError('Video export plan may contain only one staged caption document.');
			captionInput = input;
		} else {
			throw new TypeError(`Unsupported video export input kind: ${input?.kind}.`);
		}
	}
	if (audioInput && audioInput !== inputs.at(-1)) {
		throw new RangeError('The staged audio mix must be the final video export input.');
	}
	const expectsAudio = plan.filterPlan?.audio?.strategy === 'staged-mix';
	if (expectsAudio !== Boolean(audioInput)) {
		throw new TypeError('Video export plan audio input and filter strategy do not agree.');
	}
	if (Boolean(audioInput) !== Boolean(plan.codecs?.audioEncoder)) {
		throw new TypeError('Video export plan audio input and encoder do not agree.');
	}
	if (audioInput && plan.codecs.audioEncoder !== descriptor.audioEncoder) {
		throw new TypeError(`Video export plan audio encoder must be ${descriptor.audioEncoder}.`);
	}

	const content = plan.version === 1
		? { segments: normalizeSequentialSegments(plan, inputs) }
		: {
				intervals: normalizeVideoFfmpegCompositionIntervals(
					plan, inputs, durationSeconds, { width, height, fit },
				),
		};

	const captions = normalizedPlanCaptions(plan, descriptor, captionInput);

	return {
		version: plan.version,
		descriptor,
		inputs,
		audioInput,
		captionInput,
		captions,
		...content,
		width,
		height,
		frameRate,
		durationSeconds,
		pixelFormat,
		quality,
		backgroundColor: plan.canvas?.backgroundColor || '#000000',
	};
}

/**
 * What this plan asks the muxer to do about captions.
 *
 * A caption input and a caption decision have to agree — an input with no
 * decision would be staged and never mapped, and a decision with no input would
 * map a stream that is not there. Both are refused rather than reconciled,
 * because either one means the plan was assembled by something that did not
 * understand it.
 */
function normalizedPlanCaptions(plan, descriptor, captionInput) {
	const captions = plan.captions ?? null;
	if (captions === null) {
		if (captionInput) throw new TypeError('Video export plan stages captions it never asks to carry.');
		return null;
	}
	if (typeof captions !== 'object' || Array.isArray(captions)) {
		throw new TypeError('plan.captions must be an object or null.');
	}
	const mux = captions.mux === true;
	if (mux !== Boolean(captionInput)) {
		throw new TypeError('Video export plan caption input and mux decision do not agree.');
	}
	if (mux && captions.subtitleCodec !== descriptor.subtitleCodec) {
		throw new TypeError(`Video export plan caption codec must be ${String(descriptor.subtitleCodec)}.`);
	}
	return { mux, subtitleCodec: mux ? descriptor.subtitleCodec : null };
}

/**
 * The delivery quality this plan states, refusing a version that cannot state one.
 *
 * The same rule the canvas fit answers to, for the same reason: a version that
 * predates the option has no tier to read, and a tier found on one is a document
 * assembled from two builds. Reading it as `balanced` would deliver a draft or a
 * high-effort encode as neither, silently.
 */
function normalizedPlanQuality(plan) {
	const quality = plan.quality;
	if (quality === undefined) {
		if (plan.version >= CANONICAL_VIDEO_EXPORT_PLAN_VERSION) {
			throw new TypeError('plan.quality is required from version '
				+ `${CANONICAL_VIDEO_EXPORT_PLAN_VERSION} onwards.`);
		}
		return DEFAULT_VIDEO_DELIVERY_QUALITY;
	}
	if (plan.version < CANONICAL_VIDEO_EXPORT_PLAN_VERSION) {
		throw new TypeError(`Video export plan version ${plan.version} cannot state a delivery quality.`);
	}
	if (!isVideoDeliveryQuality(quality)) {
		throw new RangeError(`Unsupported plan.quality: ${String(quality)}.`);
	}
	return quality;
}

/**
 * The delivery fit this plan states, refusing a version that cannot state one.
 *
 * A plan older than the canonical version has no fit field, and a fit found on
 * one is a document assembled from two different builds — reading it as the
 * contain those versions meant would deliver the wrong framing silently, so it
 * is refused instead.
 */
function normalizedPlanCanvasFit(plan) {
	const fit = plan.canvas?.fit;
	if (fit === undefined) {
		if (plan.version >= CANONICAL_VIDEO_EXPORT_PLAN_VERSION) {
			throw new TypeError('plan.canvas.fit is required from version '
				+ `${CANONICAL_VIDEO_EXPORT_PLAN_VERSION} onwards.`);
		}
		return 'contain';
	}
	if (plan.version < CANONICAL_VIDEO_EXPORT_PLAN_VERSION) {
		throw new TypeError(`Video export plan version ${plan.version} cannot state a canvas fit.`);
	}
	if (!isVideoCanvasFit(fit)) throw new RangeError(`Unsupported plan.canvas.fit: ${String(fit)}.`);
	return fit;
}

function normalizeSequentialSegments(plan, inputs) {
	if (!Array.isArray(plan.segments) || plan.segments.length === 0) {
		throw new RangeError('Video export plan must contain at least one segment.');
	}
	return plan.segments.map((segment, index) => {
		const duration = positiveFiniteNumber(
			segment?.durationSeconds,
			`plan.segments[${index}].durationSeconds`,
		);
		if (segment.kind === 'black') {
			return {
				kind: 'black',
				color: segment.color,
				durationSeconds: duration,
			};
		}
		if (segment.kind !== 'video') {
			throw new TypeError(`Unsupported video export segment kind: ${segment?.kind}.`);
		}
		const inputIndex = nonNegativeInteger(segment.inputIndex, `plan.segments[${index}].inputIndex`);
		const input = inputs[inputIndex];
		if (input?.kind !== 'video-source' || input.sourceId !== segment.sourceId) {
			throw new ReferenceError(`Video export segment ${index} references an incompatible input.`);
		}
		const sourceStartTimeSeconds = nonNegativeFiniteNumber(
			segment.sourceStartTimeSeconds,
			`plan.segments[${index}].sourceStartTimeSeconds`,
		);
		const sourceEndTimeSeconds = positiveFiniteNumber(
			segment.sourceEndTimeSeconds,
			`plan.segments[${index}].sourceEndTimeSeconds`,
		);
		if (sourceEndTimeSeconds <= sourceStartTimeSeconds) {
			throw new RangeError(`Video export segment ${index} source range must have positive duration.`);
		}
		return {
			kind: 'video',
			inputIndex,
			sourceStartTimeSeconds,
			sourceEndTimeSeconds,
			playbackRate: positiveFiniteNumber(
				segment.playbackRate,
				`plan.segments[${index}].playbackRate`,
			),
			durationSeconds: duration,
		};
	});
}

function normalizeVideoInputPresentation(value, name) {
	if (value == null) return null;
	if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	if (value.autorotate !== true) {
		throw new TypeError(`${name}.autorotate must be true: the decode applies the display matrix.`);
	}
	const decodedWidth = positiveSafeInteger(value.decodedWidth, `${name}.decodedWidth`);
	const decodedHeight = positiveSafeInteger(value.decodedHeight, `${name}.decodedHeight`);
	const scaledWidth = positiveSafeInteger(value.scaledWidth, `${name}.scaledWidth`);
	const scaledHeight = positiveSafeInteger(value.scaledHeight, `${name}.scaledHeight`);
	if (scaledWidth === decodedWidth && scaledHeight === decodedHeight) {
		throw new RangeError(`${name} must state a stretch the decode did not already apply.`);
	}
	return Object.freeze({
		autorotate: true,
		decodedWidth,
		decodedHeight,
		sampleAspect: Object.freeze({
			num: positiveSafeInteger(value.sampleAspect?.num, `${name}.sampleAspect.num`),
			den: positiveSafeInteger(value.sampleAspect?.den, `${name}.sampleAspect.den`),
		}),
		scaledWidth,
		scaledHeight,
	});
}
