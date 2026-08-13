/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	canonicalParameterAddressKey,
	normalizeParameterAddress,
	type ParameterAddress,
	type ParameterDescriptor,
} from '../parameter-address.ts';

export const STALE_SCHEDULED_PARAMETER_TARGET_CODE = 'STALE_SCHEDULED_PARAMETER_TARGET' as const;

export class StaleScheduledParameterTargetError extends Error {
	readonly code = STALE_SCHEDULED_PARAMETER_TARGET_CODE;

	constructor() {
		super('The scheduled parameter target no longer belongs to the active audio graph.');
		this.name = 'StaleScheduledParameterTargetError';
	}
}

export class ScheduledParameterMessageRejectedError extends Error {
	constructor() {
		super('The scheduled parameter message was rejected as stale.');
		this.name = 'ScheduledParameterMessageRejectedError';
	}
}

export type ScheduledParameterEvent = Readonly<{
	kind: 'set' | 'linear';
	frame: number;
	value: number;
}>;

export interface ScheduledParameterScheduleOptions {
	readonly fromFrame: number;
	readonly contextStartTime: number;
	readonly sampleRate: number;
	readonly contextSampleRate: number;
	readonly transportRate?: number;
}

export interface ScheduledParameterMessageEvent {
	readonly kind: 'set' | 'linear';
	readonly frameOffset: number;
	readonly value: number;
}

export interface ScheduledParameterMessage {
	readonly type: 'schedule-parameter-v1';
	readonly revision: number;
	readonly address: ParameterAddress;
	readonly fromFrame: number;
	readonly contextStartTime: number;
	readonly sampleRate: number;
	readonly contextSampleRate: number;
	readonly transportRate: number;
	readonly events: readonly ScheduledParameterMessageEvent[];
}

export type ScheduledParameterMessageReceiver = (
	message: ScheduledParameterMessage,
) => boolean | void;

export type ScheduledParameterBinding =
	| Readonly<{
		kind: 'audio-param';
		param: AudioParam;
		transformValue: (value: number) => number;
	}>
	| Readonly<{ kind: 'message'; receive: ScheduledParameterMessageReceiver }>;

export interface ScheduledParameterTargetOptions {
	readonly latencyFrames?: number;
	readonly transformValue?: (value: number) => number;
}

export interface ScheduledParameterTarget {
	readonly descriptor: ParameterDescriptor;
	readonly binding: ScheduledParameterBinding;
	readonly latencyFrames: number;
	schedule(
		events: readonly ScheduledParameterEvent[],
		options: ScheduledParameterScheduleOptions,
	): void;
}

class RegisteredScheduledParameterTarget implements ScheduledParameterTarget {
	readonly descriptor: ParameterDescriptor;
	readonly binding: ScheduledParameterBinding;
	readonly latencyFrames: number;
	#registry: ScheduledParameterRegistry;
	#key: string;
	#revision = 0;

	constructor(
		registry: ScheduledParameterRegistry,
		key: string,
		descriptor: ParameterDescriptor,
		binding: ScheduledParameterBinding,
		latencyFrames: number,
	) {
		this.#registry = registry;
		this.#key = key;
		this.descriptor = descriptor;
		this.binding = binding;
		this.latencyFrames = latencyFrames;
	}

	schedule(
		eventsValue: readonly ScheduledParameterEvent[],
		optionsValue: ScheduledParameterScheduleOptions,
	): void {
		this.#assertActive();
		const events = normalizeEvents(eventsValue, this.descriptor);
		if (!events.length) return;
		const options = normalizeScheduleOptions(optionsValue);
		if (events[0]!.frame < options.fromFrame) {
			throw new RangeError('Scheduled parameter events cannot precede fromFrame.');
		}
		if (this.binding.kind === 'audio-param') {
			this.#scheduleAudioParam(events, options);
			return;
		}
		const revision = this.#revision + 1;
		const packet = Object.freeze({
			type: 'schedule-parameter-v1' as const,
			revision,
			address: this.descriptor.address,
			fromFrame: options.fromFrame,
			contextStartTime: options.contextStartTime,
			sampleRate: options.sampleRate,
			contextSampleRate: options.contextSampleRate,
			transportRate: options.transportRate,
			events: Object.freeze(events.map((event) => Object.freeze({
				kind: event.kind,
				frameOffset: messageFrameOffset(
					event.frame,
					options.fromFrame,
					options.transportRate,
					this.latencyFrames,
				),
				value: event.value,
			}))),
		});
		if (this.binding.receive(packet) === false) {
			throw new ScheduledParameterMessageRejectedError();
		}
		this.#revision = revision;
	}

