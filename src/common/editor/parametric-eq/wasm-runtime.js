import { designParametricEq } from './design.js';

export const PARAMETRIC_EQ_WASM_ABI_VERSION = 2;
export const PARAMETRIC_EQ_WASM_MEMORY_BYTES = 1_048_576;
export const PARAMETRIC_EQ_WASM_MAXIMUM_BLOCK_SIZE = 1_024;

export const PARAMETRIC_EQ_WASM_COMMIT_MODE = Object.freeze({
	immediate: 0,
	smooth: 1,
	crossfade: 2,
});

const STATUS_MESSAGES = Object.freeze({
	'-1': 'The parametric EQ WASM runtime is not initialized.',
	'-2': 'The parametric EQ WASM runtime received an invalid argument.',
	'-3': 'The parametric EQ WASM runtime is completing a structural transition.',
	'-4': 'The parametric EQ WASM runtime rejected an incomplete or unstable configuration.',
	'-5': 'The parametric EQ WASM runtime rejected non-finite audio.',
	'-6': 'The parametric EQ WASM runtime has no active configuration.',
});
const BAND_TYPES = new Set([
	'peaking',
	'lowshelf',
	'highshelf',
	'highpass',
	'lowpass',
	'notch',
]);
const CUT_SLOPES = new Set([12, 24, 36, 48]);
const NATIVE_BAND_TYPES = Object.freeze({
	peaking: 0,
	lowshelf: 1,
	highshelf: 2,
	highpass: 3,
	lowpass: 4,
	notch: 5,
	bandpass: 6,
});

export class ParametricEqWasmError extends Error {
	constructor(message, status = null) {
		super(status == null ? message : `${message} (${status})`);
		this.name = 'ParametricEqWasmError';
		this.status = status;
	}
}

/** Compile on the main thread, then structured-clone the returned module. */
export async function compileParametricEqWasm(source) {
	if (source instanceof WebAssembly.Module) return source;
	let bytes = source;
	if (typeof Response !== 'undefined' && source instanceof Response) {
		if (!source.ok) {
			throw new ParametricEqWasmError(
				`Could not load parametric EQ WASM (${source.status} ${source.statusText}).`,
			);
		}
		bytes = await source.arrayBuffer();
	} else if (source && typeof source.arrayBuffer === 'function'
		&& !(source instanceof ArrayBuffer) && !ArrayBuffer.isView(source)) {
		bytes = await source.arrayBuffer();
	}
	if (ArrayBuffer.isView(bytes)) {
		bytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
	}
	if (!(bytes instanceof ArrayBuffer)) {
		throw new TypeError('Parametric EQ WASM source must be a WebAssembly.Module, Response, ArrayBuffer, or typed array.');
	}
	try {
		return await WebAssembly.compile(bytes);
	} catch (error) {
		throw new ParametricEqWasmError(`Could not compile parametric EQ WASM: ${error.message}`);
	}
}

export async function createParametricEqWasmRuntime(source, options) {
	return new ParametricEqWasmRuntime(await compileParametricEqWasm(source), options);
}

/** Strictly validate canonical parameters and return their sample-rate-specific TPT design. */
export function designParametricEqWasmConfiguration(params, sampleRate, options = {}) {
	validateCanonicalParams(params);
	const configuration = designParametricEq(
		params,
		normalizeInteger(sampleRate, 8_000, 768_000, 'sampleRate'),
		{
			effectId: options.effectId,
			auditionBandId: options.auditionBandId,
		},
	);
	validateDesignedConfiguration(configuration);
	return configuration;
}

/**
 * Synchronous constructor for AudioWorkletGlobalScope and dedicated workers.
 * It intentionally accepts only a precompiled module and has no JS DSP fallback.
 */
