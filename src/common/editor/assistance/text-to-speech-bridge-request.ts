/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed source-free renderer request fields shared with the pathless assistance bridge. */

import { isKokoroLanguage, isKokoroVoiceForLanguage } from './kokoro-voices-v1.ts';

export interface TextToSpeechBridgeSettings {
	readonly settingsVersion: 1;
	readonly language: string;
	readonly voice: string;
	readonly speed: number;
}

export function sourceFreeTextToSpeechFence(value: unknown): null {
	if (value !== null) throw new TypeError('Text-to-speech requires a null source-free selection fence.');
	return null;
}

export function normalizeTextToSpeechBridgeSettings(value: unknown): TextToSpeechBridgeSettings {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError('Text-to-speech settings must be a closed plain object.');
	}
	const record = value as Readonly<Record<string, unknown>>;
	if (Object.keys(record).sort().join(',') !== 'language,settingsVersion,speed,voice'
		|| record.settingsVersion !== 1 || !isKokoroLanguage(record.language)
		|| !isKokoroVoiceForLanguage(record.language, record.voice)
		|| typeof record.speed !== 'number' || !Number.isFinite(record.speed)
		|| record.speed < 0.5 || record.speed > 2) {
		throw new TypeError('The text-to-speech language, voice, or speed is invalid.');
	}
	return Object.freeze({ settingsVersion: 1, language: record.language,
		voice: record.voice, speed: record.speed });
}

export function normalizeTextToSpeechBridgeFields(record: Readonly<Record<string, unknown>>):
	Readonly<{ selectionFence: null; settings: TextToSpeechBridgeSettings }> {
	return Object.freeze({ selectionFence: sourceFreeTextToSpeechFence(record.selectionFence),
		settings: normalizeTextToSpeechBridgeSettings(record.settings) });
}
