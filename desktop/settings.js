import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

import { SETTINGS_SCHEMA_VERSION, SUPPORTED_LOCALES } from './constants.js';
import { resolveLocale, validateLocale } from './validation.js';

const DEFAULTS = Object.freeze({
	schemaVersion: SETTINGS_SCHEMA_VERSION,
	locale: null,
	updatesEnabled: true,
	lastUpdateCheck: null,
});

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
	return {
		...DEFAULTS,
		locale,
		updatesEnabled: value.updatesEnabled !== false,
		lastUpdateCheck,
	};
}
