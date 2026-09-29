/* SPDX-License-Identifier: AGPL-3.0-only */

export const PARALLEL_STACK_PROCESSOR_NAME = 'soundscaper-parallel-stacks';
export const ParallelStackStatus = { Preparing: 0, Running: 1, Stopped: 2, Faulted: 3 } as const;
export const ParallelStackFault = { None: 0, Deadline: 1, Capacity: 2, Quantum: 3, Clock: 4, Worker: 5 } as const;
export const ParallelStackBankState = { Free: 0, Capturing: 1, Ready: 2, Complete: 3, Reading: 4 } as const;
export const PARALLEL_STACK_MAXIMUM_BYTES = 128 * 1024 * 1024;
const HEADER_WORDS = 4;
const BANK_WORDS = 5;
const WORD_RANGE = 4_294_967_296;

export interface ParallelStackGeometry {
	readonly generation: number;
	readonly planeCount: number;
	readonly taskCount: number;
	readonly workerCount: number;
	readonly blockFrames: number;
	readonly quantumFrames: number;
	readonly latencyFrames: number;
	readonly bankCount: number;
}

export interface SharedParallelStackBuffers {
	readonly geometry: ParallelStackGeometry;
	readonly control: SharedArrayBuffer;
	readonly pcm: SharedArrayBuffer;
}

export interface ParallelStackTaskSchedule {
	readonly worker: number;
	readonly dependencies: readonly number[];
}

export interface ParallelStackBank {
	readonly planes: readonly Float32Array[];
	readonly offset: number;
	state(): number;
	sequence(): number;
	unfinished(): number;
}

/** All views are allocated once, before either realtime loop is entered. */
export function createParallelStackViews(shared: SharedParallelStackBuffers) {
	validateShared(shared);
	const { geometry } = shared;
	const control = new Int32Array(shared.control);
	const bankStride = BANK_WORDS + geometry.taskCount;
	const bankBase = HEADER_WORDS + geometry.workerCount * 2;
	const banks: ParallelStackBank[] = [];
	for (let bank = 0; bank < geometry.bankCount; bank += 1) {
		const offset = bankBase + bank * bankStride;
		const planes = Array.from({ length: geometry.planeCount }, (_, plane) => new Float32Array(
			shared.pcm, (bank * geometry.planeCount + plane) * geometry.blockFrames * 4, geometry.blockFrames,
		));
		banks.push({
			planes, offset,
			state: () => Atomics.load(control, offset),
			sequence: () => (control[offset + 1] >>> 0) + (control[offset + 2] >>> 0) * WORD_RANGE,
			unfinished: () => Atomics.load(control, offset + 3),
		});
	}
	return {
		control, banks, geometry,
		status: () => Atomics.load(control, 0),
		fault: () => Atomics.load(control, 1),
		workerWakeIndex: (worker: number) => HEADER_WORDS + worker,
		workerStateIndex: (worker: number) => HEADER_WORDS + geometry.workerCount + worker,
		taskIndex: (bank: ParallelStackBank, task: number) => bank.offset + BANK_WORDS + task,
	};
}

export type ParallelStackViews = ReturnType<typeof createParallelStackViews>;

export function createParallelStackBuffers(options: Pick<ParallelStackGeometry,
	'generation' | 'planeCount' | 'taskCount' | 'workerCount'> & Partial<ParallelStackGeometry>): SharedParallelStackBuffers {
	const geometry = Object.freeze({ blockFrames: 256, quantumFrames: 128, latencyFrames: 768, bankCount: 8, ...options });
	validateGeometry(geometry);
	return {
		geometry,
		control: new SharedArrayBuffer(controlBytes(geometry)),
		pcm: new SharedArrayBuffer(pcmBytes(geometry)),
	};
}

export function startParallelStackBuffers(shared: SharedParallelStackBuffers): void {
	const views = controlViews(shared);
	if (Atomics.compareExchange(views.control, 0, ParallelStackStatus.Preparing, ParallelStackStatus.Running)
		!== ParallelStackStatus.Preparing) throw new Error('A parallel stack generation can only start once.');
	wakeParallelStackWorkers(views);
}

export function stopParallelStackBuffers(shared: SharedParallelStackBuffers): void {
	stopParallelStackViews(controlViews(shared));
}

