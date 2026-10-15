/* SPDX-License-Identifier: AGPL-3.0-only */
import { clearPreparedAudioWarpPlayback } from './audio-warp-fallback.ts';
import { disposePlaybackFrequencyOutput } from './playback-frequency-range.ts';
import { ENGINE_CANCEL_SCRUB, ENGINE_DISPOSE_RESOURCES, ENGINE_HALT_GRAPH } from './runtime-symbols.ts';
import type { EngineRuntimeHost } from './runtime-types.ts';

/** Disposal stays terminal to callers while a failed physical close remains retryable. */
export function disposeEngine(engine: EngineRuntimeHost): Promise<void> {
	if (engine.disposePromise) return engine.disposePromise;
	if (!engine.disposed) { engine.disposed = true; engine.lifecycleGeneration += 1; engine.state = 'disposed'; }
	const pending = engine[ENGINE_DISPOSE_RESOURCES]().catch((error: unknown) => {
		if (engine.disposePromise === pending) engine.disposePromise = null;
		throw error;
	});
	engine.disposePromise = pending; return pending;
}

export async function disposeEngineResources(this: EngineRuntimeHost): Promise<void> {
	this[ENGINE_CANCEL_SCRUB](); this[ENGINE_HALT_GRAPH]();
	this.project = null; this.projectGraphSelection = null;
	this.sources.clear(); this.chunkSources.clear();
	this.positionListeners.clear(); this.meterListeners.clear(); this.stateListeners.clear(); this.playbackErrorListeners.clear(); this.parametricEqErrorListeners.clear();
	this.reversedBuffers = new WeakMap(); this.preparedSpeedPlayback = null; clearPreparedAudioWarpPlayback(this);
	this.masterLoudnessMeter?.dispose(); this.masterLoudnessMeter = null;
	this.masterLoudnessMeterChannelCount = null; this.masterLoudnessMeterChannelWeights = null; this.masterLoudnessMeterPromise = null;
	this.latestMasterLoudnessMeter = null; this.masterLoudnessMeterError = null;
	disposePlaybackFrequencyOutput(this); this.playbackOutputNode?.disconnect(); this.playbackOutputNode = null; this.playbackOutputDestination = null;
	const errors: unknown[] = [], context = this.context;
	try { if (context?.state !== 'closed') await context?.close?.(); this.context = null; } catch (error) { errors.push(error); }
	try { await this.chunkStreamClient?.dispose?.(); this.chunkStreamClient = null; } catch (error) { errors.push(error); }
	if (errors.length === 1) throw errors[0];
	if (errors.length) throw new AggregateError(errors, 'Audio engine resource cleanup failed.', { cause: errors[0] });
}
