/* SPDX-License-Identifier: AGPL-3.0-only */

import { createStableId } from '../common/editor/stable-id.js';
import { throwIfScapeAborted } from '../common/editor/scape-abort.ts';
import { createBlobScapeArchiveByteSource } from '../common/editor/scape-archive-byte-source.ts';
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	cloneFramescaperProjectV18,
	loadFramescaperProjectV18,
	type FramescaperProjectV18,
} from './editor-project-v18.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import type {
	FramescaperScapeProjectFileImportOptionsV18,
	FramescaperScapeProjectFileImportResultV18,
	FramescaperScapeProjectFileV18,
} from './scape-project-file-v18.ts';

export interface FramescaperScapeNativeStoreV18 {
	loadProject(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown;
}

export interface FramescaperScapeNativeImportOptionsV18 {
	readonly collision: string;
	readonly signal: AbortSignal;
}

export interface FramescaperScapeNativeImportResultV18 {
	readonly project: FramescaperProjectV18;
	readonly readOnly: boolean;
	readonly reason: 'proxy-attached' | 'newer-schema' | null;
	readonly manifest: Readonly<Record<string, unknown>>;
	readonly collision: 'copy' | 'replace' | null;
}

export interface FramescaperScapeNativeRuntimeV18 {
	readonly inspectScapeProject: FramescaperScapeProjectFileV18['inspectScapeProject'];
	readonly importScapeProject: (
		input: ScapeProjectInput,
		store: FramescaperScapeNativeStoreV18,
		options: FramescaperScapeNativeImportOptionsV18,
	) => Promise<Readonly<FramescaperScapeNativeImportResultV18>>;
	readonly exportScapeProject: (
		project: unknown,
		store: FramescaperScapeNativeStoreV18,
		options: Parameters<FramescaperScapeProjectFileV18['exportProject']>[1],
	) => ReturnType<FramescaperScapeProjectFileV18['exportProject']>;
	readonly copyScapeArchive: (
		input: Blob,
		write: (bytes: Uint8Array) => void | PromiseLike<void>,
		options: Readonly<{ signal: AbortSignal }>,
	) => Promise<Readonly<{ byteLength: number; schemaVersion: 18 }>>;
}

/** Maps generic native-project choices onto exact V18 publication contracts. */
export function createFramescaperScapeNativeRuntimeV18(
	profile: EditorProjectRuntimeProfile | unknown,
	file: FramescaperScapeProjectFileV18,
): Readonly<FramescaperScapeNativeRuntimeV18> {
	assertFramescaperProjectV18Profile(profile);
	if (!file || typeof file !== 'object') throw new TypeError('The exact V18 Scape file authority is required.');
	return Object.freeze({
		inspectScapeProject: file.inspectScapeProject,
		importScapeProject: async (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStoreV18,
			options: FramescaperScapeNativeImportOptionsV18,
		) => {
			const inspected = await file.inspectScapeProject(
				input,
				store,
				{ signal: options.signal },
				{ retain() {} },
			);
			const existing = await store.loadProject(inspected.id, { signal: options.signal });
			const publication = publicationRequest(profile, inspected, existing, options.collision);
			const result = await file.importProject(input, {
				decision: 'continue',
				operationId: createStableId('scape-v18-import'),
				publication,
				signal: options.signal,
			});
			return nativeResult(profile, inspected.manifest, existing, options.collision, result);
		},
		exportScapeProject: (
			project: unknown,
			_store: FramescaperScapeNativeStoreV18,
			options: Parameters<FramescaperScapeProjectFileV18['exportProject']>[1],
		) => file.exportProject(project, options),
		copyScapeArchive: async (
			input: Blob,
			write: (bytes: Uint8Array) => void | PromiseLike<void>,
			options: Readonly<{ signal: AbortSignal }>,
		) => {
			if (typeof write !== 'function') throw new TypeError('A V18 Scape archive copy sink is required.');
			const signal = options?.signal;
			if (!(signal instanceof AbortSignal)) throw new TypeError('A V18 Scape archive copy signal is required.');
			const inspection = await file.inspectScapeProject(
				input,
				null,
				{ signal },
				{ retain() {} },
			);
			if (!inspection.readOnly || inspection.schemaVersion !== 18) {
				throw new Error('Only an intrinsically read-only V18 Scape archive can be copied unchanged.');
			}
			throwIfScapeAborted(signal);
			const source = createBlobScapeArchiveByteSource(input);
			let offset = 0;
			while (offset < source.size) {
				throwIfScapeAborted(signal);
				const bytes = await source.read({
					offset,
					length: Math.min(source.maximumReadBytes, source.size - offset),
					signal,
				});
				await write(bytes);
				offset += bytes.byteLength;
			}
			throwIfScapeAborted(signal);
			return Object.freeze({ byteLength: offset, schemaVersion: 18 });
		},
	});
}

function publicationRequest(
	profile: EditorProjectRuntimeProfile,
	inspection: Readonly<{ id: string; title: string; project: unknown }>,
	existingValue: unknown,
	collision: string,
): FramescaperScapeProjectFileImportOptionsV18['publication'] {
	if (!existingValue) return Object.freeze({ mode: 'create' });
	const expected = cloneFramescaperProjectV18(profile, existingValue);
	const origin = cloneFramescaperProjectV18(profile, inspection.project);
	const now = new Date().toISOString();
	if (collision === 'replace') {
		if (expected.revision === Number.MAX_SAFE_INTEGER) throw new RangeError('The V18 project revision cannot advance.');
		return Object.freeze({
			mode: 'compare-and-swap',
			expected,
			project: cloneFramescaperProjectV18(profile, {
				...origin,
				id: expected.id,
				revision: expected.revision + 1,
				createdAt: expected.createdAt,
				updatedAt: now,
			}),
		});
	}
	if (collision !== 'copy') throw new RangeError('Choose copy or replace for a V18 Scape collision.');
	return Object.freeze({
		mode: 'copy',
		project: cloneFramescaperProjectV18(profile, {
			...origin,
			id: createStableId('project'),
			title: `${inspection.title || 'Untitled'} copy`,
			revision: 0,
			createdAt: now,
			updatedAt: now,
		}),
	});
}

function nativeResult(
	profile: EditorProjectRuntimeProfile,
	manifest: Readonly<Record<string, unknown>>,
	existing: unknown,
	collision: string,
	result: Readonly<FramescaperScapeProjectFileImportResultV18>,
): Readonly<FramescaperScapeNativeImportResultV18> {
	if (result.status !== 'published') {
		throw new Error(result.status === 'stale'
			? 'The V18 Scape destination changed before publication.'
			: 'The V18 Scape import was cancelled.');
	}
	const loaded = loadFramescaperProjectV18(profile, result.project);
	if (loaded.project.schemaVersion !== 18) throw new Error('The V18 Scape import returned a future project.');
	return Object.freeze({
		project: loaded.project as FramescaperProjectV18,
		readOnly: loaded.readOnly,
		reason: loaded.reason,
		manifest,
		collision: existing ? (collision === 'replace' ? 'replace' : 'copy') : null,
	});
}
