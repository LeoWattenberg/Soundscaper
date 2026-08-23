/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	snapshotFramescaperProjectCommandV24,
	type FramescaperProjectCommandOptionsV24,
	type FramescaperProjectCommandV24,
} from './editor-project-v24-commands.ts';
import { applyInheritedFramescaperProjectCommandV27 } from './editor-project-v27-command-inheritance.ts';
import { assertFramescaperProjectV27Profile } from './editor-project-runtime-profile-v27.ts';
import {
	validateFramescaperProjectV27,
	type FramescaperProjectV27,
} from './editor-project-v27-validation.ts';

/** Selected V27 initially inherits the complete maintained V24 command vocabulary. */
export type FramescaperProjectCommandV27 = FramescaperProjectCommandV24;
export type FramescaperProjectCommandOptionsV27 = FramescaperProjectCommandOptionsV24;

export function snapshotFramescaperProjectCommandV27(value: unknown): FramescaperProjectCommandV27 {
	return snapshotFramescaperProjectCommandV24(value);
}

export function applyFramescaperProjectCommandV27(
	profile: unknown,
	project: unknown,
	commandValue: unknown,
	options: FramescaperProjectCommandOptionsV27 = {},
): FramescaperProjectV27 {
	assertFramescaperProjectV27Profile(profile);
	validateFramescaperProjectV27(profile, project);
	const command = snapshotFramescaperProjectCommandV27(commandValue);
	return applyInheritedFramescaperProjectCommandV27(
		profile,
		project as FramescaperProjectV27,
		command,
		options,
	);
}
