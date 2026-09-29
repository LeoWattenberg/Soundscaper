/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	claimParallelStackBank, createParallelStackViews, faultParallelStackViews, publishParallelStackBank, stopParallelStackViews,
	ParallelStackBankState, ParallelStackStatus, ParallelStackFault,
	type SharedParallelStackBuffers, type ParallelStackViews,
} from './parallel-stack-protocol.ts';

export interface ParallelStackCollectorOptions {
	readonly shared: SharedParallelStackBuffers;
	readonly inputPlaneIndices: readonly (readonly number[])[];
	readonly outputPlaneIndices: readonly (readonly number[])[];
	readonly startFrame?: number;
}

/** The audio-thread half: bounded copies and publications only, never waiting. */
export class ParallelStackCollector {
	private readonly views: ParallelStackViews;
	private readonly inputPlanes: readonly (readonly number[])[];
	private readonly outputPlanes: readonly (readonly number[])[];
	private readonly lastOutput: readonly Float32Array[];
	private startFrame: number | null = null;
	private endFrame: number | null = null;
	private expectedFrame = 0;
	private ended = false;
	private faultReported = false;
	private readonly onFault: (code: number) => void;

	constructor(options: ParallelStackCollectorOptions, onFault: (code: number) => void = () => {}) {
		this.views = createParallelStackViews(options.shared);
		this.inputPlanes = options.inputPlaneIndices;
		this.outputPlanes = options.outputPlaneIndices;
		this.onFault = onFault;
		validatePlanePorts(this.inputPlanes, this.views.geometry.planeCount, true);
		validatePlanePorts(this.outputPlanes, this.views.geometry.planeCount, false);
		if (this.outputPlanes.length === 0) throw new RangeError('Parallel stacks require an output port.');
		this.lastOutput = this.outputPlanes.map((planes) => new Float32Array(planes.length));
		if (options.startFrame !== undefined) this.arm(options.startFrame);
	}

	get fault(): number { return this.views.fault(); }

	arm(startFrame: number): void {
		if (this.startFrame !== null || !Number.isSafeInteger(startFrame) || startFrame < 0
			|| startFrame % this.views.geometry.quantumFrames !== 0) throw new RangeError('Invalid parallel stack frame origin.');
		this.startFrame = startFrame;
		this.expectedFrame = startFrame;
	}

	setEndFrame(endFrame: number): void {
		if (this.startFrame === null || this.endFrame !== null || !Number.isSafeInteger(endFrame)
			|| endFrame < this.startFrame || endFrame < this.expectedFrame) throw new RangeError('Invalid parallel stack output endpoint.');
		this.endFrame = endFrame;
	}

