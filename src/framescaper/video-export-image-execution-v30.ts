/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	mapFramescaperImageTimelineFrameV1,
	type FramescaperImageClipV1,
	type FramescaperImageSourceV1,
} from '../common/editor/timeline-image-model-v30.ts';
import type { UnifiedExactRenderPlanV13 } from '../common/editor/unified-exact-render-plan.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../common/editor/video-clip-composition.ts';
import { defaultVideoSourceColorInterpretationV1 } from '../common/editor/video-color-management-v27.ts';
import { resolveVideoRenderDescription } from '../common/editor/video-render-description.ts';
import {
	framescaperImageSourceForClipV30,
	openFramescaperStoredImageFramePackV30,
	type FramescaperImageFramePackReaderV1,
} from './editor-selected-v30-image-frame-source.ts';
import { cloneFramescaperProjectV30, type FramescaperProjectV30 } from './editor-project-v30.ts';
import { gradeEncodedFrame } from './selected-v27-exact-frame-support.ts';
import type { FramescaperSelectedExactSupplementalPictureV27 } from './selected-v27-exact-frame-execution.ts';
import type { FramescaperVideoExportSupplementalPictureExecutionV27 } from './video-export-exact-execution-v27.ts';

interface ImageContextV30 {
	readonly clip: FramescaperImageClipV1;
	readonly source: FramescaperImageSourceV1;
	readonly reader: FramescaperImageFramePackReaderV1;
	readonly trackId: string;
	readonly trackIndex: number;
	lastFrameIndex: number;
	lastLinearFrame: Readonly<{
		readonly width: number;
		readonly height: number;
		readonly pixels: Uint8Array<ArrayBuffer>;
	}> | null;
}

/** Resolve authenticated V30 frame packs directly into the exact linear compositor. */
export async function createFramescaperVideoExportImageExecutionV30(options: Readonly<{
	readonly profile: unknown;
	readonly project: FramescaperProjectV30;
	readonly foundationPlan: UnifiedExactRenderPlanV13;
	readonly store: AudioEditorProjectStore;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
}>): Promise<FramescaperVideoExportSupplementalPictureExecutionV27 | null> {
	const project = cloneFramescaperProjectV30(options?.profile, options?.project);
	assertReady(options);
	const visible = visibleImageClips(project);
	if (visible.length === 0) return null;
	const readers = new Map<string, FramescaperImageFramePackReaderV1>();
	const contexts: ImageContextV30[] = [];
	try {
		for (const item of visible) {
			const source = framescaperImageSourceForClipV30(project.sources, item.clip);
			let reader = readers.get(source.id);
			if (!reader) {
				reader = await openFramescaperStoredImageFramePackV30(options.store, source, options.signal);
				readers.set(source.id, reader);
			}
			assertReady(options);
			contexts.push({ ...item, source, reader, lastFrameIndex: -1, lastLinearFrame: null });
		}
	} catch (error) {
		disposeContexts(contexts);
		throw error;
	}
	let disposed = false;
	let active = false;
	return Object.freeze({
		async resolve(request: Parameters<FramescaperVideoExportSupplementalPictureExecutionV27['resolve']>[0]) {
			if (disposed) throw new Error('The V30 image export execution is disposed.');
			if (active) throw new Error('The V30 image export execution cannot overlap frames.');
			active = true;
			try {
				assertReady({ ...options, signal: request.signal });
				assertCanvas(options.foundationPlan, request.width, request.height);
				const sequenceFrame = floorRational(request.sequencePosition);
				const pictures: FramescaperSelectedExactSupplementalPictureV27[] = [];
				for (const context of contexts) {
					const clip = context.clip;
					if (sequenceFrame < clip.sequenceStartFrame
						|| sequenceFrame >= clip.sequenceStartFrame + clip.sequenceFrameCount) continue;
					const address = mapFramescaperImageTimelineFrameV1({
						clip,
						sequenceFrame,
						sequenceRate: sequenceRate(project, clip.sequenceId),
						timings: context.reader.timings,
					});
					const frame = await linearFrame(context, address.frameIndex, request.signal);
					assertReady({ ...options, signal: request.signal });
					pictures.push(Object.freeze({
						trackId: context.trackId,
						clipId: clip.id,
						sourceId: context.source.id,
						frame,
						displayWidth: context.source.canonical.width,
						displayHeight: context.source.canonical.height,
						renderDescription: resolveVideoRenderDescription({
							composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
							sourceDisplaySize: {
								width: context.source.canonical.width,
								height: context.source.canonical.height,
							},
							canvas: { width: request.width, height: request.height },
							opacityStart: 1,
						}),
						opacity: 1,
					}));
				}
				return Object.freeze(pictures);
			} finally { active = false; }
		},
		dispose() {
			if (disposed) return;
			if (active) throw new Error('The V30 image export execution is active.');
			disposed = true;
			disposeContexts(contexts);
		},
	});
}

