/* SPDX-License-Identifier: AGPL-3.0-only */

import { createDeesserProcessor } from '../deesser/dsp.ts';
import { createMultibandCompressorProcessor } from '../multiband-compressor/dsp.ts';

export class BandDynamicsProcessor extends (globalThis.AudioWorkletProcessor || class {}) {
	constructor(options = {}) {
		super();
		const settings = options.processorOptions || {};
		if (!['deesser', 'multiband-compressor'].includes(settings.type)) throw new RangeError('Unknown dynamics effect.');
		this.effectType = settings.type;
		this.sampleRate = Number(globalThis.sampleRate);
		this.analysisWindow = null;
		this.analysisSequence = 0;
		this.analysisFramesPerReport = Math.max(1, Math.round(this.sampleRate / 60));
		const create = settings.type === 'deesser' ? createDeesserProcessor : createMultibandCompressorProcessor;
		this.processor = create({ sampleRate: this.sampleRate,
			channelCount: settings.channelCount || 2, params: settings.params || {} });
		if (this.port) this.port.onmessage = ({ data }) => {
			try {
				if (data?.type === 'configure') this.processor.updateParams(data.params || {});
				else if (data?.type === 'reset') {
					this.processor.reset();
					this.analysisWindow = null;
				}
			} catch (error) {
				this.port.postMessage({ type: 'error', message: String(error?.message || error) });
			}
		};
	}
	process(inputs, outputs) {
		const output = outputs[0] || [];
		this.processor.processBlock(inputs[0] || [], output, output[0]?.length || 0);
		this.#reportAnalysis();
		return true;
	}
	#reportAnalysis() {
		const analysis = this.processor.readAnalysis?.();
		if (!analysis) return;
		const window = this.analysisWindow || { frames: 0, inputPeak: 0, outputPeak: 0, reductionDb: 0 };
		window.frames += analysis.frames;
		if (analysis.inputPeak > window.inputPeak) window.inputPeak = analysis.inputPeak;
		if (analysis.outputPeak > window.outputPeak) window.outputPeak = analysis.outputPeak;
		if (analysis.reductionDb < window.reductionDb) window.reductionDb = analysis.reductionDb;
		if (window.frames < this.analysisFramesPerReport) {
			this.analysisWindow = window;
			return;
		}
		this.analysisWindow = null;
		this.analysisSequence += 1;
		this.port?.postMessage({
			type: 'analysis', sequence: this.analysisSequence, effectType: this.effectType,
			frames: window.frames, seconds: window.frames / this.sampleRate,
			inputPeak: window.inputPeak, outputPeak: window.outputPeak, reductionDb: window.reductionDb,
		});
	}
}

if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('kw-band-dynamics', BandDynamicsProcessor);
