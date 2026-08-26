/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded, VFR-preserving access to authenticated assistance RGBA frame packs. */

import { readFile } from 'node:fs/promises';

import {
	reviewAssistanceFramePackV1,
	type AssistanceFramePackV1Frame,
	type ReviewedAssistanceFramePackV1,
} from '../src/common/editor/assistance/binary-formats-v1.ts';
import type {
	AssistanceRuntimeFamilyInputGrantV1,
} from './assistance-runtime-family-job-contract.ts';

const FRAME_PACK_MEDIA_TYPE = 'application/vnd.soundscaper.frame-pack';
const MAXIMUM_VISUAL_FRAMES = 100_000;

interface PackIndexV1 {
	readonly inputIndex: number;
	readonly ordinalStart: number;
	readonly frameCount: number;
	readonly sourceFrames: readonly number[];
	readonly presentationTicks: readonly string[];
}

export interface AssistanceOnnxVisualFrameAuthorityV1 {
	readonly width: number;
	readonly height: number;
	readonly timescale: number;
	readonly frameCount: number;
	readonly frames: readonly Readonly<{
		readonly sourceFrame: number;
		readonly presentationTick: string;
	}>[];
	readFrame(ordinal: number): Promise<AssistanceFramePackV1Frame>;
	release(): void;
}

export async function openAssistanceOnnxVisualFrameSourceV1(
	inputs: readonly AssistanceRuntimeFamilyInputGrantV1[],
	signal?: AbortSignal,
): Promise<AssistanceOnnxVisualFrameAuthorityV1> {
	if (inputs.length < 1 || inputs.some(({ role, mediaType }) =>
		role !== 'frame-pack' || mediaType !== FRAME_PACK_MEDIA_TYPE)) {
		throw new TypeError('Visual ONNX execution requires exact assistance frame-pack inputs.');
	}
	let width: number | null = null;
	let height: number | null = null;
	let timescale: number | null = null;
	let priorSource = -1;
	let priorTick = -1n;
	const frames: Array<Readonly<{ sourceFrame: number; presentationTick: string }>> = [];
	const packs: PackIndexV1[] = [];
	for (const [inputIndex, input] of inputs.entries()) {
		signal?.throwIfAborted();
		const reviewed = reviewAssistanceFramePackV1(await readFile(input.path));
		if (reviewed.frameCount < 1) throw new RangeError('A visual frame pack cannot be empty.');
		if (width !== null && (reviewed.width !== width || reviewed.height !== height
			|| reviewed.timescale !== timescale)) {
			throw new RangeError('Visual frame-pack chunks disagree about geometry or timescale.');
		}
		width ??= reviewed.width;
		height ??= reviewed.height;
		timescale ??= reviewed.timescale;
		const sourceFrames: number[] = [];
		const presentationTicks: string[] = [];
		for (let index = 0; index < reviewed.frameCount; index += 1) {
			const frame = reviewed.frame(index);
			if (frame.sourceFrame <= priorSource || BigInt(frame.presentationTick) <= priorTick) {
				throw new RangeError('Visual frame packs must retain ordered VFR source/tick authority.');
			}
			priorSource = frame.sourceFrame;
			priorTick = BigInt(frame.presentationTick);
			sourceFrames.push(frame.sourceFrame);
			presentationTicks.push(frame.presentationTick);
			frames.push(Object.freeze({ sourceFrame: frame.sourceFrame,
				presentationTick: frame.presentationTick }));
			if (frames.length > MAXIMUM_VISUAL_FRAMES) {
				throw new RangeError('Visual ONNX execution exceeds its exact frame bound.');
			}
		}
		packs.push(Object.freeze({ inputIndex, ordinalStart: frames.length - reviewed.frameCount,
			frameCount: reviewed.frameCount, sourceFrames: Object.freeze(sourceFrames),
			presentationTicks: Object.freeze(presentationTicks) }));
	}
	if (width === null || height === null || timescale === null) {
		throw new RangeError('Visual ONNX execution requires at least one reviewed frame.');
	}
	let cachedInputIndex = -1;
	let cached: ReviewedAssistanceFramePackV1 | null = null;
	return Object.freeze({ width, height, timescale, frameCount: frames.length,
		frames: Object.freeze(frames),
		async readFrame(ordinalValue: number) {
			if (!Number.isSafeInteger(ordinalValue) || ordinalValue < 0 || ordinalValue >= frames.length) {
				throw new RangeError('A visual adapter requested a frame outside reviewed custody.');
			}
			const pack = packs.find(({ ordinalStart, frameCount }) => ordinalValue >= ordinalStart
				&& ordinalValue < ordinalStart + frameCount)!;
			if (cachedInputIndex !== pack.inputIndex || cached === null) {
				signal?.throwIfAborted();
				cached = reviewAssistanceFramePackV1(await readFile(inputs[pack.inputIndex]!.path));
				cachedInputIndex = pack.inputIndex;
				if (cached.width !== width || cached.height !== height || cached.timescale !== timescale
					|| cached.frameCount !== pack.frameCount) {
					throw new Error('A visual frame pack changed after its authenticated metadata pass.');
				}
			}
			const local = ordinalValue - pack.ordinalStart;
			const frame = cached.frame(local);
			if (frame.sourceFrame !== pack.sourceFrames[local]
				|| frame.presentationTick !== pack.presentationTicks[local]) {
				throw new Error('Visual frame timing changed after its authenticated metadata pass.');
			}
			return frame;
		},
		release() { cached = null; cachedInputIndex = -1; },
	});
}

export function assistanceOnnxVisualAuthorityJsonV1(
	source: AssistanceOnnxVisualFrameAuthorityV1,
): Readonly<{ width: number; height: number; timescale: number;
	frames: AssistanceOnnxVisualFrameAuthorityV1['frames'] }> {
	return Object.freeze({ width: source.width, height: source.height,
		timescale: source.timescale, frames: source.frames });
}
