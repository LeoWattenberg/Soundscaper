/* SPDX-License-Identifier: AGPL-3.0-only */

import { isStandardEffect } from './definition.ts';
import { createStandardEffectProcessor } from './dsp.ts';
import { instantiateStaffPadWasm } from '../../staffpad/wasm-instance.ts';

export class StandardEffectProcessor extends (globalThis.AudioWorkletProcessor || class {}) {
	constructor(options = {}) {
		super();
		this.disposed = false;
		const settings = options.processorOptions || {};
		if (!isStandardEffect(settings.type)) throw new RangeError('Unknown standard effect.');
		this.processor = createStandardEffectProcessor({ type: settings.type,
			sampleRate: globalThis.sampleRate, channelCount: settings.channelCount || 2,
			params: settings.params || {},
			staffPadRuntime: settings.staffPadWasmModule ? instantiateStaffPadWasm(settings.staffPadWasmModule) : undefined });
		if (this.port) this.port.onmessage = ({ data }) => {
			if (this.disposed) return;
			try {
				if (data?.type === 'configure') this.processor.updateParams(data.params || {});
				else if (data?.type === 'reset') this.processor.reset();
				else if (data?.type === 'dispose') {
					this.disposed = true;
					this.processor.dispose?.();
				}
			} catch (error) {
				this.port.postMessage({ type: 'error', message: String(error?.message || error) });
			}
		};
	}
	process(inputs, outputs) {
		const output = outputs[0] || [];
		if (this.disposed) {
			for (const channel of output) channel.fill(0);
			return false;
		}
		if (output.length) this.processor.processBlock(inputs[0] || [], output, output[0].length);
		return true;
	}
}

if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('kw-standard-effect', StandardEffectProcessor);
