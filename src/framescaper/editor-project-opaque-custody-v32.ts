/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorProjectV17 } from '../common/editor/project-v17.ts';
import {
	snapshotFramescaperOpaqueCustodyProjectV28,
	type FramescaperOpaqueCustodyProjectV28,
} from './editor-project-opaque-custody-v28.ts';

const CUSTODY_VIEW_TIMESTAMP = '1970-01-01T00:00:00.000Z';

export type FramescaperOpaqueCustodyProjectV32 = FramescaperOpaqueCustodyProjectV28;

export interface FramescaperOpaqueCustodyConsumerProjectV32 extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly title: string;
	readonly schemaVersion: 32;
	readonly sampleRate: number;
	readonly sources: readonly never[];
	readonly clips: readonly never[];
	readonly tracks: readonly never[];
}

export function snapshotFramescaperOpaqueCustodyProjectV32(
	value: unknown,
): FramescaperOpaqueCustodyProjectV32 {
	return snapshotFramescaperOpaqueCustodyProjectV28(value);
}

/** Expose an inert selected-schema shell while retaining the opaque document in custody. */
export function createFramescaperOpaqueCustodyConsumerProjectV32(
	value: unknown,
): FramescaperOpaqueCustodyConsumerProjectV32 {
	const project = snapshotFramescaperOpaqueCustodyProjectV32(value);
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
		schemaVersion: 32,
		sources: Object.freeze([]),
		clips: Object.freeze([]),
		tracks: Object.freeze([]),
	}) as FramescaperOpaqueCustodyConsumerProjectV32;
}
