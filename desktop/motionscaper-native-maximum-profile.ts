/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionMaximumScene } from './motionscaper-native-maximum-scenes.ts';
export type MotionMaximumNativeKind = 'index' | MotionMaximumScene;

/** These four literal inputs alone are admitted by the separate maximum-workload decoder. */
export function motionMaximumNativeProfile(kind: MotionMaximumNativeKind) {
	if (kind === 'index') return { width: 16, height: 16, frames: 32768, firstFrame: 0, selectedFrames: [0, 16384, 32767], audioSamples: 52_428_800, timeoutMs: 1800000 } as const;
	if (kind === 'quality') return { width: 64, height: 64, frames: 2, firstFrame: 1, selectedFrames: [0, 1], audioSamples: 0, timeoutMs: 600000 } as const;
	if (kind === 'planes') return { width: 1024, height: 1024, frames: 1, firstFrame: 0, selectedFrames: [0], audioSamples: 0, timeoutMs: 600000 } as const;
	if (kind === 'lights') return { width: 32, height: 32, frames: 1, firstFrame: 0, selectedFrames: [0], audioSamples: 0, timeoutMs: 600000 } as const;
	throw new RangeError('Unknown native maximum-workload profile.');
}
const record = (value: unknown): Record<string, unknown> => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Missing maximum-scene metadata.');
	return value as Record<string, unknown>;
};
export function inspectMotionMaximumSceneMetadata(value: unknown, kind: MotionMaximumScene, pictureBytes: number, pcmBytes: number) {
	const expected = motionMaximumNativeProfile(kind), v = record(value);
	if (v.width !== expected.width || v.height !== expected.height || v.frameCount !== expected.frames || v.profile !== 4
		|| !Number.isSafeInteger(v.colorDepth) || Number(v.colorDepth) < 10 || Number(v.colorDepth) > 16
		|| !Number.isSafeInteger(v.alphaDepth) || Number(v.alphaDepth) < 10 || Number(v.alphaDepth) > 16
		|| v.colorPrimaries !== 1 || v.colorTransfer !== 1 || v.colorSpace !== 1) throw new Error('Unexpected maximum-scene picture contract.');
	const first = record(v.firstTimestamp), last = record(v.lastTimestamp);
	const time = (time: Record<string, unknown>, frame: number) => Number.isSafeInteger(time.num) && Number.isSafeInteger(time.den) && Number(time.den) > 0
		&& BigInt(Number(time.num)) * 30n === BigInt(frame) * BigInt(Number(time.den));
	if (v.contiguousFrameTimes !== true || !time(first, 0) || !time(last, expected.frames - 1)) throw new Error('Incomplete maximum-scene timestamps.');
	if (!Array.isArray(v.selectedFrames) || v.selectedFrames.length !== expected.selectedFrames.length
		|| v.selectedFrames.some((frame, index) => frame !== expected.selectedFrames[index])) throw new Error('Incorrect selected maximum-scene pictures.');
	if (pictureBytes !== expected.selectedFrames.length * expected.width * expected.height * 16 || pcmBytes !== 0 || v.audio !== null) throw new Error('Unexpected maximum-scene picture/PCM bytes.');
	if (!Number.isSafeInteger(v.maximumReadBytes) || Number(v.maximumReadBytes) < 1 || Number(v.maximumReadBytes) > 65536
		|| !Number.isSafeInteger(v.maximumPacketBytes) || Number(v.maximumPacketBytes) < 1 || Number(v.maximumPacketBytes) > 1024 * 1024) throw new Error('Maximum-scene reference window/packet admission exceeded.');
	return v;
}