export class ParametricEqWasmRuntime {
	constructor(module, options = {}) {
		if (!(module instanceof WebAssembly.Module)) {
			throw new TypeError('ParametricEqWasmRuntime requires a precompiled WebAssembly.Module.');
		}
		this.sampleRate = normalizeInteger(options.sampleRate, 8_000, 768_000, 'sampleRate');
		this.channelCount = normalizeInteger(options.channelCount, 1, 32, 'channelCount');
		let instance;
		try {
			instance = new WebAssembly.Instance(module, {});
		} catch (error) {
			throw new ParametricEqWasmError(`Could not instantiate parametric EQ WASM: ${error.message}`);
		}
		this.instance = instance;
		this.exports = instance.exports;
		this.exports._initialize?.();
		this.#validateAbi();
		this.#requireSuccess(
			this.exports.peq_initialize(this.sampleRate, this.channelCount),
			'Could not initialize parametric EQ WASM',
		);
		this.memory = this.exports.memory;
		this.input = [];
		this.output = [];
		for (let channel = 0; channel < this.channelCount; channel += 1) {
			this.input.push(new Float32Array(
				this.memory.buffer,
				this.exports.peq_input_pointer(channel),
				PARAMETRIC_EQ_WASM_MAXIMUM_BLOCK_SIZE,
			));
			this.output.push(new Float32Array(
				this.memory.buffer,
				this.exports.peq_output_pointer(channel),
				PARAMETRIC_EQ_WASM_MAXIMUM_BLOCK_SIZE,
			));
		}
		this.configuration = null;
	}

	configure(params, options = {}) {
		return this.configureDesigned(
			designParametricEqWasmConfiguration(params, this.sampleRate, options),
			options,
		);
	}

	configureDesigned(configuration, options = {}) {
		return this.commitPreparedConfiguration(
			this.prepareDesignedConfiguration(configuration, options),
		);
	}

	/** Validate and allocate grouping metadata outside the audio callback. */
	prepareDesignedConfiguration(configuration, options = {}) {
		validateDesignedConfiguration(configuration);
		if (configuration.sampleRate !== this.sampleRate) {
			throw new RangeError('Designed parametric EQ sample rate does not match this WASM runtime.');
		}
		const requestedMode = options.mode ?? 'auto';
		const mode = requestedMode === 'auto'
			? this.configuration == null
				? 'immediate'
				: this.configuration.topologyKey === configuration.topologyKey
					? 'smooth'
					: 'crossfade'
			: requestedMode;
		const commitMode = PARAMETRIC_EQ_WASM_COMMIT_MODE[mode];
		if (commitMode == null) {
			throw new RangeError('Parametric EQ WASM mode must be auto, immediate, smooth, or crossfade.');
		}
		const bypassChanged = mode === 'smooth'
			&& this.configuration?.topologyKey === configuration.topologyKey
			&& this.configuration.packet.bands.some((band, index) => (
				band.enabled !== configuration.packet.bands[index]?.enabled
			));
		const transitionFrames = normalizeTransitionFrames(
			options.transitionFrames,
			mode === 'smooth'
				? Math.round(this.sampleRate * (bypassChanged ? 0.01 : 0.005))
				: mode === 'crossfade'
					? Math.round(this.sampleRate * 0.02)
					: 0,
		);
		const groups = groupSections(configuration.sections);
		return {
			configuration,
			commitMode,
			groups,
			transitionFrames,
			result: {
				mode,
				transitionFrames,
				topologyChanged: mode === 'crossfade',
			},
		};
	}

	/** Commit metadata produced by prepareDesignedConfiguration without allocating. */
	commitPreparedConfiguration(prepared) {
		if (!prepared || typeof prepared !== 'object'
			|| !Array.isArray(prepared.groups)
			|| !prepared.configuration) {
			throw new TypeError('Expected a prepared parametric EQ WASM configuration.');
		}
		const configuration = prepared.configuration;
		const commitMode = prepared.commitMode;
		const transitionFrames = prepared.transitionFrames;
		const packetBands = configuration.auditionBandId == null
			? configuration.packet.bands
			: configuration.packet.bands.filter(
				(band) => band.id === configuration.auditionBandId,
			);
		this.#requireSuccess(this.exports.peq_begin_semantic_configuration(
			packetBands.length,
			configuration.outputGainDb,
		), 'Could not begin parametric EQ configuration');
		for (let bandIndex = 0; bandIndex < packetBands.length; bandIndex += 1) {
			const band = packetBands[bandIndex];
			const type = nativeBandType(band.type, configuration.auditionBandId != null);
			this.#requireSuccess(this.exports.peq_set_semantic_band(
				bandIndex,
				type,
				band.slopeDbPerOctave,
				band.frequencyHz,
				band.gainDb,
				band.q,
				configuration.auditionBandId != null || band.enabled ? 1 : 0,
			), 'Could not configure a parametric EQ band');
		}
		this.#requireSuccess(
			this.exports.peq_commit_configuration(commitMode, transitionFrames),
			'Could not commit parametric EQ configuration',
		);
		this.configuration = configuration;
		return prepared.result;
	}

	/** Copies one bounded planar block through WASM without allocating. */
	process(inputChannels, outputChannels, frameCount = null) {
		if (!Array.isArray(inputChannels) || !Array.isArray(outputChannels)) {
			throw new TypeError('Parametric EQ WASM process requires planar input and output arrays.');
		}
		const frames = frameCount == null
			? outputChannels[0]?.length ?? inputChannels[0]?.length ?? 0
			: frameCount;
		if (!Number.isInteger(frames) || frames < 1
			|| frames > PARAMETRIC_EQ_WASM_MAXIMUM_BLOCK_SIZE) {
			throw new RangeError(`Parametric EQ WASM block size must be between 1 and ${PARAMETRIC_EQ_WASM_MAXIMUM_BLOCK_SIZE}.`);
		}
		for (let channel = 0; channel < outputChannels.length; channel += 1) {
			const destination = outputChannels[channel];
			if (!destination || !ArrayBuffer.isView(destination)
				|| typeof destination.set !== 'function'
				|| typeof destination.fill !== 'function'
				|| destination.length < frames) {
				throw new RangeError(`Parametric EQ output channel ${channel} is shorter than the requested block.`);
			}
		}
		for (let channel = 0; channel < this.channelCount; channel += 1) {
			const source = inputChannels[channel];
			if (source) {
				if (!ArrayBuffer.isView(source) || source.length < frames) {
					throw new RangeError(`Parametric EQ input channel ${channel} is shorter than the requested block.`);
				}
				for (let frame = 0; frame < frames; frame += 1) {
					this.input[channel][frame] = source[frame];
				}
			} else {
				this.input[channel].fill(0, 0, frames);
			}
		}
		const status = this.exports.peq_process(frames);
		if (status !== frames) {
			for (const destination of outputChannels) destination?.fill(0, 0, frames);
			if (status < 0) {
				this.#requireSuccess(status, 'Parametric EQ WASM could not process audio');
			}
			throw new ParametricEqWasmError(
				`Parametric EQ WASM processed ${status} frames instead of ${frames}.`,
			);
		}
		for (let channel = 0; channel < outputChannels.length; channel += 1) {
			const destination = outputChannels[channel];
			if (channel < this.channelCount) {
				for (let frame = 0; frame < frames; frame += 1) {
					destination[frame] = this.output[channel][frame];
				}
			} else destination.fill(0, 0, frames);
		}
		return frames;
	}

	evaluateResponse(frequencies, configuration = 'active') {
		if (!Array.isArray(frequencies) && !ArrayBuffer.isView(frequencies)) {
			throw new TypeError('Parametric EQ response frequencies must be an array or typed array.');
		}
		const selector = configuration === 'active' ? 0 : configuration === 'staging' ? 1 : null;
		if (selector == null) throw new RangeError('Parametric EQ response configuration must be active or staging.');
		return Float64Array.from(frequencies, (frequency) => {
			const decibels = this.exports.peq_response_db(selector, Number(frequency));
			if (!Number.isFinite(decibels)) {
				throw new ParametricEqWasmError('Parametric EQ WASM could not evaluate its response.');
			}
			return decibels;
		});
	}

	reset() {
		this.#requireSuccess(this.exports.peq_reset(), 'Could not reset parametric EQ WASM');
	}

	get transitioning() {
		return this.exports.peq_is_transitioning() === 1;
	}

	#validateAbi() {
		const api = this.exports;
		const requiredFunctions = [
			'peq_abi_version',
			'peq_maximum_block_size',
			'peq_maximum_channels',
			'peq_maximum_bands',
			'peq_maximum_sections',
			'peq_linear_memory_bytes',
			'peq_initialize',
			'peq_input_pointer',
			'peq_output_pointer',
			'peq_begin_configuration',
			'peq_set_band',
			'peq_set_section',
			'peq_begin_semantic_configuration',
			'peq_set_semantic_band',
			'peq_commit_configuration',
			'peq_is_transitioning',
			'peq_process',
			'peq_reset',
			'peq_response_db',
		];
		if (!(api.memory instanceof WebAssembly.Memory)
			|| requiredFunctions.some((name) => typeof api[name] !== 'function')) {
			throw new ParametricEqWasmError('Parametric EQ WASM has an incomplete ABI.');
		}
		if (api.peq_abi_version() !== PARAMETRIC_EQ_WASM_ABI_VERSION
			|| api.peq_maximum_block_size() !== PARAMETRIC_EQ_WASM_MAXIMUM_BLOCK_SIZE
			|| api.peq_maximum_channels() !== 32
			|| api.peq_maximum_bands() !== 12
			|| api.peq_maximum_sections() !== 48
			|| api.peq_linear_memory_bytes() !== PARAMETRIC_EQ_WASM_MEMORY_BYTES
			|| api.memory.buffer.byteLength !== PARAMETRIC_EQ_WASM_MEMORY_BYTES) {
			throw new ParametricEqWasmError('Parametric EQ WASM ABI limits do not match this application.');
		}
	}

	#requireSuccess(status, context) {
		if (status >= 0) return status;
		throw new ParametricEqWasmError(
			`${context}: ${STATUS_MESSAGES[status] || 'unknown native failure'}`,
			status,
		);
	}
}

