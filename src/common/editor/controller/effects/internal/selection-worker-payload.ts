/* SPDX-License-Identifier: AGPL-3.0-only */

import { cloneAudacityWorkerPayload } from './nyquist/nyquist-audio.ts';
import type { SelectionEffectWorkerRequest } from './selection-effect-worker-service.ts';

/** Only fresh, consumed render channels may cross this transfer-ownership boundary. */
export function prepareSelectionWorkerPayload(request: SelectionEffectWorkerRequest, transfer: ArrayBuffer[], ownership: 'borrow' | 'transfer') {
	if (ownership === 'borrow') return cloneAudacityWorkerPayload(request, transfer);
	const buffers = new Set<ArrayBuffer>();
	for (const channel of request.channels) {
		if (!(channel instanceof Float32Array) || !(channel.buffer instanceof ArrayBuffer)
			|| channel.byteOffset !== 0 || channel.byteLength !== channel.buffer.byteLength) {
			throw new TypeError('Transfer ownership requires exact-span PCM channels.');
		}
		if (buffers.has(channel.buffer)) throw new TypeError('Transfer ownership requires independent PCM channels.');
		buffers.add(channel.buffer);
	}
	const message = cloneAudacityWorkerPayload({ ...request, channels: [] }, transfer);
	transfer.push(...buffers);
	return { ...message, channels: request.channels };
}
