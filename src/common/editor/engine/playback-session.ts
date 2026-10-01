/* SPDX-License-Identifier: AGPL-3.0-only */

import { clampFrame } from './buffer-math.ts';
import { ENGINE_ASSERT_ACTIVE, ENGINE_CANCEL_SCRUB, ENGINE_EMIT_POSITION, ENGINE_HALT_GRAPH, ENGINE_SET_STATE } from './runtime-symbols.ts';
import type { EngineRuntimeHost, EngineRuntimeMethodMap } from './runtime-types.ts';

// The scheduler's playbackStartFrame changes on seeks and graph rebuilds.
// The session origin remains the place the user started playback.
const sessionStarts = new WeakMap<EngineRuntimeHost, number>();

export function playbackSessionStart(engine: EngineRuntimeHost): number | undefined {
	return sessionStarts.get(engine);
}

export function restorePlaybackSessionStart(engine: EngineRuntimeHost, frame: number | undefined): void {
	if (frame !== undefined) sessionStarts.set(engine, frame);
}

export function resetPlaybackSession(engine: EngineRuntimeHost): void {
	sessionStarts.delete(engine);
}

export const enginePlaybackSessionMethods = {
	stop() {
		this[ENGINE_ASSERT_ACTIVE]();
		const frame = playbackSessionStart(this) ?? this.getPositionFrames();
		this[ENGINE_CANCEL_SCRUB]();
		this[ENGINE_HALT_GRAPH]();
		this.masterLoudnessMeter?.setRunning(false);
		this.positionFrame = clampFrame(frame, 0, this.playbackDurationFrames);
		this.playRange = null;
		this[ENGINE_SET_STATE](this.project ? 'stopped' : 'empty');
		this[ENGINE_EMIT_POSITION]();
	},
	[ENGINE_SET_STATE](value) {
		if (value === 'playing' && !sessionStarts.has(this)) sessionStarts.set(this, this.playbackStartFrame);
		else if (value !== 'playing' && value !== 'paused') resetPlaybackSession(this);
		if (this.state === value) return;
		this.state = value;
		for (const listener of this.stateListeners) listener(value);
	},
} satisfies EngineRuntimeMethodMap<'stop' | typeof ENGINE_SET_STATE>;
