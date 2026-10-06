/* SPDX-License-Identifier: AGPL-3.0-only */

import { createSignalGeneratorStreamRuntime } from './signal-generator-stream-runtime.ts';

const handle = createSignalGeneratorStreamRuntime();
const scope = globalThis as unknown as {
	onmessage: ((event: Readonly<{ data: unknown }>) => void) | null;
	postMessage(message: unknown, transfer: readonly Transferable[]): void;
};
scope.onmessage = (event): void => {
	const response = handle(event.data);
	const buffers: Transferable[] = [];
	if (response.type === 'result') {
		if ('channels' in response.result) {
			for (const channel of response.result.channels ?? []) buffers.push(channel.buffer);
		} else if ('levels' in response.result) {
			for (const level of response.result.levels) for (const channel of level.channels) {
				buffers.push(channel.minimums.buffer, channel.maximums.buffer, channel.rms.buffer);
			}
		}
	}
	scope.postMessage(response, buffers);
};
