/* SPDX-License-Identifier: AGPL-3.0-only */

import { MEDIA_EXPORT_FORMATS } from './media-export.js';
import { VIDEO_EXPORT_FORMATS } from './video-export.js';

/**
 * Delivery presets: validated data that resolves to export-plan options.
 *
 * A preset carries no encode path of its own. It resolves to the same options
 * the existing plan builders already take, so the plan stays the single
 * semantic authority and a preset can never reach an encoder the dialog
 * cannot. That is also why resolution returns options rather than a plan —
 * the plan builder does the validating, and a preset gets no way around it.
 *
 * Legal availability is declared, never created. A preset naming a codec that
 * sits behind a licensing row reports that row's status and its fallback; it
 * does not decide the row.
 */

export const DELIVERY_PRESET_KINDS = Object.freeze(['audio', 'video'] as const);

export type DeliveryPresetKind = (typeof DELIVERY_PRESET_KINDS)[number];

/**
 * Settings a preset may carry, per kind. The list is closed on purpose: an
 * unrecognized field is a preset written against a build that understood
 * something this one does not, and guessing at it is how a delivery quietly
 * stops matching what the user asked for.
 */
export const DELIVERY_PRESET_SETTINGS: Readonly<Record<DeliveryPresetKind, readonly string[]>> = Object.freeze({
	audio: Object.freeze([
		'sampleRate', 'channelMapping', 'sampleFormat', 'dither',
		'bitRate', 'quality', 'compressionLevel', 'mode', 'includeTail',
		'loudnessNormalization',
	]),
	video: Object.freeze([
		'size', 'fit', 'frameRate', 'backgroundColor',
		'maximumWidth', 'maximumHeight', 'maximumFrameRate', 'quality', 'audioLayout', 'includeAudio',
	]),
});

const ALLOWED_PRESET_FIELDS: readonly string[] = Object.freeze([
	'schemaVersion', 'id', 'label', 'kind', 'format', 'settings',
	'licensingRowId', 'fallbackPresetId', 'createdAt', 'updatedAt',
]);

export interface DeliveryPreset {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly label: string;
	readonly kind: DeliveryPresetKind;
	readonly format: string;
	readonly settings: Readonly<Record<string, unknown>>;
	/** The licensing row this preset's codec answers to, when one governs it. */
	readonly licensingRowId: string | null;
	/** Where delivery goes when this preset is unavailable. */
	readonly fallbackPresetId: string | null;
	/** Record metadata for saved presets; absent on built-in ones. */
	readonly createdAt?: string;
	readonly updatedAt?: string;
}

export interface DeliveryPresetAvailability {
	readonly available: boolean;
	readonly status: 'implemented';
	readonly licensingRowId: string | null;
	readonly licensingStatus: string;
	readonly licensingPending: boolean;
}

export class DeliveryPresetError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DeliveryPresetError';
	}
}

/** Validate a preset record. Unknown fields and unknown formats are rejected, never ignored. */
export function validateDeliveryPreset(value: unknown): DeliveryPreset {
	if (!isRecord(value)) throw new DeliveryPresetError('A delivery preset must be a record.');
	if (value.schemaVersion !== 1) {
		throw new DeliveryPresetError('Delivery presets must declare schemaVersion 1.');
	}
	for (const field of Object.keys(value)) {
		if (!ALLOWED_PRESET_FIELDS.includes(field)) {
			throw new DeliveryPresetError(`Unknown delivery preset field: ${field}.`);
		}
	}
	const id = requireNonEmptyString(value.id, 'id');
	const label = requireNonEmptyString(value.label, 'label');
	const kind = value.kind;
	if (kind !== 'audio' && kind !== 'video') {
		throw new DeliveryPresetError(`Unsupported delivery preset kind: ${String(kind)}.`);
	}
	const format = requireNonEmptyString(value.format, 'format');
	if (!knownFormat(kind, format)) {
		throw new DeliveryPresetError(`Delivery preset ${id} names an unknown ${kind} format: ${format}.`);
	}
	const rawSettings = value.settings === undefined ? {} : value.settings;
	if (!isRecord(rawSettings)) {
		throw new DeliveryPresetError(`Delivery preset ${id} settings must be a record.`);
	}
	for (const field of Object.keys(rawSettings)) {
		if (!DELIVERY_PRESET_SETTINGS[kind].includes(field)) {
			throw new DeliveryPresetError(`Unknown ${kind} delivery setting: ${field}.`);
		}
	}
	return Object.freeze({
		schemaVersion: 1 as const,
		id,
		label,
		kind,
		format,
		settings: Object.freeze({ ...rawSettings }),
		licensingRowId: value.licensingRowId == null
			? null
			: requireNonEmptyString(value.licensingRowId, 'licensingRowId'),
		fallbackPresetId: value.fallbackPresetId == null
			? null
			: requireNonEmptyString(value.fallbackPresetId, 'fallbackPresetId'),
		...(value.createdAt == null ? {} : { createdAt: String(value.createdAt) }),
		...(value.updatedAt == null ? {} : { updatedAt: String(value.updatedAt) }),
	});
}

