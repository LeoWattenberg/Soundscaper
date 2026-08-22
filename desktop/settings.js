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
		nativePluginDiscoveryEnabled: value.nativePluginDiscoveryEnabled === true,
		nativeMediaEnabled: value.nativeMediaEnabled === true,
		nativeHardwareDecodeEnabled: value.nativeHardwareDecodeEnabled === true,
		nativeHardwareEncodeEnabled: value.nativeHardwareEncodeEnabled === true,
		ofxConsentEnabled: value.ofxConsentEnabled === true,
	};
}
