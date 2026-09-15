/* SPDX-License-Identifier: AGPL-3.0-only */

import { STAFFPAD_MAXIMUM_MEMORY_BYTES } from '../../staffpad/parameters.js';

// Leave the pinned runtime's entire initial 16 MiB available for static data,
// stack, allocator bookkeeping and temporary construction/FFT buffers.
const RUNTIME_HEAP_RESERVE_BYTES = 16 * 1024 ** 2;
const reservedByRuntime = new WeakMap<object, number>();

/** Conservative bound for the pinned non-formant StaffPad sessions. The
 * native setup owns FFT-sized sample/spectrum/phase/window/index buffers,
 * PFFFT scratch/twiddles, ABI input/output and rounded circular buffers.
 * Stereo's FFT-sized arrays consume less than 100 bytes per FFT sample;
 * mono's consume less than 70 before small-FFT rounding. Round to 128/96,
 * with another 64 KiB per session for ABI buffers, alignment and small FFT
 * circular-buffer rounding.
 */
export function standardDelayPitchNativeBytes(sampleRate: number, channelCount: number, echoes: number): number {
	if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError('Invalid StaffPad delay sample rate.');
	if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 32) throw new RangeError('Invalid StaffPad delay channel count.');
	if (!Number.isInteger(echoes) || echoes < 0 || echoes > 30) throw new RangeError('Invalid StaffPad delay echo count.');
	const fft = 2 ** (12 + Math.round(Math.log2(sampleRate / 44100)));
	const stereoGroups = Math.floor(channelCount / 2);
	const monoGroups = channelCount % 2;
	const stereoBytes = 128 * fft + 64 * 1024;
	const monoBytes = 96 * fft + 64 * 1024;
	return echoes * (stereoGroups * stereoBytes + monoGroups * monoBytes);
}

/** Admit both an intended configuration and temporarily retained old sessions. */
export function assertStandardDelayPitchNativeCapacity(sampleRate: number, channelCount: number,
	echoes: number, retainedBytes = 0): number {
	if (!Number.isSafeInteger(retainedBytes) || retainedBytes < 0) throw new RangeError('Invalid retained StaffPad delay memory.');
	const bytes = standardDelayPitchNativeBytes(sampleRate, channelCount, echoes);
	if (bytes + retainedBytes > STAFFPAD_MAXIMUM_MEMORY_BYTES - RUNTIME_HEAP_RESERVE_BYTES) {
		throw new RangeError('The StaffPad delay configuration exceeds its native memory limit. Reduce echoes, channels or sample rate.');
	}
	return bytes;
}

/** Shared selections and replacement streams reserve native state before
 * allocation. Release after destroying their sessions, including failed setup.
 */
export function reserveStandardDelayPitchNativeCapacity(runtime: object, sampleRate: number,
	channelCount: number, echoes: number): () => void {
	const retained = reservedByRuntime.get(runtime) ?? 0;
	const bytes = assertStandardDelayPitchNativeCapacity(sampleRate, channelCount, echoes, retained);
	reservedByRuntime.set(runtime, retained + bytes);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		const remaining = (reservedByRuntime.get(runtime) ?? 0) - bytes;
		if (remaining > 0) reservedByRuntime.set(runtime, remaining);
		else reservedByRuntime.delete(runtime);
	};
}
