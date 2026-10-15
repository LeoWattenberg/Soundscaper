/* SPDX-License-Identifier: AGPL-3.0-only */

import { RenderCaptureProcessor } from '../../src/common/editor/render-capture-worklet.js';

type Message = Readonly<Record<string, unknown>>;
type ClockFault = 'sink-suspension' | 'running-quantum' | 'none';

class ClockNode {
	readonly gain = { value: 1, setValueAtTime() {} };
	connect(target: unknown): unknown { return target; }
	disconnect(): void {}
}

/** Run the maintained capture processor against a backend whose suspend/resume
 * boundary can lose one quantum. This is a controlled backend model, not a claim
 * that any particular browser failure was caused by suspension. */
export class MotionNativeClockContext {
	readonly sampleRate = 48_000;
	readonly destination = new ClockNode();
	readonly audioWorklet = { addModule: async () => undefined };
	state: AudioContextState = 'suspended';
	capture: MotionNativeCaptureNode | null = null;
	frame = 0;
	suspendCalls = 0;
	closeCalls = 0;
	quantumCount = 0;
	maximumInFlightChunks = 0;
	private scheduled = false;
	private runningFaultApplied = false;
	private readonly previousFrame = Object.getOwnPropertyDescriptor(globalThis, 'currentFrame');
	onClose: () => void = () => undefined;
	onSinkSuspension: () => void = () => undefined;

	constructor(readonly fault: ClockFault) {}

	get currentTime(): number { return this.frame / this.sampleRate; }
	createGain(): ClockNode { return new ClockNode(); }

	async suspend(): Promise<void> {
		this.suspendCalls++;
		if (this.state === 'running' && this.frame > 0) {
			if (this.fault === 'sink-suspension') this.frame += 128;
			this.onSinkSuspension();
		}
		this.state = 'suspended';
	}

	async resume(): Promise<void> {
		this.state = 'running';
		this.scheduleQuantum();
	}

	async close(): Promise<void> {
		this.closeCalls++;
		this.state = 'closed';
		this.onClose();
	}

	restore(): void {
		if (this.previousFrame) Object.defineProperty(globalThis, 'currentFrame', this.previousFrame);
		else Reflect.deleteProperty(globalThis, 'currentFrame');
	}

	private scheduleQuantum(): void {
		if (this.scheduled) return;
		this.scheduled = true;
		setImmediate(() => {
			this.scheduled = false;
			if (this.state !== 'running' || !this.capture) return;
			const processor = this.capture.processor;
			if (this.fault === 'running-quantum' && !this.runningFaultApplied && processor.capturedFrames >= 4096) {
				this.frame += 128;
				this.runningFaultApplied = true;
			}
			Object.defineProperty(globalThis, 'currentFrame', { configurable: true, writable: true, value: this.frame });
			const start = processor.startFrame ?? this.frame;
			const input = Array.from({ length: 2 }, (_, channel) => Float32Array.from(
				{ length: 128 }, (_, offset) => motionNativeClockSample(this.frame + offset - start, channel),
			));
			const active = processor.process([input], [[new Float32Array(128), new Float32Array(128)]]);
			this.maximumInFlightChunks = Math.max(this.maximumInFlightChunks, processor.inFlightChunks);
			this.quantumCount++;
			this.frame += 128;
			if (active) this.scheduleQuantum();
		});
	}
}

export class MotionNativeCaptureNode extends ClockNode {
	readonly processor: RenderCaptureProcessor;
	readonly port = {
		onmessage: null as ((event: { data: Message }) => void) | null,
		start() {},
		postMessage: (data: Message): void => { this.processor.port.onmessage?.({ data }); },
	};
	onprocessorerror: (() => void) | null = null;

	constructor(context: MotionNativeClockContext, _name: string, options: object) {
		super();
		this.processor = new RenderCaptureProcessor(options);
		this.processor.port.postMessage = (data: Message) => {
			queueMicrotask(() => this.port.onmessage?.({ data }));
		};
		context.capture = this;
		queueMicrotask(() => this.port.onmessage?.({ data: { type: 'capture-ready' } }));
	}
}

export function motionNativeClockSample(frame: number, channel: number): number {
	return frame < 0 || frame % 97 === 48 ? 0 : Math.fround((frame % 97 - 48) / (channel === 0 ? 128 : -256));
}
