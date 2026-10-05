/* SPDX-License-Identifier: AGPL-3.0-only */

import { engineAutomationControlMethods } from './automation-control-v21.ts';
import { engineCutPreviewMethods } from './cut-preview.ts';
import { engineEffectControlMethods } from './effect-control.ts';
import { engineLifecycleMethods } from './lifecycle.ts';
import { engineLiveAnalysisLeaseMethods } from './live-analysis-lease.ts';
import { installEngineMethodMaps } from './method-installer.ts';
import { engineRenderingMethods } from './rendering.ts';
import { engineNativeEffectPdcControlMethods } from './native-effect-pdc-control.ts';
import { enginePlaybackOutputMethods } from './playback-output.ts';
import { enginePlaybackFrequencyMethods } from './playback-frequency-range.ts';
import { enginePlaybackGraphLatencyMethods } from './playback-graph-latency.ts';
import { enginePlaybackFailureMethods } from './playback-stream-failure.ts';
import { enginePlaybackSessionMethods } from './playback-session.ts';
import {
	engineTransportAccessors,
	engineTransportControlMethods,
} from './transport-control.ts';
import { engineTransportSchedulerMethods } from './transport-scheduler.ts';
import type { EnginePublicApi } from './public-api.ts';

type Assert<T extends true> = T;

export const ENGINE_PUBLIC_METHOD_NAMES = [
	'loadProject',
	'applyProject',
	'setSourceResolver',
	'setChunkSources',
	'getAudioWarpRenderStatus',
	'decodeAudioData',
	'getAudioContext',
	'setOutputDevice',
	'getOutputDeviceState',
	'setPlaybackGain',
	'getPlaybackGain',
	'setPlaybackFrequencyRange',
	'play',
	'playCutPreview',
	'playAtSpeed',
	'playAt',
	'getPlaybackGraphLatencyFrames',
	'getPlaybackAudibleStartTime',
	'pause',
	'stop',
	'seek',
	'pauseLoudnessMeasurement',
	'continueLoudnessMeasurement',
	'resetLoudnessMeasurement',
	'getLoudnessMeasurementState',
	'scrub',
	'endScrub',
	'setLoop',
	'setPlayRange',
	'getPositionFrames',
	'sampleRate',
	'getState',
	'commitNativeEffectPdcRevision',
	'subscribePosition',
	'subscribeMeters',
	'acquireLiveAnalysis',
	'subscribeState',
	'subscribePlaybackErrors',
	'subscribeParametricEqErrors',
	'previewScheduledParameter',
	'configureRackEffect',
	'configureParametricEq',
	'auditionParametricEq',
	'resetParametricEq',
	'readParametricEqSpectrum',
	'readDynamicsAnalysis',
	'createParametricEqPreview',
	'renderMix',
	'renderMixRealtime',
	'renderMixToSink',
	'renderTrack',
	'renderTrackToSink',
	'dispose',
] as const satisfies readonly (keyof EnginePublicApi)[];

export type EnginePublicRegistryIsComplete = Assert<
	keyof EnginePublicApi extends typeof ENGINE_PUBLIC_METHOD_NAMES[number] ? true : false
>;

export function installEngineRuntimeMethods(target: object): void {
	installEngineMethodMaps(target, [
		engineLifecycleMethods,
		enginePlaybackOutputMethods,
		enginePlaybackFrequencyMethods,
		enginePlaybackGraphLatencyMethods,
		enginePlaybackFailureMethods,
		engineTransportControlMethods,
		enginePlaybackSessionMethods,
		engineLiveAnalysisLeaseMethods,
		engineCutPreviewMethods,
		engineTransportAccessors,
		engineAutomationControlMethods,
		engineEffectControlMethods,
		engineNativeEffectPdcControlMethods,
		engineRenderingMethods,
		engineTransportSchedulerMethods,
	]);
}
