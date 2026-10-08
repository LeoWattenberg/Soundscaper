/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * How a macro runs when its steps are not all realtime.
 *
 * Audacity applies a macro one command at a time to the selection, and most of
 * its effects have no realtime form at all. Soundscaper's rack render stays the
 * fast path for a chain that is entirely realtime; anything else is split into
 * runs here — consecutive realtime steps render together through one rack, and
 * every other step is applied on its own exactly as the effect menu applies it.
 */

import { createLocalizedError } from '../../../../../i18n/presentation-message.ts'; import { AUDIO_SELECTION_EFFECT_DEFINITIONS } from '../../../../effects.js';
import { createAudioPreviewProject } from '../../../../engine/audio-preview-project.ts';
import { defaultMixerChannelMapV21, type MixerGraphV21 } from '../../../../mixer-graph-v21.ts';
import { createStableId } from '../../../../project.js';
import { isRealtimeEffectMacroStepType } from '../../../../effect-macro-steps.ts';
import { runOfflineSelectionSegment, type RunOfflineSelectionChain } from './offline-selection-chain.ts';
import { createMacroNeighbourPcmCache, type MacroNeighbourPcmCache } from './macro-neighbour-pcm-cache.ts';
import { independentTrackEffectParams } from '../independent-track-effect-params.ts';

const selectionEffectDefinitions = AUDIO_SELECTION_EFFECT_DEFINITIONS as unknown as
	Readonly<Record<string, SelectionEffectDefinition | undefined>>;

const REPAIR_CONTEXT_FRAMES = 128;
const STAFF_PAD_SECONDS = 1;

export interface EffectMacroChainStep extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type: string;
	readonly params: Readonly<Record<string, unknown>>;
	readonly context?: Readonly<Record<string, unknown>> | null;
}

export interface EffectMacroChainSegment {
	readonly realtime: boolean;
	readonly steps: readonly EffectMacroChainStep[];
}

export interface EffectMacroChainTarget {
	readonly track: Readonly<{ id: string }>;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly channelCount: number;
	readonly clipIds?: readonly string[];
}

interface SelectionEffectDefinition {
	readonly preRollSeconds?: number;
	readonly requiresContext?: boolean;
	readonly requiresControlTrack?: boolean;
	readonly requiresNoiseProfile?: boolean;
	readonly requiresStaffPad?: boolean;
}

/** The default rendered-buffer shape; the chain only hands it to `audioBufferChannels`. */
export interface MacroRenderBuffer {
	readonly [property: string]: unknown;
}

interface ChainCopy {
	readonly autoDuckControlTrack: string;
	readonly effectInvalidAudio: string;
	readonly noiseProfileMissing: string;
}

export interface EffectMacroChainRuntime<Buffer = MacroRenderBuffer> {
	readonly contextCacheBytes?: number;
	/** Opt-in private worker port guarantees the canonical per-step channel match. */
	readonly runSelectionEffectChain?: RunOfflineSelectionChain;
	readonly copy: ChainCopy;
	readonly sampleRate: number;
	readonly assertCurrent: () => void;
	readonly projectFrameCount: () => number;
	readonly renderDryRange: (
		trackId: string,
		startFrame: number,
		endFrame: number,
		channelCount: number,
		clipIds?: readonly string[],
	) => Promise<readonly Float32Array[]>;
	readonly renderControlTrackRange?: (
		trackId: string, target: EffectMacroChainTarget,
	) => Promise<readonly Float32Array[]>;
	readonly runSelectionEffect: (request: Readonly<{
		operation: 'apply';
		effectType: string;
		channels: readonly Float32Array[];
		sampleRate: number;
		params: Readonly<Record<string, unknown>>;
		context: Readonly<Record<string, unknown>>;
	}>) => Promise<Readonly<{ channels: readonly Float32Array[] }>>;
	readonly createAudioBuffer: (channels: readonly Float32Array[], sampleRate: number) => Promise<unknown>;
	readonly renderSnapshot: (
		project: unknown,
		range: Readonly<Record<string, unknown>>,
		sourceBuffers: ReadonlyMap<string, unknown>,
	) => Promise<Buffer>;
	readonly audioBufferChannels: (buffer: Buffer) => readonly Float32Array[];
	readonly matchSelectionChannels: (
		channels: readonly Float32Array[],
		channelCount: number,
	) => Float32Array[];
}

/**
 * Group a macro into the runs that share one execution. A run of realtime
 * steps renders through a single rack so the chain sounds as it would during
 * playback, instead of being flattened step by step.
 */