function nativeBandType(type, audition) {
	if (!audition) return NATIVE_BAND_TYPES[type];
	if (type === 'lowshelf' || type === 'highpass') {
		return NATIVE_BAND_TYPES.lowpass;
	}
	if (type === 'highshelf' || type === 'lowpass') {
		return NATIVE_BAND_TYPES.highpass;
	}
	return NATIVE_BAND_TYPES.bandpass;
}

function groupSections(sections) {
	const groups = [];
	for (const section of sections) {
		const previous = groups[groups.length - 1];
		if (previous?.[0]?.bandId === section.bandId) previous.push(section);
		else groups.push([section]);
	}
	return groups;
}

function validateDesignedConfiguration(configuration) {
	if (!configuration || typeof configuration !== 'object'
		|| !Array.isArray(configuration.sections)
		|| !configuration.packet || typeof configuration.topologyKey !== 'string'
		|| configuration.sections.length > 48
		|| !Number.isFinite(configuration.sampleRate)) {
		throw new TypeError('Expected a designed parametric EQ configuration.');
	}
	validateCanonicalParams(configuration.packet);
	const groups = groupSections(configuration.sections);
	const auditionBandId = configuration.auditionBandId;
	const packetBands = auditionBandId == null
		? configuration.packet.bands
		: configuration.packet.bands.filter((band) => band.id === auditionBandId);
	if (!Number.isFinite(configuration.outputGainDb)
		|| packetBands.length !== (auditionBandId == null ? configuration.packet.bands.length : 1)
		|| groups.length !== packetBands.length || groups.length > 12) {
		throw new RangeError('Designed parametric EQ topology does not match its packet.');
	}
	const bandIds = new Set();
	for (const [bandIndex, sections] of groups.entries()) {
		const packetBand = packetBands[bandIndex];
		if (sections.length < 1 || sections.length > 4
			|| sections[0].bandId !== packetBand.id
			|| bandIds.has(sections[0].bandId)) {
			throw new RangeError('Designed parametric EQ contains invalid or duplicate band topology.');
		}
		bandIds.add(sections[0].bandId);
		for (const section of sections) {
			const values = section?.tpt;
			if (section.bandId !== packetBand.id
				|| section.bandEnabled !== (auditionBandId == null ? packetBand.enabled : true)
				|| typeof section.bandWet !== 'boolean'
				|| !values || !(values.g > 0) || !(values.k > 0)
				|| ![values.g, values.k, values.m0, values.m1, values.m2]
					.every(Number.isFinite)) {
				throw new RangeError('Designed parametric EQ contains an invalid TPT section.');
			}
		}
	}
}

