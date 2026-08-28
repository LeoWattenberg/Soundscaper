/* SPDX-License-Identifier: AGPL-3.0-only */

/** Product-owned baseline adapter from caption tracks to exact delivery artifacts. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	videoBurnInFontSubsetIds,
	resolveVideoBurnInStage,
	type VideoBurnInStage,
} from '../common/editor/video-caption-burn-in.ts';
import type {
	VideoCaptionExportResultV1,
	VideoCaptionInterchangeLossV1,
} from '../common/editor/video-caption-track-v27.ts';
import {
	exportVideoCaptionTrackV1,
	normalizeVideoCaptionTrackV1,
	type VideoCaptionCueV1,
	type VideoCaptionTrackV1,
	type VideoCaptionWordV1,
} from '../common/editor/video-caption-track-v27.ts';
import {
	nativeMediaV14EncodeDispatch,
	type NativeMediaV14EncodeProfileId,
} from '../common/editor/native-media-v14-native-dispatch.ts';
import type {
	UnifiedExactRenderCaptionDeliveryV15,
} from '../common/editor/unified-exact-render-delivery-v15.ts';

export type FramescaperCaptionSidecarFormat = 'srt' | 'vtt' | 'imsc1';

export interface FramescaperCaptionDeliveryRequest {
	readonly trackId: string;
	readonly mux: boolean;
	readonly burnIn: boolean;
	readonly sidecar: FramescaperCaptionSidecarFormat | null;
}

export interface FramescaperCaptionDeliveryContext {
	readonly profileId: NativeMediaV14EncodeProfileId;
	readonly sampleRate: number;
	readonly range: Readonly<{ readonly startFrame: number; readonly endFrame: number }>;
	readonly canvas: Readonly<{ readonly width: number; readonly height: number }>;
}

export interface FramescaperCaptionDeliveryAvailability {
	readonly muxCodec: 'mov_text' | 'webvtt' | null;
	readonly burnIn: boolean;
	readonly burnInRefusal: string | null;
}

export interface FramescaperCaptionDeliveryDocument
	extends VideoCaptionExportResultV1 {
	readonly sha256: string;
}

export interface FramescaperCaptionBurnPlan {
	readonly schemaVersion: 1;
	/** The present renderer flattens M4 presentation fields and reports every omission. */
	readonly renderingMode: 'legacy-fixed-style-v1';
	readonly trackId: string;
	readonly sourceCaptionSha256: string;
	readonly stage: VideoBurnInStage;
	readonly interchangeOmissions: readonly VideoCaptionInterchangeLossV1[];
}

export interface FramescaperCaptionDeliveryAdapter {
	readonly track: VideoCaptionTrackV1;
	readonly delivery: UnifiedExactRenderCaptionDeliveryV15;
	readonly muxDocument: FramescaperCaptionDeliveryDocument | null;
	readonly sidecarDocument: FramescaperCaptionDeliveryDocument | null;
	readonly burnInStage: VideoBurnInStage | null;
	readonly burnInPlan: FramescaperCaptionBurnPlan | null;
	readonly interchangeOmissions: Readonly<{
		readonly mux: readonly VideoCaptionInterchangeLossV1[];
		readonly sidecar: readonly VideoCaptionInterchangeLossV1[];
		readonly burnIn: readonly VideoCaptionInterchangeLossV1[];
	}>;
}

/** Report native carrier capability without claiming that its licensing gate passed. */
export function framescaperCaptionDeliveryAvailability(
	profileId: NativeMediaV14EncodeProfileId,
): FramescaperCaptionDeliveryAvailability {
	const dispatch = nativeMediaV14EncodeDispatch(profileId);
	const muxCodec = dispatch.muxer === 'mp4' || dispatch.muxer === 'mov'
		? 'mov_text' as const
		: dispatch.muxer === 'webm' ? 'webvtt' as const : null;
	const preservesAuthoredAlpha = profileId === 'encode-mov-prores-4444';
	return Object.freeze({
		muxCodec,
		burnIn: !preservesAuthoredAlpha,
		burnInRefusal: preservesAuthoredAlpha
			? 'Caption burn-in would replace authored ProRes 4444 alpha.' : null,
	});
}

/**
 * Adapt one exact Framescaper caption track into the staged documents and V15 authority.
 *
 * This does no file IO and never changes project state. The native queue owns
 * publication; this adapter supplies immutable bytes/text, their digests, and
 * every interchange omission that publication must put in its report.
 */
