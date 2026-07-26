/* SPDX-License-Identifier: AGPL-3.0-only */

export const ENGINE_ASSERT_ACTIVE = Symbol('engine.assertActive');
export const ENGINE_CANCEL_SCRUB = Symbol('engine.cancelScrub');
export const ENGINE_DISPOSE_RESOURCES = Symbol('engine.disposeResources');
export const ENGINE_EMIT_METERS = Symbol('engine.emitMeters');
export const ENGINE_EMIT_PARAMETRIC_EQ_ERROR = Symbol('engine.emitParametricEqError');
export const ENGINE_EMIT_POSITION = Symbol('engine.emitPosition');
export const ENGINE_ENSURE_MASTER_LOUDNESS_METER = Symbol('engine.ensureMasterLoudnessMeter');
export const ENGINE_GET_CHUNK_STREAM_CLIENT = Symbol('engine.getChunkStreamClient');
export const ENGINE_GET_CONTEXT = Symbol('engine.getContext');
export const ENGINE_HANDLE_SCHEDULING_ERROR = Symbol('engine.handleSchedulingError');
export const ENGINE_HALT_GRAPH = Symbol('engine.haltGraph');
export const ENGINE_SCHEDULE_CURRENT_PLAYBACK = Symbol('engine.scheduleCurrentPlayback');
export const ENGINE_SCHEDULE_LOOP_AHEAD = Symbol('engine.scheduleLoopAhead');
export const ENGINE_SCHEDULE_PLAYBACK = Symbol('engine.schedulePlayback');
export const ENGINE_SCHEDULE_PREPARED_SPEED_PLAYBACK = Symbol('engine.schedulePreparedSpeedPlayback');
export const ENGINE_SET_STATE = Symbol('engine.setState');
export const ENGINE_START_TICKER = Symbol('engine.startTicker');
export const ENGINE_STOP_TICKER = Symbol('engine.stopTicker');
