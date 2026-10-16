/* SPDX-License-Identifier: AGPL-3.0-only */

import { loadRecordingWorklet } from './recording.js';

/** Observe the native input before selecting the recording node's explicit width. */
export async function probeCaptureAudioInputChannelCount(contextValue: unknown, streamValue: unknown): Promise<number> {
	if (typeof globalThis.AudioContext !== 'function' || !(contextValue instanceof globalThis.AudioContext)
		|| typeof globalThis.MediaStream !== 'function' || !(streamValue instanceof globalThis.MediaStream)) {
		throw new TypeError('Capture channel inspection requires an AudioContext and MediaStream.');
	}
	const context = contextValue;
	if (context.state === 'suspended') await context.resume();
	await loadRecordingWorklet(context, new URL('./recording-worklet.js', import.meta.url));
	const source = context.createMediaStreamSource(streamValue);
	let node: AudioWorkletNode | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		node = new AudioWorkletNode(context, 'kw-audio-recorder', {
			numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
			channelCountMode: 'max', channelInterpretation: 'discrete',
			processorOptions: { monitor: false },
		});
		const probe = node;
		return await new Promise<number>((resolve, reject) => {
			probe.port.onmessage = (event: MessageEvent<unknown>) => {
				const data = event.data;
				if (!data || typeof data !== 'object' || !('type' in data) || data.type !== 'input-channel-count') return;
				const width = 'channelCount' in data ? data.channelCount : undefined;
				if (typeof width !== 'number' || !Number.isSafeInteger(width) || width < 1 || width > 32) {
					reject(new RangeError('Capture audio observed channel count must be an integer between 1 and 32.'));
				} else resolve(width);
			};
			probe.onprocessorerror = () => { reject(new Error('Capture input channel inspection failed.')); };
			timer = setTimeout(() => { reject(new Error('Capture input channel inspection timed out.')); }, 5_000);
			probe.port.postMessage({ type: 'inspect-input-channel-count' });
			source.connect(probe);
			probe.connect(context.destination);
		});
	} finally {
		if (timer !== undefined) clearTimeout(timer);
		source.disconnect();
		if (node) {
			node.port.onmessage = null;
			node.onprocessorerror = null;
			node.disconnect();
			node.port.close();
		}
	}
}
