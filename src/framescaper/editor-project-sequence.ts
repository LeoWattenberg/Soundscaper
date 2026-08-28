/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { FRAMESCAPER_PROJECT_SCHEMA_FAMILY } from '../common/editor/project-schema-identity.ts';
import {
	createAudioEditorProjectV17,
	type AudioEditorProjectV17Options,
} from '../common/editor/project-v17.ts';
import { normalizeVideoProxyAttachmentV18 } from '../common/editor/video-proxy-attachment-v18.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsSequence,
} from './editor-project-feature-requirements-sequence.ts';
import { assertFramescaperProjectSequenceProfile } from './editor-domain-runtime-profile.ts';
import type { FramescaperMulticameraGroupSequence } from './editor-project-sequence-multicam.ts';
import type { FramescaperSubsequenceSequence } from './editor-project-sequence-subsequence.ts';
import {
	FRAMESCAPER_PROJECT_SEQUENCE_SCHEMA_VERSION,
	validateFramescaperProjectSequence,
	type FramescaperProjectSequence,
} from './editor-project-sequence-validation.ts';

export {
	FRAMESCAPER_PROJECT_SEQUENCE_SCHEMA_VERSION,
	validateFramescaperProjectSequence,
	type FramescaperProjectSequence,
} from './editor-project-sequence-validation.ts';

export type FramescaperProjectSequenceOptions = AudioEditorProjectV17Options & Readonly<{
	readonly subsequences?: readonly FramescaperSubsequenceSequence[];
	readonly multicameraGroups?: readonly FramescaperMulticameraGroupSequence[];
}>;

/** Create a new exact sequence document; constructor input can never author an attachment. */
export function createFramescaperProjectSequence(
	profile: EditorProjectRuntimeProfile | unknown,
	options: FramescaperProjectSequenceOptions = {},
): FramescaperProjectSequence {
	assertFramescaperProjectSequenceProfile(profile);
	const subsequences = collectionInput(options, 'subsequences');
	const multicameraGroups = collectionInput(options, 'multicameraGroups');
	const foundation = createAudioEditorProjectV17(options) as unknown as Record<string, unknown>;
	const sources = (foundation.sources as readonly Record<string, unknown>[]).map((source) => {
		const result = { ...source };
		if (source.kind === 'video') result.proxyAttachment = null;
		else delete result.proxyAttachment;
		return result;
	});
	const project: Record<string, unknown> = {
		...foundation,
		schemaFamily: FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
		schemaVersion: FRAMESCAPER_PROJECT_SEQUENCE_SCHEMA_VERSION,
		sources,
		subsequences,
		multicameraGroups,
	};
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsSequence(profile, project);
	validateFramescaperProjectSequence(profile, project);
	return project as unknown as FramescaperProjectSequence;
}

function collectionInput(
	options: FramescaperProjectSequenceOptions | unknown,
	key: 'subsequences' | 'multicameraGroups',
): unknown {
	if (!options || typeof options !== 'object' || Array.isArray(options)) {
		throw new TypeError('Framescaper sequence project options must be an object.');
	}
	const descriptor = Object.getOwnPropertyDescriptor(options, key);
	if (!descriptor) return [];
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Framescaper sequence project ${key} must be an own enumerable data property.`);
	}
	return snapshotClone(descriptor.value, `Framescaper sequence project ${key}`);
}

/** Validate and detach an exact sequence document, including normalized frozen attachments. */
export function cloneFramescaperProjectSequence(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectSequence | unknown,
): FramescaperProjectSequence {
	assertFramescaperProjectSequenceProfile(profile);
	validateFramescaperProjectSequence(profile, project);
	const clone = snapshotClone(project, 'Framescaper project') as FramescaperProjectSequence;
	const sources = clone.sources as unknown as Record<string, unknown>[];
	for (const source of sources) {
		if (source.kind === 'video' && source.proxyAttachment !== null) {
			source.proxyAttachment = normalizeVideoProxyAttachmentV18(source.proxyAttachment);
		}
	}
	return clone;
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
		Object.defineProperty(result, key, {
			configurable: true,
			enumerable: true,
			value: snapshotClone(descriptor.value, `${name}.${key}`, seen),
			writable: true,
		});
	}
	return result;
}