export function createFramescaperCaptionDeliveryAdapter(
	trackValue: unknown,
	requestValue: unknown,
	contextValue: FramescaperCaptionDeliveryContext,
): FramescaperCaptionDeliveryAdapter {
	const sourceTrack = normalizeVideoCaptionTrackV1(trackValue);
	const request = snapshotFramescaperCaptionDeliveryRequest(requestValue);
	const context = snapshotContext(contextValue);
	if (request.trackId !== sourceTrack.id) {
		throw new ReferenceError('The selected Framescaper caption request track does not match its exact track authority.');
	}
	if (!request.mux && !request.burnIn && request.sidecar === null) {
		throw new RangeError('A Framescaper caption delivery must select mux, burn-in, or a sidecar.');
	}
	const track = deliveredTrack(sourceTrack, context.range);
	if (track.cues.length === 0) {
		throw new RangeError(`Track ${track.id} contributes no captions to the delivered range.`);
	}
	const availability = framescaperCaptionDeliveryAvailability(context.profileId);
	if (request.mux && availability.muxCodec === null) {
		const muxer = nativeMediaV14EncodeDispatch(context.profileId).muxer;
		throw new RangeError(`The ${muxer} delivery cannot mux a caption track; select a sidecar or burn-in.`);
	}
	if (request.burnIn && !availability.burnIn) {
		throw new RangeError(availability.burnInRefusal ?? 'This delivery refuses caption burn-in.');
	}

	const muxDocument = request.mux ? document(
		track, availability.muxCodec === 'webvtt' ? 'webvtt' : 'srt', context.sampleRate,
	) : null;
	const sidecarDocument = request.sidecar === null ? null : document(
		track, request.sidecar === 'vtt' ? 'webvtt'
			: request.sidecar === 'imsc1' ? 'imsc1.1' : 'srt', context.sampleRate,
	);
	const burnInterchange = request.burnIn ? document(track, 'srt', context.sampleRate) : null;
	const burnInStage = request.burnIn
		? resolveVideoBurnInStage(track.cues.map((cue) => Object.freeze({
			startFrame: cue.startFrame, endFrame: cue.endFrame, title: cue.text,
		})), context.canvas, context.sampleRate)
		: null;
	if (request.burnIn && burnInStage === null) {
		throw new RangeError('The selected Framescaper caption track has no drawable cues in the delivered range.');
	}
	const cueSetSha256 = digest({
		styles: track.styles, regions: track.regions, speakers: track.speakers, cues: track.cues,
	});
	const burnInPlan = burnInStage === null ? null : Object.freeze({
		schemaVersion: 1 as const,
		renderingMode: 'legacy-fixed-style-v1' as const,
		trackId: track.id,
		sourceCaptionSha256: cueSetSha256,
		stage: burnInStage,
		interchangeOmissions: burnInterchange!.losses,
	});
	const fontSubsetIds = Object.freeze([...videoBurnInFontSubsetIds(burnInStage)].sort());
	const delivery = Object.freeze({
		stage: 'post-finishing-delivery' as const,
		trackId: track.id,
		cueSetSha256,
		mux: muxDocument === null ? null : Object.freeze({
			codec: availability.muxCodec!, documentSha256: muxDocument.sha256,
		}),
		burnIn: burnInStage === null ? null : Object.freeze({
			planSha256: digest(burnInPlan), fontSubsetIds,
			alphaDisposition: nativeMediaV14EncodeDispatch(context.profileId).supportsAlpha
				? 'caption-composited' as const : 'opaque-output' as const,
		}),
		sidecar: sidecarDocument === null ? null : Object.freeze({
			format: request.sidecar!, documentSha256: sidecarDocument.sha256,
		}),
	}) satisfies UnifiedExactRenderCaptionDeliveryV15;
	return Object.freeze({
		track,
		delivery,
		muxDocument,
		sidecarDocument,
		burnInStage,
		burnInPlan,
		interchangeOmissions: Object.freeze({
			mux: muxDocument?.losses ?? Object.freeze([]),
			sidecar: sidecarDocument?.losses ?? Object.freeze([]),
			burnIn: burnInterchange?.losses ?? Object.freeze([]),
		}),
	});
}

function deliveredTrack(
	track: VideoCaptionTrackV1,
	range: FramescaperCaptionDeliveryContext['range'],
): VideoCaptionTrackV1 {
	return normalizeVideoCaptionTrackV1({
		...track,
		cues: track.cues.flatMap((cue) => {
			const startFrame = Math.max(cue.startFrame, range.startFrame);
			const endFrame = Math.min(cue.endFrame, range.endFrame);
			if (endFrame <= startFrame) return [];
			return [{
				...cue,
				startFrame: startFrame - range.startFrame,
				endFrame: endFrame - range.startFrame,
				words: deliveredWords(cue, range),
			}];
		}),
	});
}

