/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	preparePersistedProjectCommandDraft,
} from '../common/editor/project-current-runtime.ts';
import { projectV10ForCommand } from '../common/editor/project-v10-command-projection.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { normalizeVideoProxyAttachmentV18 } from '../common/editor/video-proxy-attachment-v18.ts';
import {
	resolveRuntimeProjectProjection,
	type RuntimeClipProject,
} from '../common/editor/runtime-clip-projection.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import {
	validateFramescaperProjectV18,
	type FramescaperProjectV18,
} from './editor-project-v18.ts';

type DataRecord = Record<string, unknown>;

/** Resolve an exact V18 project through the unchanged V17 timing foundation. */
export function framescaperProjectForRuntimeConsumersV18(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectV18 | unknown,
): FramescaperProjectV18 {
	assertFramescaperProjectV18Profile(profile);
	validateFramescaperProjectV18(profile, project);
	const foundation = resolveRuntimeProjectProjection({
		...(project as FramescaperProjectV18),
		schemaVersion: 17,
	} as RuntimeClipProject) as unknown as DataRecord;
	return Object.freeze({ ...foundation, schemaVersion: 18 }) as FramescaperProjectV18;
}

/** Produce the branded command projection without teaching global V17 helpers about V18. */
export function framescaperProjectForCommandConsumersV18(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectV18 | unknown,
): FramescaperProjectV18 {
	assertFramescaperProjectV18Profile(profile);
	validateFramescaperProjectV18(profile, project);
	const projection = projectV10ForCommand({
		...(project as FramescaperProjectV18),
		schemaVersion: 17,
	});
	projection.schemaVersion = 18;
	return projection as FramescaperProjectV18;
}

/** Reconcile one command draft while retaining exact source attachment authority. */
export function prepareFramescaperPersistedProjectCommandDraftV18(
	profile: EditorProjectRuntimeProfile | unknown,
	draft: DataRecord,
	persistedBase: FramescaperProjectV18 | unknown,
): void {
	assertFramescaperProjectV18Profile(profile);
	validateFramescaperProjectV18(profile, persistedBase);
	if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
		throw new TypeError('A Framescaper V18 command draft is required.');
	}
	const base = persistedBase as FramescaperProjectV18;
	const baseAttachments = new Map(base.sources.map((source) => [
		String(source.id),
		source.kind === 'video' ? source.proxyAttachment : undefined,
	]));
	draft.schemaVersion = 17;
	const persistedFoundation = { ...base, schemaVersion: 17 };
	try {
		preparePersistedProjectCommandDraft(draft, persistedFoundation);
	} finally {
		draft.schemaVersion = 18;
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
	validateFramescaperProjectV18(profile, draft);
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
