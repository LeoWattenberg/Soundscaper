/* SPDX-License-Identifier: AGPL-3.0-only */

import { createDeesserProcessor } from '../deesser/dsp.ts';
import { createMultibandCompressorProcessor } from '../multiband-compressor/dsp.ts';

export class BandDynamicsProcessor extends (globalThis.AudioWorkletProcessor || class {}) {
	constructor(options = {}) {
		super();
		const settings = options.processorOptions || {};
		if (!['deesser', 'multiband-compressor'].includes(settings.type)) throw new RangeError('Unknown dynamics effect.');
		const create = settings.type === 'deesser' ? createDeesserProcessor : createMultibandCompressorProcessor;
		this.processor = create({ sampleRate: globalThis.sampleRate,
			channelCount: settings.channelCount || 2, params: settings.params || {} });
		if (this.port) this.port.onmessage = ({ data }) => {
			try {
				if (data?.type === 'configure') this.processor.updateParams(data.params || {});
				else if (data?.type === 'reset') this.processor.reset();
			} catch (error) {
				this.port.postMessage({ type: 'error', message: String(error?.message || error) });
			}
		};
	}
	process(inputs, outputs) {
		const output = outputs[0] || [];
		this.processor.processBlock(inputs[0] || [], output, output[0]?.length || 0);
		return true;
	}
}

if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('kw-band-dynamics', BandDynamicsProcessor);
