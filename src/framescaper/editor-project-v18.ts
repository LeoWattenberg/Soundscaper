/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	createAudioEditorProjectV17,
	type AudioEditorProjectV17Options,
} from '../common/editor/project-v17.ts';
import { normalizeVideoProxyAttachmentV18 } from '../common/editor/video-proxy-attachment-v18.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import {
	FRAMESCAPER_PROJECT_V18_SCHEMA_VERSION,
	framescaperProjectV18HasProxyAttachment,
	validateFramescaperProjectV18,
	type FramescaperProjectV18,
} from './editor-project-v18-validation.ts';

export {
	FRAMESCAPER_PROJECT_V18_SCHEMA_VERSION,
	validateFramescaperProjectV18,
	type FramescaperProjectV18,
} from './editor-project-v18-validation.ts';

export type FramescaperProjectV18Options = AudioEditorProjectV17Options;

export interface LoadedFramescaperProjectV18 {
	readonly project: FramescaperProjectV18 | Readonly<Record<string, unknown>>;
	readonly readOnly: boolean;
	readonly intrinsicReadOnly: boolean;
	readonly reason: 'proxy-attached' | 'newer-schema' | null;
}

/** Create a new exact V18 document; constructor input can never author an attachment. */
export function createFramescaperProjectV18(
	profile: EditorProjectRuntimeProfile | unknown,
	options: FramescaperProjectV18Options = {},
): FramescaperProjectV18 {
	assertFramescaperProjectV18Profile(profile);
	const foundation = createAudioEditorProjectV17(options) as unknown as Record<string, unknown>;
	const sources = (foundation.sources as readonly Record<string, unknown>[]).map((source) => {
		const result = { ...source };
		if (source.kind === 'video') result.proxyAttachment = null;
		else delete result.proxyAttachment;
		return result;
	});
	const project = {
		...foundation,
		schemaVersion: FRAMESCAPER_PROJECT_V18_SCHEMA_VERSION,
		sources,
	};
	validateFramescaperProjectV18(profile, project);
	return project as unknown as FramescaperProjectV18;
}

/** Validate and detach an exact V18 document, including normalized frozen attachments. */
export function cloneFramescaperProjectV18(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectV18 | unknown,
): FramescaperProjectV18 {
	assertFramescaperProjectV18Profile(profile);
	validateFramescaperProjectV18(profile, project);
	const clone = snapshotClone(project, 'Framescaper project') as FramescaperProjectV18;
	const sources = clone.sources as unknown as Record<string, unknown>[];
	for (const source of sources) {
		if (source.kind === 'video' && source.proxyAttachment !== null) {
			source.proxyAttachment = normalizeVideoProxyAttachmentV18(source.proxyAttachment);
		}
	}
	return clone;
}

/** Load exact V18 or preserve a descriptor-snapshotted future document opaquely. */
export function loadFramescaperProjectV18(
	profile: EditorProjectRuntimeProfile | unknown,
	value: unknown,
): LoadedFramescaperProjectV18 {
	assertFramescaperProjectV18Profile(profile);
	const schemaVersion = readSchemaVersion(value);
	if (schemaVersion > FRAMESCAPER_PROJECT_V18_SCHEMA_VERSION) {
		return {
			project: snapshotClone(value, 'future Framescaper project') as Readonly<Record<string, unknown>>,
			readOnly: true,
			intrinsicReadOnly: true,
			reason: 'newer-schema',
		};
	}
	validateFramescaperProjectV18(profile, value);
	const project = cloneFramescaperProjectV18(profile, value);
	const attached = framescaperProjectV18HasProxyAttachment(project);
	return {
		project,
		readOnly: attached,
		intrinsicReadOnly: attached,
		reason: attached ? 'proxy-attached' : null,
	};
}

export function readFramescaperProjectSchemaVersion(value: unknown): number {
	return readSchemaVersion(value);
}

export function snapshotFramescaperOpaqueProject(value: unknown): Readonly<Record<string, unknown>> {
	return snapshotClone(value, 'opaque Framescaper project') as Readonly<Record<string, unknown>>;
}

function readSchemaVersion(value: unknown): number {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A saved Framescaper project is required.');
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('Saved Framescaper project schemaVersion must be an own enumerable data property.');
	}
	if (!Number.isSafeInteger(descriptor.value) || Number(descriptor.value) < 1) {
		throw new RangeError(`Unsupported Framescaper project schema version: ${String(descriptor.value)}.`);
	}
	return Number(descriptor.value);
}

function snapshotClone(value: unknown, name: string, seen = new Map<object, unknown>()): unknown {
	if (value === null || typeof value !== 'object') return value;
	const prior = seen.get(value);
	if (prior !== undefined) return prior;
	if (Array.isArray(value)) {
		const result: unknown[] = [];
		seen.set(value, result);
		const keys = Reflect.ownKeys(value);
		if (keys.some((key) => key !== 'length' && (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(key)))) {
			throw new TypeError(`${name} arrays must be dense data arrays.`);
		}
		for (let index = 0; index < value.length; index += 1) {
			const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
			if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
				throw new TypeError(`${name}[${String(index)}] must be an own enumerable data property.`);
			}
			result.push(snapshotClone(descriptor.value, `${name}[${String(index)}]`, seen));
		}
		return result;
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must contain only plain structured-clone records.`);
	}
	const result: Record<string, unknown> = {};
	seen.set(value, result);
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') throw new TypeError(`${name} cannot contain symbol properties.`);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
		}
		result[key] = snapshotClone(descriptor.value, `${name}.${key}`, seen);
	}
	return result;
}
