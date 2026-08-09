/* SPDX-License-Identifier: AGPL-3.0-only */

export const TRACK_FOLDER_V12_LIMITS = Object.freeze({
	maximumFolders: 4_096,
	maximumIdCodeUnits: 256,
	maximumNameCodeUnits: 4_096,
	minimumHeight: 40,
	maximumHeight: 4_096,
});

export const TRACK_FOLDER_V12_DEFAULTS = Object.freeze({
	collapsed: false,
	height: TRACK_FOLDER_V12_LIMITS.minimumHeight,
	hidden: false,
	mute: false,
	solo: false,
});

export interface TrackFolderV12 {
	readonly id: string;
	readonly name: string;
	readonly collapsed: boolean;
	readonly height: number;
	readonly hidden: boolean;
	readonly mute: boolean;
	readonly solo: boolean;
}

export interface TrackFolderV12Options {
	readonly id: string;
	readonly name: string;
	readonly collapsed?: boolean;
	readonly height?: number;
	readonly hidden?: boolean;
	readonly mute?: boolean;
	readonly solo?: boolean;
}

type DataRecord = Record<string, unknown>;
type FolderKey = keyof TrackFolderV12;

const FOLDER_KEYS = Object.freeze([
	'id',
	'name',
	'collapsed',
	'height',
	'hidden',
	'mute',
	'solo',
] as const satisfies readonly FolderKey[]);
const REQUIRED_FACTORY_KEYS: ReadonlySet<string> = new Set(['id', 'name']);
const FOLDER_KEY_SET: ReadonlySet<string> = new Set(FOLDER_KEYS);
const INVALID_CANONICAL_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** Create one immutable canonical V12 folder, applying only the declared state defaults. */
export function createTrackFolderV12(value: unknown): TrackFolderV12 {
	const candidate = closedDataRecord(
		value,
		FOLDER_KEY_SET,
		REQUIRED_FACTORY_KEYS,
		'track folder',
	);
	return Object.freeze({
		id: canonicalText(
			candidate.id,
			'track folder.id',
			TRACK_FOLDER_V12_LIMITS.maximumIdCodeUnits,
		),
		name: canonicalText(
			candidate.name,
			'track folder.name',
			TRACK_FOLDER_V12_LIMITS.maximumNameCodeUnits,
		),
		collapsed: folderBoolean(
			Object.hasOwn(candidate, 'collapsed') ? candidate.collapsed : TRACK_FOLDER_V12_DEFAULTS.collapsed,
			'track folder.collapsed',
		),
		height: folderHeight(
			Object.hasOwn(candidate, 'height') ? candidate.height : TRACK_FOLDER_V12_DEFAULTS.height,
			'track folder.height',
		),
		hidden: folderBoolean(
			Object.hasOwn(candidate, 'hidden') ? candidate.hidden : TRACK_FOLDER_V12_DEFAULTS.hidden,
			'track folder.hidden',
		),
		mute: folderBoolean(
			Object.hasOwn(candidate, 'mute') ? candidate.mute : TRACK_FOLDER_V12_DEFAULTS.mute,
			'track folder.mute',
		),
		solo: folderBoolean(
			Object.hasOwn(candidate, 'solo') ? candidate.solo : TRACK_FOLDER_V12_DEFAULTS.solo,
			'track folder.solo',
		),
	});
}

/** Create an immutable ordered folder metadata collection with globally unique folder IDs. */
export function createTrackFoldersV12(value: unknown): readonly TrackFolderV12[] {
	const candidates = canonicalArray(
		value,
		'project.trackFolders',
		TRACK_FOLDER_V12_LIMITS.maximumFolders,
	);
	const folders = candidates.map((candidate) => createTrackFolderV12(candidate));
	assertUniqueFolderIds(folders, 'project.trackFolders');
	return Object.freeze(folders);
}

/** Validate one exact persisted V12 folder without applying defaults or coercing values. */
export function validateTrackFolderV12(value: unknown): value is TrackFolderV12 {
	const candidate = closedDataRecord(value, FOLDER_KEY_SET, FOLDER_KEY_SET, 'track folder');
	canonicalText(candidate.id, 'track folder.id', TRACK_FOLDER_V12_LIMITS.maximumIdCodeUnits);
	canonicalText(candidate.name, 'track folder.name', TRACK_FOLDER_V12_LIMITS.maximumNameCodeUnits);
	folderBoolean(candidate.collapsed, 'track folder.collapsed');
	folderHeight(candidate.height, 'track folder.height');
	folderBoolean(candidate.hidden, 'track folder.hidden');
	folderBoolean(candidate.mute, 'track folder.mute');
	folderBoolean(candidate.solo, 'track folder.solo');
	return true;
}

