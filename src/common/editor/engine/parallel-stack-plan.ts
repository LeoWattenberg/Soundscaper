/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeMixerGraphV21, mixerEndpointKeyV21 } from '../mixer-graph-v21.ts';
import { createMixerSignalTopologyV21 } from '../mixer-signal-topology-v21.ts';
import { resolveTerminalChannelWidths } from '../terminal-channel-widths.ts';
import type { StripRef } from '../parameter-address.ts';
import { compileProjectPathPdcPlanV21 } from './project-path-pdc-plan-v21.ts';
import { activeRackEffects } from './project-effects.ts';
import { compileParallelStackEffectInventory } from './parallel-stack-effect-plan.ts';
import { createParallelStackControlIndex, createParallelStackSidechainResolver, orderParallelStackTasks } from './parallel-stack-planning-index.ts';
import { parallelStackMemoryBytes, validateParallelStackPlan } from './parallel-stack-plan-validation.ts';
import { parallelChannelMatrix } from './parallel-stack-routing.ts';
import type { EngineProject, EngineGainOwner } from './types.ts';
import type { ParallelStackPlan, ParallelStackTask, ParallelStackTrack, ParallelStackTap,
	ParallelStackOutput, ParallelStackEdge } from './parallel-stack-types.ts';

export interface ParallelStackPlanOptions {
	readonly parametricEqWasmModule?: WebAssembly.Module;
	readonly sampleRate: number;
	readonly workerCount: number;
	readonly blockFrames?: number;
	readonly bankCount?: number;
	readonly maximumMemoryBytes?: number;
}
const LIMIT_BYTES = 128 * 1024 ** 2;
const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Whole-graph admission: an unsupported semantic selects the conventional graph. */
export function compileParallelStackPlan(project: EngineProject, options: ParallelStackPlanOptions): ParallelStackPlan {
	const sampleRate = options.sampleRate;
	const blockFrames = options.blockFrames ?? 256;
	const bankCount = options.bankCount ?? 8;
	if (!Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000) throw new Error('Unsupported parallel sample rate.');
	if (blockFrames !== 256 || bankCount !== 8) throw new Error('Unqualified parallel block geometry.');
	if (!Number.isInteger(options.workerCount) || options.workerCount < 1 || options.workerCount > 8) throw new Error('Parallel worker count must be between 1 and 8.');
	if (project.schemaFamily !== 'soundscaper' || project.schemaVersion !== 1) throw new Error('Parallel stacks require the production V21 mixer.');
	if ((project.automationLanes?.length ?? 0) > 0) throw new Error('Parallel timeline automation is not admitted yet.');
	// Same authority as projectHasAuthoredAudioWarp; avoid importing its render graph into this compiler.
	if (project.clips?.some((clip) => clip.warpMap != null)) throw new Error('Parallel authored audio warp is not admitted.');
	const graph = normalizeMixerGraphV21(project.mixer);
	const tracks = (project.tracks ?? []).filter((track) => track.type === 'audio');
	assertStableTrackInputWidths(project);
	const mixerNodes = [...graph.groups, ...graph.sends, ...graph.cues];
	const owners = [...tracks, ...mixerNodes, project.master];
	if (owners.some((owner) => (owner as EngineGainOwner | undefined)?.envelope?.length)) throw new Error('Parallel gain envelope automation is not admitted yet.');
	const adm = project.metadata?.adm;
	if (adm && typeof adm === 'object' && 'mode' in adm && ['authored', 'passthrough'].includes(String(adm.mode))) throw new Error('Parallel ADM routing is not admitted.');
	const widths = resolveTerminalChannelWidths(project, project.masterChannels).tracks;
	const pdc = compileProjectPathPdcPlanV21(project, { sampleRate });
	const workerCount = Math.min(options.workerCount, Math.max(1, owners.length));
	const solos = new Set<string>();
	for (const track of tracks) if (track.solo) solos.add(`track:${String(track.id)}`);
	for (const strip of mixerNodes) if (strip.solo) solos.add(`mixer-node:${strip.id}`);
	const topology = createMixerSignalTopologyV21(graph, { includeOutputs: false });
	const audible = (key: string): boolean => {
		if (!solos.size) return true;
		for (const solo of solos) if (topology.reaches(key, solo) || topology.reaches(solo, key)) return true;
		return false;
	};
	const controls = createParallelStackControlIndex(graph);
	const sidechainEffect = createParallelStackSidechainResolver();
	let planeCount = 0;
	const reserve = (channels: number) => Array.from({ length: channels }, () => planeCount++);
	const tasks: ParallelStackTask[] = [];
	const trackPlans: ParallelStackTrack[] = [];
	const stripTaps: ParallelStackTap[] = [];
	const outputs: ParallelStackOutput[] = [];
	const keys = new Map<string, number>();
	const addStack = (ref: StripRef, owner: EngineGainOwner, channels: number): void => {
		const key = mixerEndpointKeyV21(ref);
		const inputPlanes = ref.kind === 'track' ? reserve(channels) : [];
		const prePlanes = reserve(channels);
		const postPlanes = reserve(channels <= 2 ? 2 : channels);
		const { effects, hasParametricEq, latencyFrames } = compileParallelStackEffectInventory(activeRackEffects(owner), sampleRate, channels);
		if (hasParametricEq && !(options.parametricEqWasmModule instanceof WebAssembly.Module)) {
			throw new Error('Parallel parametric EQ requires its precompiled WASM module.');
		}
		if (latencyFrames !== (pdc.nodeOutputLatencyFrames.get(key) ?? 0) - (pdc.nodeInputLatencyFrames.get(key) ?? 0)) {
			throw new Error('Parallel effect latency disagrees with the production PDC plan.');
		}
		keys.set(key, tasks.length);
		tasks.push({ kind: 'stack', key, worker: 0, dependencies: [], channels, inputPlanes, prePlanes, postPlanes,
			inputDelayFrames: inputPlanes.length ? pdc.nodeInputLatencyFrames.get(key) ?? 0 : 0,
			effects, edges: [], gain: finite(owner.gain, 1), pan: Math.max(-1, Math.min(1, finite(owner.pan, 0))),
			gate: !owner.mute && audible(key) ? 1 : 0, vca: controls.vcaGain(key), outputDelayFrames: 0 });
		const scope = controls.scope(ref);
		stripTaps.push({ key, ref, scope, planes: postPlanes, channels: postPlanes.length });
		if (ref.kind === 'track') trackPlans.push({ id: ref.id, channels, inputPlanes, prePlanes, postPlanes });
	};
	for (const track of tracks) {
		if (typeof track.id !== 'string') throw new Error('Parallel track ID must be a string.');
		addStack({ kind: 'track', id: track.id }, track, widths.get(track.id) ?? 2);
	}
	for (const strip of mixerNodes) addStack({ kind: 'mixer-node', id: strip.id }, strip, strip.channelCount);
	addStack({ kind: 'master' }, project.master ?? {}, Math.max(1, Math.min(32, Math.trunc(project.masterChannels ?? 2))));
	for (const output of graph.outputs) {
		const planes = reserve(output.channelCount);
		const key = `output:${output.id}`;
		keys.set(key, tasks.length);
		tasks.push({ kind: 'output', key, worker: 0, dependencies: [], channels: output.channelCount,
			inputPlanes: [], prePlanes: [], postPlanes: planes, inputDelayFrames: 0, effects: [], edges: [], gain: 1, pan: 0, gate: 1, vca: 1,
			outputDelayFrames: pdc.latencyFrames - (pdc.outputLatencyFrames.get(output.id) ?? 0) });
		outputs.push({ id: output.id, role: output.role, channels: output.channelCount, planes });
	}
	if (tasks.length > 256 || planeCount > 4096) throw new Error('Parallel graph exceeds task or channel-plane limits.');
	const incoming = tasks.map(() => [] as ParallelStackEdge[]);
	for (const edge of graph.edges) {
		if (!edge.enabled) continue;
		const sourceTask = keys.get(mixerEndpointKeyV21(edge.source))!;
		const destinationKey = edge.destination.kind === 'effect-sidechain'
			? mixerEndpointKeyV21(edge.destination.strip) : mixerEndpointKeyV21(edge.destination);
		const destinationTask = keys.get(destinationKey)!;
		const source = tasks[sourceTask]!;
		const destination = tasks[destinationTask]!;
		const sourcePlanes = edge.position === 'pre-fader' ? source.prePlanes : source.postPlanes;
		const sidechainEffectId = edge.destination.kind === 'effect-sidechain' ? edge.destination.effectId : null;
		if (sidechainEffectId !== null) {
			const effect = sidechainEffect(destination, sidechainEffectId);
			if (effect && !['limiter', 'gate'].includes(effect.type)) throw new Error(`Parallel effect ${effect.type} cannot consume sidechains.`);
		}
		incoming[destinationTask]!.push({ id: edge.id, sourceTask, sourcePlanes,
			matrix: parallelChannelMatrix(edge, sourcePlanes.length, source.channels, destination.channels),
			delayFrames: pdc.edgeCompensationFrames.get(edge.id) ?? 0, level: edge.level, sidechainEffectId });
	}
	const connected = tasks.map((task, index) => ({ ...task, edges: incoming[index]!,
		dependencies: [...new Set(incoming[index]!.map(({ sourceTask }) => sourceTask))] }));
	const ordered = orderParallelStackTasks(connected, workerCount);
	const memoryBytes = parallelStackMemoryBytes(ordered, planeCount, blockFrames, bankCount, workerCount);
	const limit = Math.min(options.maximumMemoryBytes ?? LIMIT_BYTES, LIMIT_BYTES);
	if (!Number.isSafeInteger(memoryBytes) || memoryBytes > limit) throw new Error('Parallel graph exceeds the total memory limit.');
	const result: ParallelStackPlan = { version: 1, sampleRate, blockFrames, bankCount, workerCount, planeCount, tasks: ordered,
		taskOrder: ordered.map((_, index) => index), tracks: trackPlans, stripTaps, outputs,
		inputPlaneIndices: trackPlans.map(({ inputPlanes }) => inputPlanes), outputPlaneIndices: outputs.map(({ planes }) => planes),
		latencyFrames: pdc.latencyFrames, memoryBytes };
	validateParallelStackPlan(result);
	return result;
}