/**
 * Canvas geometry the video plan builder reads from a nested `canvas` option
 * rather than the top level. A preset carrying these flat would validate,
 * resolve, and then be silently ignored — which is exactly the hidden
 * behaviour this milestone exists to prevent.
 */
const VIDEO_CANVAS_SETTINGS: readonly string[] = Object.freeze([
	'size', 'fit', 'frameRate', 'backgroundColor',
	'maximumWidth', 'maximumHeight', 'maximumFrameRate',
]);

/**
 * The options this preset means. They go to the ordinary plan builder, which
 * validates them; nothing here decides whether they are legal.
 */
export function resolveDeliveryPresetPlanOptions(
	preset: DeliveryPreset,
): Readonly<Record<string, unknown>> {
	if (!preset || preset.schemaVersion !== 1) {
		throw new DeliveryPresetError('A validated delivery preset is required.');
	}
	if (preset.kind !== 'video') {
		return Object.freeze({ format: preset.format, ...preset.settings });
	}
	const options: Record<string, unknown> = { format: preset.format };
	const canvas: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(preset.settings)) {
		if (VIDEO_CANVAS_SETTINGS.includes(key)) canvas[key] = value;
		else options[key] = value;
	}
	// Only attach the option when the preset actually asked for geometry, so a
	// preset with no canvas settings leaves existing exports byte-stable.
	if (Object.keys(canvas).length > 0) options.canvas = Object.freeze(canvas);
	return Object.freeze(options);
}

/**
 * Whether this preset is implemented, with its licensing state reported
 * independently from runtime availability.
 */
export function resolveDeliveryPresetAvailability(
	preset: DeliveryPreset,
	licensingMatrix: unknown,
): DeliveryPresetAvailability {
	if (!preset || preset.schemaVersion !== 1) {
		throw new DeliveryPresetError('A validated delivery preset is required.');
	}
	if (preset.licensingRowId == null) {
		return Object.freeze({
			available: true,
			status: 'implemented',
			licensingRowId: null,
			licensingStatus: 'not-required',
			licensingPending: false,
		});
	}
	const row = findLicensingRow(licensingMatrix, preset.licensingRowId);
	if (!row) {
		return Object.freeze({
			available: true,
			status: 'implemented',
			licensingRowId: preset.licensingRowId,
			licensingStatus: 'unrecorded',
			licensingPending: true,
		});
	}
	const status = typeof row.status === 'string' ? row.status : 'unknown';
	const reviewed = status === 'cleared' || status === 'documented' || status === 'implemented';
	return Object.freeze({
		available: true,
		status: 'implemented',
		licensingRowId: preset.licensingRowId,
		licensingStatus: status,
		licensingPending: !reviewed,
	});
}

function findLicensingRow(matrix: unknown, rowId: string): Record<string, unknown> | null {
	if (!isRecord(matrix)) return null;
	for (const value of Object.values(matrix)) {
		if (!Array.isArray(value)) continue;
		for (const row of value) {
			if (isRecord(row) && row.id === rowId) return row;
		}
	}
	return null;
}

function knownFormat(kind: DeliveryPresetKind, format: string): boolean {
	const table = kind === 'audio' ? MEDIA_EXPORT_FORMATS : VIDEO_EXPORT_FORMATS;
	return Object.hasOwn(table as Record<string, unknown>, format);
}

function requireNonEmptyString(value: unknown, field: string): string {
	if (typeof value !== 'string' || !value) {
		throw new DeliveryPresetError(`Delivery preset ${field} must be a non-empty string.`);
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
