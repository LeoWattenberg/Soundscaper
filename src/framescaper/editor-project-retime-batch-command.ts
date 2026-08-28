/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperProjectCommandRetime } from './editor-project-retime-commands.ts';

/** Iteratively flatten an admitted batch without consuming the JavaScript call stack. */
export function flattenFramescaperProjectBatchCommandsRetime(
	command: Extract<FramescaperProjectCommandRetime, { readonly type: 'batch' }>,
): readonly FramescaperProjectCommandRetime[] {
	const result: FramescaperProjectCommandRetime[] = [];
	const pending = [...command.commands].reverse() as FramescaperProjectCommandRetime[];
	while (pending.length > 0) {
		const candidate = pending.pop()!;
		if (candidate.type !== 'batch') {
			result.push(candidate);
			continue;
		}
		for (let index = candidate.commands.length - 1; index >= 0; index -= 1) {
			pending.push(candidate.commands[index] as FramescaperProjectCommandRetime);
		}
	}
	return Object.freeze(result);
}
