/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createFramescaperVideoRetimeConstantCommandV20,
	createFramescaperVideoRetimeFreezeCommandV20,
	createFramescaperVideoRetimeRampCommandV20,
	createFramescaperVideoRetimeResetCommandV20,
	createFramescaperVideoRetimeReverseCommandV20,
	createFramescaperVideoRetimeSetCommandV20,
	type FramescaperVideoRetimeCommandV20,
} from './editor-project-v20-retime-command.ts';

type Input<T extends FramescaperVideoRetimeCommandV20['type']> = Omit<Extract<
	FramescaperVideoRetimeCommandV20, { readonly type: T }
>, 'type' | 'scope'> & Readonly<{ scope?: 'timeline' | 'project-bin' }>;

export interface FramescaperVideoRetimeActionsV20 {
	readonly set: (value: Input<'video-retime/set'> | unknown) => unknown;
	readonly reset: (value: Input<'video-retime/reset'> | unknown) => unknown;
	readonly constant: (value: Input<'video-retime/constant'> | unknown) => unknown;
	readonly reverse: (value: Input<'video-retime/reverse'> | unknown) => unknown;
	readonly freeze: (value: Input<'video-retime/freeze'> | unknown) => unknown;
	readonly ramp: (value: Input<'video-retime/ramp'> | unknown) => unknown;
}

/** Bind the six exact authoring spellings without exposing a generic command escape hatch. */
export function createFramescaperVideoRetimeActionsV20(
	executeValue: ((command: FramescaperVideoRetimeCommandV20) => unknown) | unknown,
): Readonly<FramescaperVideoRetimeActionsV20> {
	if (typeof executeValue !== 'function') {
		throw new TypeError('Framescaper V20 video-retime actions require an exact command executor.');
	}
	const execute = executeValue as (command: FramescaperVideoRetimeCommandV20) => unknown;
	return Object.freeze({
		set: (value: unknown) => execute(createFramescaperVideoRetimeSetCommandV20(value)),
		reset: (value: unknown) => execute(createFramescaperVideoRetimeResetCommandV20(value)),
		constant: (value: unknown) => execute(createFramescaperVideoRetimeConstantCommandV20(value)),
		reverse: (value: unknown) => execute(createFramescaperVideoRetimeReverseCommandV20(value)),
		freeze: (value: unknown) => execute(createFramescaperVideoRetimeFreezeCommandV20(value)),
		ramp: (value: unknown) => execute(createFramescaperVideoRetimeRampCommandV20(value)),
	});
}
