/* SPDX-License-Identifier: AGPL-3.0-only */

import { engineAutomationControlMethods } from './automation-control-v21.ts';
import { engineEffectControlMethods } from './effect-control.ts';
import { engineLifecycleMethods } from './lifecycle.ts';
import { installEngineMethodMaps } from './method-installer.ts';
import { engineRenderingMethods } from './rendering.ts';
import { engineNativeEffectPdcControlMethods } from './native-effect-pdc-control.ts';
import { enginePlaybackOutputMethods } from './playback-output.ts';
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
	'play',
	'playAtSpeed',
	'playAt',
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
	'getPositionFrames',
	'sampleRate',
	'getState',
	'commitNativeEffectPdcRevision',
	'subscribePosition',
	'subscribeMeters',
	'subscribeState',
	'subscribeParametricEqErrors',
	'previewScheduledParameter',
	'configureRackEffect',
	'configureParametricEq',
	'auditionParametricEq',
	'resetParametricEq',
	'readParametricEqSpectrum',
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
		engineTransportControlMethods,
		engineTransportAccessors,
		engineAutomationControlMethods,
		engineEffectControlMethods,
		engineNativeEffectPdcControlMethods,
		engineRenderingMethods,
		engineTransportSchedulerMethods,
	]);
}
