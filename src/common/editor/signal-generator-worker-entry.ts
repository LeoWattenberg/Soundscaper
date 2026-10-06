/* SPDX-License-Identifier: AGPL-3.0-only */

import { executeSignalGeneratorRequest } from './signal-generator-worker-runtime.ts';

const scope = globalThis as unknown as {
	onmessage: ((event: Readonly<{ data: unknown }>) => void) | null;
	postMessage(message: unknown, transfer: readonly Transferable[]): void;
};
scope.onmessage = (event): void => {
	const response = executeSignalGeneratorRequest(event.data);
	scope.postMessage(response, response.type === 'result'
		? response.result.channels.map(channel => channel.buffer as ArrayBuffer) : []);
};
