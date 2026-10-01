/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAbortError } from './async-utils.ts';

/** The audio thread must initialize the node before its sources get a start time. */
export async function waitForRealtimeCaptureReady(
	capture: Pick<AudioWorkletNode, 'port' | 'onprocessorerror'>,
	signal?: AbortSignal | null,
): Promise<void> {
	if (signal?.aborted) throw createAbortError();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	let abort: (() => void) | undefined;
	try {
		await new Promise<void>((resolve, reject) => {
			abort = () => reject(createAbortError());
			signal?.addEventListener('abort', abort, { once: true });
			capture.port.onmessage = ({ data }: MessageEvent<unknown>) => {
				if (data && typeof data === 'object' && 'type' in data && data.type === 'capture-ready') resolve();
			};
			capture.onprocessorerror = () => reject(new Error('The realtime render worklet failed.'));
			capture.port.start();
			timeout = setTimeout(() => reject(new Error('The realtime capture worklet did not initialize.')), 10_000);
		});
	} finally {
		clearTimeout(timeout);
		if (abort) signal?.removeEventListener('abort', abort);
		capture.port.onmessage = null;
		capture.onprocessorerror = null;
	}
}
