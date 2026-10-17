/* SPDX-License-Identifier: AGPL-3.0-only */

import { admitAudioEditorProjectValidationStructure, AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS } from '../project-validation-budget.ts';

/** A label-only wire leaves the V1–V6 media/annotation descriptor formats unchanged. */
export const AUDIO_EDITOR_LABEL_CLIPBOARD_SCHEMA_VERSION = 7;

export interface AudioEditorClipboardLabel {
	readonly title: string;
	readonly color: string;
	readonly anchor: 'sample' | 'musical';
	readonly startOffsetFrame: number;
	readonly endOffsetFrame: number;
	readonly opaqueExtensions: Readonly<Record<string, unknown>>;
}

export interface LabelClipboardDescriptor {
	readonly schemaVersion: typeof AUDIO_EDITOR_LABEL_CLIPBOARD_SCHEMA_VERSION;
	readonly sampleRate: number;
	readonly durationFrames: number;
	readonly tracks: readonly never[];
	readonly annotations: readonly never[];
	readonly takeGroups: readonly never[];
	readonly labels: readonly AudioEditorClipboardLabel[];
}

/** Reject mixed media payloads and accessors before cloning extension data. */
export function normalizeLabelClipboardDescriptor(value: unknown): LabelClipboardDescriptor {
	admitAudioEditorProjectValidationStructure(value, AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS);
	const candidate = exactRecord(value, ['schemaVersion', 'sampleRate', 'durationFrames', 'tracks', 'annotations', 'takeGroups', 'labels']);
	if (candidate.schemaVersion !== AUDIO_EDITOR_LABEL_CLIPBOARD_SCHEMA_VERSION) throw new RangeError('Unsupported label clipboard schema version.');
	const sampleRate = integer(candidate.sampleRate, 1, 'sampleRate');
	const durationFrames = integer(candidate.durationFrames, 1, 'durationFrames');
	for (const field of ['tracks', 'annotations', 'takeGroups']) {
		if (!Array.isArray(candidate[field]) || candidate[field].length !== 0) throw new TypeError(`Label clipboard ${field} must be empty.`);
	}
	if (!Array.isArray(candidate.labels) || !candidate.labels.length || candidate.labels.length > 100_000) {
		throw new TypeError('Label clipboard labels must be a nonempty bounded array.');
	}
	const labels = candidate.labels.map((value): AudioEditorClipboardLabel => {
		const label = exactRecord(value, ['title', 'color', 'anchor', 'startOffsetFrame', 'endOffsetFrame', 'opaqueExtensions']);
		if (typeof label.title !== 'string' || typeof label.color !== 'string' || !label.color) throw new TypeError('Label clipboard text and color must be strings.');
		if (label.anchor !== 'sample' && label.anchor !== 'musical') throw new TypeError('Label clipboard anchor must be sample or musical.');
		const startOffsetFrame = integer(label.startOffsetFrame, 0, 'start offset');
		const endOffsetFrame = integer(label.endOffsetFrame, startOffsetFrame, 'end offset');
		if (endOffsetFrame > durationFrames) throw new RangeError('Label clipboard offsets exceed its duration span.');
		if (!label.opaqueExtensions || typeof label.opaqueExtensions !== 'object' || Array.isArray(label.opaqueExtensions)) {
			throw new TypeError('Label clipboard opaqueExtensions must be an object.');
		}
		return { title: label.title, color: label.color, anchor: label.anchor, startOffsetFrame, endOffsetFrame,
			opaqueExtensions: structuredClone(label.opaqueExtensions) as Record<string, unknown> };
	});
	if (!labels.some(label => label.startOffsetFrame === 0)) throw new RangeError('The earliest clipboard label must have zero offset.');
	return { schemaVersion: AUDIO_EDITOR_LABEL_CLIPBOARD_SCHEMA_VERSION, sampleRate, durationFrames,
		tracks: [], annotations: [], takeGroups: [], labels };
}

function exactRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) throw new TypeError('A label clipboard plain record is required.');
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError('Label clipboard record must contain its exact fields.');
	}
	for (const field of fields) {
		const property = Object.getOwnPropertyDescriptor(value, field);
		if (!property?.enumerable || !Object.hasOwn(property, 'value')) throw new TypeError('Label clipboard fields must be own enumerable data properties.');
	}
	return value as Record<string, unknown>;
}

function integer(value: unknown, minimum: number, field: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new RangeError(`Label clipboard ${field} is invalid.`);
	return value;
}
