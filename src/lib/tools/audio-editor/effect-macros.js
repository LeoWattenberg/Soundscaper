import {
	AUP4_REALTIME_EFFECT_PROFILES,
	decodeAudacityRealtimeEffectParameters,
	encodeAudacityRealtimeEffectParameters,
} from './aup4-effects.js';
import {
	AUDIO_EFFECT_DEFINITIONS,
	createEffect,
	isAudacityRackEffectType,
	normalizeEffect,
} from './effects.js';
import { createStableId } from './project.js';

const MAX_MACRO_CODE_UNITS = 1024 * 1024;
const MAX_MACRO_LINES = 4_096;
const MAX_MACRO_LINE_CODE_UNITS = 128 * 1024;
const MAX_MACRO_EFFECTS = 256;
const MAX_MACRO_PARAMETERS = 512;
const MAX_EXTENSION_JSON_CODE_UNITS = 64 * 1024;
const MAX_DRAFT_NAME_CODE_UNITS = 256;
const GRAPHIC_EQ_FREQUENCIES = Object.freeze([
	20, 25, 31, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630,
	800, 1_000, 1_250, 1_600, 2_000, 2_500, 3_150, 4_000, 5_000, 6_300, 8_000,
	10_000, 12_500, 16_000, 20_000,
]);

export const AUDACITY_EFFECT_MACRO_COMMANDS = Object.freeze({
	'audacity-auto-duck': 'AutoDuck',
	'audacity-bass-treble': 'BassAndTreble',
	'audacity-click-removal': 'ClickRemoval',
	'audacity-compressor': 'Compressor',
	'audacity-distortion': 'Distortion',
	'audacity-echo': 'Echo',
	'audacity-filter-curve-eq': 'FilterCurve',
	'audacity-graphic-eq': 'GraphicEq',
	'audacity-invert': 'Invert',
	'audacity-limiter': 'Limiter',
	'audacity-noise-reduction': 'NoiseReduction',
	'audacity-phaser': 'Phaser',
	'audacity-classic-filters': 'ClassicFilters',
	'audacity-wahwah': 'Wahwah',
});

const EFFECT_TYPE_BY_COMMAND = new Map(Object.entries(AUDACITY_EFFECT_MACRO_COMMANDS)
	.map(([type, command]) => [command, type]));
// Audacity's source file and older scripting references also call Classic
// Filters "ScienFilter". Import both IDs and always export the current one.
EFFECT_TYPE_BY_COMMAND.set('ScienFilter', 'audacity-classic-filters');

const IGNORED_VISUALIZATION_PARAMETERS = Object.freeze(new Set([
	'showInput', 'showOutput', 'showActual', 'showTarget',
]));

/**
 * Serialize an ordered realtime rack using Audacity text-macro syntax plus
 * namespaced Soundscaper extensions for settings Audacity cannot represent
 * portably. Disabled rack entries are omitted because a macro contains only
 * steps that will run.
 */
export function serializeAudacityEffectMacro(effects) {
	if (!Array.isArray(effects)) throw new TypeError('An effect macro needs an ordered effects array.');
	const lines = [];
	for (const effect of effects) {
		if (effect?.enabled === false) continue;
		const normalized = normalizeEffect(effect);
		if (normalized.type === 'audacity-noise-reduction') {
			// Audacity's macro command stores only a preset reference for Noise
			// Reduction, not the actual automation settings.
			lines.push(formatSoundscaperEffect(normalized));
		} else if (isAudacityRackEffectType(normalized.type)) {
			const command = AUDACITY_EFFECT_MACRO_COMMANDS[normalized.type];
			if (!command) throw new RangeError(`Unsupported Audacity macro effect: ${normalized.type}.`);
			const parameters = encodeAudacityRealtimeEffectParameters(normalized.type, normalized.params)
				.map(([name, value]) => [macroParameterName(name), value]);
			lines.push(formatMacroLine(command, parameters));
		} else {
			if (!Object.hasOwn(AUDIO_EFFECT_DEFINITIONS, normalized.type)) {
				throw new RangeError(`Unsupported Soundscaper macro effect: ${normalized.type}.`);
			}
			lines.push(formatSoundscaperEffect(normalized));
		}
		if (lines.length > MAX_MACRO_EFFECTS) throw new RangeError('An effect macro has too many steps.');
	}
	if (!lines.length) throw new RangeError('An effect macro needs at least one enabled effect.');
	const output = `${lines.join('\n')}\n`;
	if (output.length > MAX_MACRO_CODE_UNITS) throw new RangeError('The effect macro is too large.');
	return output;
}