function validateCanonicalParams(params) {
	if (!params || typeof params !== 'object' || Array.isArray(params)) {
		throw new TypeError('Parametric EQ configuration must be an object.');
	}
	const packet = Object.hasOwn(params, 'version');
	if (packet && params.version !== 1) {
		throw new RangeError('Parametric EQ packet version must be 1.');
	}
	const outputGain = packet ? params.outputGainDb : params.outputGain;
	assertNumberInRange(outputGain, -24, 24, packet ? 'outputGainDb' : 'outputGain');
	if (!Array.isArray(params.bands) || params.bands.length > 12) {
		throw new RangeError('Parametric EQ configuration must contain between zero and 12 bands.');
	}
	const ids = new Set();
	for (let index = 0; index < params.bands.length; index += 1) {
		const band = params.bands[index];
		if (!band || typeof band !== 'object' || Array.isArray(band)) {
			throw new TypeError(`Parametric EQ band ${index} must be an object.`);
		}
		if (typeof band.id !== 'string' || !band.id.trim()
			|| band.id !== band.id.trim() || band.id.length > 160) {
			throw new TypeError(`Parametric EQ band ${index} must have a non-empty ID no longer than 160 characters.`);
		}
		if (ids.has(band.id)) throw new RangeError(`Duplicate parametric EQ band ID: ${band.id}.`);
		ids.add(band.id);
		if (typeof band.enabled !== 'boolean') {
			throw new TypeError(`Parametric EQ band ${band.id} enabled must be boolean.`);
		}
		if (!BAND_TYPES.has(band.type)) {
			throw new RangeError(`Parametric EQ band ${band.id} has an unsupported type.`);
		}
		assertNumberInRange(
			packet ? band.frequencyHz : band.frequency,
			10,
			24_000,
			`band ${band.id} frequency`,
		);
		assertNumberInRange(
			packet ? band.gainDb : band.gain,
			-24,
			24,
			`band ${band.id} gain`,
		);
		assertNumberInRange(band.q, 0.1, 30, `band ${band.id} Q`);
		const slope = packet ? band.slopeDbPerOctave : band.slope;
		if (!CUT_SLOPES.has(slope)) {
			throw new RangeError(`Parametric EQ band ${band.id} slope must be 12, 24, 36, or 48 dB/octave.`);
		}
	}
}

function assertNumberInRange(value, minimum, maximum, name) {
	if (typeof value !== 'number' || !Number.isFinite(value)
		|| value < minimum || value > maximum) {
		throw new RangeError(`Parametric EQ ${name} must be a finite number between ${minimum} and ${maximum}.`);
	}
}

function normalizeInteger(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isInteger(number) || number < minimum || number > maximum) {
		throw new RangeError(`Parametric EQ ${name} must be an integer between ${minimum} and ${maximum}.`);
	}
	return number;
}

function normalizeTransitionFrames(value, fallback) {
	if (value == null) return fallback;
	const frames = Number(value);
	if (!Number.isFinite(frames)) return fallback;
	return Math.max(0, Math.min(1_000_000, Math.round(frames)));
}
