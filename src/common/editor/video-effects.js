import { createStableId } from './stable-id.js';

function parameter(label, labelKey, defaultValue, minimum, maximum, step, options = {}) {
	return Object.freeze({
		label,
		labelKey,
		default: defaultValue,
		min: minimum,
		max: maximum,
		step,
		integer: Boolean(options.integer),
		...(options.unit ? { unit: options.unit } : {}),
	});
}

function definition(type, label, labelKey, ffmpegFilter, params) {
	return Object.freeze({
		type,
		label,
		labelKey,
		shader: type,
		ffmpegFilter,
		params: Object.freeze(params),
	});
}

export const VIDEO_EFFECT_DEFINITIONS = Object.freeze({
	'color-adjust': definition('color-adjust', 'Color Adjust', 'videoEffectColorAdjust', 'eq-hue', {
		brightness: parameter('Brightness', 'videoEffectParamBrightness', 0, -1, 1, 0.01),
		contrast: parameter('Contrast', 'videoEffectParamContrast', 1, 0, 2, 0.01),
		saturation: parameter('Saturation', 'videoEffectParamSaturation', 1, 0, 3, 0.01),
		gamma: parameter('Gamma', 'videoEffectParamGamma', 1, 0.25, 4, 0.01),
		hueDegrees: parameter('Hue', 'videoEffectParamHue', 0, -180, 180, 1, { unit: 'degrees' }),
	}),
	pixelate: definition('pixelate', 'Pixelate', 'videoEffectPixelate', 'pixelize', {
		blockSize: parameter('Block size', 'videoEffectParamBlockSize', 16, 2, 128, 1, { integer: true, unit: 'pixels' }),
	}),
	vignette: definition('vignette', 'Vignette', 'videoEffectVignette', 'vignette', {
		amount: parameter('Amount', 'videoEffectParamAmount', 0.5, 0, 1, 0.01),
	}),
	'gaussian-blur': definition('gaussian-blur', 'Gaussian Blur', 'videoEffectGaussianBlur', 'gblur', {
		sigma: parameter('Radius', 'videoEffectParamSigma', 4, 0, 20, 0.1, { unit: 'pixels' }),
	}),
	sharpen: definition('sharpen', 'Sharpen', 'videoEffectSharpen', 'unsharp', {
		amount: parameter('Amount', 'videoEffectParamAmount', 0.5, 0, 2, 0.01),
	}),
	'rgb-split': definition('rgb-split', 'RGB Split', 'videoEffectRgbSplit', 'rgbashift', {
		offsetX: parameter('Horizontal offset', 'videoEffectParamOffsetX', 6, -64, 64, 1, { integer: true, unit: 'pixels' }),
		offsetY: parameter('Vertical offset', 'videoEffectParamOffsetY', 0, -64, 64, 1, { integer: true, unit: 'pixels' }),
	}),
});

export const VIDEO_EFFECT_TYPES = Object.freeze(Object.keys(VIDEO_EFFECT_DEFINITIONS));

