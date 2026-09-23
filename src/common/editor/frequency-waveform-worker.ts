/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createFrequencyWaveformWorkerProtocol,
	type FrequencyWaveformWorkerRequest,
	type FrequencyWaveformWorkerResponse,
} from './frequency-waveform-worker-protocol.ts';

interface WorkerScope {
	addEventListener(type: 'message', listener: (event: MessageEvent<FrequencyWaveformWorkerRequest>) => void): void;
	postMessage(message: FrequencyWaveformWorkerResponse, transfer: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;
const execute = createFrequencyWaveformWorkerProtocol({
	postMessage(message, transfer = []) { scope.postMessage(message, transfer); },
});
let queue = Promise.resolve();

scope.addEventListener('message', ({ data }) => {
	queue = queue.then(() => execute(data)).catch((error: unknown) => {
		scope.postMessage({
			type: 'error',
			message: error instanceof Error ? error.message : String(error),
		}, []);
	});
});
