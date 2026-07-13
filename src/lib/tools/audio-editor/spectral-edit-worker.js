/* Repository-owned browser spectral edit worker. SPDX-License-Identifier: AGPL-3.0-only */

import { applySpectralGain } from './spectral-edit.js';

globalThis.onmessage = ({ data = {} }) => {
	try {
		const channels = (data.channels || []).map((channel) => (
			channel instanceof Float32Array ? channel : new Float32Array(channel)
		));
		const output = applySpectralGain(channels, data.options || {});
		globalThis.postMessage({ type: 'result', channels: output }, output.map((channel) => channel.buffer));
	} catch (error) {
		globalThis.postMessage({
			type: 'error',
			name: error instanceof Error ? error.name : 'Error',
			message: error instanceof Error ? error.message : String(error),
		});
	}
};
