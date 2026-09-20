/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Closed, pathless Vamp analyzer wire values. Native analyzer code is not an
 * audio effect: it consumes a finite PCM stream and returns timestamped
 * features, with no latency, bypass, rack-state, or vendor-window semantics.
 */

export const VAMP_ANALYZER_LIMITS = Object.freeze({
	maximumTextLength: 512,
	maximumLabelLength: 4_096,
	maximumParameters: 256,
	maximumPrograms: 1_024,
	maximumOutputs: 256,
	maximumBins: 65_536,
	maximumChannels: 64,
	maximumBlockFrames: 1_048_576,
	maximumPcmChunkFrames: 65_536,
	maximumPcmChunkBytes: 16 * 1_024 * 1_024,
	maximumSessionSeconds: 12 * 60 * 60,
	maximumBatchFeatures: 65_536,
	maximumBatchValues: 1_048_576,
	maximumSessionFeatures: 100_000,
	maximumConcurrentSessions: 64,
} as const);

export type VampAnalyzerInputDomain = 'time' | 'frequency';
export type VampAnalyzerSampleType =
	| 'one-sample-per-step' | 'fixed-sample-rate' | 'variable-sample-rate';

export interface VampAnalyzerParameterDescriptor {
	readonly identifier: string;
	readonly name: string;
	readonly description: string;
	readonly unit: string;
	readonly minimumValue: number;
	readonly maximumValue: number;
	readonly defaultValue: number;
	readonly quantizeStep: number | null;
	readonly valueNames: readonly string[];
}

export interface VampAnalyzerOutputDescriptor {
	readonly identifier: string;
	readonly name: string;
	readonly description: string;
	readonly unit: string;
	/** `null` means the plug-in declares a variable number of values. */
	readonly binCount: number | null;
	readonly binNames: readonly string[];
	readonly extents: Readonly<{
		readonly minimumValue: number;
		readonly maximumValue: number;
	}> | null;
	readonly quantizeStep: number | null;
	readonly sampleType: VampAnalyzerSampleType;
	readonly sampleRate: number | null;
	readonly hasDuration: boolean;
}

export interface VampAnalyzerDescriptor {
	readonly kind: 'analyzer';
	readonly format: 'vamp';
	readonly identifier: string;
	readonly name: string;
	readonly description: string;
	readonly maker: string;
	readonly copyright: string;
	readonly pluginVersion: number;
	readonly vampApiVersion: number;
	readonly inputDomain: VampAnalyzerInputDomain;
	readonly minimumChannels: number;
	readonly maximumChannels: number;
	readonly preferredStepSize: number;
	readonly preferredBlockSize: number;
	readonly parameters: readonly Readonly<VampAnalyzerParameterDescriptor>[];
	readonly programs: readonly string[];
	readonly outputs: readonly Readonly<VampAnalyzerOutputDescriptor>[];
}

export interface VampAnalyzerConfiguration {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly stepSize: number;
	readonly blockSize: number;
	readonly frameCount: number;
	readonly parameters: Readonly<Record<string, number>>;
	readonly program: string | null;
}

export interface VampAnalyzerPcmChunk {
	readonly startFrame: number;
	readonly frameCount: number;
	readonly channels: readonly Float32Array[];
}

export interface VampAnalyzerTime {
	readonly seconds: number;
	readonly nanoseconds: number;
}

export interface VampAnalyzerFeature {
	readonly outputId: string;
	readonly timestamp: Readonly<VampAnalyzerTime> | null;
	readonly duration: Readonly<VampAnalyzerTime> | null;
	readonly values: readonly number[];
	readonly label: string;
}

const DESCRIPTOR_KEYS = [
	'kind', 'format', 'identifier', 'name', 'description', 'maker', 'copyright',
	'pluginVersion', 'vampApiVersion', 'inputDomain', 'minimumChannels', 'maximumChannels',
	'preferredStepSize', 'preferredBlockSize', 'parameters', 'programs', 'outputs',
] as const;
const PARAMETER_KEYS = [
	'identifier', 'name', 'description', 'unit', 'minimumValue', 'maximumValue',
	'defaultValue', 'quantizeStep', 'valueNames',
] as const;
const OUTPUT_KEYS = [
	'identifier', 'name', 'description', 'unit', 'binCount', 'binNames', 'extents',
	'quantizeStep', 'sampleType', 'sampleRate', 'hasDuration',
] as const;