	#scheduleAudioParam(
		events: readonly ScheduledParameterEvent[],
		options: NormalizedScheduleOptions,
	): void {
		const param = this.binding.kind === 'audio-param' ? this.binding.param : null;
		if (!param) return;
		const latencySeconds = this.latencyFrames / options.contextSampleRate;
		const scheduleStart = options.contextStartTime + latencySeconds;
		param.cancelScheduledValues?.(scheduleStart);
		for (const event of events) {
			const time = options.contextStartTime + (
				latencySeconds
				+ (event.frame - options.fromFrame) / (options.sampleRate * options.transportRate)
			);
			const value = this.binding.kind === 'audio-param'
				? finite(this.binding.transformValue(event.value), 'transformed parameter value')
				: event.value;
			if (event.kind === 'set') param.setValueAtTime(value, time);
			else param.linearRampToValueAtTime(value, time);
		}
	}

	#assertActive(): void {
		if (!this.#registry.owns(this.#key, this)) throw new StaleScheduledParameterTargetError();
	}
}

export class ScheduledParameterRegistry {
	#targets = new Map<string, RegisteredScheduledParameterTarget>();

	get size(): number {
		return this.#targets.size;
	}

	registerAudioParam(
		descriptor: ParameterDescriptor,
		param: AudioParam,
		options: ScheduledParameterTargetOptions = {},
	): ScheduledParameterTarget {
		if (!param || typeof param.setValueAtTime !== 'function'
			|| typeof param.linearRampToValueAtTime !== 'function') {
			throw new TypeError('A schedulable AudioParam is required.');
		}
		const transformValue = options.transformValue ?? identity;
		if (typeof transformValue !== 'function') throw new TypeError('A parameter value transform must be a function.');
		return this.#register(
			descriptor,
			Object.freeze({ kind: 'audio-param', param, transformValue }),
			options,
		);
	}

	registerMessageTarget(
		descriptor: ParameterDescriptor,
		receive: ScheduledParameterMessageReceiver,
		options: ScheduledParameterTargetOptions = {},
	): ScheduledParameterTarget {
		if (typeof receive !== 'function') throw new TypeError('A parameter message receiver is required.');
		return this.#register(descriptor, Object.freeze({ kind: 'message', receive }), options);
	}

	get(address: unknown): ScheduledParameterTarget | null {
		return this.#targets.get(canonicalParameterAddressKey(address)) || null;
	}

	has(address: unknown): boolean {
		return this.#targets.has(canonicalParameterAddressKey(address));
	}

	entries(): readonly ScheduledParameterTarget[] {
		return Object.freeze([...this.#targets.values()]);
	}

	unregister(address: unknown): boolean {
		return this.#targets.delete(canonicalParameterAddressKey(address));
	}

	clear(): void {
		this.#targets.clear();
	}

	owns(key: string, target: RegisteredScheduledParameterTarget): boolean {
		return this.#targets.get(key) === target;
	}

	#register(
		descriptorValue: ParameterDescriptor,
		binding: ScheduledParameterBinding,
		options: ScheduledParameterTargetOptions,
	): ScheduledParameterTarget {
		const descriptor = normalizeDescriptor(descriptorValue);
		if (!descriptor.automatable) {
			throw new RangeError(`Parameter ${descriptor.id} is not automatable.`);
		}
		const key = canonicalParameterAddressKey(descriptor.address);
		if (this.#targets.has(key)) throw new RangeError(`Parameter target ${key} is already registered.`);
		const latencyFrames = options.latencyFrames == null
			? descriptor.latencyFrames
			: nonNegativeSafeInteger(options.latencyFrames, 'target latencyFrames');
		const target = new RegisteredScheduledParameterTarget(
			this, key, descriptor, binding, latencyFrames,
		);
		this.#targets.set(key, target);
		return target;
	}
}

interface NormalizedScheduleOptions {
	readonly fromFrame: number;
	readonly contextStartTime: number;
	readonly sampleRate: number;
	readonly contextSampleRate: number;
	readonly transportRate: number;
}

function normalizeDescriptor(value: ParameterDescriptor): ParameterDescriptor {
	if (!value || typeof value !== 'object') throw new TypeError('A parameter descriptor is required.');
	const address = normalizeParameterAddress(value.address);
	const id = canonicalParameterAddressKey(address);
	if (value.id !== id) throw new RangeError('A parameter descriptor ID must equal its canonical address key.');
	const minimum = finite(value.minimum, 'descriptor minimum');
	const maximum = finite(value.maximum, 'descriptor maximum');
	const defaultValue = finite(value.defaultValue, 'descriptor default');
	if (minimum > maximum || defaultValue < minimum || defaultValue > maximum) {
		throw new RangeError('A parameter descriptor default must be inside its ordered range.');
	}
	const latencyFrames = nonNegativeSafeInteger(value.latencyFrames, 'descriptor latencyFrames');
	const tailFrames = nonNegativeSafeInteger(value.tailFrames, 'descriptor tailFrames');
	return Object.freeze({ ...value, id, address, minimum, maximum, defaultValue, latencyFrames, tailFrames });
}

function normalizeEvents(
	value: readonly ScheduledParameterEvent[],
	descriptor: ParameterDescriptor,
): readonly ScheduledParameterEvent[] {
	if (!Array.isArray(value)) throw new TypeError('Scheduled parameter events must be an array.');
	let previousFrame = -1;
	return Object.freeze(value.map((event, index) => {
		if (!event || typeof event !== 'object' || (event.kind !== 'set' && event.kind !== 'linear')) {
			throw new TypeError(`Scheduled parameter event ${index} is invalid.`);
		}
		const frame = nonNegativeSafeInteger(event.frame, `scheduled parameter event ${index} frame`);
		if (frame < previousFrame) throw new RangeError('Scheduled parameter events must be ordered by frame.');
		previousFrame = frame;
		const valueNumber = finite(event.value, `scheduled parameter event ${index} value`);
		if (valueNumber < descriptor.minimum || valueNumber > descriptor.maximum) {
			throw new RangeError(
				`Scheduled parameter values must be between ${descriptor.minimum} and ${descriptor.maximum}.`,
			);
		}
		if (descriptor.taper === 'discrete' && event.kind !== 'set') {
			throw new RangeError('Discrete parameters only accept set events.');
		}
		return Object.freeze({ kind: event.kind, frame, value: valueNumber });
	}));
}

function normalizeScheduleOptions(value: ScheduledParameterScheduleOptions): NormalizedScheduleOptions {
	if (!value || typeof value !== 'object') throw new TypeError('Parameter schedule options are required.');
	const fromFrame = nonNegativeSafeInteger(value.fromFrame, 'fromFrame');
	const contextStartTime = finite(value.contextStartTime, 'contextStartTime');
	if (contextStartTime < 0) throw new RangeError('contextStartTime must be non-negative.');
	const sampleRate = positive(value.sampleRate, 'sampleRate');
	const contextSampleRate = positive(value.contextSampleRate, 'contextSampleRate');
	const transportRate = positive(value.transportRate ?? 1, 'transportRate');
	return Object.freeze({ fromFrame, contextStartTime, sampleRate, contextSampleRate, transportRate });
}

function messageFrameOffset(
	frame: number,
	fromFrame: number,
	transportRate: number,
	latencyFrames: number,
): number {
	const offset = latencyFrames + Math.round((frame - fromFrame) / transportRate);
	if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError('A parameter frame offset is unsafe.');
	return offset;
}

function finite(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite.`);
	return number;
}

function positive(value: unknown, name: string): number {
	const number = finite(value, name);
	if (!(number > 0)) throw new RangeError(`${name} must be positive.`);
	return number;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return number;
}

function identity(value: number): number {
	return value;
}
