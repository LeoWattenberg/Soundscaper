/* SPDX-License-Identifier: AGPL-3.0-only */

import { ParallelStackCollector, type ParallelStackCollectorOptions } from './parallel-stack-collector.ts';
import { PARALLEL_STACK_PROCESSOR_NAME } from './parallel-stack-protocol.ts';

declare const currentFrame: number;
declare class AudioWorkletProcessor {
	readonly port: MessagePort;
	constructor(options?: AudioWorkletNodeOptions);
}
declare function registerProcessor(name: string, processor: typeof ParallelStackProcessor): void;

class ParallelStackProcessor extends AudioWorkletProcessor {
	private readonly collector: ParallelStackCollector;
	private readonly faultMessage = { type: 'fault', code: 0 };

	constructor(options: AudioWorkletNodeOptions) {
		super(options);
		const configuration = options.processorOptions as ParallelStackCollectorOptions;
		const generation = configuration.shared.geometry.generation;
		const quantumFrames = configuration.shared.geometry.quantumFrames;
		this.collector = new ParallelStackCollector(configuration, (code) => {
			this.faultMessage.code = code;
			this.port.postMessage(this.faultMessage);
		});
		this.port.onmessage = (event: MessageEvent<Readonly<{ type?: string; startFrame?: number; endFrame?: number }>>) => {
			if ((event.data.type === 'start' || event.data.type === 'arm') && typeof event.data.startFrame === 'number') {
				// The renderer can be delayed after choosing an origin. Use the audio clock
				// and acknowledge the actual frame so sources start no earlier than capture.
				const startFrame = Math.max(event.data.startFrame,
					Math.ceil((currentFrame + quantumFrames * 2) / quantumFrames) * quantumFrames);
				this.collector.arm(startFrame);
				this.port.postMessage({ type: event.data.type === 'start' ? 'started' : 'armed', startFrame, generation });
			}
			if (event.data.type === 'end' && typeof event.data.endFrame === 'number') this.collector.setEndFrame(event.data.endFrame);
		};
		this.port.postMessage({ type: 'ready', generation });
	}

	process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		return this.collector.process(inputs, outputs, currentFrame);
	}
}

registerProcessor(PARALLEL_STACK_PROCESSOR_NAME, ParallelStackProcessor);
