/*
 * Validated request/result protocol shared by the Nyquist worker and client.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { stripNyquistPluginHeader } from './plugin-parser.js';

export const NYQUIST_WASM_ABI_VERSION = 1;
export const NYQUIST_DEFAULT_TIMEOUT_MS = 120_000;
export const NYQUIST_MAX_SOURCE_BYTES = 4 * 1024 * 1024;
export const NYQUIST_MAX_CHANNELS = 32;
// Input and result buffers coexist in the 256 MiB WASM heap. Capping each
// side at 96 MiB leaves space for Nyquist's Lisp heap and delayed DSP nodes.
export const NYQUIST_MAX_TOTAL_AUDIO_SAMPLES = 24 * 1024 * 1024;
export const NYQUIST_MAX_TEXT_BYTES = 1024 * 1024;

const MIN_SAMPLE_RATE = 1_000;
const MAX_SAMPLE_RATE = 768_000;
const MAX_BINDINGS = 256;
const MAX_LIST_ITEMS = 4_096;
const MAX_VALUE_DEPTH = 12;
const HOST_OBJECTS = new Set([
	'AUDACITY',
	'PROJECT',
	'SELECTION',
	'SYSTEM-TIME',
	'TRACK',
]);
const SYMBOL_PATTERN = /^[A-Za-z*][A-Za-z0-9_:+*/<>=!?$%&~^.-]*$/;
const PROPERTY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const encoder = new TextEncoder();

export function normalizeNyquistRequest(value, options = {}) {
	if (!isPlainObject(value)) throw new TypeError('A Nyquist evaluation request is required.');
	const source = requireBoundedText(value.source ?? value.program, 'Nyquist source', NYQUIST_MAX_SOURCE_BYTES);
	if (!source.trim()) throw new RangeError('Nyquist source must not be empty.');
	if (source.includes('\0')) throw new RangeError('Nyquist source must not contain NUL characters.');
	const language = String(value.language || 'lisp').trim().toLowerCase();
	if (language !== 'lisp' && language !== 'sal') throw new RangeError('Nyquist language must be "lisp" or "sal".');
	const sampleRate = normalizeInteger(value.sampleRate ?? 44_100, 'Nyquist sample rate', MIN_SAMPLE_RATE, MAX_SAMPLE_RATE);
	const channels = normalizeChannels(value.channels, options.copyInput === true);
	const frameCount = channels[0]?.length || 0;
	if (channels.length > 0 && frameCount === 0) {
		throw new RangeError('Nyquist input channels must not be empty; use no channels for a generator.');
	}
	const maximumBySamples = Math.floor(NYQUIST_MAX_TOTAL_AUDIO_SAMPLES / Math.max(1, channels.length));
	const suggestedMaximum = Math.max(
		sampleRate * 1_800,
		frameCount,
		Math.min(Number.MAX_SAFE_INTEGER, frameCount * 8),
	);
	const maxOutputFrames = value.maxOutputFrames == null
		? Math.min(maximumBySamples, suggestedMaximum)
		: Math.min(
			maximumBySamples,
			normalizeInteger(value.maxOutputFrames, 'Nyquist maximum output frames', 1, 0x7fff_ffff),
		);
	const encodedLispBudget = { used: 0, maximum: NYQUIST_MAX_SOURCE_BYTES };
	return {
		source,
		language,
		sampleRate,
		channels,
		controls: normalizeBindings(value.controls, 'control', encodedLispBudget),
		properties: normalizeProperties(value.properties ?? value.hostProperties, encodedLispBudget),
		globals: normalizeBindings(value.globals, 'global', encodedLispBudget),
		maxOutputFrames,
		debug: value.debug === true,
	};
}

