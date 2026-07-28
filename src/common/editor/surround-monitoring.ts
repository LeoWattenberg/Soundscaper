/* SPDX-License-Identifier: AGPL-3.0-only */

interface SurroundDestination {
	readonly maxChannelCount?: number;
	channelCount?: number;
	channelCountMode?: string;
	channelInterpretation?: string;
}

export function configureNativeSurroundDestination(
	destination: SurroundDestination | null | undefined,
	channelCount: number,
): boolean {
	if (!destination || !Number.isInteger(channelCount) || channelCount < 1 || channelCount > 32) return false;
	if (!Number.isInteger(destination.maxChannelCount) || destination.maxChannelCount! < channelCount) return false;
	try {
		destination.channelCount = channelCount;
		destination.channelCountMode = 'explicit';
		destination.channelInterpretation = 'discrete';
		return destination.channelCount === channelCount;
	} catch {
		return false;
	}
}

export function downmixSurroundToStereo(
	input: readonly Float32Array[],
): readonly [Float32Array, Float32Array] {
	if (!Array.isArray(input) || input.length < 1) throw new TypeError('At least one monitoring channel is required.');
	const frameCount = input[0]?.length ?? 0;
	if (input.some((channel) => !(channel instanceof Float32Array) || channel.length !== frameCount)) {
		throw new TypeError('Monitoring channels must be aligned Float32 PCM.');
	}
	if (input.length === 1) return [input[0].slice(), input[0].slice()];
	if (input.length === 2) return [input[0].slice(), input[1].slice()];
	if (input.length !== 6) throw new RangeError('Monitoring supports mono, stereo, or the L/R/C/LFE/Ls/Rs 5.1 order.');
	const left = new Float32Array(frameCount);
	const right = new Float32Array(frameCount);
	const relatedGain = Math.SQRT1_2 * 0.5;
	for (let frame = 0; frame < frameCount; frame += 1) {
		left[frame] = input[0][frame] * 0.5 + input[2][frame] * relatedGain + input[4][frame] * relatedGain;
		right[frame] = input[1][frame] * 0.5 + input[2][frame] * relatedGain + input[5][frame] * relatedGain;
	}
	return [left, right];
}

export function connectSurroundMonitoring(
	context: BaseAudioContext,
	source: AudioNode,
	destination: AudioNode,
	channelCount: number,
	nodes: AudioNode[],
): 'native' | 'stereo-fallback' | 'direct' {
	if (!Number.isInteger(channelCount) || channelCount <= 2 || channelCount > 32) {
		source.connect(destination);
		return 'direct';
	}
	const deviceDestination = (context as BaseAudioContext & { destination?: AudioDestinationNode }).destination;
	if (configureNativeSurroundDestination(deviceDestination, channelCount)) {
		source.connect(destination);
		return 'native';
	}
	const splitter = context.createChannelSplitter(channelCount);
	const merger = context.createChannelMerger(2);
	nodes.push(splitter, merger);
	source.connect(splitter);
	if (channelCount === 6) {
		connectRoute(0, 0, 0.5);
		connectRoute(1, 1, 0.5);
		connectRoute(2, 0, Math.SQRT1_2 * 0.5);
		connectRoute(2, 1, Math.SQRT1_2 * 0.5);
		connectRoute(4, 0, Math.SQRT1_2 * 0.5);
		connectRoute(5, 1, Math.SQRT1_2 * 0.5);
	} else {
		// Arbitrary ADM channel orders have no safe generic fold-down. Keep the
		// first pair deterministic rather than relying on browser-specific mixing.
		connectRoute(0, 0, 1);
		connectRoute(1, 1, 1);
	}
	merger.connect(destination);
	return 'stereo-fallback';

	function connectRoute(inputChannel: number, outputChannel: number, gainValue: number): void {
		const gain = context.createGain();
		gain.gain.setValueAtTime(gainValue, context.currentTime);
		nodes.push(gain);
		splitter.connect(gain, inputChannel);
		gain.connect(merger, 0, outputChannel);
	}
}
