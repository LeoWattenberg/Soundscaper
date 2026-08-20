/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	authoredAdmChannelCount,
	normalizeAdmProjectMetadata,
	type AdmProjectMetadataInput,
} from './adm-project-metadata.ts';
import { normalizeCartMetadata } from './cart-metadata.ts';
import { normalizeIxmlMetadata } from './ixml.ts';
import {
	AUDIO_EDITOR_PROJECT_DEFAULT_MASTER_CHANNELS,
	AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE,
	createAudioMaster,
	normalizeAudioMixer,
} from './project-audio-factory.js';
import { normalizeProjectBextMetadata } from './project-bext-metadata.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from './project-schema-version.ts';
import { createStableId } from './stable-id.js';

type DataRecord = Record<string, unknown>;

/**
 * Create the schema-neutral root shared by the exact-current document factory.
 * Media, timeline authority, annotations, hierarchy, and feature ownership are
 * added by focused factories after this bounded UI/metadata shell is complete.
 */
export function createProjectDocumentBase(
	options: Readonly<Record<string, unknown>> = {},
): DataRecord {
	const timestamp = isoTimestamp(options.now ?? options.createdAt);
	const updatedAt = options.updatedAt === undefined ? timestamp : isoTimestamp(options.updatedAt);
	const title = String(options.title || 'Untitled project').trim() || 'Untitled project';
	const sampleRate = safeInteger(
		options.sampleRate ?? AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE,
		1,
		'project.sampleRate',
	);
	const metadata = createMetadata(options.metadata, title);
	const authoredChannels = authoredAdmChannelCount(metadata.adm);
	return {
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		id: options.id || createStableId('project'),
		title,
		revision: safeInteger(options.revision ?? 0, 0, 'project.revision'),
		createdAt: timestamp,
		updatedAt,
		sampleRate,
		masterChannels: safeInteger(
			authoredChannels ?? options.masterChannels ?? AUDIO_EDITOR_PROJECT_DEFAULT_MASTER_CHANNELS,
			1,
			'project.masterChannels',
		),
		tempo: createTempo(options.tempo),
		snap: createSnap(options.snap),
		timeDisplay: createTimeDisplay(options.timeDisplay),
		metadata,
		selection: createSelection(options.selection, sampleRate),
		loop: createLoop(options.loop),
		view: createView(options.view),
		sources: [],
		clips: [],
		tracks: [],
		master: createAudioMaster(recordOrEmpty(options.master, 'project.master')),
		mixer: normalizeAudioMixer(recordOrEmpty(options.mixer, 'project.mixer')),
		opaqueExtensions: clone(options.opaqueExtensions ?? {}),
		projectBin: { clips: [] },
	};
}

function createTempo(value: unknown): DataRecord {
	const input = recordOrEmpty(value, 'project.tempo');
	const signature = recordOrEmpty(input.timeSignature, 'project.tempo.timeSignature');
	const numerator = safeInteger(signature.numerator ?? 4, 1, 'tempo.timeSignature.numerator');
	const denominator = safeInteger(signature.denominator ?? 4, 1, 'tempo.timeSignature.denominator');
	if ((denominator & (denominator - 1)) !== 0) {
		throw new RangeError('tempo.timeSignature.denominator must be a power of two.');
	}
	return {
		bpm: finiteInRange(input.bpm ?? 120, 1, 1_000, 'tempo.bpm'),
		timeSignature: { numerator, denominator },
		detected: Boolean(input.detected),
	};
}

function createMetadata(value: unknown, projectTitle: string): DataRecord & { adm: ReturnType<typeof normalizeAdmProjectMetadata> | null } {
	const input = recordOrEmpty(value, 'project.metadata');
	const tags = recordOrEmpty(input.tags, 'metadata.tags');
	const normalizedTags: Record<string, string> = {};
	for (const [key, tagValue] of Object.entries(tags)) {
		normalizedTags[nonEmptyString(key, 'metadata tag name')] = String(tagValue ?? '');
	}
	const adm = input.adm == null
		? null
		: normalizeAdmProjectMetadata(input.adm as AdmProjectMetadataInput);
	return {
		title: String(input.title ?? projectTitle),
		artist: String(input.artist ?? ''),
		album: String(input.album ?? ''),
		trackNumber: String(input.trackNumber ?? ''),
		year: String(input.year ?? ''),
		comments: String(input.comments ?? ''),
		tags: normalizedTags,
		bext: input.bext == null ? null : normalizeProjectBextMetadata(input.bext),
		...(input.ixml == null ? {} : { ixml: normalizeIxmlMetadata(input.ixml) }),
		...(input.cart == null ? {} : { cart: normalizeCartMetadata(input.cart) }),
		adm,
	};
}

