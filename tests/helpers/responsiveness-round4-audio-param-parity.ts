/* SPDX-License-Identifier: AGPL-3.0-only */

import { stripParameterDescriptor } from '../../src/common/editor/effect-parameter-descriptors.ts';
import type {
	ScheduledParameterRegistry,
	ScheduledParameterScheduleOptions,
} from '../../src/common/editor/engine/scheduled-parameter-registry.ts';

export type AudioParamRegistryFactory = () => Pick<ScheduledParameterRegistry, 'registerAudioParam' | 'registerAudioParamGroup'>;
interface Call { readonly binding: number; readonly kind: string; readonly value?: string; readonly time: string }

/** Float64 bytes retain signed zero, infinity and every arithmetic rounding bit. */
function bits(value: number): string {
	const buffer = new ArrayBuffer(8);
	new DataView(buffer).setFloat64(0, value, true);
	return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function collectAudioParamTimingReceipt(factory: AudioParamRegistryFactory) {
	const cases: Array<{ name: string; calls: Call[]; errors: Array<{ name: string; message: string }> }> = [];
	for (const rate of [1, .1, 1.2, 2.001, Number.MIN_VALUE, Number.MAX_VALUE]) {
		for (const sampleRate of [32_000, 44_100, 48_000, 96_000]) {
			for (const contextSampleRate of [44_100, 48_000]) {
				for (const latencyFrames of [0, 32]) {
					cases.push(run(factory, `${rate}/${sampleRate}/${contextSampleRate}/${latencyFrames}`, {
						fromFrame: 37, contextStartTime: .125, sampleRate, contextSampleRate, transportRate: rate,
					}, latencyFrames));
				}
			}
		}
	}
	for (const failure of ['transform-throws', 'transform-nonfinite', 'param-throws', 'cancel-throws'] as const) {
		cases.push(run(factory, failure, {
			fromFrame: 37, contextStartTime: 1, sampleRate: 48_000, contextSampleRate: 48_000, transportRate: 1,
		}, 32, failure));
	}
	return cases;
}

function run(
	factory: AudioParamRegistryFactory,
	name: string,
	options: ScheduledParameterScheduleOptions,
	latencyFrames: number,
	failure = '',
) {
	const calls: Call[] = [];
	const errors: Array<{ name: string; message: string }> = [];
	let fail = failure;
	const param = (binding: number) => ({
		cancelScheduledValues(time: number) {
			calls.push({ binding, kind: 'cancel', time: bits(time) });
			if (fail === 'cancel-throws' && binding === 1) throw new Error('cancel sentinel');
		},
		setValueAtTime(value: number, time: number) {
			calls.push({ binding, kind: 'set', value: bits(value), time: bits(time) });
			if (fail === 'param-throws' && binding === 1 && value === .5) throw new Error('param sentinel');
		},
		linearRampToValueAtTime(value: number, time: number) {
			calls.push({ binding, kind: 'linear', value: bits(value), time: bits(time) });
		},
	}) as unknown as AudioParam;
	const descriptor = stripParameterDescriptor({ kind: 'strip', strip: { kind: 'track', id: 'track' }, parameterId: 'gain' }, latencyFrames);
	const registry = factory();
	const target = latencyFrames === 0 ? registry.registerAudioParam(descriptor, param(0)) : registry.registerAudioParamGroup(descriptor, [
		{ param: param(0) },
		{ param: param(1), transformValue(value: number) {
			if (value === 1 && fail === 'transform-throws') throw new Error('transform sentinel');
			if (value === 1 && fail === 'transform-nonfinite') return Infinity;
			return value * .5;
		} },
	]);
	const events = [
		{ kind: 'set' as const, frame: 37, value: 0 },
		{ kind: 'set' as const, frame: 38, value: 1 },
		{ kind: 'linear' as const, frame: 9_637, value: 2 },
	];
	const schedule = (window: ScheduledParameterScheduleOptions) => {
		try { target.schedule(events, window); }
		catch (error) {
			if (!(error instanceof Error)) throw error;
			errors.push({ name: error.name, message: error.message });
		}
	};
	schedule(options);
	fail = '';
	// Failed partial writes must not advance the successful-through frontier.
	schedule(options);
	const end = options.contextStartTime + (latencyFrames / options.contextSampleRate
		+ 9_600 / (options.sampleRate * (options.transportRate ?? 1)));
	if (Number.isFinite(end)) {
		const nextStart = end - latencyFrames / options.contextSampleRate;
		schedule({ ...options, contextStartTime: Math.max(0, nextStart) });
		schedule({ ...options, contextStartTime: Math.max(0, nextStart - 1 / options.contextSampleRate) });
	}
	return { name, calls, errors };
}
