import { createWaveformPeakBuilder } from './waveform-peak-builder.ts';

let builder = null;

self.onmessage = ({ data = {} }) => {
	try {
		if (data.type === 'start') {
			builder = createWaveformPeakBuilder({ frameCount: data.frameCount, channelCount: data.channelCount });
			self.postMessage({ type: 'ready' });
		} else if (data.type === 'chunk') {
			if (!builder) throw new Error('Peak analysis has not started.');
			builder.append((data.channels || []).map((channel) => new Float32Array(channel)));
			self.postMessage({ type: 'ack' });
		} else if (data.type === 'finish') {
			if (!builder) throw new Error('Peak analysis has not started.');
			const { levels } = builder.finish();
			const transfers = levels.flatMap((level) => level.channels.flatMap(
				(channel) => [channel.minimums.buffer, channel.maximums.buffer, channel.rms.buffer],
			));
			self.postMessage({ type: 'result', levels }, transfers);
			builder = null;
		}
	} catch (error) {
		self.postMessage({ type: 'error', message: error?.message || String(error) });
	}
};