function createSnap(value: unknown): DataRecord {
	const input = recordOrEmpty(value, 'project.snap');
	return {
		enabled: Boolean(input.enabled),
		unit: nonEmptyString(input.unit || 'seconds', 'snap.unit'),
		mode: nonEmptyString(input.mode || 'nearest', 'snap.mode'),
		triplets: Boolean(input.triplets),
		division: nonEmptyString(input.division || input.unit || 'seconds', 'snap.division'),
		opaqueType: safeInteger(input.opaqueType ?? 0, 0, 'snap.opaqueType'),
	};
}

function createTimeDisplay(value: unknown): DataRecord {
	const input = recordOrEmpty(value, 'project.timeDisplay');
	return { format: nonEmptyString(input.format || 'hh:mm:ss+milliseconds', 'timeDisplay.format') };
}

function createSelection(value: unknown, sampleRate: number): DataRecord {
	const input = recordOrEmpty(value, 'project.selection');
	const startFrame = safeInteger(input.startFrame ?? 0, 0, 'selection.startFrame');
	const endFrame = safeInteger(input.endFrame ?? startFrame, 0, 'selection.endFrame');
	if (endFrame < startFrame) throw new RangeError('selection.endFrame cannot precede selection.startFrame.');
	let frequencyRange = null;
	if (input.frequencyRange != null) {
		const range = dataRecord(input.frequencyRange, 'selection.frequencyRange');
		const minimumFrequency = finiteInRange(
			range.minimumFrequency,
			0,
			sampleRate / 2,
			'selection.frequencyRange.minimumFrequency',
		);
		const maximumFrequency = finiteInRange(
			range.maximumFrequency,
			0,
			sampleRate / 2,
			'selection.frequencyRange.maximumFrequency',
		);
		if (maximumFrequency <= minimumFrequency) {
			throw new RangeError('Selection frequency range must have a positive width.');
		}
		frequencyRange = { minimumFrequency, maximumFrequency };
	}
	return {
		startFrame,
		endFrame,
		trackIds: uniqueStrings(input.trackIds ?? [], 'selection.trackIds'),
		clipIds: uniqueStrings(input.clipIds ?? [], 'selection.clipIds'),
		frequencyRange,
	};
}

function createLoop(value: unknown): DataRecord {
	const input = recordOrEmpty(value, 'project.loop');
	const startFrame = safeInteger(input.startFrame ?? 0, 0, 'loop.startFrame');
	const endFrame = safeInteger(input.endFrame ?? startFrame, 0, 'loop.endFrame');
	if (endFrame < startFrame) throw new RangeError('loop.endFrame cannot precede loop.startFrame.');
	if (input.enabled && endFrame === startFrame) throw new RangeError('An enabled loop must have a positive duration.');
	return { enabled: Boolean(input.enabled), startFrame, endFrame };
}

function createView(value: unknown): DataRecord {
	const input = recordOrEmpty(value, 'project.view');
	return {
		scrollFrame: safeInteger(input.scrollFrame ?? 0, 0, 'view.scrollFrame'),
		pixelsPerSecond: finiteInRange(input.pixelsPerSecond ?? 100, 0.001, 1_000_000, 'view.pixelsPerSecond'),
		playheadFrame: safeInteger(input.playheadFrame ?? 0, 0, 'view.playheadFrame'),
		zoom: finiteInRange(input.zoom ?? input.pixelsPerSecond ?? 100, 0.001, 1_000_000, 'view.zoom'),
		horizontalPosition: finiteInRange(input.horizontalPosition ?? 0, 0, Number.MAX_SAFE_INTEGER, 'view.horizontalPosition'),
		verticalPosition: safeInteger(input.verticalPosition ?? 0, 0, 'view.verticalPosition'),
		selectedTrackIds: uniqueStrings(input.selectedTrackIds ?? [], 'view.selectedTrackIds'),
		panelState: clone(input.panelState ?? {}),
	};
}

function uniqueStrings(value: unknown, name: string): string[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	const result = value.map((item, index) => nonEmptyString(item, `${name}[${String(index)}]`));
	if (new Set(result).size !== result.length) throw new RangeError(`${name} cannot contain duplicate IDs.`);
	return result;
}

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function safeInteger(value: unknown, minimum: number, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum) {
		throw new RangeError(`${name} must be a safe integer greater than or equal to ${String(minimum)}.`);
	}
	return number;
}

function finiteInRange(value: unknown, minimum: number, maximum: number, name: string): number {
	const number = Number(value);
	if (!Number.isFinite(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be between ${String(minimum)} and ${String(maximum)}.`);
	}
	return number;
}

function recordOrEmpty(value: unknown, name: string): DataRecord {
	return value == null ? {} : dataRecord(value, name);
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as DataRecord;
}

function isoTimestamp(value: unknown = new Date()): string {
	const date = value instanceof Date ? value : new Date(value as string | number);
	if (Number.isNaN(date.getTime())) throw new TypeError('A valid timestamp is required.');
	return date.toISOString();
}

function clone<Value>(value: Value): Value {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}
