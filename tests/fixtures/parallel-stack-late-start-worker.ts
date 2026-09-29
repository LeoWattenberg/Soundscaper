/* SPDX-License-Identifier: AGPL-3.0-only */

import { once } from 'node:events';
import { MessageChannel, parentPort } from 'node:worker_threads';
import { createParallelStackBuffers, startParallelStackBuffers } from '../../src/common/editor/engine/parallel-stack-protocol.ts';

export interface LateStartResult {
	readonly requested: number;
	readonly actual: number;
	readonly before: boolean;
	readonly active: boolean;
	readonly fault: number;
}

const channel = new MessageChannel();
let processorType: (new (options: AudioWorkletNodeOptions) => { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean }) | null = null;
const globals = globalThis as typeof globalThis & {
	AudioWorkletProcessor: new (options?: AudioWorkletNodeOptions) => { port: MessagePort };
	registerProcessor: (name: string, processor: typeof processorType) => void;
	currentFrame: number;
};
globals.AudioWorkletProcessor = class {
	readonly port = channel.port1 as unknown as MessagePort;
};
globals.registerProcessor = (_name, processor) => { processorType = processor; };
globals.currentFrame = 512;
await import('../../src/common/editor/engine/parallel-stack-worklet.ts');
if (!processorType) throw new Error('Parallel stack worklet did not register.');
const shared = createParallelStackBuffers({ generation: 1, planeCount: 2, taskCount: 1, workerCount: 1 });
const Processor = processorType as unknown as new (options: AudioWorkletNodeOptions) => {
	process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};
const processor = new Processor({ processorOptions: { shared, inputPlaneIndices: [[0]], outputPlaneIndices: [[1]] } });
await once(channel.port2, 'message');
startParallelStackBuffers(shared);
channel.port2.postMessage({ type: 'start', startFrame: 0 });
const [started] = await once(channel.port2, 'message') as [{ startFrame: number }];
const outputs = [[new Float32Array(128)]];
globals.currentFrame = started.startFrame - 128;
const before = processor.process([], outputs);
globals.currentFrame = started.startFrame;
const active = processor.process([], outputs);
parentPort?.postMessage({ requested: 0, actual: started.startFrame, before, active, fault: new Int32Array(shared.control)[1] });
channel.port1.close();
channel.port2.close();
