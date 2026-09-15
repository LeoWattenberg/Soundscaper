/* SPDX-License-Identifier: AGPL-3.0-only */

import { isStandardEffect } from './definition.ts';
import { createStandardEffectProcessor } from './dsp.ts';

export class StandardEffectProcessor extends (globalThis.AudioWorkletProcessor || class {}) {
	constructor(options = {}) {
		super();
		const settings = options.processorOptions || {};
		if (!isStandardEffect(settings.type)) throw new RangeError('Unknown standard effect.');
		this.processor = createStandardEffectProcessor({ type: settings.type,
			sampleRate: globalThis.sampleRate, channelCount: settings.channelCount || 2,
			params: settings.params || {} });
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
		if (output.length) this.processor.processBlock(inputs[0] || [], output, output[0].length);
		return true;
	}
}

if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('kw-standard-effect', StandardEffectProcessor);
