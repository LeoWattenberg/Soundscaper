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

/**
 * Schema-neutral frame-offset queue receiver contract. Registering a receiver
 * allocates no packets or signal nodes; a future lane scheduler must call
 * ScheduledParameterTarget.schedule before any message is emitted.
 */
export type ScheduledParameterMessageReceiver = (
	message: ScheduledParameterMessage,
) => boolean | void;

export type ScheduledParameterBinding =
	| Readonly<{
		kind: 'audio-param';
		params: readonly Readonly<{
			param: AudioParam;
			transformValue: (value: number) => number;
		}>[];
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
				frameOffset: roundScheduledParameterContextFrameOffset(
					event.frame,
					options.fromFrame,
					options.sampleRate,
					options.contextSampleRate,
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
		const bindings = this.binding.kind === 'audio-param' ? this.binding.params : [];
		if (!bindings.length) return;
		const latencySeconds = this.latencyFrames / options.contextSampleRate;
		const scheduleStart = options.contextStartTime + latencySeconds;
		for (const { param } of bindings) param.cancelScheduledValues?.(scheduleStart);
		for (const event of events) {
			const time = options.contextStartTime + (
				latencySeconds
				+ (event.frame - options.fromFrame) / (options.sampleRate * options.transportRate)
			);
			for (const { param, transformValue } of bindings) {
				const value = finiteNumber(transformValue(event.value), 'transformed parameter value');
				if (event.kind === 'set') param.setValueAtTime(value, time);
				else param.linearRampToValueAtTime(value, time);
			}
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
		assertAudioParam(param);
		const transformValue = options.transformValue ?? identity;
		if (typeof transformValue !== 'function') throw new TypeError('A parameter value transform must be a function.');
		return this.#register(
			descriptor,
			Object.freeze({
				kind: 'audio-param',
				params: Object.freeze([Object.freeze({ param, transformValue })]),
			}),
			options,
		);
	}

	registerAudioParamGroup(
		descriptor: ParameterDescriptor,
		bindings: readonly Readonly<{
			param: AudioParam;
			transformValue?: (value: number) => number;
		}>[],
		options: ScheduledParameterTargetOptions = {},
	): ScheduledParameterTarget {
		if (!Array.isArray(bindings) || bindings.length < 2 || bindings.length > 8) {
			throw new RangeError('A composite parameter target requires between two and eight AudioParams.');
		}
		const normalized = bindings.map(({ param, transformValue = identity }) => {
			assertAudioParam(param);
			if (typeof transformValue !== 'function') {
				throw new TypeError('A parameter value transform must be a function.');
			}
			return Object.freeze({ param, transformValue });
		});
		return this.#register(descriptor, Object.freeze({
			kind: 'audio-param',
			params: Object.freeze(normalized),
		}), options);
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
		const latencyFrames = options.latencyFrames === undefined
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
	const descriptor = ownDataRecord(value, 'A parameter descriptor');
	closedRecord(descriptor, [
		'id',
		'address',
		'unit',
		'minimum',
		'maximum',
		'defaultValue',
		'step',
		'taper',
		'automationTolerance',
		'automatable',
		'automationBlockReason',
		'latencyFrames',
		'tailFrames',
	], 'parameter descriptor');
	const address = normalizeParameterAddress(descriptor.address);
	const id = canonicalParameterAddressKey(address);
	if (descriptor.id !== id) throw new RangeError('A parameter descriptor ID must equal its canonical address key.');
	const unit = boundedString(descriptor.unit, 'descriptor unit');
	const minimum = finiteNumber(descriptor.minimum, 'descriptor minimum');
	const maximum = finiteNumber(descriptor.maximum, 'descriptor maximum');
	const defaultValue = finiteNumber(descriptor.defaultValue, 'descriptor default');
	if (minimum > maximum || defaultValue < minimum || defaultValue > maximum) {
		throw new RangeError('A parameter descriptor default must be inside its ordered range.');
	}
	const step = descriptor.step === null
		? null
		: positiveFiniteNumber(descriptor.step, 'descriptor step');
	const taper = descriptor.taper;
	if (taper !== 'linear' && taper !== 'logarithmic'
		&& taper !== 'decibel' && taper !== 'discrete') {
		throw new RangeError('A descriptor taper must be linear, logarithmic, decibel, or discrete.');
	}
	if (taper === 'logarithmic' && minimum <= 0) {
		throw new RangeError('A logarithmic parameter descriptor requires a positive minimum.');
	}
	const automationTolerance = nonNegativeFiniteNumber(
		descriptor.automationTolerance,
		'descriptor automationTolerance',
	);
	if (typeof descriptor.automatable !== 'boolean') {
		throw new TypeError('descriptor automatable must be a boolean.');
	}
	const automationBlockReason = descriptor.automationBlockReason === undefined
		? undefined
		: boundedString(descriptor.automationBlockReason, 'descriptor automation block reason');
	if (!descriptor.automatable && !automationBlockReason) {
		throw new RangeError('A nonautomatable parameter descriptor requires an automation block reason.');
	}
	if (descriptor.automatable && automationBlockReason) {
		throw new RangeError('An automatable parameter descriptor cannot have an automation block reason.');
	}
	const latencyFrames = nonNegativeSafeInteger(descriptor.latencyFrames, 'descriptor latencyFrames');
	const tailFrames = nonNegativeSafeInteger(descriptor.tailFrames, 'descriptor tailFrames');
	return Object.freeze({
		id,
		address,
		unit,
		minimum,
		maximum,
		defaultValue,
		step,
		taper,
		automationTolerance,
		automatable: descriptor.automatable,
		...(automationBlockReason === undefined ? {} : { automationBlockReason }),
		latencyFrames,
		tailFrames,
	});
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
		const valueNumber = finiteNumber(event.value, `scheduled parameter event ${index} value`);
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
	const contextStartTime = finiteNumber(value.contextStartTime, 'contextStartTime');
	if (contextStartTime < 0) throw new RangeError('contextStartTime must be non-negative.');
	const sampleRate = positiveSafeInteger(value.sampleRate, 'sampleRate');
	const contextSampleRate = positiveSafeInteger(value.contextSampleRate, 'contextSampleRate');
	const transportRate = positiveFiniteNumber(
		value.transportRate === undefined ? 1 : value.transportRate,
		'transportRate',
	);
	return Object.freeze({ fromFrame, contextStartTime, sampleRate, contextSampleRate, transportRate });
}