/**
 * Parse the supported effect subset of Audacity text-macro syntax, including
 * namespaced Soundscaper extensions. Valid non-effect commands are ignored and
 * reported by command ID. Any malformed supported effect aborts the whole
 * import; no partial chain is returned.
 */
export function parseAudacityEffectMacro(text, options = {}) {
	if (typeof text !== 'string') throw new TypeError('An Audacity macro must be text.');
	if (text.length > MAX_MACRO_CODE_UNITS) throw new RangeError('The effect macro is too large.');
	const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	const lines = source.split(/\r\n?|\n/);
	if (lines.length > MAX_MACRO_LINES) throw new RangeError('The effect macro has too many lines.');

	const parsed = [];
	const ignoredCommands = [];
	const ignoredCommandSet = new Set();
	for (let index = 0; index < lines.length; index += 1) {
		const lineNumber = index + 1;
		const line = lines[index].trim();
		if (!line) continue;
		if (line.length > MAX_MACRO_LINE_CODE_UNITS) {
			throw macroSyntaxError(lineNumber, 'the line is too long');
		}
		const separator = line.indexOf(':');
		if (separator < 0) {
			// Audacity ignores colonless lines. Preserve that behavior while still
			// surfacing a command-looking line to callers.
			if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(line)) addIgnoredCommand(line);
			continue;
		}
		const command = line.slice(0, separator).trim();
		if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(command)) {
			throw macroSyntaxError(lineNumber, 'the command ID is malformed');
		}
		const effectType = EFFECT_TYPE_BY_COMMAND.get(command);
		if (!effectType && command !== 'SoundscaperEffect') {
			addIgnoredCommand(command);
			continue;
		}
		try {
			const fields = parseMacroParameters(line.slice(separator + 1), lineNumber);
			parsed.push(command === 'SoundscaperEffect'
				? parseSoundscaperEffect(fields)
				: parseAudacityEffect(effectType, command, fields));
		} catch (error) {
			if (error instanceof SyntaxError && /line \d+/.test(error.message)) throw error;
			const message = error instanceof Error ? error.message : String(error);
			throw macroSyntaxError(lineNumber, message, error);
		}
		if (parsed.length > MAX_MACRO_EFFECTS) throw new RangeError('An effect macro has too many steps.');
	}
	if (!parsed.length) throw new RangeError('The macro contains no supported effects.');

	const idFactory = typeof options.idFactory === 'function' ? options.idFactory : createStableId;
	const effects = parsed.map((effect, index) => {
		const id = idFactory('effect', index);
		assertStableId(id, `effect at index ${index}`);
		const effectOptions = { id, enabled: true, params: effect.params };
		if (effect.context !== undefined) effectOptions.context = effect.context;
		return freezeValue(createEffect(effect.type, effectOptions));
	});
	assertUniqueEffectIds(effects);
	return Object.freeze({
		effects: Object.freeze(effects),
		ignoredCommands: Object.freeze(ignoredCommands),
	});

	function addIgnoredCommand(command) {
		if (ignoredCommandSet.has(command)) return;
		ignoredCommandSet.add(command);
		ignoredCommands.push(command);
	}
}

/** Create a named, immutable macro draft for the macro manager. */
export function createEffectMacroDraft(options = {}) {
	if (!isPlainObject(options)) throw new TypeError('Effect macro draft options must be an object.');
	return normalizeEffectMacroDraft({
		...options,
		name: options.name ?? 'Untitled macro',
		effects: options.effects ?? [],
	}, options);
}

/**
 * Normalize a macro manager draft to its settings-only model. Effect routing,
 * processor state, disabled entries, and other rack-only metadata are omitted;
 * a portable Noise Reduction profile is retained with its step.
 */