export function planEffectMacroChain(
	steps: readonly EffectMacroChainStep[],
): readonly EffectMacroChainSegment[] {
	const segments: Array<{ realtime: boolean; steps: EffectMacroChainStep[] }> = [];
	for (const step of steps) {
		const realtime = isRealtimeEffectMacroStepType(step.type);
		const open = segments.at(-1);
		if (open && open.realtime === realtime) open.steps.push(step);
		else segments.push({ realtime, steps: [step] });
	}
	return Object.freeze(segments.map((segment) => Object.freeze({
		realtime: segment.realtime,
		steps: Object.freeze(segment.steps),
	})));
}

export function createEffectMacroChainRunner<Buffer = MacroRenderBuffer>(runtime: EffectMacroChainRuntime<Buffer>) {
	/**
	 * Apply one offline step to the audio the chain currently holds. The audio
	 * around the selection still comes from the project: a later step replaces
	 * the selection in place, so what neighbours it never moves, and the effects
	 * that read across the boundary — Repair, and the pitch and tempo stretches
	 * — need it to avoid an edge artefact.
	 */
	async function applyOfflineStep(
		step: EffectMacroChainStep,
		channels: readonly Float32Array[],
		target: EffectMacroChainTarget,
		cache?: MacroNeighbourPcmCache,
	): Promise<readonly Float32Array[]> {
		const definition = selectionEffectDefinitions[step.type];
		if (!definition) throw new RangeError(`Unsupported macro effect: ${step.type}.`);
		if (definition.requiresControlTrack) throw createLocalizedError(Error, runtime.copy, 'autoDuckControlTrack');
		const context: Record<string, unknown> = {};
		if (definition.requiresNoiseProfile) {
			const noiseProfile = step.context?.noiseProfile;
			if (!isRecord(noiseProfile)) throw createLocalizedError(Error, runtime.copy, 'noiseProfileMissing');
			context.noiseProfile = noiseProfile;
		}
		const contextFrames = definition.preRollSeconds
			? Math.ceil(definition.preRollSeconds * runtime.sampleRate)
			: definition.requiresStaffPad
			? Math.ceil(STAFF_PAD_SECONDS * runtime.sampleRate)
			: definition.requiresContext ? REPAIR_CONTEXT_FRAMES : 0;
		if (contextFrames > 0) {
			context.beforeChannels = await renderNeighbouringRange(
				target,
				Math.max(0, target.startFrame - contextFrames),
				target.startFrame,
				channels.length,
				cache,
			);
			if (!definition.preRollSeconds) {
				const afterEnd = Math.min(runtime.projectFrameCount(), target.endFrame + contextFrames);
				context.afterChannels = await renderNeighbouringRange(
					target,
					target.endFrame,
					afterEnd,
					channels.length,
					cache,
				);
			}
		}
		const result = await runtime.runSelectionEffect({
			operation: 'apply',
			effectType: step.type,
			channels,
			sampleRate: runtime.sampleRate,
			params: independentTrackEffectParams(step.type, step.params),
			context,
		});
		runtime.assertCurrent();
		return runtime.matchSelectionChannels(result.channels, channels.length);
	}

	/**
	 * Render a run of realtime steps over audio the chain already holds. The
	 * rack has no timeline to read from once an offline step has rewritten the
	 * selection, so the audio is staged as a one-clip render project instead.
	 */
	async function renderRackSegment(
		steps: readonly EffectMacroChainStep[],
		channels: readonly Float32Array[],
		target: EffectMacroChainTarget,
	): Promise<readonly Float32Array[]> {
		const frames = channels[0]?.length ?? 0;
		if (!frames) throw createLocalizedError(Error, runtime.copy, 'effectInvalidAudio');
		const buffer = await runtime.createAudioBuffer(channels, runtime.sampleRate);
		runtime.assertCurrent();
		const sourceId = createStableId('macro-step-source');
		const clipId = createStableId('macro-step-clip');
		const trackId = createStableId('macro-step-track');
		const controlSources: Record<string, unknown>[] = [];
		const controlClips: Record<string, unknown>[] = [];
		const controlTracks: Record<string, unknown>[] = [];
		const controlWidths = new Map<string, number>();
		const sourceBuffers = new Map([[sourceId, buffer]]);
		const controlIds = new Set(steps.filter(step => step.type === 'audacity-auto-duck')
			.map(step => step.context?.controlTrackId).filter((id): id is string => typeof id === 'string' && Boolean(id)));
		for (const controlTrackId of controlIds) {
			const controlTarget = { ...target, endFrame: target.startFrame + frames };
			const control = runtime.renderControlTrackRange
				? await runtime.renderControlTrackRange(controlTrackId, controlTarget)
				: await runtime.renderDryRange(controlTrackId, controlTarget.startFrame, controlTarget.endFrame, 1);
			runtime.assertCurrent();
			const controlBuffer = await runtime.createAudioBuffer(control, runtime.sampleRate);
			runtime.assertCurrent();
			const controlSourceId = createStableId('macro-control-source');
			const controlClipId = createStableId('macro-control-clip');
			sourceBuffers.set(controlSourceId, controlBuffer);
			controlWidths.set(controlTrackId, control.length);
			controlSources.push({ id: controlSourceId, name: 'Macro control', storageKey: controlSourceId,
				frameCount: frames, channelCount: control.length, sampleRate: runtime.sampleRate });
			controlClips.push({ id: controlClipId, sourceId: controlSourceId, timelineStartFrame: 0,
				durationFrames: frames, sourceStartFrame: 0, sourceDurationFrames: frames });
			controlTracks.push({ id: controlTrackId, name: 'Macro control', clipIds: [controlClipId],
				effects: [], gain: 1, pan: 0, mute: false, solo: false });
		}
		const project = createAudioPreviewProject({
			title: 'Macro step',
			sampleRate: runtime.sampleRate,
			masterChannels: channels.length,
			sources: [{
				id: sourceId,
				name: 'Macro step',
				storageKey: sourceId,
				frameCount: frames,
				channelCount: channels.length,
				sampleRate: runtime.sampleRate,
			}, ...controlSources],
			clips: [{
				id: clipId,
				sourceId,
				title: 'Macro step',
				timelineStartFrame: 0,
				durationFrames: frames,
				sourceStartFrame: 0,
				sourceDurationFrames: frames,
			}, ...controlClips],
			tracks: [{
				id: trackId,
				name: 'Macro step',
				clipIds: [clipId],
				effects: steps,
				gain: 1,
				pan: 0,
				mute: false,
				solo: false,
			}, ...controlTracks],
		});
		const mixer = project.mixer as MixerGraphV21;
		const sidechainEdges = steps.filter(step => step.type === 'audacity-auto-duck').map(step => ({
			id: createStableId('macro-control-edge'), kind: 'sidechain' as const,
			source: { kind: 'track' as const, id: String(step.context?.controlTrackId) },
			destination: { kind: 'effect-sidechain' as const, strip: { kind: 'track' as const, id: trackId }, effectId: step.id },
			position: 'pre-fader' as const, level: 1, enabled: true,
			channelMap: defaultMixerChannelMapV21(controlWidths.get(String(step.context?.controlTrackId)) ?? 1, channels.length),
		}));
		const staged = { ...project, mixer: { ...mixer, edges: [...mixer.edges.filter(edge => (
			edge.source.kind !== 'track' || !controlIds.has(edge.source.id) || edge.kind === 'sidechain'
		)), ...sidechainEdges] } };
		const rendered = await runtime.renderSnapshot(staged, {
			startFrame: 0,
			endFrame: frames,
			trackId,
			includeMaster: false,
			includeTrackPan: false,
			respectMuteSolo: false,
			outputFrames: frames,
			preRollFrames: 0,
		}, sourceBuffers);
		runtime.assertCurrent();
		return runtime.matchSelectionChannels(
			runtime.audioBufferChannels(rendered),
			channels.length,
		);
	}

	/** Run every segment after the one the caller has already rendered. */
	async function runSegments(
		segments: readonly EffectMacroChainSegment[],
		initialChannels: readonly Float32Array[],
		target: EffectMacroChainTarget,
	): Promise<readonly Float32Array[]> {
		const cache = createMacroNeighbourPcmCache(runtime.contextCacheBytes ?? 0);
		let channels = initialChannels;
		for (const segment of segments) {
			if (segment.realtime) {
				channels = await renderRackSegment(segment.steps, channels, target);
				continue;
			}
			const steps = segment.steps.map(step => ({ ...step,
				params: independentTrackEffectParams(step.type, step.params) }));
			channels = await runOfflineSelectionSegment(steps, channels,
				(step, current) => applyOfflineStep(step, current, target, cache), runtime.sampleRate, runtime.assertCurrent, runtime.runSelectionEffectChain);
		}
		return channels;
	}

	async function renderNeighbouringRange(
		target: EffectMacroChainTarget,
		startFrame: number,
		endFrame: number,
		channelCount: number,
		cache?: MacroNeighbourPcmCache,
	): Promise<readonly Float32Array[]> {
		runtime.assertCurrent();
		if (endFrame <= startFrame) {
			return Array.from({ length: channelCount }, () => new Float32Array(0));
		}
		const key = JSON.stringify([target.track.id, startFrame, endFrame, target.channelCount, channelCount, target.clipIds ?? null]);
		const retained = cache?.get(key);
		if (retained) return retained;
		const rendered = await runtime.renderDryRange(
			target.track.id,
			startFrame,
			endFrame,
			target.channelCount,
			target.clipIds,
		);
		runtime.assertCurrent();
		const channels = runtime.matchSelectionChannels(rendered, channelCount);
		cache?.retain(key, channels);
		return channels;
	}

	return Object.freeze({ applyOfflineStep, renderRackSegment, runSegments });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
