/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorProjectV17 } from '../common/editor/project-v17.ts';
import { snapshotFramescaperOpaqueCustodyProjectV28 } from './editor-project-opaque-custody-v28.ts';

const CUSTODY_VIEW_TIMESTAMP = '1970-01-01T00:00:00.000Z';

export interface FramescaperOpaqueCustodyConsumerProjectV31 extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly title: string;
	readonly schemaVersion: number;
	readonly sampleRate: number;
	readonly sources: readonly never[];
	readonly clips: readonly never[];
	readonly tracks: readonly never[];
}

/** Expose an inert consumer shell while retaining canonical opaque custody separately. */
export function createFramescaperOpaqueCustodyConsumerProjectV31(
	value: unknown,
): FramescaperOpaqueCustodyConsumerProjectV31 {
	const project = snapshotFramescaperOpaqueCustodyProjectV28(value);
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
		// Retain the held schema marker so exact-F31 validators never grant this
		// deliberately incomplete consumer view native document authority.
		schemaVersion: project.schemaVersion,
		sources: Object.freeze([]),
		clips: Object.freeze([]),
		tracks: Object.freeze([]),
	}) as FramescaperOpaqueCustodyConsumerProjectV31;
}
