import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import { SETTINGS_SCHEMA_VERSION, SUPPORTED_LOCALES } from './constants.js';
import { resolveLocale, validateLocale } from './validation.js';

const DEFAULTS = Object.freeze({
	schemaVersion: SETTINGS_SCHEMA_VERSION,
	locale: null,
	updatesEnabled: true,
	lastUpdateCheck: null,
	modelsDirectory: null,
	nativeProbeHelperEnabled: false,
	nativeAudioHelperEnabled: false,
	nativeAudioCalibrations: Object.freeze([]),
	nativeAudioRoutePreference: null,
	nativePluginDiscoveryEnabled: false,
	nativeMediaEnabled: false,
	nativeHardwareDecodeEnabled: false,
	nativeHardwareEncodeEnabled: false,
	ofxConsentEnabled: false,
});

const MAX_MODELS_DIRECTORY_LENGTH = 4096;

/**
 * The optional assistance models directory. `null` means the product-owned
 * default under userData; any other value is an absolute path the user chose,
 * so the models stay plain files they can inspect and delete themselves.
 */
export function validateModelsDirectory(value) {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'string' || value.trim() === '') {
		throw new TypeError('The models directory must be an absolute path or null.');
	}
	if (value.length > MAX_MODELS_DIRECTORY_LENGTH || value.includes('\0')) {
		throw new RangeError('The models directory path is out of range.');
	}
	if (!isAbsolute(value)) {
		throw new TypeError('The models directory must be an absolute path or null.');
	}
	return resolve(value);
}

export class DesktopSettingsStore {
	#filePath;
	#settings = { ...DEFAULTS };
	#mutationTail = Promise.resolve();

	constructor(filePath) {
		this.#filePath = filePath;
	}

	async load(preferredLocales = []) {
		let parsed = null;
		try {
			parsed = JSON.parse(await readFile(this.#filePath, 'utf8'));
		} catch (error) {
			if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
		}
		this.#settings = validateSettings(parsed);
		if (!this.#settings.locale) {
			const locale = resolveLocale(preferredLocales, SUPPORTED_LOCALES);
			await this.#update((settings) => ({ ...settings, locale }));
		}
		return this.snapshot();
	}

	snapshot() {
		return Object.freeze({ ...this.#settings });
	}

	async setLocale(locale) {
		const validated = validateLocale(locale);
		const settings = await this.#update((current) => ({ ...current, locale: validated }));
		return settings.locale;
	}

	async setModelsDirectory(directory) {
		const validated = validateModelsDirectory(directory);
		const settings = await this.#update((current) => ({ ...current, modelsDirectory: validated }));
		return settings.modelsDirectory;
	}

	/** The native probe helper stays off until the user turns it on. */
	async setNativeProbeHelperEnabled(enabled) {
		const settings = await this.#update((current) => ({
			...current,
			nativeProbeHelperEnabled: enabled === true,
		}));
		return settings.nativeProbeHelperEnabled;
	}

	/** The native audio helper stays off until the user turns it on. */
	async setNativeAudioHelperEnabled(enabled) {
		const settings = await this.#update((current) => ({
			...current,
			nativeAudioHelperEnabled: enabled === true,
		}));
		return settings.nativeAudioHelperEnabled;
	}

	resolveNativeAudioCalibration(identity) {
		const normalized = nativeAudioCalibrationIdentity(identity);
		const key = nativeAudioCalibrationKey(normalized);
		const entry = this.#settings.nativeAudioCalibrations.find((candidate) => candidate.key === key);
		return entry ? Math.round(entry.offsetMilliseconds * normalized.sampleRate / 1000) : null;
	}

	async persistNativeAudioCalibration(value) {
		const identity = nativeAudioCalibrationIdentity(value?.identity);
		const offsetFrames = boundedInteger(value?.offsetFrames, 0, 1_048_576, 'calibration frame offset');
		const key = nativeAudioCalibrationKey(identity);
		const entry = Object.freeze({
			identity, key,
			offsetMilliseconds: offsetFrames * 1000 / identity.sampleRate,
			measuredAtEpochMs: Date.now(),
		});
		const settings = await this.#update((current) => ({
			...current,
			nativeAudioCalibrations: Object.freeze([
				...current.nativeAudioCalibrations.filter((candidate) => candidate.key !== key), entry,
			].sort((left, right) => right.measuredAtEpochMs - left.measuredAtEpochMs || compareCodeUnits(left.key, right.key)).slice(0, 64)),
		}));
		return settings.nativeAudioCalibrations.find((candidate) => candidate.key === key) ?? null;
	}

	async setNativeAudioRoutePreference(value) {
		const preference = value === null ? null : nativeAudioRoutePreference(value);
		const settings = await this.#update((current) => ({
			...current, nativeAudioRoutePreference: preference,
		}));
		return settings.nativeAudioRoutePreference;
	}

	/** Native plug-in discovery stays off until the user turns it on. */
	async setNativePluginDiscoveryEnabled(enabled) {
		const settings = await this.#update((current) => ({
			...current,
			nativePluginDiscoveryEnabled: enabled === true,
		}));
		return settings.nativePluginDiscoveryEnabled;
	}

	/** Framescaper's native media engine is an independent, default-off authority. */
	async setNativeMediaEnabled(enabled) {
		const settings = await this.#update((current) => ({
			...current,
			nativeMediaEnabled: enabled === true,
		}));
		return settings.nativeMediaEnabled;
	}

	async setNativeHardwareDecodeEnabled(enabled) {
		const settings = await this.#update((current) => ({
			...current,
			nativeHardwareDecodeEnabled: enabled === true,
		}));
		return settings.nativeHardwareDecodeEnabled;
	}

	async setNativeHardwareEncodeEnabled(enabled) {
		const settings = await this.#update((current) => ({
			...current,
			nativeHardwareEncodeEnabled: enabled === true,
		}));
		return settings.nativeHardwareEncodeEnabled;
	}

	async setOfxConsentEnabled(enabled) {
		const settings = await this.#update((current) => ({
			...current,
			ofxConsentEnabled: enabled === true,
		}));
		return settings.ofxConsentEnabled;
	}

	async recordUpdateCheck(timestamp = Date.now()) {
		const lastUpdateCheck = new Date(timestamp).toISOString();
		await this.#update((settings) => ({ ...settings, lastUpdateCheck }));
	}

	/** Whole-file replacements must observe and commit in invocation order. */
	#update(project) {
		const mutation = this.#mutationTail.then(async () => {
			const next = project(this.#settings);
			await this.#write(next);
			this.#settings = next;
			return this.snapshot();
		});
		this.#mutationTail = mutation.then(() => undefined, () => undefined);
		return mutation;
	}

	async #write(settings) {
		const directory = dirname(this.#filePath);
		await mkdir(directory, { recursive: true });
		const temporaryPath = `${this.#filePath}.${randomBytes(8).toString('hex')}.tmp`;
		const handle = await open(temporaryPath, 'wx', 0o600);
		try {
			await handle.writeFile(`${JSON.stringify(settings, null, 2)}\n`, 'utf8');
			await handle.sync();
			await handle.close();
			await rename(temporaryPath, this.#filePath);
		} catch (error) {
			await handle.close().catch(() => {});
			await unlink(temporaryPath).catch(() => {});
			throw error;
		}
	}
}