/**
 * Convert one project-domain frame into the worklet context-frame domain.
 * Fractional context frames round to the nearest integer, with exact halves
 * owned by the later frame. Latency is already declared in context frames.
 */
export function roundScheduledParameterContextFrameOffset(
	frame: number,
	fromFrame: number,
	sampleRate: number,
	contextSampleRate: number,
	transportRate: number,
	latencyFrames: number,
): number {
	const projectFrameDelta = frame - fromFrame;
	const scaledOffset = projectFrameDelta / sampleRate * contextSampleRate / transportRate;
	if (!Number.isFinite(scaledOffset) || scaledOffset < 0
		|| scaledOffset > Number.MAX_SAFE_INTEGER - latencyFrames) {
		throw new RangeError('A parameter frame offset is unsafe.');
	}
	const offset = latencyFrames + Math.floor(scaledOffset + 0.5);
	if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError('A parameter frame offset is unsafe.');
	return offset;
}

function finiteNumber(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new TypeError(`${name} must be a finite number.`);
	}
	return value;
}

function nonNegativeFiniteNumber(value: unknown, name: string): number {
	const number = finiteNumber(value, name);
	if (number < 0) throw new RangeError(`${name} must be non-negative.`);
	return number;
}

function positiveFiniteNumber(value: unknown, name: string): number {
	const number = finiteNumber(value, name);
	if (!(number > 0)) throw new RangeError(`${name} must be positive.`);
	return number;
}

function boundedString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value || value.length > 4_096) {
		throw new TypeError(`${name} must be a non-empty bounded string.`);
	}
	return value;
}

function ownDataRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain object.`);
	}
	if (Object.getOwnPropertySymbols(value).length) {
		throw new TypeError(`${name} must contain only named own data properties.`);
	}
	const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
		if (!Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} must contain only own data properties.`);
		}
		snapshot[key] = descriptor.value;
	}
	return Object.freeze(snapshot);
}

function closedRecord(
	value: Readonly<Record<string, unknown>>,
	allowed: readonly string[],
	name: string,
): void {
	const allowedSet = new Set(allowed);
	const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
	if (unknown) throw new TypeError(`${name} has an unknown member: ${unknown}.`);
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return value;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return value;
}

function identity(value: number): number {
	return value;
}

function assertAudioParam(param: AudioParam): void {
	if (!param || typeof param.setValueAtTime !== 'function'
		|| typeof param.linearRampToValueAtTime !== 'function') {
		throw new TypeError('A schedulable AudioParam is required.');
	}
}
