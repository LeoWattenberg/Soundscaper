/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	preparePersistedProjectCommandDraft,
} from '../common/editor/project-current-runtime.ts';
import { projectForCommand } from '../common/editor/project-command-projection.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { normalizeVideoProxyAttachmentV18 } from '../common/editor/video-proxy-attachment-v18.ts';
import {
	resolveRuntimeProjectProjection,
	type RuntimeClipProject,
	type RuntimeProjectProjection,
} from '../common/editor/runtime-clip-projection.ts';
import {
	framescaperProjectFeatureRequirementsForV17Foundation,
} from './editor-project-feature-requirements-sequence.ts';
import {
	materializeFramescaperNestedPlaybackFoundationSequence,
} from './editor-project-sequence-nested-playback.ts';
import {
	materializeFramescaperMulticameraPlaybackProjectSequence,
} from './editor-project-sequence-multicam-playback.ts';
import { assertFramescaperProjectSequenceProfile } from './editor-domain-runtime-profile.ts';
import {
	validateFramescaperProjectSequence,
	type FramescaperProjectSequence,
} from './editor-project-sequence.ts';

type DataRecord = Record<string, unknown>;

export interface FramescaperProjectRuntimeFoundationV17 extends RuntimeClipProject {
	readonly id: string;
	readonly schemaVersion: 17;
	readonly sources: readonly Readonly<Record<string, unknown>>[];
}

/** Resolve an exact sequence project through the unchanged V17 timing foundation. */
export function framescaperProjectForRuntimeConsumersSequence(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectSequence | unknown,
): RuntimeProjectProjection<FramescaperProjectRuntimeFoundationV17> {
	const foundation = framescaperProjectForAuthoredFoundationSequence(profile, project);
	return resolveRuntimeProjectProjection(foundation);
}

/**
 * Produce the exact V17-shaped transient document accepted by the unchanged
 * playback engine. Private sequence attachment authority and its requirement never
 * cross this boundary; canonical source identities still address originals.
 */
export function framescaperProjectForPlaybackFoundationSequence(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectSequence | unknown,
): FramescaperProjectRuntimeFoundationV17 {
	const playback = activeAngleProject(profile, project);
	if (playback.subsequences.length > 0) {
		return materializeFramescaperNestedPlaybackFoundationSequence(profile, playback);
	}
	return v17Foundation(profile, playback);
}

/**
 * Produce the same V17-shaped transient without the nested flattening. Command,
 * timeline, and preview consumers address authored clips, tracks, and selection
 * by their persisted identity, so only the identity-preserving active-angle
 * substitution may cross this boundary.
 */
export function framescaperProjectForAuthoredFoundationSequence(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectSequence | unknown,
): FramescaperProjectRuntimeFoundationV17 {
	return v17Foundation(profile, activeAngleProject(profile, project));
}

function activeAngleProject(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectSequence | unknown,
): FramescaperProjectSequence {
	assertFramescaperProjectSequenceProfile(profile);
	validateFramescaperProjectSequence(profile, project);
	const canonical = project as FramescaperProjectSequence;
	return canonical.multicameraGroups.length > 0
		? materializeFramescaperMulticameraPlaybackProjectSequence(profile, canonical)
		: canonical;
}

function v17Foundation(
	profile: EditorProjectRuntimeProfile | unknown,
	playback: FramescaperProjectSequence,
): FramescaperProjectRuntimeFoundationV17 {
	const sources = playback.sources.map((source) => {
		const foundationSource: Record<string, unknown> = { ...source };
		delete foundationSource.proxyAttachment;
		return Object.freeze(foundationSource);
	});
	const foundation: Record<string, unknown> = {
		...playback,
		schemaVersion: 17,
		sources: Object.freeze(sources),
		featureRequirements: framescaperProjectFeatureRequirementsForV17Foundation(
			profile,
			playback,
		),
	};
	delete foundation.schemaFamily;
	delete foundation.subsequences;
	delete foundation.multicameraGroups;
	return Object.freeze(foundation) as FramescaperProjectRuntimeFoundationV17;
}

/** Produce the branded command projection without teaching global V17 helpers about sequence. */
export function framescaperProjectForCommandConsumersSequence(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectSequence | unknown,
): FramescaperProjectRuntimeFoundationV17 {
	assertFramescaperProjectSequenceProfile(profile);
	validateFramescaperProjectSequence(profile, project);
	const foundation: Record<string, unknown> = {
		...(project as FramescaperProjectSequence),
		schemaVersion: 17,
	};
	delete foundation.schemaFamily;
	const projection = projectForCommand(foundation);
	return projection as FramescaperProjectRuntimeFoundationV17;
}

/** Reconcile one command draft while retaining exact source attachment authority. */
export function prepareFramescaperPersistedProjectCommandDraftSequence(
	profile: EditorProjectRuntimeProfile | unknown,
	draft: DataRecord,
	persistedBase: FramescaperProjectSequence | unknown,
): void {
	assertFramescaperProjectSequenceProfile(profile);
	validateFramescaperProjectSequence(profile, persistedBase);
	if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
		throw new TypeError('A Framescaper sequence command draft is required.');
	}
	const base = persistedBase as FramescaperProjectSequence;
	const baseAttachments = new Map(base.sources.map((source) => [
		String(source.id),
		source.kind === 'video' ? source.proxyAttachment : undefined,
	]));
	draft.schemaVersion = 17;
	delete draft.schemaFamily;
	const persistedFoundation: Record<string, unknown> = { ...base, schemaVersion: 17 };
	delete persistedFoundation.schemaFamily;
	try {
		preparePersistedProjectCommandDraft(draft, persistedFoundation);
	} finally {
		draft.schemaFamily = 'framescaper';
		draft.schemaVersion =  1;
	}
	const sources = recordArray(draft.sources, 'Framescaper command project.sources');
	for (const source of sources) {
		const id = String(source.id);
		if (source.kind === 'video') {
			const prior = baseAttachments.get(id);
			if (!baseAttachments.has(id)) source.proxyAttachment = null;
			else if (!sameAttachment(dataProperty(source, 'proxyAttachment', id), prior)) {
				throw new RangeError(`Framescaper command changed video source ${id} proxy attachment authority.`);
			}
		} else if (source.kind === 'audio') {
			delete source.proxyAttachment;
		}
	}
	validateFramescaperProjectSequence(profile, draft);
}

function sameAttachment(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (left === null || right === null || left === undefined || right === undefined) return false;
	return JSON.stringify(normalizeVideoProxyAttachmentV18(left))
		=== JSON.stringify(normalizeVideoProxyAttachmentV18(right));
}

function dataProperty(value: DataRecord, key: string, sourceId: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Framescaper video source ${sourceId}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function recordArray(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((candidate, index) => {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			throw new TypeError(`${name}[${String(index)}] must be an object.`);
		}
		return candidate as DataRecord;
	});
}
