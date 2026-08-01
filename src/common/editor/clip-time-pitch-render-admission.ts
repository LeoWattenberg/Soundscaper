/* SPDX-License-Identifier: AGPL-3.0-only */

import { STAFFPAD_MAXIMUM_BLOCK_FRAMES } from './staffpad/parameters.js';

const MIB = 1024 * 1024;
const FLOAT32_BYTES = Float32Array.BYTES_PER_ELEMENT;
const MAXIMUM_SAFE_BYTES = BigInt(Number.MAX_SAFE_INTEGER);

export const MAXIMUM_CLIP_TIME_PITCH_RENDER_USEFUL_BINARY_BYTES = 256 * MIB;
export const STAFFPAD_CLIP_TIME_PITCH_WASM_BYTES = 64 * MIB;
export const STAFFPAD_CLIP_TIME_PITCH_MAXIMUM_BLOCK_FRAMES = STAFFPAD_MAXIMUM_BLOCK_FRAMES;

export type ClipTimePitchRenderDirection = 'forward' | 'reverse';
export type ClipTimePitchRenderWorkingSetScope =
	| 'staffpad-clip-cache-stage-useful-binary-working-set'
	| 'staffpad-clip-cache-render-useful-binary-working-set';

export interface ClipTimePitchRenderAdmissionStage {
	readonly inputFrames: number;
	readonly outputFrames: number;
}

export interface ClipTimePitchRenderAdmissionPlan {
	readonly sourceFrameCount: number;
	readonly channelCount: number;
	readonly direction: ClipTimePitchRenderDirection;
	readonly stages: readonly ClipTimePitchRenderAdmissionStage[];
}

export interface ClipTimePitchRenderAdmissionOptions {
	readonly chunkFrames: number;
	readonly transferLoadedSourceChannels: boolean;
}

export interface ClipTimePitchRenderWorkingSetBound {
	readonly bytes: number;
	readonly certainty: 'upper-bound';
	readonly scope: ClipTimePitchRenderWorkingSetScope;
}

export interface ClipTimePitchRenderAdmissionPhase {
	readonly stageIndex: number;
	readonly stageInputFrames: number;
	readonly outputFrames: number;
	readonly accountedInputFrames: number;
	readonly inputCopies: 1 | 2;
	readonly sourceInputBytes: number;
	readonly clientOutputBytes: number;
	readonly cumulativeTransferredOutputBytes: number;
	readonly chunkScratchBytes: number;
	readonly wasmBlockScratchBytes: number;
	readonly staffPadWasmBytes: number;
	readonly usefulBinaryWorkingSet: Readonly<ClipTimePitchRenderWorkingSetBound>;
}

export interface ClipTimePitchRenderAdmissionEstimate {
	readonly phases: readonly Readonly<ClipTimePitchRenderAdmissionPhase>[];
	readonly peakPhaseIndex: number;
	readonly usefulBinaryWorkingSet: Readonly<ClipTimePitchRenderWorkingSetBound>;
	readonly browserHeapBytes: null;
	readonly processResidentSetBytes: null;
	readonly garbageCollectionHeadroomBytes: null;
}

/**
 * Accounts for the useful binary buffers owned by one sequential StaffPad
 * clip-cache render phase. The bound includes source input copies, the client
 * output allocation, up to one output payload in queued transferred chunks,
 * one accumulator chunk, one maximum-sized block copied out of WASM, and the
 * audited maximum StaffPad WASM linear memory. It is not a browser-heap,
 * whole-process RSS, or GC-headroom bound.
 */
