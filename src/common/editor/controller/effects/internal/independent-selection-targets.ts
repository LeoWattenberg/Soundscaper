/* SPDX-License-Identifier: AGPL-3.0-only */
import type { SelectionEffectWorkerContext, SelectionEffectWorkerRequest, SelectionEffectWorkerResult, EffectWorkerRunOptions } from './selection-effect-worker-service.ts';
import type { IndependentSelectionEffectOptions } from './bounded-selection-effect-workers.ts';

interface Target {
	readonly track: Readonly<{ id: string }>;
	readonly startFrame: number; readonly endFrame: number; readonly channelCount: number;
	readonly sourceFrameCount?: number; readonly clipIds?: readonly string[];
}
interface Definition { readonly requiresControlTrack?: boolean; readonly requiresNoiseProfile?: boolean }
interface DryResult<TargetValue extends Target> {
	readonly target: TargetValue; readonly channels: Float32Array[];
	readonly neighbourContext?: SelectionEffectWorkerContext;
}
export interface IndependentSelectionPorts {
	readonly runSelectionEffectWorker: (request: SelectionEffectWorkerRequest, options: EffectWorkerRunOptions) => Promise<SelectionEffectWorkerResult>;
	readonly runIndependentSelectionEffects?: (requests: readonly SelectionEffectWorkerRequest[], options: IndependentSelectionEffectOptions) => Promise<SelectionEffectWorkerResult[]>;
}

/** Prepare original-project context in target order; only admitted independent jobs share two lanes. */
export async function processIndependentSelectionTargets<TargetValue extends Target>(options: IndependentSelectionPorts & Readonly<{
	dryResults: readonly DryResult<TargetValue>[]; effectType: string; sampleRate: number; params: Readonly<Record<string, unknown>>;
	definition: Definition; spectralSelections: ReadonlyMap<string, unknown>; controlChannels: Float32Array[] | null;
	controlTrackId: string; noiseProfile: unknown; contextFrames: number; afterContextFrames: number;
	projectFrameCount: () => number; assertCurrent: () => void;
	renderDryRange(trackId: string, startFrame: number, endFrame: number, channelCount?: number, clipIds?: readonly string[]): Promise<Float32Array[]>;
}>): Promise<Array<Readonly<{ target: TargetValue; channels: Float32Array[] | undefined }>>> {
	async function prepare({ target, channels, neighbourContext }: DryResult<TargetValue>): Promise<SelectionEffectWorkerRequest> {
		options.assertCurrent();
		const context: Record<string, unknown> = {};
		const spectral = options.spectralSelections.get(target.track.id); if (spectral) context.spectralSelection = spectral;
		if (options.definition.requiresControlTrack) context.controlChannels = options.controlChannels || await options.renderDryRange(options.controlTrackId, target.startFrame, target.endFrame);
		if (options.definition.requiresNoiseProfile) context.noiseProfile = options.noiseProfile;
		if (neighbourContext) Object.assign(context, neighbourContext);
		else if (options.contextFrames > 0) {
			const beforeStart = Math.max(0, target.startFrame - options.contextFrames);
			context.beforeChannels = beforeStart < target.startFrame
				? await options.renderDryRange(target.track.id, beforeStart, target.startFrame, target.channelCount, target.clipIds)
				: channels.map(() => new Float32Array(0));
			if (options.afterContextFrames > 0) {
				const afterEnd = Math.min(target.sourceFrameCount ?? options.projectFrameCount(), target.endFrame + options.afterContextFrames);
				context.afterChannels = target.endFrame < afterEnd
					? await options.renderDryRange(target.track.id, target.endFrame, afterEnd, target.channelCount, target.clipIds)
					: channels.map(() => new Float32Array(0));
			}
		}
		options.assertCurrent();
		return { operation: 'apply', effectType: options.effectType, channels, sampleRate: options.sampleRate, params: options.params, context };
	}
	const output: Array<Readonly<{ target: TargetValue; channels: Float32Array[] | undefined }>> = [];
	if (options.runIndependentSelectionEffects && options.dryResults.length > 1) {
		const requests: SelectionEffectWorkerRequest[] = [];
		for (const dry of options.dryResults) requests.push(await prepare(dry));
		const results = await options.runIndependentSelectionEffects(requests, { pcmOwnership: 'transfer', assertCurrent: options.assertCurrent });
		options.assertCurrent();
		for (const [index, dry] of options.dryResults.entries()) output.push({ target: dry.target, channels: results[index]?.channels });
	} else {
		for (const dry of options.dryResults) {
			const result = await options.runSelectionEffectWorker(await prepare(dry), { pcmOwnership: 'transfer' });
			options.assertCurrent(); output.push({ target: dry.target, channels: result.channels });
		}
	}
	return output;
}
