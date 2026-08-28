// @ts-check

import { createStreamingAudioAnalyzer } from './analysis.js';

/** @typedef {Parameters<typeof createStreamingAudioAnalyzer>[0]} AudioAnalyzerOptions */
/** @typedef {ArrayBuffer | ArrayLike<number>} SerializedAudioChannel */
/**
 * @typedef {Readonly<{
 *   type?: string,
 *   options?: AudioAnalyzerOptions,
 *   channels?: readonly SerializedAudioChannel[],
 * }>} AnalysisWorkerRequest
 */

/** @type {ReturnType<typeof createStreamingAudioAnalyzer> | null} */
let analyzer = null;

self.onmessage = (event) => {
	const data = /** @type {AnalysisWorkerRequest} */ (event.data || {});
	try {
		if (data.type === 'start') {
			analyzer = createStreamingAudioAnalyzer(data.options);
			self.postMessage({ type: 'ready' });
		} else if (data.type === 'chunk') {
			analyzer?.push((data.channels || []).map((channel) => new Float32Array(channel)));
			self.postMessage({ type: 'ack' });
		} else if (data.type === 'finish') {
			self.postMessage({ type: 'result', result: analyzer?.finish() });
			analyzer = null;
		}
	} catch (error) {
		self.postMessage({
			type: 'error',
			message: error instanceof Error ? error.message : String(error),
		});
	}
};
