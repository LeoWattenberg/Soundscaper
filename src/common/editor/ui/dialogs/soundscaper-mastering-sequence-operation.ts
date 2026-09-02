/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	MasteringSequenceCommandPayloads,
	MasteringSequenceCommandType,
} from '../../commands/mastering-sequence.ts';

/** The ordinary document commands emitted by the focused mastering editor. */
export type MasteringSequenceCommandOperation = {
	readonly [Type in MasteringSequenceCommandType]: Readonly<
		{ readonly type: Type } & MasteringSequenceCommandPayloads[Type]
	>;
}[MasteringSequenceCommandType];

export type MasteringSequenceDialogOperation =
	| MasteringSequenceCommandOperation
	| Readonly<{
		readonly type: 'batch';
		readonly commands: readonly MasteringSequenceCommandOperation[];
	}>;