export function buildNyquistEvaluationSource(value, options = {}) {
	const request = options.normalized === true ? value : normalizeNyquistRequest(value || {});
	const inputFrames = request.channels[0]?.length || 0;
	const selectionEnd = inputFrames / request.sampleRate;
	const lines = [
		'(snd-set-latency 0.1)',
		'(setf S 0.25)',
		'(setf *PREVIEWP* NIL)',
		"(putprop '*AUDACITY* (list 3 7 7) 'VERSION)",
		"(putprop '*AUDACITY* \"en\" 'LANGUAGE)",
		`(putprop '*PROJECT* (float ${request.sampleRate}) 'RATE)`,
		"(putprop '*PROJECT* 6.0 'PREVIEW-DURATION)",
		`(putprop '*SELECTION* ${request.channels.length} 'CHANNELS)`,
		`(putprop '*SELECTION* (list${request.channels.length ? ' 1' : ''}) 'TRACKS)`,
		"(putprop '*SELECTION* 0.0 'START)",
		`(putprop '*SELECTION* ${formatFloat(selectionEnd)} 'END)`,
		"(putprop '*TRACK* 1 'INDEX)",
		`(putprop '*TRACK* ${request.channels.length} 'CHANNELS)`,
		`(putprop '*TRACK* (float ${request.sampleRate}) 'RATE)`,
	];
	for (const [hostObject, properties] of Object.entries(request.properties)) {
		for (const [property, propertyValue] of Object.entries(properties)) {
			lines.push(`(putprop '*${hostObject}* ${toLisp(propertyValue)} '${property})`);
		}
	}
	for (const [name, bindingValue] of Object.entries(request.globals)) {
		lines.push(`(setf ${name} ${toLisp(bindingValue)})`);
	}
	// A worker has no interactive XLISP break console. Errors must unwind back
	// through Nyx so the client can report them or enforce its hard deadline.
	lines.push('(setf *breakenable* NIL)');
	lines.push(`(setf *tracenable* ${request.debug ? 'T' : 'NIL'})`);
	for (const [name, controlValue] of Object.entries(request.controls)) {
		lines.push(`(setf ${name} ${toLisp(controlValue)})`);
	}
	const program = /^\s*[$;]nyquist\s+plug-?in\s*$/im.test(request.source)
		? stripNyquistPluginHeader(request.source)
		: request.source;
	if (request.language === 'lisp') {
		lines.push(program);
	} else {
		const salSource = `${program}\nset aud:result = main()\n`;
		if (request.debug) {
			lines.push('(setf *tracenable* NIL)');
			lines.push('(setf *breakenable* NIL)');
			lines.push('(setf *sal-traceback* T)');
		}
		lines.push('(setf *sal-call-stack* NIL)');
		lines.push('(setf aud:result NIL)');
		lines.push(`(sal-compile-audacity "${escapeLispString(salSource)}" T T NIL)`);
		lines.push('(prog1 aud:result (setf aud:result NIL))');
	}
	const source = `${lines.join('\n')}\n`;
	if (encoder.encode(source).byteLength > NYQUIST_MAX_SOURCE_BYTES) {
		throw new RangeError(`Prepared Nyquist source exceeds ${NYQUIST_MAX_SOURCE_BYTES} UTF-8 bytes.`);
	}
	return source;
}

export function normalizeNyquistResult(value) {
	if (!isPlainObject(value)) throw new TypeError('Nyquist returned an invalid result.');
	const type = String(value.type || '');
	const output = optionalBoundedText(value.output, 'Nyquist output', NYQUIST_MAX_TEXT_BYTES);
	if (type === 'audio') {
		const sampleRate = normalizeInteger(value.sampleRate, 'Nyquist result sample rate', MIN_SAMPLE_RATE, MAX_SAMPLE_RATE);
		const channels = normalizeChannels(value.channels, false);
		if (channels.length < 1) throw new RangeError('Nyquist audio results require at least one channel.');
		const frameCount = channels[0].length;
		if (value.frameCount != null && value.frameCount !== frameCount) {
			throw new RangeError('Nyquist audio result frame count does not match its channel data.');
		}
		return { type, channels, sampleRate, frameCount, output };
	}
	if (type === 'labels') {
		if (!Array.isArray(value.labels)) throw new TypeError('Nyquist label results require a labels array.');
		if (value.labels.length > MAX_LIST_ITEMS * 16) throw new RangeError('Nyquist returned too many labels.');
		const textBudget = { used: 0, maximum: NYQUIST_MAX_TEXT_BYTES };
		const labels = value.labels.map((label, index) => normalizeLabel(label, index, textBudget));
		return { type, labels, output };
	}
	if (type === 'message') {
		const message = requireBoundedText(value.message, 'Nyquist result message', NYQUIST_MAX_TEXT_BYTES, true);
		return { type, message, output };
	}
	if (type === 'number') {
		const numericType = value.numericType === 'integer' ? 'integer' : 'double';
		const number = Number(value.value);
		if (!Number.isFinite(number)) throw new RangeError('Nyquist returned a non-finite number.');
		if (numericType === 'integer' && !Number.isSafeInteger(number)) {
			throw new RangeError('Nyquist returned an unsafe integer.');
		}
		return { type, value: number, numericType, output };
	}
	throw new RangeError(`Nyquist returned unsupported result type "${type || 'unknown'}".`);
}

export function nyquistTransferableBuffers(result) {
	if (result?.type !== 'audio' || !Array.isArray(result.channels)) return [];
	return [...new Set(result.channels.map((channel) => channel.buffer))]
		.filter((buffer) => buffer instanceof ArrayBuffer);
}

