/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createFramescaperVideoRetimeConstantCommandRetime,
	createFramescaperVideoRetimeFreezeCommandRetime,
	createFramescaperVideoRetimeRampCommandRetime,
	createFramescaperVideoRetimeResetCommandRetime,
	createFramescaperVideoRetimeReverseCommandRetime,
	createFramescaperVideoRetimeSetCommandRetime,
	type FramescaperVideoRetimeCommandRetime,
} from './editor-project-retime-retime-command.ts';

type Input<T extends FramescaperVideoRetimeCommandRetime['type']> = Omit<Extract<
	FramescaperVideoRetimeCommandRetime, { readonly type: T }
>, 'type' | 'scope'> & Readonly<{ scope?: 'timeline' | 'project-bin' }>;

export interface FramescaperVideoRetimeActionsRetime {
	readonly set: (value: Input<'video-retime/set'> | unknown) => unknown;
	readonly reset: (value: Input<'video-retime/reset'> | unknown) => unknown;
	readonly constant: (value: Input<'video-retime/constant'> | unknown) => unknown;
	readonly reverse: (value: Input<'video-retime/reverse'> | unknown) => unknown;
	readonly freeze: (value: Input<'video-retime/freeze'> | unknown) => unknown;
	readonly ramp: (value: Input<'video-retime/ramp'> | unknown) => unknown;
}

/** Bind the six exact authoring spellings without exposing a generic command escape hatch. */
export function createFramescaperVideoRetimeActionsRetime(
	executeValue: ((command: FramescaperVideoRetimeCommandRetime) => unknown) | unknown,
): Readonly<FramescaperVideoRetimeActionsRetime> {
	if (typeof executeValue !== 'function') {
		throw new TypeError('Framescaper retime video-retime actions require an exact command executor.');
	}
	const execute = executeValue as (command: FramescaperVideoRetimeCommandRetime) => unknown;
	return Object.freeze({
		set: (value: unknown) => execute(createFramescaperVideoRetimeSetCommandRetime(value)),
		reset: (value: unknown) => execute(createFramescaperVideoRetimeResetCommandRetime(value)),
		constant: (value: unknown) => execute(createFramescaperVideoRetimeConstantCommandRetime(value)),
		reverse: (value: unknown) => execute(createFramescaperVideoRetimeReverseCommandRetime(value)),
		freeze: (value: unknown) => execute(createFramescaperVideoRetimeFreezeCommandRetime(value)),
		ramp: (value: unknown) => execute(createFramescaperVideoRetimeRampCommandRetime(value)),
	});
}