export function admitVampAnalyzerDescriptor(value: unknown): Readonly<VampAnalyzerDescriptor> {
	const record = closedRecord(value, DESCRIPTOR_KEYS, 'Vamp analyzer descriptor');
	if (record.kind !== 'analyzer') throw new TypeError('Invalid Vamp analyzer kind.');
	if (record.format !== 'vamp') throw new TypeError('Invalid Vamp format.');
	const minimumChannels = integer(record.minimumChannels, 1,
		VAMP_ANALYZER_LIMITS.maximumChannels, 'minimum channel count');
	const maximumChannels = integer(record.maximumChannels, minimumChannels,
		VAMP_ANALYZER_LIMITS.maximumChannels, 'maximum channel count');
	const parameters = admittedArray(record.parameters, VAMP_ANALYZER_LIMITS.maximumParameters,
		'Vamp parameters', admitParameter);
	uniqueIdentifiers(parameters, 'parameter');
	const programs = admittedArray(record.programs, VAMP_ANALYZER_LIMITS.maximumPrograms,
		'Vamp programs', (entry) => text(entry, 'program'));
	if (new Set(programs).size !== programs.length) throw new TypeError('Duplicate Vamp program.');
	const outputs = admitVampAnalyzerOutputs(record.outputs);
	return Object.freeze({
		kind: 'analyzer', format: 'vamp',
		identifier: identifier(record.identifier, 'analyzer identifier'),
		name: text(record.name, 'analyzer name'),
		description: text(record.description, 'analyzer description'),
		maker: text(record.maker, 'analyzer maker'),
		copyright: text(record.copyright, 'analyzer copyright'),
		pluginVersion: integer(record.pluginVersion, 0, 0x7fffffff, 'plug-in version'),
		vampApiVersion: integer(record.vampApiVersion, 1, 0xffff, 'Vamp API version'),
		inputDomain: enumeration(record.inputDomain, ['time', 'frequency'], 'input domain'),
		minimumChannels, maximumChannels,
		preferredStepSize: integer(record.preferredStepSize, 0,
			VAMP_ANALYZER_LIMITS.maximumBlockFrames, 'preferred step size'),
		preferredBlockSize: integer(record.preferredBlockSize, 0,
			VAMP_ANALYZER_LIMITS.maximumBlockFrames, 'preferred block size'),
		parameters, programs, outputs,
	});
}

export function admitVampAnalyzerOutputs(
	value: unknown,
): readonly Readonly<VampAnalyzerOutputDescriptor>[] {
	const outputs = admittedArray(value, VAMP_ANALYZER_LIMITS.maximumOutputs,
		'Vamp outputs', admitOutput);
	if (outputs.length === 0) throw new RangeError('A Vamp analyzer must declare at least one output.');
	uniqueIdentifiers(outputs, 'output');
	return outputs;
}

export function admitVampAnalyzerConfiguration(
	value: unknown,
	descriptor: Readonly<VampAnalyzerDescriptor>,
): Readonly<VampAnalyzerConfiguration> {
	const record = closedRecord(value, [
		'sampleRate', 'channelCount', 'stepSize', 'blockSize', 'frameCount', 'parameters', 'program',
	], 'Vamp analyzer configuration');
	const sampleRate = integer(record.sampleRate, 8_000, 768_000, 'sample rate');
	const channelCount = integer(record.channelCount, descriptor.minimumChannels,
		descriptor.maximumChannels, 'channel count');
	const blockSize = integer(record.blockSize, 1,
		VAMP_ANALYZER_LIMITS.maximumBlockFrames, 'block size');
	const stepSize = integer(record.stepSize, 1, blockSize, 'step size');
	const frameCount = integer(record.frameCount, 0, Number.MAX_SAFE_INTEGER, 'frame count');
	if (frameCount > sampleRate * VAMP_ANALYZER_LIMITS.maximumSessionSeconds) {
		throw new RangeError('Vamp analysis duration exceeds its admitted limit.');
	}
	const supplied = openRecord(record.parameters, 'Vamp analyzer parameter values');
	const known = new Map(descriptor.parameters.map((parameter) => [parameter.identifier, parameter]));
	for (const key of Object.keys(supplied)) {
		if (!known.has(key)) throw new TypeError(`Unknown Vamp parameter: ${key}`);
	}
	const parameters: Record<string, number> = {};
	for (const parameter of descriptor.parameters) {
		const candidate = Object.hasOwn(supplied, parameter.identifier)
			? supplied[parameter.identifier] : parameter.defaultValue;
		const admitted = finite(candidate, `parameter ${parameter.identifier}`);
		if (admitted < parameter.minimumValue || admitted > parameter.maximumValue) {
			throw new RangeError(`Vamp parameter ${parameter.identifier} is outside its range.`);
		}
		if (parameter.quantizeStep !== null
			&& !quantized(admitted, parameter.minimumValue, parameter.quantizeStep)) {
			throw new RangeError(`Vamp parameter ${parameter.identifier} is not quantized.`);
		}
		parameters[parameter.identifier] = admitted;
	}
	const program = record.program === null ? null : text(record.program, 'program');
	if (program !== null && !descriptor.programs.includes(program)) {
		throw new TypeError('The Vamp analyzer program was not declared by the analyzer.');
	}
	return Object.freeze({
		sampleRate, channelCount, stepSize, blockSize, frameCount,
		parameters: Object.freeze(parameters), program,
	});
}

