import { createStreamingAudioAnalyzer } from './analysis.js';

let analyzer = null;

self.onmessage = ({ data = {} }) => {
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
		self.postMessage({ type: 'error', message: error?.message || String(error) });
	}
};