function validateSettings(value) {
	if (!value || value.schemaVersion !== SETTINGS_SCHEMA_VERSION) return { ...DEFAULTS };
	let locale = null;
	try {
		if (value.locale) locale = validateLocale(value.locale);
	} catch {
		locale = null;
	}
	const lastUpdateCheck = Number.isFinite(Date.parse(value.lastUpdateCheck)) ? new Date(value.lastUpdateCheck).toISOString() : null;
	let modelsDirectory;
	try {
		modelsDirectory = validateModelsDirectory(value.modelsDirectory);
	} catch {
		modelsDirectory = null;
	}
	return {
		...DEFAULTS,
		locale,
		updatesEnabled: value.updatesEnabled !== false,
		lastUpdateCheck,
		modelsDirectory,
		nativeProbeHelperEnabled: value.nativeProbeHelperEnabled === true,
		nativeAudioHelperEnabled: value.nativeAudioHelperEnabled === true,
		nativeAudioCalibrations: nativeAudioCalibrations(value.nativeAudioCalibrations),
		nativeAudioRoutePreference: persistedNativeAudioRoutePreference(value.nativeAudioRoutePreference),
		nativePluginDiscoveryEnabled: value.nativePluginDiscoveryEnabled === true,
		nativeMediaEnabled: value.nativeMediaEnabled === true,
		nativeHardwareDecodeEnabled: value.nativeHardwareDecodeEnabled === true,
		nativeHardwareEncodeEnabled: value.nativeHardwareEncodeEnabled === true,
		ofxConsentEnabled: value.ofxConsentEnabled === true,
	};
}

const NATIVE_AUDIO_BACKENDS = Object.freeze(['coreaudio', 'wasapi', 'asio', 'pipewire', 'alsa', 'jack']);

