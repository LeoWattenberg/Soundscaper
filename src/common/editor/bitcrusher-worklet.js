/*
 * Real-time host for the bitcrusher. All of the signal work lives in the
 * shared DSP core, so this file only owns the AudioWorklet lifecycle.
 */

import { createBitcrusherProcessor } from './first-party-effects/bitcrusher/dsp.js';

const PROCESSOR_NAME = 'kw-audio-bitcrusher';

export class BitcrusherProcessor extends (globalThis.AudioWorkletProcessor || class {}) {
	constructor(options = {}) {
		super();
		const settings = options.processorOptions || {};
		this.processor = createBitcrusherProcessor({
			sampleRate: globalThis.sampleRate,
			channelCount: Math.min(32, Math.max(1, Number(settings.channelCount) || 2)),
			params: settings.params || {},
			seed: settings.seed,
		});
		if (this.port) {
			this.port.onmessage = (event) => {
				const message = event?.data;
				if (message?.type === 'configure') this.processor.updateParams(message.params || {});
				else if (message?.type === 'reset') this.processor.reset();
			};
		}
	}

	process(inputs, outputs) {
		const input = inputs[0] || [];
		const output = outputs[0] || [];
		const frames = output[0]?.length || 0;
		if (frames > 0) this.processor.processBlock(input, output, frames);
		return true;
	}
}

if (typeof globalThis.registerProcessor === 'function') {
	globalThis.registerProcessor(PROCESSOR_NAME, BitcrusherProcessor);
}

export { PROCESSOR_NAME as BITCRUSHER_WORKLET_NAME };
