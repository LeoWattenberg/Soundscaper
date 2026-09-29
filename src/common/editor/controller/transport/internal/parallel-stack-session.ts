/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioWorkletLoadOnce } from '../../../audio-worklet-load-once.ts';
import { createAbortError, throwIfAborted } from '../../../engine/async-utils.ts';
import { buildParallelStackAudioGraph } from '../../../engine/parallel-stack-audio-graph.ts';
import { setParallelStackSourceStartTime, registerParallelStackEndFrame, type ParallelStackPlaybackRequest } from '../../../engine/parallel-stack-playback.ts';
import {
	createParallelStackBuffers, createParallelStackViews, faultParallelStackViews,
	PARALLEL_STACK_PROCESSOR_NAME, ParallelStackFault, ParallelStackStatus,
	startParallelStackBuffers, stopParallelStackBuffers,
} from '../../../engine/parallel-stack-protocol.ts';
import type { ParallelStackPlan } from '../../../engine/parallel-stack-types.ts';
import type { ProjectGraph } from '../../../engine/project-graph.ts';
import { getParametricEqWasmModule } from '../../../engine/effect-worklets.ts';
import { createParallelStackEffectMailbox } from '../../../engine/parallel-stack-effect-mailbox.ts';
import { registerParallelStackLiveControls } from '../../../engine/parallel-stack-live-controls.ts';

export interface ParallelStackSessionResources {
	readonly loadWorklet: (context: AudioContext) => Promise<void>;
	readonly createWorker: (index: number) => Worker;
	readonly createNode: (context: AudioContext, options: AudioWorkletNodeOptions) => AudioWorkletNode;
}

const worklet = createAudioWorkletLoadOnce(async (context) => {
	const url = import.meta.env?.DEV || import.meta.env?.PROD
		? (await import('../../../engine/parallel-stack-worklet.ts?worker&url')).default
		: new URL('../../../engine/parallel-stack-worklet.ts', import.meta.url);
	await context.audioWorklet.addModule(url);
});
const browserResources: ParallelStackSessionResources = {
	loadWorklet: (context) => worklet.ensure(context),
	createWorker: (index) => new Worker(new URL('../../../engine/parallel-stack-worker.ts', import.meta.url), {
		type: 'module', name: `soundscaper-parallel-stack-${String(index)}`,
	}),
	createNode: (context, options) => new AudioWorkletNode(context, PARALLEL_STACK_PROCESSOR_NAME, options),
};
let generation = 0;

