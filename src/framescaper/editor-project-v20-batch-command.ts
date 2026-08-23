/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperProjectCommandV20 } from './editor-project-v20-commands.ts';

/** Iteratively flatten an admitted batch without consuming the JavaScript call stack. */
export function flattenFramescaperProjectBatchCommandsV20(
	command: Extract<FramescaperProjectCommandV20, { readonly type: 'batch' }>,
): readonly FramescaperProjectCommandV20[] {
	const result: FramescaperProjectCommandV20[] = [];
	const pending = [...command.commands].reverse() as FramescaperProjectCommandV20[];
	while (pending.length > 0) {
		const candidate = pending.pop()!;
		if (candidate.type !== 'batch') {
			result.push(candidate);
			continue;
		}
		for (let index = candidate.commands.length - 1; index >= 0; index -= 1) {
			pending.push(candidate.commands[index] as FramescaperProjectCommandV20);
		}
	}
	return Object.freeze(result);
}
