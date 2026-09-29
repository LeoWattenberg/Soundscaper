/* SPDX-License-Identifier: AGPL-3.0-only */
import { createParallelStackSession } from '../../src/common/editor/controller/transport/internal/parallel-stack-session.ts';
import { compileParallelStackPlan } from '../../src/common/editor/engine/parallel-stack-plan.ts';
import { createParallelStackViews, PARALLEL_STACK_PROCESSOR_NAME, type ParallelStackViews,
	type SharedParallelStackBuffers } from '../../src/common/editor/engine/parallel-stack-protocol.ts';
import type { EngineProject } from '../../src/common/editor/engine/types.ts';

export interface ParallelDesktopSmokeResult {
	readonly isolated: boolean;
	readonly secure: boolean;
	readonly protocol: string;
	readonly workers: number;
	readonly terminated: number;
	readonly progress: readonly number[];
	readonly peak: number;
	readonly fault: number;
	readonly status: number;
	readonly errors: readonly string[];
}

async function run(): Promise<ParallelDesktopSmokeResult> {
	if (!crossOriginIsolated || typeof SharedArrayBuffer !== 'function') throw new Error('The desktop origin did not enable shared memory.');
	const project: EngineProject = {
		schemaFamily: 'soundscaper', schemaVersion: 1, sampleRate: 48000, masterChannels: 2,
		tracks: ['a', 'b'].map((id) => ({ id, type: 'audio', gain: 1, effectsActive: true,
			effects: [{ id: `${id}-crusher`, type: 'bitcrusher', params: { bitDepth: 8 } }] })),
		mixer: { schemaVersion: 1, groups: [], sends: [], cues: [], vcas: [],
			outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }],
			edges: ['a', 'b', 'master'].map((id) => ({ id, kind: 'assignment',
				source: id === 'master' ? { kind: 'master' } : { kind: 'track', id },
				destination: id === 'master' ? { kind: 'output', id: 'main' } : { kind: 'master' },
				position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] })) } as EngineProject['mixer'],
	};
	const context = new AudioContext({ sampleRate: 48000 });
	await context.resume();
	const plan = compileParallelStackPlan(project, { sampleRate: context.sampleRate, workerCount: 2 });
	const errors: string[] = [];
	const workers: Worker[] = [];
	let terminated = 0;
	const capture: { views?: ParallelStackViews } = {};
	const graph = await createParallelStackSession({ context, destination: context.destination, project, metering: true,
		playbackMode: 'normal', playbackRate: 1, fromFrame: 0, onFailure: (error) => { errors.push(error.message); } },
	plan, 1536, new AbortController().signal, {
		loadWorklet: (audioContext) => audioContext.audioWorklet.addModule('/worklet.js'),
		createNode: (audioContext, options) => new AudioWorkletNode(audioContext, PARALLEL_STACK_PROCESSOR_NAME, options),
		createWorker: () => {
			const worker = new Worker('/worker.js', { type: 'module' });
			const post = worker.postMessage.bind(worker);
			worker.postMessage = (message: unknown, options: Transferable[] | StructuredSerializeOptions = []) => {
				if (message && typeof message === 'object' && 'shared' in message && !capture.views) {
					capture.views = createParallelStackViews(message.shared as SharedParallelStackBuffers);
				}
				if (Array.isArray(options)) post(message, options); else post(message, options);
			};
			const terminate = worker.terminate.bind(worker);
			worker.terminate = () => { terminated++; terminate(); };
			workers.push(worker);
			return worker;
		},
	});
	const sources: ConstantSourceNode[] = [];
	try {
		for (const input of graph.trackInputs.values()) {
			const source = context.createConstantSource(); source.offset.value = .15;
			source.connect(input); source.start(); sources.push(source);
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 500));
		const active = capture.views;
		if (!active) throw new Error('No shared worker generation was prepared.');
		const sequences = () => {
			const result = Array<number>(plan.workerCount).fill(-1);
			for (const bank of active.banks) {
				const sequence = bank.sequence();
				for (let task = 0; task < plan.tasks.length; task++) if (Atomics.load(active.control, active.taskIndex(bank, task)) === 2) {
					const worker = plan.tasks[task]!.worker;
					if (bank.sequence() === sequence) result[worker] = Math.max(result[worker]!, sequence);
				}
			}
			return result;
		};
		const before = sequences();
		const until = performance.now() + 500;
		while (performance.now() < until) { /* Block the renderer UI, leaving real worker/audio threads active. */ }
		const after = sequences();
		const samples = new Float32Array(256);
		graph.masterAnalyser?.getFloatTimeDomainData(samples);
		const peak = samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
		const result = { isolated: crossOriginIsolated, secure: isSecureContext, protocol: location.protocol,
			workers: workers.length, progress: after.map((sequence, worker) => sequence - before[worker]!), peak,
			fault: active.fault(), status: active.status(), errors };
		graph.abortController.abort();
		return { ...result, terminated };
	} finally {
		graph.abortController.abort();
		for (const source of sources) { source.stop(); source.disconnect(); }
		await context.close();
	}
}

void run().then((result) => {
	document.body.textContent = JSON.stringify(result);
	document.documentElement.dataset.status = 'complete';
}, (error: unknown) => {
	document.body.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
	document.documentElement.dataset.status = 'failed';
});
