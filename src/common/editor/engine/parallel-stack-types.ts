/* SPDX-License-Identifier: AGPL-3.0-only */
import type { StripRef } from '../parameter-address.ts';

export interface ParallelStackRuntimeModules {
	readonly parametricEqWasmModule?: WebAssembly.Module;
}

/** Plain structured-clone data. A plane has exactly blockFrames samples. */
export interface ParallelStackEffect {
	readonly id: string;
	readonly type: string;
	readonly params: Readonly<Record<string, unknown>>;
	readonly latencyFrames: number;
	readonly stateBytes: number;
}
export interface ParallelStackEdge {
	readonly id: string;
	readonly sourceTask: number;
	readonly sourcePlanes: readonly number[];
	/** Destination rows, source columns. Explicit maps or width-preserving identity. */
	readonly matrix: readonly (readonly number[])[];
	readonly delayFrames: number;
	readonly level: number;
	readonly sidechainEffectId: string | null;
}
export interface ParallelStackTask {
	readonly kind: 'stack' | 'output';
	readonly key: string;
	readonly worker: number;
	readonly dependencies: readonly number[];
	readonly channels: number;
	readonly inputPlanes: readonly number[];
	readonly inputDelayFrames: number;
	readonly prePlanes: readonly number[];
	readonly postPlanes: readonly number[];
	readonly effects: readonly ParallelStackEffect[];
	readonly edges: readonly ParallelStackEdge[];
	readonly gain: number;
	readonly pan: number;
	readonly gate: number;
	readonly vca: number;
	readonly outputDelayFrames: number;
}
export interface ParallelStackTrack {
	readonly id: string;
	readonly channels: number;
	readonly inputPlanes: readonly number[];
	readonly prePlanes: readonly number[];
	readonly postPlanes: readonly number[];
}
export interface ParallelStackTap {
	readonly scope: 'track' | 'group' | 'send' | 'cue' | 'master';
	readonly key: string;
	readonly ref: StripRef;
	readonly planes: readonly number[];
	readonly channels: number;
}
export interface ParallelStackOutput {
	readonly id: string;
	readonly role: string;
	readonly channels: number;
	readonly planes: readonly number[];
}
export interface ParallelStackPlan {
	readonly version: 1;
	readonly sampleRate: number;
	readonly blockFrames: number;
	readonly bankCount: number;
	readonly workerCount: number;
	readonly planeCount: number;
	readonly tasks: readonly ParallelStackTask[];
	readonly taskOrder: readonly number[];
	readonly tracks: readonly ParallelStackTrack[];
	readonly stripTaps: readonly ParallelStackTap[];
	readonly outputs: readonly ParallelStackOutput[];
	readonly inputPlaneIndices: readonly (readonly number[])[];
	readonly outputPlaneIndices: readonly (readonly number[])[];
	readonly latencyFrames: number;
	readonly memoryBytes: number;
}