export function admitVampAnalyzerPcmChunk(
	value: unknown,
	configuration: Readonly<VampAnalyzerConfiguration>,
	expectedStartFrame: number,
): Readonly<VampAnalyzerPcmChunk> {
	const record = closedRecord(value, ['startFrame', 'channels'], 'Vamp PCM chunk');
	const startFrame = integer(record.startFrame, 0, configuration.frameCount, 'PCM start frame');
	if (startFrame !== expectedStartFrame) throw new RangeError('Vamp PCM chunks must be contiguous.');
	if (!Array.isArray(record.channels) || record.channels.length !== configuration.channelCount) {
		throw new RangeError('Vamp PCM channel count does not match the configuration.');
	}
	let frameCount: number | null = null;
	const channels = record.channels.map((channel, channelIndex) => {
		if (!(channel instanceof Float32Array)) {
			throw new TypeError(`Vamp PCM channel ${String(channelIndex)} is not Float32 PCM.`);
		}
		if (frameCount === null) frameCount = channel.length;
		else if (frameCount !== channel.length) throw new RangeError('Vamp PCM channels have unequal frame counts.');
		for (const sample of channel) {
			if (!Number.isFinite(sample)) throw new TypeError('Vamp PCM samples must be finite.');
		}
		return Float32Array.from(channel);
	});
	const frames = frameCount ?? 0;
	if (frames < 1 || frames > VAMP_ANALYZER_LIMITS.maximumPcmChunkFrames) {
		throw new RangeError('Vamp PCM chunk frame count is outside its admitted range.');
	}
	if ((frames * channels.length * Float32Array.BYTES_PER_ELEMENT)
		> VAMP_ANALYZER_LIMITS.maximumPcmChunkBytes) {
		throw new RangeError('Vamp PCM chunk exceeds its byte limit.');
	}
	if (startFrame + frames > configuration.frameCount) {
		throw new RangeError('Vamp PCM chunk exceeds the configured frame count.');
	}
	return Object.freeze({ startFrame, frameCount: frames, channels: Object.freeze(channels) });
}