function deliveredWords(
	cue: VideoCaptionCueV1,
	range: FramescaperCaptionDeliveryContext['range'],
): readonly VideoCaptionWordV1[] {
	return cue.words.flatMap((word) => {
		const startFrame = Math.max(word.startFrame, range.startFrame);
		const endFrame = Math.min(word.endFrame, range.endFrame);
		return endFrame <= startFrame ? [] : [Object.freeze({
			startFrame: startFrame - range.startFrame,
			endFrame: endFrame - range.startFrame,
			text: word.text,
		})];
	});
}

function document(
	track: VideoCaptionTrackV1,
	format: 'srt' | 'webvtt' | 'imsc1.1',
	sampleRate: number,
): FramescaperCaptionDeliveryDocument {
	const result = exportVideoCaptionTrackV1(track, { format, sampleRate });
	return Object.freeze({ ...result, sha256: digestText(result.text) });
}

export function snapshotFramescaperCaptionDeliveryRequest(
	value: unknown,
): FramescaperCaptionDeliveryRequest {
	const row = closedRecord(value, ['trackId', 'mux', 'burnIn', 'sidecar'], 'Framescaper caption delivery request');
	if (typeof row.trackId !== 'string' || row.trackId.length === 0) {
		throw new TypeError('Framescaper caption delivery request.trackId must be a non-empty string.');
	}
	if (typeof row.mux !== 'boolean' || typeof row.burnIn !== 'boolean') {
		throw new TypeError('Framescaper caption delivery request mux and burnIn must be booleans.');
	}
	if (row.sidecar !== null && row.sidecar !== 'srt'
		&& row.sidecar !== 'vtt' && row.sidecar !== 'imsc1') {
		throw new RangeError('Framescaper caption sidecar format is unsupported.');
	}
	return Object.freeze({
		trackId: row.trackId,
		mux: row.mux,
		burnIn: row.burnIn,
		sidecar: row.sidecar,
	}) as FramescaperCaptionDeliveryRequest;
}

function snapshotContext(
	value: FramescaperCaptionDeliveryContext,
): FramescaperCaptionDeliveryContext {
	const row = closedRecord(
		value, ['profileId', 'sampleRate', 'range', 'canvas'], 'Framescaper caption delivery context',
	);
	nativeMediaV14EncodeDispatch(row.profileId as NativeMediaV14EncodeProfileId);
	if (!Number.isSafeInteger(row.sampleRate) || Number(row.sampleRate) < 1) {
		throw new RangeError('Framescaper caption delivery sampleRate must be positive.');
	}
	const range = closedRecord(row.range, ['startFrame', 'endFrame'], 'Framescaper caption delivery range');
	if (!Number.isSafeInteger(range.startFrame) || Number(range.startFrame) < 0
		|| !Number.isSafeInteger(range.endFrame) || Number(range.endFrame) <= Number(range.startFrame)) {
		throw new RangeError('Framescaper caption delivery range must be a non-empty safe frame range.');
	}
	const canvas = closedRecord(row.canvas, ['width', 'height'], 'Framescaper caption delivery canvas');
	if (!Number.isSafeInteger(canvas.width) || Number(canvas.width) < 1
		|| !Number.isSafeInteger(canvas.height) || Number(canvas.height) < 1) {
		throw new RangeError('Framescaper caption delivery canvas must have positive safe extents.');
	}
	return Object.freeze({
		profileId: row.profileId as NativeMediaV14EncodeProfileId,
		sampleRate: Number(row.sampleRate),
		range: Object.freeze({
			startFrame: Number(range.startFrame), endFrame: Number(range.endFrame),
		}),
		canvas: Object.freeze({ width: Number(canvas.width), height: Number(canvas.height) }),
	});
}

function closedRecord(
	value: unknown,
	fields: readonly string[],
	name: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a closed plain record.`);
	}
	const row = value as Readonly<Record<string, unknown>>;
	const keys = Reflect.ownKeys(row);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} has an invalid closed shape.`);
	}
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(row, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an own enumerable data property.`);
		}
	}
	return row;
}

function digest(value: unknown): string {
	return digestText(JSON.stringify(value));
}

function digestText(value: string): string {
	return bytesToHex(sha256(new TextEncoder().encode(value)));
}