/** Fixed ingress width changes mono panner behavior when another clip on the track is stereo. */
function assertStableTrackInputWidths(project: EngineProject): void {
	const sourceWidths = new Map<string, number>();
	for (const source of project.sources ?? []) {
		const width = source.channelCount;
		if (source.id != null && typeof width === 'number' && Number.isSafeInteger(width) && width >= 1) {
			sourceWidths.set(String(source.id), Math.min(32, width));
		}
	}
	const clipSources = new Map<string, string>();
	for (const clip of project.clips ?? []) if (clip.id != null && clip.sourceId != null) {
		clipSources.set(String(clip.id), String(clip.sourceId));
	}
	for (const track of project.tracks ?? []) {
		if (track.type !== 'audio') continue;
		if (!Array.isArray(track.clipIds) && Array.isArray(track.clips) && track.clips.length > 0) {
			throw new Error('Parallel stacks require canonical clip IDs to resolve channel widths.');
		}
		let width = 0;
		for (const clipId of track.clipIds ?? []) {
			const sourceId = clipSources.get(String(clipId));
			const next = sourceId === undefined ? undefined : sourceWidths.get(sourceId);
			if (next === undefined) throw new Error('Parallel stacks require a known clip channel width.');
			if (width !== 0 && next !== width) throw new Error('Parallel stacks do not admit mixed clip channel widths on one track.');
			width = next;
		}
	}
}