export function admitVampAnalyzerFeatures(
	value: unknown,
	outputs: readonly Readonly<VampAnalyzerOutputDescriptor>[],
): readonly Readonly<VampAnalyzerFeature>[] {
	if (!Array.isArray(value) || value.length > VAMP_ANALYZER_LIMITS.maximumBatchFeatures) {
		throw new RangeError('Vamp feature batch exceeds its feature limit.');
	}
	const byId = new Map(outputs.map((output) => [output.identifier, output]));
	let totalValues = 0;
	const features = value.map((entry) => {
		const record = closedRecord(entry,
			['outputId', 'timestamp', 'duration', 'values', 'label'], 'Vamp feature');
		const outputId = identifier(record.outputId, 'feature output identifier');
		const output = byId.get(outputId);
		if (!output) throw new TypeError(`Unknown Vamp feature output: ${outputId}`);
		if (!Array.isArray(record.values) || record.values.length > VAMP_ANALYZER_LIMITS.maximumBins) {
			throw new RangeError('Vamp feature values exceed their bin limit.');
		}
		if (output.binCount !== null && record.values.length !== output.binCount) {
			throw new RangeError('Vamp feature values do not match the output bin count.');
		}
		totalValues += record.values.length;
		if (totalValues > VAMP_ANALYZER_LIMITS.maximumBatchValues) {
			throw new RangeError('Vamp feature batch exceeds its aggregate value limit.');
		}
		const values = Object.freeze(record.values.map((candidate) => {
			const admitted = finite(candidate, 'feature value');
			if (output.extents !== null
				&& (admitted < output.extents.minimumValue || admitted > output.extents.maximumValue)) {
				throw new RangeError('Vamp feature value is outside the declared output extents.');
			}
			if (output.quantizeStep !== null && output.extents !== null
				&& !quantized(admitted, output.extents.minimumValue, output.quantizeStep)) {
				throw new RangeError('Vamp feature value does not match the output quantization.');
			}
			return admitted;
		}));
		const timestamp = record.timestamp === null ? null : admitTime(record.timestamp, false);
		const duration = record.duration === null ? null : admitTime(record.duration, true);
		if (output.sampleType === 'variable-sample-rate' && timestamp === null) {
			throw new TypeError('A variable-sample-rate Vamp feature requires a timestamp.');
		}
		if (output.hasDuration !== (duration !== null)) {
			throw new TypeError('Vamp feature duration does not match its output descriptor.');
		}
		return Object.freeze({
			outputId, timestamp, duration, values,
			label: text(record.label, 'feature label', VAMP_ANALYZER_LIMITS.maximumLabelLength),
		});
	});
	return Object.freeze(features);
}

function admitParameter(value: unknown): Readonly<VampAnalyzerParameterDescriptor> {
	const record = closedRecord(value, PARAMETER_KEYS, 'Vamp parameter descriptor');
	const minimumValue = finite(record.minimumValue, 'parameter minimum');
	const maximumValue = finite(record.maximumValue, 'parameter maximum');
	const defaultValue = finite(record.defaultValue, 'parameter default');
	if (minimumValue > maximumValue || defaultValue < minimumValue || defaultValue > maximumValue) {
		throw new RangeError('Invalid Vamp parameter value range.');
	}
	const quantizeStep = nullablePositive(record.quantizeStep, 'parameter quantize step');
	if (quantizeStep !== null && !quantized(defaultValue, minimumValue, quantizeStep)) {
		throw new RangeError('The Vamp parameter default is not quantized.');
	}
	const valueNames = admittedArray(record.valueNames, VAMP_ANALYZER_LIMITS.maximumBins,
		'Vamp parameter value names', (entry) => text(entry, 'parameter value name'));
	return Object.freeze({
		identifier: identifier(record.identifier, 'parameter identifier'),
		name: text(record.name, 'parameter name'), description: text(record.description, 'parameter description'),
		unit: text(record.unit, 'parameter unit'), minimumValue, maximumValue, defaultValue,
		quantizeStep, valueNames,
	});
}

function admitOutput(value: unknown): Readonly<VampAnalyzerOutputDescriptor> {
	const record = closedRecord(value, OUTPUT_KEYS, 'Vamp output descriptor');
	const binCount = record.binCount === null ? null
		: integer(record.binCount, 0, VAMP_ANALYZER_LIMITS.maximumBins, 'output bin count');
	const binNames = admittedArray(record.binNames, VAMP_ANALYZER_LIMITS.maximumBins,
		'Vamp output bin names', (entry) => text(entry, 'output bin name'));
	if (binNames.length > 0 && (binCount === null || binNames.length !== binCount)) {
		throw new RangeError('Vamp output bin names do not match its fixed bin count.');
	}
	const extents = record.extents === null ? null : admitExtents(record.extents);
	const sampleType = enumeration(record.sampleType,
		['one-sample-per-step', 'fixed-sample-rate', 'variable-sample-rate'], 'output sample type');
	const sampleRate = record.sampleRate === null ? null : positive(record.sampleRate, 'output sample rate');
	if ((sampleType === 'fixed-sample-rate') !== (sampleRate !== null)) {
		throw new TypeError('A fixed-sample-rate Vamp output must declare its sample rate exclusively.');
	}
	return Object.freeze({
		identifier: identifier(record.identifier, 'output identifier'), name: text(record.name, 'output name'),
		description: text(record.description, 'output description'), unit: text(record.unit, 'output unit'),
		binCount, binNames, extents,
		quantizeStep: nullablePositive(record.quantizeStep, 'output quantize step'),
		sampleType, sampleRate, hasDuration: boolean(record.hasDuration, 'output duration flag'),
	});
}