function normalizeChannels(value, copy) {
	const input = value == null ? [] : value;
	if (!Array.isArray(input)) throw new TypeError('Nyquist channels must be an array.');
	if (input.length > NYQUIST_MAX_CHANNELS) {
		throw new RangeError(`Nyquist supports at most ${NYQUIST_MAX_CHANNELS} channels.`);
	}
	let frames = null;
	let totalSamples = 0;
	return input.map((channel, index) => {
		let normalized;
		if (channel instanceof Float32Array) normalized = copy ? new Float32Array(channel) : channel;
		else if (ArrayBuffer.isView(channel) || Array.isArray(channel)) normalized = Float32Array.from(channel);
		else throw new TypeError(`Nyquist channel ${index} must be Float32 audio.`);
		if (frames == null) frames = normalized.length;
		else if (normalized.length !== frames) throw new RangeError('Nyquist channels must have matching frame counts.');
		totalSamples += normalized.length;
		if (totalSamples > NYQUIST_MAX_TOTAL_AUDIO_SAMPLES) throw new RangeError('Nyquist input exceeds the audio memory limit.');
		for (let offset = 0; offset < normalized.length; offset += 1) {
			if (!Number.isFinite(normalized[offset])) throw new RangeError(`Nyquist channel ${index} contains a non-finite sample.`);
		}
		return normalized;
	});
}

function normalizeBindings(value, kind, encodedLispBudget) {
	if (value == null) return {};
	if (!isPlainObject(value)) throw new TypeError(`Nyquist ${kind}s must be an object.`);
	const entries = Object.entries(value);
	if (entries.length > MAX_BINDINGS) throw new RangeError(`Nyquist has too many ${kind} bindings.`);
	return Object.fromEntries(entries.map(([name, bindingValue]) => {
		const symbol = kind === 'global' && name.toUpperCase() === 'PREVIEWP' ? '*PREVIEWP*' : name;
		if (!SYMBOL_PATTERN.test(symbol)) throw new RangeError(`Invalid Nyquist ${kind} name "${name}".`);
		consumeEncodedLispText(encodedLispBudget, `(setf ${symbol} )\n`);
		return [symbol, normalizeLispValue(bindingValue, 0, encodedLispBudget)];
	}));
}

function normalizeProperties(value, encodedLispBudget) {
	if (value == null) return {};
	if (!isPlainObject(value)) throw new TypeError('Nyquist host properties must be an object.');
	const groups = Object.entries(value);
	if (groups.length > HOST_OBJECTS.size) throw new RangeError('Nyquist has too many host-property groups.');
	let count = 0;
	return Object.fromEntries(groups.map(([groupName, properties]) => {
		const hostObject = normalizeHostName(groupName);
		if (!HOST_OBJECTS.has(hostObject)) throw new RangeError(`Unsupported Nyquist host object "${groupName}".`);
		if (!isPlainObject(properties)) throw new TypeError(`Nyquist ${hostObject} properties must be an object.`);
		const entries = Object.entries(properties).map(([propertyName, propertyValue]) => {
			if (!PROPERTY_PATTERN.test(propertyName)) throw new RangeError(`Invalid Nyquist property name "${propertyName}".`);
			count += 1;
			if (count > MAX_BINDINGS) throw new RangeError('Nyquist has too many host properties.');
			const property = propertyName.replaceAll('_', '-').toUpperCase();
			consumeEncodedLispText(encodedLispBudget, `(putprop '*${hostObject}*  '${property})\n`);
			return [property, normalizeHostPropertyValue(hostObject, property, propertyValue, encodedLispBudget)];
		});
		return [hostObject, Object.fromEntries(entries)];
	}));
}

function normalizeHostPropertyValue(hostObject, property, value, encodedLispBudget) {
	const normalized = normalizeLispValue(value, 0, encodedLispBudget);
	if (Array.isArray(normalized) && hostObject === 'SELECTION' && (property === 'PEAK' || property === 'RMS')) {
		consumeEncodedLispBytes(encodedLispBudget, 2);
		return { kind: 'vector', values: normalized };
	}
	if (Array.isArray(normalized) && hostObject === 'TRACK' && (property === 'CLIPS' || property === 'INCLIPS')
		&& normalized.length > 0
		&& (Array.isArray(normalized[0]?.[0]) || normalized.every((channelClips) => Array.isArray(channelClips) && channelClips.length === 0))) {
		consumeEncodedLispBytes(encodedLispBudget, 2);
		return { kind: 'vector', values: normalized };
	}
	return normalized;
}

function normalizeHostName(value) {
	return String(value).trim().replace(/^\*|\*$/g, '').replaceAll('_', '-').toUpperCase();
}

