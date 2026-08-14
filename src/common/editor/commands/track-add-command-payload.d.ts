/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CommandObject } from './protocol.ts';

/** Optional duplication metadata is transient command authority, never track wire. */
export interface TrackAddCommandPayload {
	readonly track: CommandObject;
	readonly index?: number;
	readonly sequenceId?: string;
	readonly parentFolderId?: string | null;
	readonly parentIndex?: number;
	readonly productionDuplicate?: Readonly<{
		readonly sourceTrackId: string;
		readonly effectIds: readonly Readonly<{ readonly sourceId: string; readonly targetId: string }>[];
	}>;
}