export function stopParallelStackViews(views: Pick<ParallelStackViews, 'control' | 'geometry' | 'workerWakeIndex'>): void {
	for (;;) {
		const previous = Atomics.load(views.control, 0);
		if (previous >= ParallelStackStatus.Stopped) break;
		if (Atomics.compareExchange(views.control, 0, previous, ParallelStackStatus.Stopped) === previous) break;
	}
	wakeParallelStackWorkers(views);
}

export function faultParallelStackViews(views: ParallelStackViews, code: number): void {
	// The first cause is diagnostic; status is the atomic stop publication.
	Atomics.compareExchange(views.control, 1, ParallelStackFault.None, code);
	Atomics.compareExchange(views.control, 0, ParallelStackStatus.Running, ParallelStackStatus.Faulted);
	Atomics.compareExchange(views.control, 0, ParallelStackStatus.Preparing, ParallelStackStatus.Faulted);
	wakeParallelStackWorkers(views);
}

export function wakeParallelStackWorkers(views: Pick<ParallelStackViews, 'control' | 'geometry' | 'workerWakeIndex'>): void {
	for (let worker = 0; worker < views.geometry.workerCount; worker += 1) {
		const index = views.workerWakeIndex(worker);
		Atomics.add(views.control, index, 1);
		Atomics.notify(views.control, index);
	}
}

function controlViews(shared: SharedParallelStackBuffers) {
	validateShared(shared);
	return {
		control: new Int32Array(shared.control), geometry: shared.geometry,
		workerWakeIndex: (worker: number) => HEADER_WORDS + worker,
	};
}

export function claimParallelStackBank(views: ParallelStackViews, sequence: number): ParallelStackBank | null {
	const bank = views.banks[sequence % views.geometry.bankCount];
	if (Atomics.compareExchange(views.control, bank.offset, ParallelStackBankState.Free, ParallelStackBankState.Capturing)
		!== ParallelStackBankState.Free) return null;
	views.control[bank.offset + 1] = sequence % WORD_RANGE;
	views.control[bank.offset + 2] = Math.floor(sequence / WORD_RANGE);
	views.control[bank.offset + 3] = views.geometry.taskCount;
	views.control[bank.offset + 4] = views.geometry.blockFrames;
	for (let task = 0; task < views.geometry.taskCount; task += 1) views.control[views.taskIndex(bank, task)] = 0;
	return bank;
}

export function publishParallelStackBank(views: ParallelStackViews, bank: ParallelStackBank): void {
	Atomics.store(views.control, bank.offset, ParallelStackBankState.Ready);
	wakeParallelStackWorkers(views);
}

function controlBytes(geometry: ParallelStackGeometry): number {
	return (HEADER_WORDS + geometry.workerCount * 2 + geometry.bankCount * (BANK_WORDS + geometry.taskCount)) * 4;
}

function pcmBytes(geometry: ParallelStackGeometry): number {
	return geometry.bankCount * geometry.blockFrames * geometry.planeCount * 4;
}

function validateGeometry(geometry: ParallelStackGeometry): void {
	for (const value of Object.values(geometry)) {
		if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Parallel stack geometry requires positive safe integers.');
	}
	if (geometry.planeCount > 4_096 || geometry.taskCount > 256 || geometry.workerCount > 8
		|| geometry.workerCount > geometry.taskCount || geometry.bankCount > 64
		|| geometry.blockFrames !== 256 || geometry.quantumFrames !== 128
		|| geometry.latencyFrames < geometry.blockFrames * 3 || geometry.latencyFrames % geometry.blockFrames !== 0
		|| geometry.bankCount < geometry.latencyFrames / geometry.blockFrames + 2
		|| controlBytes(geometry) + pcmBytes(geometry) > PARALLEL_STACK_MAXIMUM_BYTES) {
		throw new RangeError('Parallel stack geometry exceeds the qualified resource limits.');
	}
}

function validateShared(shared: SharedParallelStackBuffers): void {
	validateGeometry(shared.geometry);
	if (!(shared.control instanceof SharedArrayBuffer) || !(shared.pcm instanceof SharedArrayBuffer)
		|| shared.control.byteLength !== controlBytes(shared.geometry) || shared.pcm.byteLength !== pcmBytes(shared.geometry)) {
		throw new RangeError('Parallel stack shared buffers do not match their geometry.');
	}
}
