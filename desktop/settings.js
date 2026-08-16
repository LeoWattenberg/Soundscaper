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
			this.#settings.locale = resolveLocale(preferredLocales, SUPPORTED_LOCALES);
			await this.#write();
		}
		return this.snapshot();
	}

	snapshot() {
		return Object.freeze({ ...this.#settings });
	}

	async setLocale(locale) {
		this.#settings.locale = validateLocale(locale);
		await this.#write();
		return this.#settings.locale;
	}

	async setModelsDirectory(directory) {
		this.#settings.modelsDirectory = validateModelsDirectory(directory);
		await this.#write();
		return this.#settings.modelsDirectory;
	}

	/** The native probe helper stays off until the user turns it on. */
	async setNativeProbeHelperEnabled(enabled) {
		this.#settings.nativeProbeHelperEnabled = enabled === true;
		await this.#write();
		return this.#settings.nativeProbeHelperEnabled;
	}

	/** The native audio helper stays off until the user turns it on. */
	async setNativeAudioHelperEnabled(enabled) {
		this.#settings.nativeAudioHelperEnabled = enabled === true;
		await this.#write();
		return this.#settings.nativeAudioHelperEnabled;
	}

	/** Native plug-in discovery stays off until the user turns it on. */
	async setNativePluginDiscoveryEnabled(enabled) {
		this.#settings.nativePluginDiscoveryEnabled = enabled === true;
		await this.#write();
		return this.#settings.nativePluginDiscoveryEnabled;
	}

	async recordUpdateCheck(timestamp = Date.now()) {
		this.#settings.lastUpdateCheck = new Date(timestamp).toISOString();
		await this.#write();
	}

	async #write() {
		const directory = dirname(this.#filePath);
		await mkdir(directory, { recursive: true });
		const temporaryPath = `${this.#filePath}.${randomBytes(8).toString('hex')}.tmp`;
		const handle = await open(temporaryPath, 'wx', 0o600);
		try {
			await handle.writeFile(`${JSON.stringify(this.#settings, null, 2)}\n`, 'utf8');
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
	};
}