function admitExtents(value: unknown): Readonly<{ minimumValue: number; maximumValue: number }> {
	const record = closedRecord(value, ['minimumValue', 'maximumValue'], 'Vamp output extents');
	const minimumValue = finite(record.minimumValue, 'output minimum');
	const maximumValue = finite(record.maximumValue, 'output maximum');
	if (minimumValue > maximumValue) throw new RangeError('Invalid Vamp output extents.');
	return Object.freeze({ minimumValue, maximumValue });
}

function admitTime(value: unknown, duration: boolean): Readonly<VampAnalyzerTime> {
	const record = closedRecord(value, ['seconds', 'nanoseconds'], `Vamp feature ${duration ? 'duration' : 'timestamp'}`);
	const minimum = duration ? 0 : -VAMP_ANALYZER_LIMITS.maximumSessionSeconds;
	return Object.freeze({
		seconds: integer(record.seconds, minimum, VAMP_ANALYZER_LIMITS.maximumSessionSeconds,
			duration ? 'duration seconds' : 'timestamp seconds'),
		nanoseconds: integer(record.nanoseconds, 0, 999_999_999,
			duration ? 'duration nanoseconds' : 'timestamp nanoseconds'),
	});
}

function admittedArray<T>(
	value: unknown, maximum: number, label: string, admit: (entry: unknown) => T,
): readonly T[] {
	if (!Array.isArray(value) || value.length > maximum) throw new RangeError(`${label} exceed their admitted limit.`);
	return Object.freeze(value.map(admit));
}

function uniqueIdentifiers(values: readonly Readonly<{ identifier: string }>[], label: string): void {
	const identifiers = values.map(({ identifier: value }) => value);
	if (new Set(identifiers).size !== identifiers.length) throw new TypeError(`Duplicate Vamp ${label} identifier.`);
}

function closedRecord<const Keys extends readonly string[]>(
	value: unknown, keys: Keys, label: string,
): Record<Keys[number], unknown> {
	const record = openRecord(value, label);
	const actual = Object.keys(record).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
		throw new TypeError(`${label} has invalid keys.`);
	}
	return record as Record<Keys[number], unknown>;
}

function openRecord(value: unknown, label: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a record.`);
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain record.`);
	for (const property of Object.values(Object.getOwnPropertyDescriptors(value))) {
		if (property.get !== undefined || property.set !== undefined) throw new TypeError(`${label} may not contain accessors.`);
	}
	return value as Record<string, unknown>;
}

function text(
	value: unknown, label: string, maximum: number = VAMP_ANALYZER_LIMITS.maximumTextLength,
): string {
	if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) {
		throw new TypeError(`Invalid Vamp ${label}.`);
	}
	return value;
}

function identifier(value: unknown, label: string): string {
	const admitted = text(value, label, 256);
	if (!/^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,255}$/u.test(admitted)) throw new TypeError(`Invalid Vamp ${label}.`);
	return admitted;
}

function finite(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Vamp ${label} must be finite.`);
	return value;
}

function positive(value: unknown, label: string): number {
	const admitted = finite(value, label);
	if (admitted <= 0) throw new RangeError(`Vamp ${label} must be positive.`);
	return admitted;
}

function nullablePositive(value: unknown, label: string): number | null {
	return value === null ? null : positive(value, label);
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new RangeError(`Invalid Vamp ${label}.`);
	}
	return value as number;
}

function boolean(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`Invalid Vamp ${label}.`);
	return value;
}

function enumeration<const Value extends string>(value: unknown, values: readonly Value[], label: string): Value {
	if (typeof value !== 'string' || !values.includes(value as Value)) throw new TypeError(`Invalid Vamp ${label}.`);
	return value as Value;
}

function quantized(value: number, minimum: number, step: number): boolean {
	const position = (value - minimum) / step;
	return Math.abs(position - Math.round(position)) <= 1e-6;
}