function nativeAudioCalibrations(value) {
	if (!Array.isArray(value)) return Object.freeze([]);
	const admitted = new Map();
	for (const candidate of value.slice(0, 256)) {
		try {
			const identity = nativeAudioCalibrationIdentity(candidate?.identity);
			const key = nativeAudioCalibrationKey(identity);
			if (candidate?.key !== key || typeof candidate.offsetMilliseconds !== 'number'
				|| !Number.isFinite(candidate.offsetMilliseconds) || candidate.offsetMilliseconds < 0
				|| candidate.offsetMilliseconds > 2_000) continue;
			const measuredAtEpochMs = boundedInteger(candidate.measuredAtEpochMs, 0, Number.MAX_SAFE_INTEGER, 'calibration time');
			const entry = Object.freeze({ identity, key, offsetMilliseconds: candidate.offsetMilliseconds, measuredAtEpochMs });
			const previous = admitted.get(key);
			if (!previous || previous.measuredAtEpochMs <= measuredAtEpochMs) admitted.set(key, entry);
		} catch { /* one stale or corrupt rig must not discard the remaining exact entries */ }
	}
	return Object.freeze([...admitted.values()]
		.sort((left, right) => right.measuredAtEpochMs - left.measuredAtEpochMs || compareCodeUnits(left.key, right.key))
		.slice(0, 64));
}

function nativeAudioCalibrationIdentity(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('A calibration identity is required.');
	const backend = enumValue(value.backend, NATIVE_AUDIO_BACKENDS, 'native audio backend');
	if (backend === 'jack') throw new TypeError('JACK is discovery-only and cannot identify a streaming calibration.');
	const inputDeviceId = nativeAudioDeviceId(value.inputDeviceId, backend, 'in');
	const outputDeviceId = nativeAudioDeviceId(value.outputDeviceId, backend, 'out');
	return Object.freeze({
		inputDeviceId, outputDeviceId, backend,
		mode: enumValue(value.mode, ['shared', 'exclusive'], 'native audio mode'),
		sampleRate: boundedInteger(value.sampleRate, 8_000, 768_000, 'sample rate'),
		bufferFrames: boundedInteger(value.bufferFrames, 1, 16_384, 'buffer size'),
	});
}

function nativeAudioCalibrationKey(identity) {
	return `native-audio-calibration-v1:${JSON.stringify([
		identity.inputDeviceId, identity.outputDeviceId, identity.backend, identity.mode,
		identity.sampleRate, identity.bufferFrames,
	])}`;
}

function nativeAudioDeviceId(value, backend, direction) {
	if (typeof value !== 'string' || value.length > 512
		|| !value.startsWith(`native:${backend}:${direction}:`) || /[\0/\\]/u.test(value)) {
		throw new TypeError('A calibration device identity must be opaque and backend-scoped.');
	}
	return value;
}

function persistedNativeAudioRoutePreference(value) {
	try { return value === null || value === undefined ? null : nativeAudioRoutePreference(value); }
	catch { return null; }
}

function nativeAudioRoutePreference(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.candidates)
		|| value.candidates.length < 1 || value.candidates.length > 4) {
		throw new TypeError('A native audio route preference requires ordered candidates.');
	}
	const candidates = value.candidates.map((candidate) => {
		const backend = enumValue(candidate?.backend, NATIVE_AUDIO_BACKENDS, 'native audio backend');
		if (backend === 'jack') throw new TypeError('JACK is discovery-only and cannot be saved as a streaming route.');
		if (typeof candidate?.deviceHandle !== 'string' || !candidate.deviceHandle
			|| candidate.deviceHandle.length > 1_024 || /[\0/\\]/u.test(candidate.deviceHandle)) {
			throw new TypeError('A saved native audio device handle must be opaque.');
		}
		return Object.freeze({ backend, deviceHandle: candidate.deviceHandle });
	});
	const mode = enumValue(value.mode, ['shared', 'exclusive'], 'native audio mode');
	if (candidates.some((candidate) => candidate.backend === 'asio') && mode !== 'exclusive') throw new TypeError('ASIO route preferences are exclusive.');
	return Object.freeze({
		candidates: Object.freeze(candidates),
		direction: enumValue(value.direction, ['input', 'output', 'duplex'], 'native audio direction'),
		mode,
		sampleRate: boundedInteger(value.sampleRate, 8_000, 768_000, 'sample rate'),
		periodFrames: boundedInteger(value.periodFrames, 1, 16_384, 'period size'),
		channelCount: boundedInteger(value.channelCount, 1, 32, 'channel count'),
	});
}

function compareCodeUnits(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function enumValue(value, values, label) {
	if (typeof value !== 'string' || !values.includes(value)) throw new TypeError(`Invalid ${label}.`);
	return value;
}

function boundedInteger(value, minimum, maximum, label) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`Invalid ${label}.`);
	return value;
}
