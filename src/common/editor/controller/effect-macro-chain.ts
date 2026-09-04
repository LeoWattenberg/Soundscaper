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

import { AUDIO_SELECTION_EFFECT_DEFINITIONS } from '../effects.js';
import { createAudioPreviewProject } from '../engine/audio-preview-project.ts';
import { createStableId } from '../project.js';
import { isRealtimeEffectMacroStepType } from '../effect-macro-steps.ts';

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

interface MacroRenderBuffer {
	readonly [property: string]: unknown;
}

interface ChainCopy {
	readonly autoDuckControlTrack: string;
	readonly effectInvalidAudio: string;
	readonly noiseProfileMissing: string;
}

export interface EffectMacroChainRuntime {
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
	readonly runSelectionEffect: (request: Readonly<{
		operation: 'apply';
		effectType: string;
		channels: readonly Float32Array[];
		sampleRate: number;
		params: Readonly<Record<string, unknown>>;
		context: Readonly<Record<string, unknown>>;
	}>) => Promise<Readonly<{ channels: readonly Float32Array[] }>>;
	readonly createAudioBuffer: (channels: readonly Float32Array[]) => Promise<unknown>;
	readonly renderSnapshot: (
		project: unknown,
		range: Readonly<Record<string, unknown>>,
		sourceBuffers: ReadonlyMap<string, unknown>,
	) => Promise<MacroRenderBuffer>;
	readonly audioBufferChannels: (buffer: MacroRenderBuffer) => readonly Float32Array[];
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

/** Whether the whole macro can take the single-render rack path. */
export function effectMacroChainIsRealtime(steps: readonly EffectMacroChainStep[]): boolean {
	return steps.every((step) => isRealtimeEffectMacroStepType(step.type));
}

export function createEffectMacroChainRunner(runtime: EffectMacroChainRuntime) {
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
	): Promise<readonly Float32Array[]> {
		const definition = selectionEffectDefinitions[step.type];
		if (!definition) throw new RangeError(`Unsupported macro effect: ${step.type}.`);
		if (definition.requiresControlTrack) throw new Error(runtime.copy.autoDuckControlTrack);
		const context: Record<string, unknown> = {};
		if (definition.requiresNoiseProfile) {
			const noiseProfile = step.context?.noiseProfile;
			if (!isRecord(noiseProfile)) throw new Error(runtime.copy.noiseProfileMissing);
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
			);
			if (!definition.preRollSeconds) {
				const afterEnd = Math.min(runtime.projectFrameCount(), target.endFrame + contextFrames);
				context.afterChannels = await renderNeighbouringRange(
					target,
					target.endFrame,
					afterEnd,
					channels.length,
				);
			}
		}
		const result = await runtime.runSelectionEffect({
			operation: 'apply',
			effectType: step.type,
			channels,
			sampleRate: runtime.sampleRate,
			params: step.params,
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
	): Promise<readonly Float32Array[]> {
		const frames = channels[0]?.length ?? 0;
		if (!frames) throw new Error(runtime.copy.effectInvalidAudio);
		const buffer = await runtime.createAudioBuffer(channels);
		runtime.assertCurrent();
		const sourceId = createStableId('macro-step-source');
		const clipId = createStableId('macro-step-clip');
		const trackId = createStableId('macro-step-track');
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
			}],
			clips: [{
				id: clipId,
				sourceId,
				title: 'Macro step',
				timelineStartFrame: 0,
				durationFrames: frames,
				sourceStartFrame: 0,
				sourceDurationFrames: frames,
			}],
			tracks: [{
				id: trackId,
				name: 'Macro step',
				clipIds: [clipId],
				effects: steps,
				gain: 1,
				pan: 0,
				mute: false,
				solo: false,
			}],
		});
		const rendered = await runtime.renderSnapshot(project, {
			startFrame: 0,
			endFrame: frames,
			trackId,
			includeMaster: false,
			includeTrackPan: false,
			respectMuteSolo: false,
			outputFrames: frames,
			preRollFrames: 0,
		}, new Map([[sourceId, buffer]]));
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
		let channels = initialChannels;
		for (const segment of segments) {
			if (segment.realtime) {
				channels = await renderRackSegment(segment.steps, channels);
				continue;
			}
			for (const step of segment.steps) channels = await applyOfflineStep(step, channels, target);
		}
		return channels;
	}

	async function renderNeighbouringRange(
		target: EffectMacroChainTarget,
		startFrame: number,
		endFrame: number,
		channelCount: number,
	): Promise<readonly Float32Array[]> {
		if (endFrame <= startFrame) {
			return Array.from({ length: channelCount }, () => new Float32Array(0));
		}
		const rendered = await runtime.renderDryRange(
			target.track.id,
			startFrame,
			endFrame,
			target.channelCount,
			target.clipIds,
		);
		runtime.assertCurrent();
		return runtime.matchSelectionChannels(rendered, channelCount);
	}

	return Object.freeze({ applyOfflineStep, renderRackSegment, runSegments });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