export function normalizeEffectMacroDraft(value, options = {}) {
	if (!isPlainObject(value)) throw new TypeError('An effect macro draft must be an object.');
	const idFactory = typeof options.idFactory === 'function' ? options.idFactory : createStableId;
	const id = value.id ?? idFactory('macro');
	assertStableId(id, 'macro draft');
	const name = nonEmptyBoundedString(value.name, 'Macro name', MAX_DRAFT_NAME_CODE_UNITS);
	if (!Array.isArray(value.effects)) throw new TypeError('An effect macro draft needs an ordered effects array.');
	const effects = [];
	for (const [index, candidate] of value.effects.entries()) {
		if (candidate?.enabled === false) continue;
		const effectId = typeof candidate?.id === 'string' && candidate.id
			? candidate.id
			: idFactory('effect', index);
		assertStableId(effectId, `effect at index ${index}`);
		const effectOptions = {
			id: effectId,
			enabled: true,
			params: candidate?.params,
		};
		if (candidate?.type === 'audacity-noise-reduction' && candidate.context?.noiseProfile) {
			effectOptions.context = normalizeNoiseReductionContext({
				noiseProfile: candidate.context.noiseProfile,
			});
		}
		const effect = createEffect(candidate?.type, effectOptions);
		effects.push(freezeValue(effect));
		if (effects.length > MAX_MACRO_EFFECTS) throw new RangeError('An effect macro has too many steps.');
	}
	assertUniqueEffectIds(effects);
	return Object.freeze({ id, name, effects: Object.freeze(effects) });
}

function parseAudacityEffect(type, command, fields) {
	if (fields.has('Use_Preset')) {
		const preset = fields.get('Use_Preset');
		throw new RangeError(`${command} references unresolved Audacity preset ${JSON.stringify(preset)}; its settings are not stored in the macro text.`);
	}
	const profile = AUP4_REALTIME_EFFECT_PROFILES[type];
	const nativeNameByMacroName = new Map(profile.params.map((descriptor) => [
		macroParameterName(descriptor.native), descriptor.native,
	]));
	const native = new Map();
	for (const [name, rawValue] of fields) {
		const nativeName = nativeNameByMacroName.get(name);
		if (nativeName) {
			native.set(nativeName, decimalCommaValue(rawValue));
			continue;
		}
		if (/^[fv]\d+$/.test(name) && (profile.curve || profile.bands)) {
			native.set(name, decimalCommaValue(rawValue));
			continue;
		}
		if (IGNORED_VISUALIZATION_PARAMETERS.has(name)
			&& (type === 'audacity-compressor' || type === 'audacity-limiter')) continue;
		throw new RangeError(`Unsupported ${command} parameter: ${name}.`);
	}
	validateEqualizationParameters(type, profile, native);
	const params = decodeAudacityRealtimeEffectParameters(type, native);
	// A fixed temporary ID validates defaults, ranges, live constraints, enums,
	// and curves before any caller-provided ID factory is touched.
	return createEffect(type, { id: 'macro-parse-validation', params });
}

function parseSoundscaperEffect(fields) {
	for (const name of fields.keys()) {
		if (name !== 'Type' && name !== 'Params' && name !== 'Context') {
			throw new RangeError(`Unsupported SoundscaperEffect parameter: ${name}.`);
		}
	}
	if (!fields.has('Type') || !fields.has('Params')) {
		throw new RangeError('SoundscaperEffect requires Type and Params.');
	}
	const type = fields.get('Type');
	if (!Object.hasOwn(AUDIO_EFFECT_DEFINITIONS, type) && type !== 'audacity-noise-reduction') {
		throw new RangeError(`Unsupported Soundscaper effect type: ${type}.`);
	}
	const json = fields.get('Params');
	if (json.length > MAX_EXTENSION_JSON_CODE_UNITS) {
		throw new RangeError('SoundscaperEffect Params is too large.');
	}
	let params;
	try {
		params = JSON.parse(json);
	} catch (cause) {
		throw new SyntaxError(`Invalid SoundscaperEffect Params JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
	}
	if (!isPlainObject(params)) throw new TypeError('SoundscaperEffect Params must be a JSON object.');
	const knownNames = new Set(Object.keys(createEffect(type, { id: 'macro-extension-defaults' }).params));
	for (const name of Object.keys(params)) {
		if (!knownNames.has(name)) throw new RangeError(`Unsupported ${type} parameter: ${name}.`);
	}
	const effectOptions = { id: 'macro-parse-validation', params };
	if (fields.has('Context')) {
		if (type !== 'audacity-noise-reduction') {
			throw new RangeError('SoundscaperEffect Context is supported only for Noise Reduction.');
		}
		const contextJson = fields.get('Context');
		if (contextJson.length > MAX_EXTENSION_JSON_CODE_UNITS) {
			throw new RangeError('SoundscaperEffect Context is too large.');
		}
		let context;
		try {
			context = JSON.parse(contextJson);
		} catch (cause) {
			throw new SyntaxError(`Invalid SoundscaperEffect Context JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
		}
		effectOptions.context = normalizeNoiseReductionContext(context);
	}
	return createEffect(type, effectOptions);
}

