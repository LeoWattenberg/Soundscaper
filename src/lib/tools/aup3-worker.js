import { decodeAup3Bytes } from './aup3-browser.js';

self.onmessage = async (event) => {
	if (event.data?.type !== 'decode') return;
	try {
		const decoded = await decodeAup3Bytes(event.data.buffer, {
			fileName: event.data.fileName,
			memoryLimits: event.data.memoryLimits,
			structured: Boolean(event.data.structured),
			onProgress(update) {
				self.postMessage({
					type: 'progress',
					progress: Number(update?.progress ?? update) || 0,
					phase: update?.phase,
				});
			},
		});
		const transfer = [];
		const result = { ...decoded };
		if (decoded.channels) {
			result.channels = decoded.channels.map((channel) => {
				transfer.push(channel.buffer);
				return channel.buffer;
			});
		}
		if (decoded.tracks) result.tracks = decoded.tracks.map((track) => ({
			...track,
			clips: track.clips?.map((clip) => ({
				...clip,
				channels: clip.channels.map((channel) => {
					transfer.push(channel.buffer);
					return channel.buffer;
				}),
			})),
		}));
		self.postMessage({
			type: 'result',
			result,
		}, transfer);
	} catch (error) {
		self.postMessage({
			type: 'error',
			code: error?.code || 'AUP3_ERROR',
			message: error?.message || String(error),
		});
	}
};