	process(inputs: readonly (readonly Float32Array[])[], outputs: readonly (readonly Float32Array[])[], currentFrame: number): boolean {
		for (let port = 0; port < outputs.length; port += 1) {
			for (let channel = 0; channel < outputs[port].length; channel += 1) outputs[port][channel].fill(0);
		}
		if (this.ended) return false;
		const status = this.views.status();
		if (status === ParallelStackStatus.Stopped) { this.ended = true; return false; }
		if (status === ParallelStackStatus.Faulted) return this.fail(outputs, this.fault);
		const { quantumFrames, blockFrames, latencyFrames, bankCount } = this.views.geometry;
		if (!this.validQuantum(inputs, outputs)) return this.fail(outputs, ParallelStackFault.Quantum);
		if (this.startFrame === null || currentFrame < this.startFrame) return true;
		if (this.endFrame !== null && currentFrame >= this.endFrame) return this.finish();
		if (status !== ParallelStackStatus.Running) return this.fail(outputs, ParallelStackFault.Worker);
		if (currentFrame !== this.expectedFrame || !Number.isSafeInteger(currentFrame + quantumFrames)) {
			return this.fail(outputs, ParallelStackFault.Clock);
		}
		const relativeFrame = currentFrame - this.startFrame;
		const inputSequence = Math.floor(relativeFrame / blockFrames);
		const blockOffset = relativeFrame % blockFrames;
		const inputBank = blockOffset === 0
			? claimParallelStackBank(this.views, inputSequence)
			: this.views.banks[inputSequence % bankCount];
		if (!inputBank || inputBank.state() !== ParallelStackBankState.Capturing || inputBank.sequence() !== inputSequence) {
			return this.fail(outputs, ParallelStackFault.Capacity);
		}
		// Verify the complete output before publishing more input in this callback.
		const outputSequence = Math.floor((relativeFrame - latencyFrames) / blockFrames);
		const outputBank = outputSequence >= 0 ? this.views.banks[outputSequence % bankCount] : null;
		if (outputBank) {
			const requiredState = blockOffset === 0 ? ParallelStackBankState.Complete : ParallelStackBankState.Reading;
			if (outputBank.state() !== requiredState || outputBank.sequence() !== outputSequence) {
				return this.fail(outputs, ParallelStackFault.Deadline);
			}
			Atomics.store(this.views.control, outputBank.offset, ParallelStackBankState.Reading);
			for (let port = 0; port < this.outputPlanes.length; port += 1) {
				for (let channel = 0; channel < this.outputPlanes[port].length; channel += 1) {
					const source = outputBank.planes[this.outputPlanes[port][channel]];
					const target = outputs[port][channel];
					for (let frame = 0; frame < quantumFrames; frame += 1) target[frame] = source[blockOffset + frame];
					this.lastOutput[port][channel] = target[quantumFrames - 1];
				}
			}
			if (blockOffset + quantumFrames === blockFrames) Atomics.store(this.views.control, outputBank.offset, ParallelStackBankState.Free);
		}
		if (this.endFrame !== null && currentFrame + quantumFrames >= this.endFrame) {
			const validFrames = this.endFrame - currentFrame;
			for (let port = 0; port < outputs.length; port += 1) {
				for (let channel = 0; channel < outputs[port].length; channel += 1) outputs[port][channel].fill(0, validFrames);
			}
			return this.finish();
		}
		for (let port = 0; port < this.inputPlanes.length; port += 1) {
			for (let channel = 0; channel < this.inputPlanes[port].length; channel += 1) {
				const target = inputBank.planes[this.inputPlanes[port][channel]];
				const source = inputs[port]?.[channel];
				for (let frame = 0; frame < quantumFrames; frame += 1) target[blockOffset + frame] = source ? source[frame] : 0;
			}
		}
		if (blockOffset + quantumFrames === blockFrames) publishParallelStackBank(this.views, inputBank);
		this.expectedFrame += quantumFrames;
		return true;
	}

	private finish(): false {
		this.ended = true;
		stopParallelStackViews(this.views);
		return false;
	}

	private validQuantum(inputs: readonly (readonly Float32Array[])[], outputs: readonly (readonly Float32Array[])[]): boolean {
		const quantum = this.views.geometry.quantumFrames;
		if (outputs.length !== this.outputPlanes.length) return false;
		for (let port = 0; port < outputs.length; port += 1) {
			if (outputs[port].length !== this.outputPlanes[port].length) return false;
			for (let channel = 0; channel < outputs[port].length; channel += 1) if (outputs[port][channel].length !== quantum) return false;
		}
		for (let port = 0; port < inputs.length; port += 1) {
			for (let channel = 0; channel < inputs[port].length; channel += 1) if (inputs[port][channel].length !== quantum) return false;
		}
		return true;
	}

	private fail(outputs: readonly (readonly Float32Array[])[], code: number): false {
		faultParallelStackViews(this.views, code);
		for (let port = 0; port < outputs.length; port += 1) {
			for (let channel = 0; channel < outputs[port].length; channel += 1) {
				const target = outputs[port][channel];
				const last = this.lastOutput[port]?.[channel] ?? 0;
				for (let frame = 0; frame < target.length; frame += 1) target[frame] = last * (1 - (frame + 1) / target.length);
			}
		}
		this.ended = true;
		if (!this.faultReported) { this.faultReported = true; this.onFault(this.fault); }
		return false;
	}
}

function validatePlanePorts(ports: readonly (readonly number[])[], planeCount: number, unique: boolean): void {
	if (ports.length > 256) throw new RangeError('Too many parallel stack ports.');
	const seen = new Set<number>();
	for (const port of ports) {
		if (port.length < 1 || port.length > 32) throw new RangeError('Invalid parallel stack channel count.');
		for (const plane of port) {
			if (!Number.isInteger(plane) || plane < 0 || plane >= planeCount || (unique && seen.has(plane))) {
				throw new RangeError('Invalid parallel stack PCM plane.');
			}
			seen.add(plane);
		}
	}
}