function validateEqualizationParameters(type, profile, parameters) {
	if (!profile.curve && !profile.bands) return;
	const indexes = new Set();
	for (const name of parameters.keys()) {
		const match = /^([fv])(\d+)$/.exec(name);
		if (!match) continue;
		const index = Number(match[2]);
		if (index >= 200) throw new RangeError('Audacity equalization curves support at most 200 points.');
		indexes.add(index);
	}
	if (!indexes.size) return;
	const maximum = Math.max(...indexes);
	const points = [];
	for (let index = 0; index <= maximum; index += 1) {
		if (!parameters.has(`f${index}`) || !parameters.has(`v${index}`)) {
			throw new RangeError('Audacity equalization points must be contiguous fN/vN pairs.');
		}
		const frequency = finiteParameterNumber(parameters.get(`f${index}`));
		const gain = finiteParameterNumber(parameters.get(`v${index}`));
		if (!(frequency > 0) || gain === undefined) {
			throw new RangeError(`Invalid Audacity equalization point f${index}/v${index}.`);
		}
		if (points.length && frequency <= points.at(-1).frequency) {
			throw new RangeError('Audacity equalization frequencies must be strictly increasing.');
		}
		points.push({ frequency, gain });
	}
	if (!profile.bands) return;
	for (const name of [...parameters.keys()]) {
		if (/^[fv]\d+$/.test(name)) parameters.delete(name);
	}
	for (const [index, frequency] of GRAPHIC_EQ_FREQUENCIES.entries()) {
		parameters.set(`f${index}`, String(frequency));
		parameters.set(`v${index}`, String(interpolateLogFrequency(points, frequency)));
	}
}

function interpolateLogFrequency(points, frequency) {
	if (frequency <= points[0].frequency) return points[0].gain;
	if (frequency >= points.at(-1).frequency) return points.at(-1).gain;
	for (let index = 1; index < points.length; index += 1) {
		const right = points[index];
		if (frequency > right.frequency) continue;
		const left = points[index - 1];
		const ratio = Math.log(frequency / left.frequency) / Math.log(right.frequency / left.frequency);
		return left.gain + (right.gain - left.gain) * ratio;
	}
	return points.at(-1).gain;
}

function formatSoundscaperEffect(effect) {
	const parameters = [
		['Type', effect.type],
		['Params', JSON.stringify(effect.params)],
	];
	if (effect.type === 'audacity-noise-reduction' && effect.context?.noiseProfile) {
		const context = JSON.stringify(normalizeNoiseReductionContext({
			noiseProfile: effect.context.noiseProfile,
		}));
		if (context.length > MAX_EXTENSION_JSON_CODE_UNITS) {
			throw new RangeError('SoundscaperEffect Context is too large.');
		}
		parameters.push(['Context', context]);
	}
	return formatMacroLine('SoundscaperEffect', parameters);
}

function normalizeNoiseReductionContext(value) {
	if (!isPlainObject(value) || !isPlainObject(value.noiseProfile)) {
		throw new TypeError('Noise Reduction Context requires a noiseProfile object.');
	}
	for (const name of Object.keys(value)) {
		if (name !== 'noiseProfile') throw new RangeError(`Unsupported Noise Reduction Context parameter: ${name}.`);
	}
	const profile = value.noiseProfile;
	const supportedNames = new Set([
		'type', 'version', 'sampleRate', 'windowSize', 'stepsPerWindow', 'windowType',
		'channelCount', 'windowCount', 'meanPowers',
	]);
	for (const name of Object.keys(profile)) {
		if (!supportedNames.has(name)) throw new RangeError(`Unsupported Noise Reduction profile parameter: ${name}.`);
	}
	if (profile.type !== 'audacity-noise-profile' || profile.version !== 1) {
		throw new TypeError('Noise Reduction Context requires an Audacity noise profile version 1.');
	}
	if (!Number.isInteger(profile.sampleRate) || profile.sampleRate <= 0) {
		throw new RangeError('The Noise Reduction profile sample rate is invalid.');
	}
	if (profile.windowSize !== 2_048 || profile.stepsPerWindow !== 4) {
		throw new RangeError('The Noise Reduction profile analysis settings are incompatible.');
	}
	if (profile.windowType !== undefined && profile.windowType !== 'hann-hann') {
		throw new RangeError('The Noise Reduction profile window type is incompatible.');
	}
	for (const name of ['channelCount', 'windowCount']) {
		if (profile[name] !== undefined && (!Number.isInteger(profile[name]) || profile[name] <= 0)) {
			throw new RangeError(`The Noise Reduction profile ${name} is invalid.`);
		}
	}
	if (!Array.isArray(profile.meanPowers) || profile.meanPowers.length !== 1_025) {
		throw new TypeError('The Noise Reduction profile spectrum is invalid.');
	}
	for (const [index, power] of profile.meanPowers.entries()) {
		if (!Number.isFinite(power) || power < 0) {
			throw new RangeError(`The Noise Reduction profile spectrum is invalid at bin ${index}.`);
		}
	}
	return {
		noiseProfile: {
			...profile,
			meanPowers: [...profile.meanPowers],
		},
	};
}

