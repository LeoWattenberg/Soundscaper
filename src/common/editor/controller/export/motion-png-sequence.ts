/* SPDX-License-Identifier: AGPL-3.0-only */

import { createMotionOutputDestination, type MotionOutputDestinationOptions } from '../../motion-output-destination.ts';
import { motionTarFileHeader, motionTarPadding } from '../../motion-tar.ts';
import type { MotionSurface } from '../../motion-surface.ts';
import { throwIfScapeAborted } from '../../scape-abort.ts';
import { compareRationals, divideRationals } from '../../timeline-time.ts';
import { normalizeMotionRenderPlan, type MotionRenderFrame, type MotionRenderPlan, type MotionRenderSink } from './motion-render-pipeline.ts';

export interface MotionPngSequenceOptions extends Omit<MotionOutputDestinationOptions, 'mimeType'> {
	readonly plan: MotionRenderPlan;
	readonly encode: (surface: MotionSurface, signal?: AbortSignal) => Promise<Uint8Array>;
}

/** Ordinary PNG files plus an exact-time sidecar in a forward-only, portable TAR archive. */
export function createMotionPngSequenceSink(options: MotionPngSequenceOptions): MotionRenderSink<Blob | null> {
	const plan = normalizeMotionRenderPlan(options.plan);
	const destination = createMotionOutputDestination({ ...options, mimeType: 'application/x-tar' });
	let written = 0;
	let state: 'open' | 'finished' | 'aborted' = 'open';
	let writing = false;
	const assertOpen = (): void => { if (state !== 'open') throw new Error('Motion PNG sequence is closed.'); };
	const addFile = async (name: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> => {
		throwIfScapeAborted(signal);
		await destination.write(motionTarFileHeader(name, bytes.byteLength));
		await destination.write(bytes);
		await destination.write(motionTarPadding(bytes.byteLength));
		throwIfScapeAborted(signal);
	};
	return {
		audioPolicy: 'exclude',
		async write(frame: MotionRenderFrame, signal?: AbortSignal) {
			assertOpen(); throwIfScapeAborted(signal);
			if (writing || frame.index !== written || written >= plan.frameCount) throw new Error('Motion PNG frames must arrive in declared sequential order.');
			if (frame.surface.width !== plan.width || frame.surface.height !== plan.height
				|| compareRationals(frame.time, divideRationals({ num: plan.firstFrame + written, den: 1 }, plan.frameRate)) !== 0
				|| compareRationals(frame.duration, divideRationals({ num: 1, den: 1 }, plan.frameRate)) !== 0) throw new Error('Motion PNG frame dimensions or timing changed.');
			writing = true;
			try {
				const png = await options.encode(frame.surface, signal);
				assertPng(png, plan);
				await addFile(`frames/frame${String(written + 1).padStart(12, '0')}.png`, png, signal);
				written += 1;
			} finally { writing = false; }
		},
		async finish(signal?: AbortSignal) {
			assertOpen(); throwIfScapeAborted(signal);
			if (writing || written !== plan.frameCount) throw new Error('Motion PNG sequence must be complete before publication.');
			const metadata = new TextEncoder().encode(JSON.stringify({ format: 'motionscaper-png-sequence', version: 1, ...plan,
				colorSpace: 'srgb', alphaMode: 'straight', pattern: 'frames/frame%012d.png' }));
			await addFile('sequence.json', metadata, signal);
			await destination.write(new Uint8Array(1024));
			throwIfScapeAborted(signal);
			const result = await destination.finish(); state = 'finished'; return result;
		},
		async abort(reason) { if (state !== 'open') return; state = 'aborted'; await destination.abort(reason); },
	};
}

function assertPng(bytes: Uint8Array, plan: MotionRenderPlan): void {
	const signature = [137, 80, 78, 71, 13, 10, 26, 10];
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 33 || bytes.byteLength > plan.width * plan.height * 6 + 65536
		|| signature.some((byte, index) => bytes[index] !== byte)) throw new Error('Motion PNG encoder returned invalid or excessive image bytes.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452 || view.getUint32(16) !== plan.width || view.getUint32(20) !== plan.height) throw new Error('Motion PNG encoded dimensions differ from the render plan.');
}
