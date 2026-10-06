/* SPDX-License-Identifier: AGPL-3.0-only */

import { executeTimelineSpectrogramWorkerRequest } from './timeline-spectrogram-worker-runtime.ts';
interface SpectrogramWorkerScope { addEventListener(type: 'message', callback: (event: MessageEvent<unknown>) => void): void; postMessage(message: unknown): void; }
const scope = globalThis as unknown as SpectrogramWorkerScope;
scope.addEventListener('message', (event: MessageEvent<unknown>) => {
	void executeTimelineSpectrogramWorkerRequest(event.data).then(response => scope.postMessage(response));
});
