/* SPDX-License-Identifier: AGPL-3.0-only */

export const SOUNDSCAPER_SOURCE_PROVENANCE_EXTENSION_VERSION = 1;

export interface SoundscaperSourceProvenanceExtensionV1 {
	readonly schemaVersion: typeof SOUNDSCAPER_SOURCE_PROVENANCE_EXTENSION_VERSION;
	readonly recordingDeviceLabels: readonly string[];
}

export interface SourceProvenanceExtensionsV1 {
	readonly soundscaper: SoundscaperSourceProvenanceExtensionV1;
}

export function createRecordingDeviceProvenanceExtension(
	value: string | null | undefined,
): SourceProvenanceExtensionsV1 | undefined {
	const label = value?.trim() ?? '';
	if (label.length > 512) throw new RangeError('The recording device label is too long.');
	return label ? Object.freeze({
		soundscaper: Object.freeze({
			schemaVersion: SOUNDSCAPER_SOURCE_PROVENANCE_EXTENSION_VERSION,
			recordingDeviceLabels: Object.freeze([label]),
		}),
	}) : undefined;
}

export function normalizeSourceProvenanceExtensions(
	value: unknown,
	name: string,
): SourceProvenanceExtensionsV1 {
	const extensions = closedRecord(value, name, ['soundscaper']);
	const soundscaper = closedRecord(extensions.soundscaper, `${name}.soundscaper`, [
		'schemaVersion', 'recordingDeviceLabels',
	]);
	if (soundscaper.schemaVersion !== SOUNDSCAPER_SOURCE_PROVENANCE_EXTENSION_VERSION) {
		throw new RangeError(
			`${name}.soundscaper.schemaVersion must be ${String(SOUNDSCAPER_SOURCE_PROVENANCE_EXTENSION_VERSION)}.`,
		);
	}
	if (!Array.isArray(soundscaper.recordingDeviceLabels)
		|| Reflect.ownKeys(soundscaper.recordingDeviceLabels).length !== soundscaper.recordingDeviceLabels.length + 1
		|| soundscaper.recordingDeviceLabels.length > 64) {
		throw new TypeError(`${name}.soundscaper.recordingDeviceLabels must be a bounded dense array.`);
	}
	const labels = soundscaper.recordingDeviceLabels.map((value, index) => {
		if (typeof value !== 'string' || !value.trim() || value.trim().length > 512) {
			throw new RangeError(`${name}.soundscaper.recordingDeviceLabels[${String(index)}] is invalid.`);
		}
		return value.trim();
	});
	if (labels.some((label, index) => labels.indexOf(label) !== index)) {
		throw new RangeError(`${name}.soundscaper.recordingDeviceLabels cannot contain duplicates.`);
	}
	return Object.freeze({
		soundscaper: Object.freeze({
			schemaVersion: SOUNDSCAPER_SOURCE_PROVENANCE_EXTENSION_VERSION,
			recordingDeviceLabels: Object.freeze(labels),
		}),
	});
}

function closedRecord(
	value: unknown,
	name: string,
	keys: readonly string[],
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a plain JSON-compatible object.`);
	}
	const input = value as Readonly<Record<string, unknown>>;
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || !keys.includes(key)) throw new TypeError(`${name}.${String(key)} is not supported.`);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an enumerable data property.`);
		}
	}
	return input;
}
