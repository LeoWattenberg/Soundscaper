/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CapturePcmChunk } from './framescaper-capture-pcm-packetizer.ts';

export interface FramescaperCapturePcmFrameMapper {
	start(sharedStartFrame: number): void;
	map(chunk: CapturePcmChunk): Readonly<CapturePcmChunk>;
}

/** Rebases an AudioContext-global worklet frame grid onto session active time. */
export function createFramescaperCapturePcmFrameMapper(): FramescaperCapturePcmFrameMapper {
	let sharedStartFrame: number | null = null;
	let firstRawFrame: number | null = null;

	function start(value: number): void {
		if (sharedStartFrame !== null) throw new Error('Capture PCM frame mapper can start only once.');
		sharedStartFrame = nonNegativeInteger(value, 'Capture PCM shared start frame');
	}

	function map(chunk: CapturePcmChunk): Readonly<CapturePcmChunk> {
		if (sharedStartFrame === null) throw new Error('Capture PCM arrived before its shared timing origin.');
		const rawFrame = nonNegativeInteger(chunk?.frameStart, 'Capture PCM raw frame start');
		firstRawFrame ??= rawFrame;
		if (rawFrame < firstRawFrame) throw new Error('Capture PCM raw frames cannot move before their origin.');
		const relativeFrame = rawFrame - firstRawFrame;
		const frameStart = exactSum(sharedStartFrame, relativeFrame);
		return Object.freeze({ ...chunk, frameStart });
	}

	return Object.freeze({ start, map });
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function exactSum(left: number, right: number): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError('Capture PCM shared frame position exceeds the safe range.');
	return result;
}
