/* SPDX-License-Identifier: AGPL-3.0-only */

import { scheduleProjectClips } from '../engine/clip-scheduler.ts';
import { ensureProjectWorklets } from '../engine/effect-worklets.ts';
import { buildProjectGraph } from '../engine/project-graph.ts';
import { disposeGraph } from '../engine/transport-scheduler.ts';
import { createM4ProductionParityEngineProject } from './m4-production-parity-workload.ts';

export type M4ProductionParityRenderMode = 'preview' | 'export';

export interface M4ProductionParityProductionPathEvidence {
	readonly schemaVersion: 1;
	readonly schedulerMode: 'live' | 'offline';
	readonly monitoring: boolean;
	readonly scheduledClipCount: number;
	readonly latencyFrames: number;
	readonly pdcErrorSamples: number;
	readonly programInputLatencyFrames: number;
	readonly fastPathCompensationFrames: number;
}

export interface M4ProductionParityProductionPathResult {
	readonly channels: readonly Float32Array[];
	readonly evidence: M4ProductionParityProductionPathEvidence;
}

/** Render the registered fixture through the same graph and clip scheduler as the engine. */
export async function renderM4ProductionParityProductionPath(
	input: readonly Float32Array[],
	mode: M4ProductionParityRenderMode,
): Promise<M4ProductionParityProductionPathResult> {
	const project = createM4ProductionParityEngineProject();
	const sampleRate = project.sampleRate ?? 48_000;
	const channelCount = project.masterChannels ?? 2;
	const frameCount = validateInput(input, channelCount);
	const context = new OfflineAudioContext(channelCount, frameCount, sampleRate);
	const buffer = context.createBuffer(channelCount, frameCount, sampleRate);
	for (const [index, channel] of input.entries()) {
		buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, index);
	}
	await ensureProjectWorklets(context, project);
	const monitoring = mode === 'preview';
	const schedulerMode = monitoring ? 'live' : 'offline';
	const graph = buildProjectGraph(context, context.destination, project, {
		metering: false,
		monitoring,
	});
	try {
		const sources = new Map<unknown, AudioBuffer>([['program-source', buffer]]);
		await scheduleProjectClips({
			context,
			project,
			sources,
			trackInputs: graph.trackInputs,
			trackGainParams: graph.trackGainParams,
			projectGainParams: graph.projectGainParams,
			parameterRegistry: graph.parameterRegistry,
			fromFrame: 0,
			toFrame: frameCount,
			contextStartTime: 0,
			sampleRate,
			reversedBuffers: new WeakMap(),
			sourceResolver: null,
			activeSources: graph.sources,
			allNodes: graph.nodes,
			mode: schedulerMode,
		});
		const scheduledClipCount = graph.sources.size;
		const rendered = await context.startRendering();
		const plan = graph.pathPdcPlanV21;
		if (!plan) throw new Error('The M4 production parity workload did not select the V21 graph.');
		return Object.freeze({
			channels: Object.freeze(Array.from(
				{ length: channelCount },
				(_, channel) => rendered.getChannelData(channel).slice(),
			)),
			evidence: Object.freeze({
				schemaVersion: 1,
				schedulerMode,
				monitoring,
				scheduledClipCount,
				latencyFrames: graph.latencyFrames,
				pdcErrorSamples: plan.pdcErrorSamples,
				programInputLatencyFrames: plan.nodeInputLatencyFrames.get('track:program') ?? -1,
				fastPathCompensationFrames: plan.edgeCompensationFrames.get('fast-parent') ?? -1,
			}),
		});
	} finally {
		disposeGraph(graph, false);
	}
}

function validateInput(input: readonly Float32Array[], channelCount: number): number {
	if (!Array.isArray(input) || input.length !== channelCount) {
		throw new RangeError(`The M4 production render requires exactly ${String(channelCount)} channels.`);
	}
	const frameCount = input[0]?.length ?? 0;
	if (!Number.isSafeInteger(frameCount) || frameCount < 1 || input.some((channel) => (
		!(channel instanceof Float32Array) || channel.length !== frameCount
	))) throw new RangeError('The M4 production render requires aligned non-empty Float32 channels.');
	return frameCount;
}
