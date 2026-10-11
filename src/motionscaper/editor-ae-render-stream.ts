/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeMotionRenderPlan, type MotionRenderPlan } from '../common/editor/controller/export/motion-render-pipeline.ts';
import { motionTarFileHeader } from '../common/editor/motion-tar.ts';
import { throwIfScapeAborted } from '../common/editor/scape-abort.ts';

/** Accept only the maintained PNG renderer's canonical forward-only sequence, never general TAR input.
 * At most one bounded PNG is retained; awaiting onFrame propagates ZIP backpressure to rendering.
 */
export function createMotionAeRenderStream(options: Readonly<{
	plan: MotionRenderPlan; maximumBytes: number; signal?: AbortSignal;
	onFrame: (index: number, bytes: Uint8Array) => Promise<void>;
}>): Readonly<{ writable: WritableStream<Uint8Array>; assertComplete: () => void }> {
	const plan = normalizeMotionRenderPlan(options.plan);
	if (plan.firstFrame !== 0 || plan.frameCount > 256 || !Number.isSafeInteger(options.maximumBytes) || options.maximumBytes < 1) throw new RangeError('AE render stream requires a bounded complete composition of at most 256 frames.');
	const expectedMetadata = JSON.stringify({ format: 'motionscaper-png-sequence', version: 1, ...plan, colorSpace: 'srgb', alphaMode: 'straight', pattern: 'frames/frame%012d.png' });
	const decoder = new TextDecoder('utf-8', { fatal: true });
	let state: 'header' | 'payload' | 'padding' | 'end' | 'closed' | 'failed' = 'header';
	let buffer = new Uint8Array(512), offset = 0, bytesRead = 0, frames = 0, padding = 0, endBytes = 0, sidecar = false;
	const advance = () => { state = sidecar ? 'end' : 'header'; buffer = new Uint8Array(sidecar ? 0 : 512); offset = 0; };
	const fail = () => { state = 'failed'; buffer = new Uint8Array(0); };
	const writable = new WritableStream<Uint8Array>({
		async write(chunk) {
			try {
				throwIfScapeAborted(options.signal);
				if (!(chunk instanceof Uint8Array) || chunk.length > 4 * 1024 * 1024 || chunk.length > options.maximumBytes - bytesRead) throw new RangeError('AE rendered sequence exceeded its bounded chunk or total byte allowance.');
				if (state === 'closed' || state === 'failed') throw new Error('AE rendered sequence is closed.');
				bytesRead += chunk.length; let at = 0;
				while (at < chunk.length) {
					throwIfScapeAborted(options.signal);
					if (state === 'end' || state === 'padding') {
						const count = Math.min(chunk.length - at, state === 'end' ? 1024 - endBytes : padding);
						if (count === 0 || chunk.subarray(at, at + count).some(byte => byte !== 0)) throw new Error('AE rendered sequence has extra entries or invalid zero padding.');
						at += count;
						if (state === 'end') endBytes += count; else { padding -= count; if (!padding) advance(); }
						continue;
					}
					const count = Math.min(chunk.length - at, buffer.length - offset);
					buffer.set(chunk.subarray(at, at + count), offset); offset += count; at += count;
					if (offset !== buffer.length) continue;
					if (state === 'header') {
						const name = frames < plan.frameCount ? `frames/frame${String(frames + 1).padStart(12, '0')}.png` : 'sequence.json';
						const digits = decoder.decode(buffer.subarray(124, 135));
						if (!/^[0-7]{11}$/u.test(digits)) throw new Error('AE render TAR size is not canonical.');
						const size = Number.parseInt(digits, 8), maximum = name === 'sequence.json' ? 65536 : Math.min(64 * 1024 * 1024, plan.width * plan.height * 6 + 65536);
						if (size < 1 || size > maximum || size > options.maximumBytes - bytesRead + chunk.length - at) throw new RangeError('AE render entry exceeds its allocation bound.');
						const canonical = motionTarFileHeader(name, size);
						if (buffer.some((byte, index) => byte !== canonical[index])) throw new Error('AE rendered sequence entry is missing, reordered or not canonical.');
						buffer = new Uint8Array(size); offset = 0; padding = (512 - size % 512) % 512; state = 'payload';
					} else {
						if (frames === plan.frameCount) {
							if (decoder.decode(buffer) !== expectedMetadata) throw new Error('AE sequence metadata differs from the pinned revision, clock or quality.');
							sidecar = true;
						} else {
							assertPng(buffer, plan); await options.onFrame(frames, buffer); throwIfScapeAborted(options.signal); frames++;
						}
						buffer = new Uint8Array(0); offset = 0; state = 'padding'; if (!padding) advance();
					}
				}
			} catch (error) { fail(); throw error; }
		},
		close() {
			try {
				throwIfScapeAborted(options.signal);
				if (state !== 'end' || endBytes !== 1024 || frames !== plan.frameCount || !sidecar) throw new Error('AE rendered sequence is incomplete.');
				state = 'closed';
			} catch (error) { fail(); throw error; }
		},
		abort() { fail(); },
	});
	return { writable, assertComplete() { if (state !== 'closed') throw new Error('AE rendered sequence is not complete.'); } };
}
function assertPng(bytes: Uint8Array, plan: MotionRenderPlan): void {
	if (bytes.length < 33 || [137, 80, 78, 71, 13, 10, 26, 10].some((byte, index) => byte !== bytes[index])) throw new Error('AE rendered frame is not a PNG.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452 || view.getUint32(16) !== plan.width || view.getUint32(20) !== plan.height || bytes[24] !== 8 || bytes[25] !== 6) throw new Error('AE rendered PNG does not match the pinned dimensions or 8-bit RGBA carrier.');
}
