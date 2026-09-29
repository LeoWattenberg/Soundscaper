/* SPDX-License-Identifier: AGPL-3.0-only */

// Run with: node --import tsx scripts/benchmark-parallel-effect-stacks.mjs
// BENCH_LATENCY_FRAMES=768 selects the 16 ms pipeline instead of 32 ms.
// BENCH_TRACKS, BENCH_EFFECTS and BENCH_WORKERS vary the workload.
// The serial mode executes the *same JavaScript DSP plan* on the callback
// thread. It is a workload proxy, not a measurement of Chromium's native
// Web Audio graph. The paced Node loop is not an audio device clock.
// Main-thread CPU includes benchmark pacing; process CPU includes workers.
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { ParallelStackCollector } from '../src/common/editor/engine/parallel-stack-collector.ts';
import { createParallelStackExecutor } from '../src/common/editor/engine/parallel-stack-dsp.ts';
import { compileParallelStackPlan } from '../src/common/editor/engine/parallel-stack-plan.ts';
import { createParallelStackBuffers, createParallelStackViews, startParallelStackBuffers, stopParallelStackBuffers } from '../src/common/editor/engine/parallel-stack-protocol.ts';

const SAMPLE_RATE = 48_000;
const QUANTUM_FRAMES = 128;
const TRACKS = Number(process.env.BENCH_TRACKS ?? 4);
const EFFECTS_PER_TRACK = Number(process.env.BENCH_EFFECTS ?? 3);
const WORKERS = Number(process.env.BENCH_WORKERS ?? 2);
const LATENCY_FRAMES = Number(process.env.BENCH_LATENCY_FRAMES ?? 1536);
const WARMUP_SECONDS = .75;
const MEASURE_SECONDS = 4;
const QUANTUM_MS = QUANTUM_FRAMES / SAMPLE_RATE * 1_000;
const warmupQuanta = Math.round(WARMUP_SECONDS * SAMPLE_RATE / QUANTUM_FRAMES);
const measureQuanta = Math.round(MEASURE_SECONDS * SAMPLE_RATE / QUANTUM_FRAMES);
const sleepWord = new Int32Array(new SharedArrayBuffer(4));
const params = { bitDepth: 7, downsampling: 3.5, mix: 76, interpolation: 'linear' };

function project() {
	const tracks = Array.from({ length: TRACKS }, (_, index) => ({
		id: `track-${index}`, type: 'audio', channelCount: 2,
		effects: Array.from({ length: EFFECTS_PER_TRACK }, (_, effect) => ({
			id: `effect-${index}-${effect}`, type: 'bitcrusher', params,
		})),
	}));
	const edges = tracks.map((track) => ({
		id: `route-${track.id}`, kind: 'assignment', source: { kind: 'track', id: track.id },
		destination: { kind: 'master' }, position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1],
	}));
	edges.push({ id: 'master-main', kind: 'assignment', source: { kind: 'master' },
		destination: { kind: 'output', id: 'main' }, position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] });
	return { schemaFamily: 'soundscaper', schemaVersion: 1, sampleRate: SAMPLE_RATE, masterChannels: 2,
		tracks, mixer: { schemaVersion: 1, groups: [], sends: [], cues: [], vcas: [],
			outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }], edges } };
}

const input = Array.from({ length: TRACKS }, (_, track) => Array.from({ length: 2 }, (_, channel) => {
	const samples = new Float32Array(QUANTUM_FRAMES);
	for (let frame = 0; frame < samples.length; frame += 1) {
		samples[frame] = Math.fround(.1 * Math.sin((frame + track * 31 + channel * 17) * .07));
	}
	return samples;
}));

function percentile(values, fraction) {
	const sorted = values.toSorted((a, b) => a - b);
	return sorted[Math.floor((sorted.length - 1) * fraction)];
}

function summarize(mode, samples, wallMilliseconds, cpu, threadCpu, faults, outputChecksum) {
	return {
		mode,
		callbacks: samples.length,
		medianCallbackUs: +percentile(samples, .5).toFixed(1),
		meanCallbackUs: +(samples.reduce((sum, value) => sum + value, 0) / samples.length).toFixed(1),
		p95CallbackUs: +percentile(samples, .95).toFixed(1),
		maxCallbackUs: +Math.max(...samples).toFixed(1),
		mainThreadCpuMs: +((threadCpu.user + threadCpu.system) / 1_000).toFixed(1),
		processCpuMs: +((cpu.user + cpu.system) / 1_000).toFixed(1),
		processCpuPercentOfOneCore: +((cpu.user + cpu.system) / 1_000 / wallMilliseconds * 100).toFixed(1),
		wallMs: +wallMilliseconds.toFixed(1),
		faults,
		outputChecksum: +outputChecksum.toFixed(6),
	};
}