export function estimateClipTimePitchRenderAdmission(
	plan: ClipTimePitchRenderAdmissionPlan,
	options: ClipTimePitchRenderAdmissionOptions,
): Readonly<ClipTimePitchRenderAdmissionEstimate> {
	const sourceFrameCount = safeIntegerRange(
		plan?.sourceFrameCount,
		1,
		Number.MAX_SAFE_INTEGER,
		'StaffPad clip-cache render source frame count',
	);
	const channelCount = safeIntegerRange(
		plan?.channelCount,
		1,
		2,
		'StaffPad clip-cache render channel count',
	);
	const direction = renderDirection(plan?.direction);
	const stages = renderStages(plan?.stages, sourceFrameCount);
	const chunkFrames = safeIntegerRange(
		options?.chunkFrames,
		1_024,
		65_536,
		'StaffPad clip-cache render chunk frames',
	);
	if (typeof options?.transferLoadedSourceChannels !== 'boolean') {
		throw new TypeError('StaffPad clip-cache render source transfer ownership must be boolean.');
	}

	const bytesPerPlanarFrame = BigInt(channelCount) * BigInt(FLOAT32_BYTES);
	const chunkScratchValue = BigInt(chunkFrames) * bytesPerPlanarFrame;
	const wasmBlockScratchValue = BigInt(STAFFPAD_CLIP_TIME_PITCH_MAXIMUM_BLOCK_FRAMES)
		* bytesPerPlanarFrame;
	const wasmValue = BigInt(STAFFPAD_CLIP_TIME_PITCH_WASM_BYTES);
	const phaseScope = 'staffpad-clip-cache-stage-useful-binary-working-set';
	const phases = stages.map((stage, stageIndex) => {
		const firstStage = stageIndex === 0;
		const inputCopies: 1 | 2 = firstStage
			&& (direction === 'reverse' || !options.transferLoadedSourceChannels)
			? 2
			: 1;
		const accountedInputFrames = firstStage ? sourceFrameCount : stage.inputFrames;
		const sourceInputValue = BigInt(accountedInputFrames)
			* bytesPerPlanarFrame
			* BigInt(inputCopies);
		const outputValue = BigInt(stage.outputFrames) * bytesPerPlanarFrame;
		const workingSetValue = sourceInputValue
			+ outputValue
			+ outputValue
			+ chunkScratchValue
			+ wasmBlockScratchValue
			+ wasmValue;
		return Object.freeze({
			stageIndex,
			stageInputFrames: stage.inputFrames,
			outputFrames: stage.outputFrames,
			accountedInputFrames,
			inputCopies,
			sourceInputBytes: safeByteNumber(
				sourceInputValue,
				'StaffPad clip-cache render source input bytes',
			),
			clientOutputBytes: safeByteNumber(
				outputValue,
				'StaffPad clip-cache render client output bytes',
			),
			cumulativeTransferredOutputBytes: safeByteNumber(
				outputValue,
				'StaffPad clip-cache render transferred output bytes',
			),
			chunkScratchBytes: safeByteNumber(
				chunkScratchValue,
				'StaffPad clip-cache render chunk scratch bytes',
			),
			wasmBlockScratchBytes: safeByteNumber(
				wasmBlockScratchValue,
				'StaffPad clip-cache render WASM block scratch bytes',
			),
			staffPadWasmBytes: STAFFPAD_CLIP_TIME_PITCH_WASM_BYTES,
			usefulBinaryWorkingSet: bound(
				safeByteNumber(
					workingSetValue,
					'StaffPad clip-cache render useful binary working set',
				),
				phaseScope,
			),
		});
	});
	let peakPhaseIndex = 0;
	for (let index = 1; index < phases.length; index += 1) {
		if (phases[index]!.usefulBinaryWorkingSet.bytes
			> phases[peakPhaseIndex]!.usefulBinaryWorkingSet.bytes) {
			peakPhaseIndex = index;
		}
	}
	const peakBytes = phases[peakPhaseIndex]!.usefulBinaryWorkingSet.bytes;
	return Object.freeze({
		phases: Object.freeze(phases),
		peakPhaseIndex,
		usefulBinaryWorkingSet: bound(
			peakBytes,
			'staffpad-clip-cache-render-useful-binary-working-set',
		),
		browserHeapBytes: null,
		processResidentSetBytes: null,
		garbageCollectionHeadroomBytes: null,
	});
}

/** Normalize a test seam without allowing the production ceiling to rise. */
export function normalizeClipTimePitchRenderMaximumBytes(
	value: unknown = MAXIMUM_CLIP_TIME_PITCH_RENDER_USEFUL_BINARY_BYTES,
): number {
	if (typeof value !== 'number'
		|| !Number.isSafeInteger(value)
		|| value < 0
		|| value > MAXIMUM_CLIP_TIME_PITCH_RENDER_USEFUL_BINARY_BYTES) {
		throw new RangeError(
			'StaffPad clip-cache render maximum must be a non-negative safe integer '
			+ `no greater than ${MAXIMUM_CLIP_TIME_PITCH_RENDER_USEFUL_BINARY_BYTES} bytes.`,
		);
	}
	return value;
}

function renderDirection(value: unknown): ClipTimePitchRenderDirection {
	if (value !== 'forward' && value !== 'reverse') {
		throw new RangeError('StaffPad clip-cache render direction must be forward or reverse.');
	}
	return value;
}

function renderStages(
	value: unknown,
	sourceFrameCount: number,
): readonly ClipTimePitchRenderAdmissionStage[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new RangeError('StaffPad clip-cache render must have at least one stage.');
	}
	let priorOutputFrames: number | null = null;
	return value.map((candidate: unknown, index) => {
		const stage = candidate as Partial<ClipTimePitchRenderAdmissionStage> | null;
		const inputFrames = safeIntegerRange(
			stage?.inputFrames,
			1,
			Number.MAX_SAFE_INTEGER,
			`StaffPad clip-cache render stage ${index} input frames`,
		);
		const outputFrames = safeIntegerRange(
			stage?.outputFrames,
			1,
			Number.MAX_SAFE_INTEGER,
			`StaffPad clip-cache render stage ${index} output frames`,
		);
		if (index === 0 && inputFrames > sourceFrameCount) {
			throw new RangeError('StaffPad clip-cache render first stage exceeds its source frame count.');
		}
		if (priorOutputFrames != null && inputFrames !== priorOutputFrames) {
			throw new RangeError('StaffPad clip-cache render stages are not frame-contiguous.');
		}
		priorOutputFrames = outputFrames;
		return Object.freeze({ inputFrames, outputFrames });
	});
}

function safeIntegerRange(
	value: unknown,
	minimum: number,
	maximum: number,
	field: string,
): number {
	if (typeof value !== 'number'
		|| !Number.isSafeInteger(value)
		|| value < minimum
		|| value > maximum) {
		throw new RangeError(`${field} must be a safe integer between ${minimum} and ${maximum}.`);
	}
	return value;
}

function safeByteNumber(value: bigint, field: string): number {
	if (value < 0n || value > MAXIMUM_SAFE_BYTES) {
		throw new RangeError(`${field} exceeds the supported safe integer range.`);
	}
	return Number(value);
}

function bound(
	bytes: number,
	scope: ClipTimePitchRenderWorkingSetScope,
): Readonly<ClipTimePitchRenderWorkingSetBound> {
	return Object.freeze({ bytes, certainty: 'upper-bound', scope });
}