function normalizeLispValue(value, depth, encodedLispBudget) {
	if (depth > MAX_VALUE_DEPTH) throw new RangeError('Nyquist binding value is nested too deeply.');
	if (value == null || typeof value === 'boolean') {
		consumeEncodedLispBytes(encodedLispBudget, value === true ? 1 : 3);
		return value;
	}
	if (typeof value === 'string') {
		requireBoundedText(value, 'Nyquist binding string', NYQUIST_MAX_TEXT_BYTES, true);
		let escapedCharacters = 0;
		for (let index = 0; index < value.length; index += 1) {
			if (value[index] === '\\' || value[index] === '"') escapedCharacters += 1;
		}
		consumeEncodedLispBytes(encodedLispBudget, encoder.encode(value).byteLength + escapedCharacters + 2);
		return value;
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new RangeError('Nyquist binding numbers must be finite.');
		consumeEncodedLispText(encodedLispBudget, Number.isInteger(value) ? String(value) : formatFloat(value));
		return value;
	}
	if (Array.isArray(value)) {
		if (value.length > MAX_LIST_ITEMS) throw new RangeError('Nyquist binding list is too long.');
		consumeEncodedLispBytes(encodedLispBudget, 6 + value.length);
		return value.map((item) => normalizeLispValue(item, depth + 1, encodedLispBudget));
	}
	if (isPlainObject(value) && (value.kind === 'vector' || value.kind === 'symbol')) {
		if (value.kind === 'symbol') {
			if (!SYMBOL_PATTERN.test(value.value || '')) throw new RangeError('Nyquist symbolic binding is invalid.');
			consumeEncodedLispText(encodedLispBudget, value.value);
			return { kind: 'symbol', value: value.value };
		}
		if (!Array.isArray(value.values) || value.values.length > MAX_LIST_ITEMS) {
			throw new RangeError('Nyquist vector binding is invalid.');
		}
		consumeEncodedLispBytes(encodedLispBudget, 8 + value.values.length);
		return {
			kind: 'vector',
			values: value.values.map((item) => normalizeLispValue(item, depth + 1, encodedLispBudget)),
		};
	}
	throw new TypeError('Nyquist bindings support only strings, finite numbers, booleans, lists, vectors, and symbols.');
}

function toLisp(value) {
	if (value == null || value === false) return 'NIL';
	if (value === true) return 'T';
	if (typeof value === 'number') return Number.isInteger(value) ? String(value) : formatFloat(value);
	if (typeof value === 'string') return `"${escapeLispString(value)}"`;
	if (Array.isArray(value)) return `(list${value.length ? ` ${value.map(toLisp).join(' ')}` : ''})`;
	if (value?.kind === 'symbol') return value.value;
	if (value?.kind === 'vector') return `(vector${value.values.length ? ` ${value.values.map(toLisp).join(' ')}` : ''})`;
	throw new TypeError('Unable to encode Nyquist binding.');
}

function formatFloat(value) {
	const text = String(value);
	return text.includes('.') || /e/i.test(text) ? text : `${text}.0`;
}

function escapeLispString(value) {
	return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function normalizeLabel(value, index, textBudget) {
	if (!isPlainObject(value)) throw new TypeError(`Nyquist label ${index} is invalid.`);
	const start = Number(value.start);
	const end = value.end == null ? start : Number(value.end);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
		throw new RangeError(`Nyquist label ${index} has invalid times.`);
	}
	const text = requireBoundedText(value.text ?? '', `Nyquist label ${index} text`, NYQUIST_MAX_TEXT_BYTES, true);
	consumeTextBytes(textBudget, encoder.encode(text).byteLength, 'Nyquist aggregate label text');
	return { start, end, text };
}

function consumeEncodedLispText(budget, value) {
	consumeEncodedLispBytes(budget, encoder.encode(value).byteLength);
}

function consumeEncodedLispBytes(budget, byteLength) {
	if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > budget.maximum - budget.used) {
		throw new RangeError(`Nyquist encoded-Lisp binding/property budget exceeds ${budget.maximum} UTF-8 bytes.`);
	}
	budget.used += byteLength;
}

function consumeTextBytes(budget, byteLength, label) {
	if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > budget.maximum - budget.used) {
		throw new RangeError(`${label} exceeds ${budget.maximum} UTF-8 bytes.`);
	}
	budget.used += byteLength;
}

function normalizeInteger(value, label, minimum, maximum) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
		throw new RangeError(`${label} must be an integer between ${minimum} and ${maximum}.`);
	}
	return number;
}

function requireBoundedText(value, label, maximumBytes, allowEmpty = false) {
	if (typeof value !== 'string') throw new TypeError(`${label} must be text.`);
	if (!allowEmpty && !value.length) throw new RangeError(`${label} must not be empty.`);
	if (encoder.encode(value).byteLength > maximumBytes) throw new RangeError(`${label} is too large.`);
	return value;
}

function optionalBoundedText(value, label, maximumBytes) {
	return value == null ? '' : requireBoundedText(value, label, maximumBytes, true);
}

function isPlainObject(value) {
	if (!value || typeof value !== 'object') return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
