const DEFAULT_LEVELS = [64, 256, 1_024, 4_096, 16_384, 65_536];
let levels = [];
let channelCount = 0;

self.onmessage = ({ data = {} }) => {
	try {
		if (data.type === 'start') {
			channelCount = data.channelCount;
			levels = (data.blockSizes || DEFAULT_LEVELS).map((blockSize) => ({
				blockSize,
				channels: Array.from({ length: channelCount }, () => createChannelLevel()),
			}));
			self.postMessage({ type: 'ready' });
		} else if (data.type === 'chunk') {
			const channels = (data.channels || []).map((channel) => new Float32Array(channel));
			if (channels.length !== channelCount) throw new Error('Peak channel count changed.');
			for (let frame = 0; frame < (channels[0]?.length || 0); frame += 1) {
				for (let channel = 0; channel < channelCount; channel += 1) {
					for (const level of levels) pushSample(level.channels[channel], channels[channel][frame], level.blockSize);
				}
			}
			self.postMessage({ type: 'ack' });
		} else if (data.type === 'finish') {
			for (const level of levels) {
				for (const channel of level.channels) flushLevel(channel);
			}
			const result = levels.map((level) => ({
				blockSize: level.blockSize,
				channels: level.channels.map((channel) => ({
					minimums: Float32Array.from(channel.minimums),
					maximums: Float32Array.from(channel.maximums),
					rms: Float32Array.from(channel.rms),
				})),
			}));
			const transfers = result.flatMap((level) => level.channels.flatMap(
				(channel) => [channel.minimums.buffer, channel.maximums.buffer, channel.rms.buffer],
			));
			self.postMessage({ type: 'result', levels: result }, transfers);
			levels = [];
		}
	} catch (error) {
		self.postMessage({ type: 'error', message: error?.message || String(error) });
	}
};

function createChannelLevel() {
	return {
		count: 0,
		minimum: 1,
		maximum: -1,
		squareSum: 0,
		minimums: [],
		maximums: [],
		rms: [],
	};
}

function pushSample(level, sample, blockSize) {
	level.minimum = Math.min(level.minimum, sample);
	level.maximum = Math.max(level.maximum, sample);
	level.squareSum += sample * sample;
	level.count += 1;
	if (level.count >= blockSize) flushLevel(level);
}

function flushLevel(level) {
	if (!level.count) return;
	level.minimums.push(level.minimum);
	level.maximums.push(level.maximum);
	level.rms.push(Math.sqrt(level.squareSum / level.count));
	level.count = 0;
	level.minimum = 1;
	level.maximum = -1;
	level.squareSum = 0;
}
