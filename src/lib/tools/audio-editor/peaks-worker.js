const DEFAULT_LEVELS = [64, 256, 1_024, 4_096, 16_384, 65_536];
let levels = [];
let channelCount = 0;

self.onmessage = ({ data = {} }) => {
	try {
		if (data.type === 'start') {
			channelCount = data.channelCount;
			levels = (data.blockSizes || DEFAULT_LEVELS).map((blockSize) => ({
				blockSize,
				count: 0,
				minimum: 1,
				maximum: -1,
				squareSum: 0,
				minimums: [],
				maximums: [],
				rms: [],
			}));
			self.postMessage({ type: 'ready' });
		} else if (data.type === 'chunk') {
			const channels = (data.channels || []).map((channel) => new Float32Array(channel));
			if (channels.length !== channelCount) throw new Error('Peak channel count changed.');
			for (let frame = 0; frame < (channels[0]?.length || 0); frame += 1) {
				let sample = 0;
				for (const channel of channels) sample += channel[frame] / channelCount;
				for (const level of levels) pushSample(level, sample);
			}
			self.postMessage({ type: 'ack' });
		} else if (data.type === 'finish') {
			for (const level of levels) flushLevel(level);
			const result = levels.map((level) => ({
				blockSize: level.blockSize,
				minimums: Float32Array.from(level.minimums),
				maximums: Float32Array.from(level.maximums),
				rms: Float32Array.from(level.rms),
			}));
			const transfers = result.flatMap((level) => [level.minimums.buffer, level.maximums.buffer, level.rms.buffer]);
			self.postMessage({ type: 'result', levels: result }, transfers);
			levels = [];
		}
	} catch (error) {
		self.postMessage({ type: 'error', message: error?.message || String(error) });
	}
};

function pushSample(level, sample) {
	level.minimum = Math.min(level.minimum, sample);
	level.maximum = Math.max(level.maximum, sample);
	level.squareSum += sample * sample;
	level.count += 1;
	if (level.count >= level.blockSize) flushLevel(level);
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