/** Validate the exact ordered V12 folder metadata collection. */
export function validateTrackFoldersV12(value: unknown): value is readonly TrackFolderV12[] {
	const folders = canonicalArray(
		value,
		'project.trackFolders',
		TRACK_FOLDER_V12_LIMITS.maximumFolders,
	);
	for (const [index, folder] of folders.entries()) {
		validateNamedFolder(folder, `project.trackFolders[${String(index)}]`);
	}
	assertUniqueFolderIds(folders as readonly TrackFolderV12[], 'project.trackFolders');
	return true;
}

function validateNamedFolder(value: unknown, name: string): asserts value is TrackFolderV12 {
	const candidate = closedDataRecord(value, FOLDER_KEY_SET, FOLDER_KEY_SET, name);
	canonicalText(candidate.id, `${name}.id`, TRACK_FOLDER_V12_LIMITS.maximumIdCodeUnits);
	canonicalText(candidate.name, `${name}.name`, TRACK_FOLDER_V12_LIMITS.maximumNameCodeUnits);
	folderBoolean(candidate.collapsed, `${name}.collapsed`);
	folderHeight(candidate.height, `${name}.height`);
	folderBoolean(candidate.hidden, `${name}.hidden`);
	folderBoolean(candidate.mute, `${name}.mute`);
	folderBoolean(candidate.solo, `${name}.solo`);
}

function assertUniqueFolderIds(folders: readonly TrackFolderV12[], name: string): void {
	const ids = new Set<string>();
	for (const folder of folders) {
		if (ids.has(folder.id)) throw new RangeError(`${name} contains duplicate folder ID: ${folder.id}.`);
		ids.add(folder.id);
	}
}

function canonicalText(value: unknown, name: string, maximumCodeUnits: number): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new TypeError(`${name} must be a non-empty string.`);
	}
	if (value !== value.trim()) throw new TypeError(`${name} must be a canonical string.`);
	if (value.length > maximumCodeUnits) {
		throw new RangeError(`${name} length exceeds its maximum of ${String(maximumCodeUnits)} UTF-16 code units.`);
	}
	if (INVALID_CANONICAL_TEXT.test(value)) {
		throw new TypeError(`${name} must be single-line and contain no control or formatting characters.`);
	}
	return value;
}

function folderBoolean(value: unknown, name: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean.`);
	return value;
}

function folderHeight(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value)
		|| Object.is(value, -0)
		|| Number(value) < TRACK_FOLDER_V12_LIMITS.minimumHeight
		|| Number(value) > TRACK_FOLDER_V12_LIMITS.maximumHeight) {
		throw new RangeError(
			`${name} must be a safe integer between ${String(TRACK_FOLDER_V12_LIMITS.minimumHeight)}`
			+ ` and ${String(TRACK_FOLDER_V12_LIMITS.maximumHeight)}.`,
		);
	}
	return Number(value);
}

function closedDataRecord(
	value: unknown,
	allowed: ReadonlySet<string>,
	required: ReadonlySet<string>,
	name: string,
): DataRecord {
	if (!isPlainRecord(value)) throw new TypeError(`${name} must be a plain data object.`);
	const snapshot: DataRecord = Object.create(null) as DataRecord;
	const present = new Set<string>();
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || !allowed.has(key)) {
			throw new TypeError(`${name} contains an unsupported field: ${String(key)}.`);
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
		}
		present.add(key);
		snapshot[key] = descriptor.value;
	}
	for (const key of required) {
		if (!present.has(key)) throw new TypeError(`${name} is missing required field: ${key}.`);
	}
	return snapshot;
}

function canonicalArray(value: unknown, name: string, maximumLength: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`${name} must be a canonical array.`);
	}
	if (value.length > maximumLength) {
		throw new RangeError(`${name} cannot exceed ${String(maximumLength)} entries.`);
	}
	const allowed = new Set<string>(['length']);
	const snapshot: unknown[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const key = String(index);
		allowed.add(key);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} must be a dense canonical array of enumerable data elements.`);
		}
		snapshot.push(descriptor.value);
	}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || !allowed.has(key)) {
			throw new TypeError(`${name} contains an unsupported canonical array field: ${String(key)}.`);
		}
	}
	return snapshot;
}

function isPlainRecord(value: unknown): value is DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
