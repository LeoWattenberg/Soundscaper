/* SPDX-License-Identifier: AGPL-3.0-only */

import { stripParameterDescriptor } from '../effect-parameter-descriptors.ts';
import type { StripRef } from '../parameter-address.ts';
import type { ScheduledGainParam } from './project-graph.ts';
import type { ScheduledParameterRegistry } from './scheduled-parameter-registry.ts';

export function registerStripParam(
	registry: ScheduledParameterRegistry,
	strip: StripRef,
	parameterId: 'gain' | 'pan' | 'mute',
	param: AudioParam,
	latencyFrames: number,
	transformValue?: (value: number) => number,
	active = true,
): void {
	const descriptor = stripParameterDescriptor({ kind: 'strip', strip, parameterId }, latencyFrames);
	if (!active) {
		registry.registerSuspendedParameter(descriptor);
		return;
	}
	if (!isSchedulableAudioParam(param)) return;
	registry.registerAudioParam(
		descriptor,
		param,
		transformValue ? { latencyFrames, transformValue } : { latencyFrames },
	);
}

export function registerEdgeParam(
	registry: ScheduledParameterRegistry,
	edgeId: string,
	param: AudioParam,
	latencyFrames: number,
): void {
	if (!isSchedulableAudioParam(param)) return;
	registry.registerAudioParam(
		stripParameterDescriptor({ kind: 'edge', edgeId, parameterId: 'level' }, latencyFrames),
		param,
		{ latencyFrames },
	);
}

export function trackMasterGain(
	strips: readonly Readonly<{ key: string }>[],
	registry: ScheduledParameterRegistry,
): ScheduledGainParam | null {
	if (!strips.some(({ key }) => key === 'master')) return null;
	const target = registry.get({ kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' });
	if (!target || target.binding.kind !== 'audio-param') return null;
	return { param: target.binding.params[0]!.param, latencyFrames: target.latencyFrames };
}

function isSchedulableAudioParam(param: AudioParam | null | undefined): param is AudioParam {
	return typeof param?.setValueAtTime === 'function'
		&& typeof param.linearRampToValueAtTime === 'function';
}