function parseMacroParameters(source, lineNumber) {
	const output = new Map();
	let offset = 0;
	let count = 0;
	while (offset < source.length) {
		while (/\s/.test(source[offset] || '')) offset += 1;
		if (offset >= source.length) break;
		count += 1;
		if (count > MAX_MACRO_PARAMETERS) throw macroSyntaxError(lineNumber, 'too many parameters');
		const nameStart = offset;
		while (offset < source.length && source[offset] !== '=') offset += 1;
		if (offset >= source.length) throw macroSyntaxError(lineNumber, 'a parameter is missing =');
		const name = source.slice(nameStart, offset).trim();
		if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)) {
			throw macroSyntaxError(lineNumber, `the parameter name ${JSON.stringify(name)} is malformed`);
		}
		offset += 1;
		while (/\s/.test(source[offset] || '')) offset += 1;
		if (source[offset] !== '"') throw macroSyntaxError(lineNumber, `${name} must have a quoted value`);
		offset += 1;
		let value = '';
		let closed = false;
		while (offset < source.length) {
			const character = source[offset++];
			if (character === '"') {
				closed = true;
				break;
			}
			if (character !== '\\') {
				value += character;
				continue;
			}
			if (offset >= source.length) throw macroSyntaxError(lineNumber, `${name} has an incomplete escape`);
			const escaped = source[offset++];
			if (escaped === '\\' || escaped === '"') value += escaped;
			else if (escaped === 'n') value += '\n';
			else throw macroSyntaxError(lineNumber, `${name} has an unsupported \\${escaped} escape`);
		}
		if (!closed) throw macroSyntaxError(lineNumber, `${name} has an unterminated quoted value`);
		if (offset < source.length && !/\s/.test(source[offset])) {
			throw macroSyntaxError(lineNumber, `unexpected text after ${name}`);
		}
		// Audacity's config-backed parser uses the final occurrence.
		output.set(name, value);
	}
	return output;
}

function formatMacroLine(command, parameters) {
	const suffix = parameters.map(([name, value]) => `${name}=${quoteMacroValue(value)}`).join(' ');
	const line = `${command}:${suffix}`;
	if (line.length > MAX_MACRO_LINE_CODE_UNITS) throw new RangeError('An effect macro line is too large.');
	return line;
}

function quoteMacroValue(value) {
	return `"${String(value)
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\n/g, '\\n')}"`;
}

function macroParameterName(name) {
	return String(name).replace(/[ /\\:=]/g, '_');
}

function decimalCommaValue(value) {
	const text = String(value).trim();
	return /^[+-]?(?:\d+,\d*|\d*,\d+)(?:[eE][+-]?\d+)?$/.test(text)
		? text.replace(',', '.')
		: value;
}

function finiteParameterNumber(value) {
	const number = Number(value);
	return Number.isFinite(number) ? number : undefined;
}

function macroSyntaxError(lineNumber, message, cause) {
	return new SyntaxError(`Invalid effect macro line ${lineNumber}: ${message}`, cause ? { cause } : undefined);
}

function nonEmptyBoundedString(value, name, maximum) {
	const output = String(value ?? '').trim();
	if (!output) throw new TypeError(`${name} must be a non-empty string.`);
	if (output.length > maximum) throw new RangeError(`${name} is too long.`);
	return output;
}

function assertStableId(value, name) {
	if (typeof value !== 'string' || !value || value.length > 1_024) {
		throw new TypeError(`The ${name} needs a bounded stable string ID.`);
	}
}

function assertUniqueEffectIds(effects) {
	if (new Set(effects.map(({ id }) => id)).size !== effects.length) {
		throw new RangeError('Effect macro step IDs must be unique.');
	}
}

function isPlainObject(value) {
	if (!value || typeof value !== 'object') return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function freezeValue(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) freezeValue(child);
	return Object.freeze(value);
}