function plainClone(value) {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function nonEmptyString(value, name) {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

export function videoEffectDefinition(type) {
	const definitionValue = VIDEO_EFFECT_DEFINITIONS[type];
	if (!definitionValue) throw new RangeError(`Unsupported video effect type: ${type}.`);
	return definitionValue;
}

export function videoEffectDefaults(type) {
	const definitionValue = videoEffectDefinition(type);
	return Object.fromEntries(Object.entries(definitionValue.params).map(([name, descriptor]) => (
		[name, descriptor.default]
	)));
}

/**
 * Validate a possibly partial parameter object without applying defaults.
 * This is the persistence-boundary primitive: bounds and integer rules remain
 * owned by this registry while callers can retain their surrounding schema
 * validation and error naming.
 */
export function validateVideoEffectParams(type, params, name = 'videoEffect.params') {
	if (!params || typeof params !== 'object' || Array.isArray(params)) {
		throw new TypeError(`${name} must be an object.`);
	}
	const definitionValue = videoEffectDefinition(type);
	for (const key of Object.keys(params)) {
		if (!Object.hasOwn(definitionValue.params, key)) {
			throw new RangeError(`${name}.${key} is not supported.`);
		}
	}
	for (const [key, descriptor] of Object.entries(definitionValue.params)) {
		if (!Object.hasOwn(params, key)) continue;
		const value = params[key];
		if (typeof value !== 'number' || !Number.isFinite(value) || value < descriptor.min || value > descriptor.max) {
			throw new RangeError(`${name}.${key} must be between ${descriptor.min} and ${descriptor.max}.`);
		}
		if (descriptor.integer && !Number.isSafeInteger(value)) {
			throw new RangeError(`${name}.${key} must be an integer.`);
		}
	}
	return true;
}

function normalizeVideoEffectParams(type, params, name) {
	if (params === undefined) params = {};
	if (!params || typeof params !== 'object' || Array.isArray(params)) {
		throw new TypeError(`${name} must be an object.`);
	}
	const definitionValue = videoEffectDefinition(type);
	for (const key of Object.keys(params)) {
		if (!Object.hasOwn(definitionValue.params, key)) {
			throw new RangeError(`${name}.${key} is not supported by ${type}.`);
		}
	}
	const normalized = {};
	for (const [key, descriptor] of Object.entries(definitionValue.params)) {
		const value = Object.hasOwn(params, key) ? params[key] : descriptor.default;
		if (typeof value !== 'number' || !Number.isFinite(value) || value < descriptor.min || value > descriptor.max) {
			throw new RangeError(`${name}.${key} must be between ${descriptor.min} and ${descriptor.max}.`);
		}
		if (descriptor.integer && !Number.isSafeInteger(value)) {
			throw new RangeError(`${name}.${key} must be an integer.`);
		}
		normalized[key] = value;
	}
	return normalized;
}

export function createVideoEffect(type, options = {}) {
	const stableType = nonEmptyString(type, 'videoEffect.type');
	videoEffectDefinition(stableType);
	if (options.enabled != null && typeof options.enabled !== 'boolean') {
		throw new TypeError('videoEffect.enabled must be a boolean.');
	}
	return {
		id: nonEmptyString(options.id ?? createStableId('video-effect'), 'videoEffect.id'),
		type: stableType,
		enabled: options.enabled !== false,
		params: normalizeVideoEffectParams(stableType, options.params, 'videoEffect.params'),
	};
}

export function normalizeVideoEffect(effect, name = 'videoEffect') {
	if (!effect || typeof effect !== 'object' || Array.isArray(effect)) {
		throw new TypeError(`${name} must be an object.`);
	}
	const allowed = new Set(['id', 'type', 'enabled', 'params']);
	for (const key of Object.keys(effect)) {
		if (!allowed.has(key)) throw new RangeError(`${name}.${key} is not supported.`);
	}
	const id = nonEmptyString(effect.id, `${name}.id`);
	const type = nonEmptyString(effect.type, `${name}.type`);
	if (typeof effect.enabled !== 'boolean') throw new TypeError(`${name}.enabled must be a boolean.`);
	if (
		!Object.hasOwn(effect, 'params')
		|| !effect.params
		|| typeof effect.params !== 'object'
		|| Array.isArray(effect.params)
	) throw new TypeError(`${name}.params must be an object.`);
	return {
		id,
		type,
		enabled: effect.enabled,
		params: normalizeVideoEffectParams(type, effect.params, `${name}.params`),
	};
}

export function normalizeVideoEffects(effects, name = 'videoEffects') {
	if (!Array.isArray(effects)) throw new TypeError(`${name} must be an array.`);
	const normalized = effects.map((effect, index) => normalizeVideoEffect(effect, `${name}[${index}]`));
	const ids = new Set();
	for (const effect of normalized) {
		if (ids.has(effect.id)) throw new RangeError(`${name} cannot contain duplicate IDs: ${effect.id}.`);
		ids.add(effect.id);
	}
	return normalized;
}

/**
 * Serialize a normalized video-effect stack into allowlisted FFmpeg filter
 * operations. Callers receive only registry-generated expressions; project
 * data is never interpreted as an FFmpeg expression.
 */
export function serializeVideoEffectsToFfmpegOperations(effects, name = 'videoEffects') {
	const normalized = normalizeVideoEffects(effects, name);
	const operations = [];
	for (const [index, effect] of normalized.entries()) {
		if (!effect.enabled) continue;
		operations.push(...serializeVideoEffectToFfmpegOperations(effect, `${name}[${index}]`));
	}
	return operations;
}

function serializeVideoEffectToFfmpegOperations(effect, name) {
	const definitionValue = videoEffectDefinition(effect.type);
	const params = effect.params;
	switch (definitionValue.ffmpegFilter) {
		case 'eq-hue': {
			const brightness = ffmpegNumber(params.brightness, `${name}.params.brightness`);
			const contrast = ffmpegNumber(params.contrast, `${name}.params.contrast`);
			const saturation = ffmpegNumber(params.saturation, `${name}.params.saturation`);
			const gamma = ffmpegNumber(params.gamma, `${name}.params.gamma`);
			const expressions = [];
			if (
				params.brightness !== 0
				|| params.contrast !== 1
				|| params.saturation !== 1
				|| params.gamma !== 1
			) {
				expressions.push(
					`eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}:gamma=${gamma}:eval=init`,
				);
			}
			if (params.hueDegrees !== 0) {
				expressions.push(
					`hue=h=${ffmpegNumber(params.hueDegrees, `${name}.params.hueDegrees`)}`,
				);
			}
			return expressions.length
				? [{
					expression: [
						'format=pix_fmts=yuva444p',
						...expressions,
						'limiter=min=16:max=235:planes=1',
						'limiter=min=16:max=240:planes=6',
					].join(','),
					preserveAlpha: true,
				}]
				: [];
		}
		case 'pixelize': {
			const size = ffmpegNumber(params.blockSize, `${name}.params.blockSize`);
			return [{
				expression: `pixelize=w=${size}:h=${size}:mode=avg:planes=15`,
				preserveAlpha: false,
			}];
		}
		case 'vignette': {
			if (params.amount === 0) return [];
			const angle = ffmpegNumber(params.amount * (Math.PI / 2 - 0.001), `${name}.angle`);
			return [{
				expression: `vignette=angle=${angle}:x0=w/2:y0=h/2:mode=forward:eval=init:dither=0`,
				preserveAlpha: true,
			}];
		}
		case 'gblur': {
			if (params.sigma === 0) return [];
			const sigma = ffmpegNumber(params.sigma, `${name}.params.sigma`);
			return [{
				expression: `gblur=sigma=${sigma}:sigmaV=${sigma}:steps=1:planes=15`,
				preserveAlpha: false,
			}];
		}
		case 'unsharp': {
			if (params.amount === 0) return [];
			const amount = ffmpegNumber(params.amount, `${name}.params.amount`);
			return [{
				expression: `unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=${amount}:chroma_msize_x=5:chroma_msize_y=5:chroma_amount=0`,
				preserveAlpha: false,
			}];
		}
		case 'rgbashift': {
			if (params.offsetX === 0 && params.offsetY === 0) return [];
			const offsetX = ffmpegNumber(params.offsetX, `${name}.params.offsetX`);
			const offsetY = ffmpegNumber(params.offsetY, `${name}.params.offsetY`);
			const blueOffsetX = ffmpegNumber(-params.offsetX, `${name}.params.offsetX`);
			const blueOffsetY = ffmpegNumber(-params.offsetY, `${name}.params.offsetY`);
			return [{
				expression: `rgbashift=rh=${offsetX}:rv=${offsetY}:gh=0:gv=0:bh=${blueOffsetX}:bv=${blueOffsetY}:ah=0:av=0:edge=smear`,
				preserveAlpha: false,
			}];
		}
		default:
			throw new RangeError(`Unsupported FFmpeg video effect mapping: ${definitionValue.ffmpegFilter}.`);
	}
}

function ffmpegNumber(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number)) throw new RangeError(`${name} must be finite.`);
	return String(Object.is(number, -0) ? 0 : number);
}

export function updateVideoEffect(effect, changes = {}) {
	if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
		throw new TypeError('Video effect changes must be an object.');
	}
	const allowed = new Set(['enabled', 'params']);
	for (const key of Object.keys(changes)) {
		if (!allowed.has(key)) throw new RangeError(`Video effect field cannot be updated: ${key}.`);
	}
	if (Object.hasOwn(changes, 'params') && (
		!changes.params
		|| typeof changes.params !== 'object'
		|| Array.isArray(changes.params)
	)) throw new TypeError('Video effect changes.params must be an object.');
	const normalized = normalizeVideoEffect(effect);
	return normalizeVideoEffect({
		...normalized,
		...changes,
		params: Object.hasOwn(changes, 'params')
			? { ...normalized.params, ...plainClone(changes.params) }
			: normalized.params,
	});
}

export function cloneVideoEffects(effects, options = {}) {
	const normalized = normalizeVideoEffects(effects);
	const regenerateIds = Boolean(options.regenerateIds);
	const idFactory = options.idFactory || createStableId;
	return normalized.map((effect) => ({
		...plainClone(effect),
		id: regenerateIds ? nonEmptyString(idFactory('video-effect'), 'videoEffect.id') : effect.id,
	}));
}