async function run(mode) {
	const parallel = mode === 'parallel';
	const plan = compileParallelStackPlan(project(), { sampleRate: SAMPLE_RATE, workerCount: parallel ? WORKERS : 1 });
	const output = [[new Float32Array(QUANTUM_FRAMES), new Float32Array(QUANTUM_FRAMES)]];
	let shared;
	let collector;
	let workers = [];
	let views;
	let planes;
	let execute;
	if (parallel) {
		shared = createParallelStackBuffers({ generation: 1, planeCount: plan.planeCount,
			taskCount: plan.tasks.length, workerCount: plan.workerCount, latencyFrames: LATENCY_FRAMES });
		views = createParallelStackViews(shared);
		collector = new ParallelStackCollector({ shared, inputPlaneIndices: plan.inputPlaneIndices,
			outputPlaneIndices: plan.outputPlaneIndices, startFrame: 0 });
		workers = Array.from({ length: plan.workerCount }, () => new Worker(
			new URL('../tests/fixtures/parallel-stack-worker-adapter.ts', import.meta.url),
		));
		const installedWorkers = workers.map((worker) => once(worker, 'message'));
		for (const [installed] of await Promise.all(installedWorkers)) {
			if (installed.type !== 'installed') throw new Error(`Worker installation failed: ${JSON.stringify(installed)}`);
		}
		const prepared = workers.map((worker) => once(worker, 'message'));
		for (let index = 0; index < workers.length; index += 1) {
			workers[index].postMessage({ type: 'prepare', shared, plan, workerIndex: index });
		}
		for (const [message] of await Promise.all(prepared)) if (message.type !== 'ready') throw new Error(JSON.stringify(message));
		startParallelStackBuffers(shared);
		const started = workers.map((worker) => once(worker, 'message'));
		for (const worker of workers) worker.postMessage({ type: 'start' });
		for (const [message] of await Promise.all(started)) if (message.type !== 'started') throw new Error(JSON.stringify(message));
	} else {
		planes = Array.from({ length: plan.planeCount }, () => new Float32Array(plan.blockFrames));
		execute = createParallelStackExecutor(plan, 0);
	}
	const durationsUs = [];
	let faults = 0;
	let checksum = 0;
	let cpuStart;
	let threadCpuStart;
	let wallStart;
	const totalQuanta = warmupQuanta + measureQuanta;
	const latencyQuanta = LATENCY_FRAMES / QUANTUM_FRAMES;
	const comparableBlocks = Math.ceil((totalQuanta - latencyQuanta) / 2);
	const origin = performance.now();
	try {
		for (let quantum = 0; quantum < totalQuanta; quantum += 1) {
			const due = origin + quantum * QUANTUM_MS;
			const wait = due - performance.now();
			if (wait > 0) Atomics.wait(sleepWord, 0, 0, wait);
			if (quantum === warmupQuanta) {
				wallStart = performance.now(); cpuStart = process.cpuUsage(); threadCpuStart = process.threadCpuUsage();
			}
			const before = process.hrtime.bigint();
			if (parallel) {
				if (!collector.process(input, output, quantum * QUANTUM_FRAMES)) {
					faults++;
					throw new Error(`Parallel callback fault ${collector.fault} at quantum ${quantum}; banks ${JSON.stringify(views.banks.map((bank) => [bank.state(), bank.sequence(), bank.unfinished()]))}`);
				}
				if (quantum >= latencyQuanta && (quantum - latencyQuanta) % 2 === 0) checksum += output[0][0][0];
			} else {
				const offset = (quantum % 2) * QUANTUM_FRAMES;
				for (let track = 0; track < input.length; track += 1) {
					for (let channel = 0; channel < input[track].length; channel += 1) {
						planes[plan.inputPlaneIndices[track][channel]].set(input[track][channel], offset);
					}
				}
				if (offset !== 0) {
					for (const task of plan.taskOrder) execute(task, planes, Math.floor(quantum / 2));
					if (Math.floor(quantum / 2) < comparableBlocks) checksum += planes[plan.outputPlaneIndices[0][0]][0];
				}
			}
			if (quantum >= warmupQuanta) durationsUs.push(Number(process.hrtime.bigint() - before) / 1_000);
		}
		const wallMilliseconds = performance.now() - wallStart;
		const cpu = process.cpuUsage(cpuStart);
		const threadCpu = process.threadCpuUsage(threadCpuStart);
		if (parallel && views.status() !== 1) throw new Error(`Parallel protocol status ${views.status()}`);
		return summarize(mode, durationsUs, wallMilliseconds, cpu, threadCpu, faults, checksum);
	} finally {
		if (shared) stopParallelStackBuffers(shared);
		await Promise.all(workers.map((worker) => worker.terminate()));
	}
}

console.log(`${TRACKS} stereo tracks, ${EFFECTS_PER_TRACK} bitcrushers per track, 48 kHz, 128-frame callbacks, 256-frame blocks, ${MEASURE_SECONDS} s per pass.`);
console.log(`Serial mode runs the identical DSP plan on this thread. Parallel mode uses the production collector and ${WORKERS} real workers.`);
console.log('Measurements exclude graph/worker setup and the first 0.75 s; process CPU includes worker threads.');
console.log(`Parallel pipeline latency: ${LATENCY_FRAMES} frames (${LATENCY_FRAMES / SAMPLE_RATE * 1000} ms).`);
const rows = [];
for (const mode of ['serial', 'parallel', 'parallel', 'serial']) rows.push(await run(mode));
for (const row of rows) {
	if (Math.abs(row.outputChecksum - rows[0].outputChecksum) > .000001) {
		throw new Error(`Serial and parallel sample checksums disagree: ${JSON.stringify(rows.map(({ outputChecksum }) => outputChecksum))}`);
	}
}
console.table(rows);