async function linearFrame(
	context: ImageContextV30,
	frameIndex: number,
	signal: AbortSignal,
) {
	if (context.lastFrameIndex === frameIndex && context.lastLinearFrame) return context.lastLinearFrame;
	const sourcePixels = await context.reader.readFrame(frameIndex, signal);
	const pixels = sourcePixels.slice() as Uint8Array<ArrayBuffer>;
	sourcePixels.fill(0);
	let linear;
	try {
		linear = gradeEncodedFrame({
			width: context.source.canonical.width,
			height: context.source.canonical.height,
			pixels,
		}, defaultVideoSourceColorInterpretationV1('still', context.source.id), [], new Map(), signal);
	} finally { pixels.fill(0); }
	context.lastLinearFrame?.pixels.fill(0);
	context.lastFrameIndex = frameIndex;
	context.lastLinearFrame = linear;
	return linear;
}

function visibleImageClips(project: FramescaperProjectV30): readonly Readonly<{
	readonly clip: FramescaperImageClipV1;
	readonly trackId: string;
	readonly trackIndex: number;
}>[] {
	const sequence = project.sequences.find(({ id }) => id === project.primarySequenceId);
	if (!sequence) throw new ReferenceError('The V30 image export primary sequence is unavailable.');
	const sequenceTrackIds = new Set(sequence.trackIds);
	const tracks = project.tracks.filter(({ id, type }) => type === 'video' && sequenceTrackIds.has(id));
	const soloed = tracks.some(({ solo }) => solo === true);
	const visibleTrackIds = new Set(tracks.filter((track) => (
		soloed ? track.solo === true : track.hidden !== true
	)).map(({ id }) => id));
	return Object.freeze(project.clips.flatMap((value) => {
		if (value.kind !== 'image') return [];
		const clip = value as FramescaperImageClipV1;
		if (clip.sequenceId !== sequence.id) return [];
		const track = tracks.find(({ clipIds }) => clipIds.includes(clip.id));
		if (!track || !visibleTrackIds.has(track.id)) return [];
		const trackIndex = sequence.trackIds.indexOf(track.id);
		if (trackIndex < 0) throw new ReferenceError(`V30 image track ${track.id} is outside its sequence.`);
		return [{ clip, trackId: track.id, trackIndex }];
	}).sort((left, right) => left.trackIndex - right.trackIndex
		|| left.clip.sequenceStartFrame - right.clip.sequenceStartFrame
		|| compareText(left.clip.id, right.clip.id)));
}

function sequenceRate(project: FramescaperProjectV30, sequenceId: string) {
	const sequence = project.sequences.find(({ id }) => id === sequenceId);
	if (!sequence) throw new ReferenceError(`V30 image sequence ${sequenceId} is unavailable.`);
	return sequence.rate;
}

function floorRational(value: Readonly<{ readonly num: number; readonly den: number }>): number {
	if (!Number.isSafeInteger(value?.num) || !Number.isSafeInteger(value?.den) || value.den < 1 || value.num < 0) {
		throw new RangeError('The V30 image export sequence position is invalid.');
	}
	const result = Number(BigInt(value.num) / BigInt(value.den));
	if (!Number.isSafeInteger(result)) throw new RangeError('The V30 image export sequence frame exceeds its domain.');
	return result;
}

function assertCanvas(plan: UnifiedExactRenderPlanV13, width: number, height: number): void {
	if (plan.output.canvas.width !== width || plan.output.canvas.height !== height) {
		throw new RangeError('The V30 image export canvas changed after planning.');
	}
}

function assertReady(options: Readonly<{
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
}>): void {
	if (options.signal.aborted) {
		throw options.signal.reason ?? new DOMException('The V30 image export was aborted.', 'AbortError');
	}
	options.assertCurrent();
}

function disposeContexts(contexts: readonly ImageContextV30[]): void {
	for (const context of contexts) {
		context.lastLinearFrame?.pixels.fill(0);
		context.lastLinearFrame = null;
		context.lastFrameIndex = -1;
	}
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
