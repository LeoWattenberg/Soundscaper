/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAudioEditorProjectV17,
} from '../common/editor/project-v17.ts';
import { snapshotFramescaperOpaqueProject } from './editor-project-v18.ts';

const CUSTODY_VIEW_TIMESTAMP = '1970-01-01T00:00:00.000Z';

export interface FramescaperOpaqueCustodyProjectV27 extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly title: string;
	readonly schemaVersion: number;
	readonly sampleRate: number;
	readonly sources: readonly unknown[];
	readonly clips: readonly unknown[];
	readonly tracks: readonly Readonly<{ readonly id: string; readonly type: string }>[];
}

export interface FramescaperOpaqueCustodyConsumerProjectV27 extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly title: string;
	readonly schemaVersion: 27;
	readonly sampleRate: number;
	readonly sources: readonly never[];
	readonly clips: readonly never[];
	readonly tracks: readonly never[];
}

/** Descriptor-snapshot the recognized document without interpreting dormant fields. */
export function snapshotFramescaperOpaqueCustodyProjectV27(
	value: unknown,
): FramescaperOpaqueCustodyProjectV27 {
	const project = snapshotFramescaperOpaqueProject(value);
	if (typeof project.id !== 'string' || !project.id.trim()
		|| typeof project.title !== 'string' || !project.title.trim()
		|| !Number.isSafeInteger(project.sampleRate)
		|| Number(project.sampleRate) < 8_000 || Number(project.sampleRate) > 384_000
		|| !Array.isArray(project.sources) || !Array.isArray(project.clips)
		|| !Array.isArray(project.tracks)) {
		throw new TypeError('Opaque Framescaper custody requires the generic project envelope.');
	}
	for (const track of project.tracks) {
		if (!track || typeof track !== 'object' || Array.isArray(track)
			|| typeof (track as Readonly<Record<string, unknown>>).id !== 'string'
			|| typeof (track as Readonly<Record<string, unknown>>).type !== 'string') {
			throw new TypeError('Opaque Framescaper custody requires generic track identities.');
		}
	}
	return project as FramescaperOpaqueCustodyProjectV27;
}

/**
 * Give maintained consumers an inert generic document while the canonical
 * dormant project remains untouched in custody. No V25/V26 field is executed.
 */
export function createFramescaperOpaqueCustodyConsumerProjectV27(
	value: unknown,
): FramescaperOpaqueCustodyConsumerProjectV27 {
	const project = snapshotFramescaperOpaqueCustodyProjectV27(value);
	const shell = createAudioEditorProjectV17({
		id: project.id,
		title: project.title,
		sampleRate: project.sampleRate,
		now: CUSTODY_VIEW_TIMESTAMP,
		updatedAt: CUSTODY_VIEW_TIMESTAMP,
		sources: [], clips: [], tracks: [],
	});
	return Object.freeze({
		...shell,
		schemaVersion: 27,
		sources: Object.freeze([]),
		clips: Object.freeze([]),
		tracks: Object.freeze([]),
	}) as FramescaperOpaqueCustodyConsumerProjectV27;
}