/** Own one fresh generation. Workers and the collector never share slabs with its replacement. */
export async function createParallelStackSession(
	request: ParallelStackPlaybackRequest,
	plan: ParallelStackPlan,
	latencyFrames: number,
	signal: AbortSignal,
	resources: ParallelStackSessionResources = browserResources,
): Promise<ProjectGraph> {
	throwIfAborted(signal);
	await resources.loadWorklet(request.context);
	throwIfAborted(signal);
	const shared = createParallelStackBuffers({
		generation: ++generation, planeCount: plan.planeCount, taskCount: plan.tasks.length,
		workerCount: plan.workerCount, blockFrames: plan.blockFrames, bankCount: plan.bankCount, latencyFrames,
	});
	const sessionGeneration = shared.geometry.generation;
	const views = createParallelStackViews(shared);
	const effectMailbox = createParallelStackEffectMailbox(plan.tasks.reduce((count, task) => count + task.effects.length, 0));
	const workers: Worker[] = [];
	const abortController = new AbortController();
	let collector: AudioWorkletNode | null = null;
	let graph: ProjectGraph | null = null;
	let installed = false;
	let disposed = false;
	let failure: Error | null = null;
	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		stopParallelStackBuffers(shared);
		abortController.abort();
		signal.removeEventListener('abort', dispose);
		for (const worker of workers) worker.terminate();
		collector?.port.close();
		collector?.disconnect();
		for (const node of graph?.nodes ?? []) node.disconnect();
	};
	const fail = (error: Error): void => {
		if (disposed || failure) return;
		failure = error;
		faultParallelStackViews(views, ParallelStackFault.Worker);
		if (installed) request.onFailure(error);
		else abortController.abort(error);
	};
	const observeFailure = (event: Event): void => {
		if (event.type !== 'message') { fail(new Error('A parallel effect worker stopped unexpectedly.')); return; }
		const data: unknown = (event as MessageEvent<unknown>).data;
		if (!data || typeof data !== 'object' || !('type' in data)) return;
		if (data.type === 'fault' || data.type === 'error') {
			fail(new Error('Parallel effect processing missed its deadline or failed. Playback stopped; the next Play uses the standard engine.'));
		}
	};
	signal.addEventListener('abort', dispose, { once: true });
	abortController.signal.addEventListener('abort', dispose, { once: true });
	try {
		for (let index = 0; index < plan.workerCount; index += 1) {
			const worker = resources.createWorker(index);
			workers.push(worker);
			worker.addEventListener('error', observeFailure);
			worker.addEventListener('messageerror', observeFailure);
			worker.addEventListener('message', observeFailure);
		}
		await Promise.all(workers.map((worker, workerIndex) => {
			const ready = waitForMessage(worker, 'ready', abortController.signal, { generation: sessionGeneration, workerIndex });
			worker.postMessage({ type: 'prepare', shared, plan, workerIndex,
				effectMailbox,
				parametricEqWasmModule: getParametricEqWasmModule(request.context),
			});
			return ready;
		}));
		throwIfAborted(abortController.signal);
		const outputPlaneIndices = [...plan.outputPlaneIndices,
			...(request.metering ? plan.stripTaps.map((tap) => tap.planes) : [])];
		collector = resources.createNode(request.context, {
			numberOfInputs: plan.tracks.length,
			numberOfOutputs: outputPlaneIndices.length,
			outputChannelCount: outputPlaneIndices.map((planes) => planes.length),
			channelCountMode: 'max', channelInterpretation: 'discrete',
			processorOptions: { shared, inputPlaneIndices: plan.inputPlaneIndices, outputPlaneIndices },
		});
		collector.port.addEventListener('message', observeFailure);
		collector.addEventListener('processorerror', observeFailure);
		const collectorReady = waitForMessage(collector.port, 'ready', abortController.signal, { generation: sessionGeneration });
		collector.port.start();
		await collectorReady;
		startParallelStackBuffers(shared);
		await Promise.all(workers.map((worker, workerIndex) => {
			const started = waitForMessage(worker, 'started', abortController.signal, { generation: sessionGeneration, workerIndex });
			worker.postMessage({ type: 'start' });
			return started;
		}));
		const context = request.context;
		// Connect while unarmed: the collector renders silence until the chosen origin,
		// even if the UI is delayed while waiting for the start acknowledgement.
		graph = buildParallelStackAudioGraph(context, request.destination, collector, plan, latencyFrames, request.metering, abortController);
		registerParallelStackLiveControls(graph, plan, effectMailbox);
		const requestedStartFrame = Math.ceil((context.currentTime + 0.05) * context.sampleRate / 128) * 128;
		const armed = waitForMessage(collector.port, 'started', abortController.signal, { generation: sessionGeneration });
		collector.port.postMessage({ type: 'start', startFrame: requestedStartFrame });
		const acknowledged = await armed;
		const startFrame = acknowledged.startFrame;
		if (typeof startFrame !== 'number' || !Number.isSafeInteger(startFrame)
			|| startFrame < requestedStartFrame || startFrame % shared.geometry.quantumFrames !== 0) {
			throw new Error('Parallel stack collector acknowledged an invalid frame origin.');
		}
		throwIfAborted(abortController.signal);
		if (failure || views.status() === ParallelStackStatus.Faulted) throw failure ?? new Error('Parallel stack startup failed.');
		setParallelStackSourceStartTime(graph, Math.max(startFrame / context.sampleRate, context.currentTime + 0.02), plan.workerCount);
		const port = collector.port;
		registerParallelStackEndFrame(graph, (endFrame) => port.postMessage({ type: 'end', endFrame }));
		installed = true;
		signal.removeEventListener('abort', dispose);
		return graph;
	} catch (error) {
		dispose();
		throw failure ?? error;
	}
}

function waitForMessage(port: Worker | MessagePort, type: string, signal: AbortSignal, identity: Readonly<Record<string, number>>): Promise<Record<string, unknown>> {
	const pending = new Promise<Record<string, unknown>>((resolve, reject) => {
		const cleanup = (): void => {
			clearTimeout(timer);
			port.removeEventListener('message', receive);
			port.removeEventListener('messageerror', failed);
			port.removeEventListener('error', failed);
			signal.removeEventListener('abort', aborted);
		};
		const finish = (error?: Error, reply: Record<string, unknown> = {}): void => { cleanup(); if (error) reject(error); else resolve(reply); };
		const receive = (event: Event): void => {
			const data: unknown = (event as MessageEvent<unknown>).data;
			if (!data || typeof data !== 'object' || !('type' in data)) return;
			if (data.type === type) {
				const reply = data as Record<string, unknown>;
				finish(Object.entries(identity).every(([key, value]) => reply[key] === value)
					? undefined : new Error('Parallel stack handshake identity mismatch.'), reply);
			}
			else if (data.type === 'error' || data.type === 'fault') failed();
		};
		const failed = (): void => finish(new Error('Parallel stack startup failed.'));
		const aborted = (): void => finish(createAbortError());
		const timer = setTimeout(() => finish(new Error('Parallel stack startup timed out.')), 5_000);
		port.addEventListener('message', receive);
		port.addEventListener('messageerror', failed);
		port.addEventListener('error', failed);
		signal.addEventListener('abort', aborted, { once: true });
		if (signal.aborted) aborted();
	});
	// A synchronous postMessage failure can abandon this waiter before Promise.all owns it.
	void pending.catch(() => undefined);
	return pending;
}
