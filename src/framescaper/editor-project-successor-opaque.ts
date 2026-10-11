/* SPDX-License-Identifier: AGPL-3.0-only */
import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import { createOpaqueProjectConsumer } from '../common/editor/project-opaque-consumer.ts';
import { classifyProjectSchemaIdentity } from '../common/editor/project-schema-identity.ts';

/** Inspect identity only. Foreign domain graphs never become successor intent. */
export function framescaperSuccessorOpaqueProject(value: unknown) {
	const identity = classifyProjectSchemaIdentity(value, 'framescaper', 'successor');
	if (identity.disposition === 'current') return null;
	if (identity.disposition === 'legacy') throw new Error('Migrate the original Framescaper archive before opening it in the successor editor.');
	return createOpaqueProjectConsumer(value, identity.identity);
}
export function framescaperSuccessorOpaqueHistory(value: unknown) {
	const present = framescaperSuccessorOpaqueProject(value);
	return present ? Object.freeze({ limit: AUDIO_EDITOR_HISTORY_LIMIT, present, undoStack: Object.freeze([]), redoStack: Object.freeze([]) }) : null;
}
export type FramescaperSuccessorOpaqueHistory = NonNullable<ReturnType<typeof framescaperSuccessorOpaqueHistory>>;
