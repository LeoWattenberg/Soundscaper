/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	applyFramescaperProjectCommandAssistance,
	snapshotFramescaperProjectCommandAssistance,
	type FramescaperProjectCommandOptionsAssistance,
	type FramescaperProjectCommandAssistance,
} from './editor-project-assistance-commands.ts';
import {
	prepareFramescaperVideoTransitionAllocationsAssistance,
} from './editor-project-assistance-transition-allocation.ts';
import {
	validateFramescaperProject,
	type FramescaperProject,
} from './editor-project.ts';
import { assertFramescaperProjectRuntimeProfile } from './editor-project-runtime-profile.ts';

/** Command DTO revisions remain wire contracts; the selected document command authority is unversioned. */
export type FramescaperProjectCommand = FramescaperProjectCommandAssistance;
export type FramescaperProjectCommandOptions = FramescaperProjectCommandOptionsAssistance;

export function snapshotFramescaperProjectCommand(value: unknown): FramescaperProjectCommand {
	return snapshotFramescaperProjectCommandAssistance(value);
}

export function applyFramescaperProjectCommand(
	profile: unknown,
	projectValue: unknown,
	commandValue: unknown,
	options: FramescaperProjectCommandOptions = {},
): FramescaperProject {
	assertFramescaperProjectRuntimeProfile(profile);
	validateFramescaperProject(profile, projectValue);
	const applied = applyFramescaperProjectCommandAssistance(
		profile,
		projectValue,
		commandValue,
		options,
	);
	validateFramescaperProject(profile, applied);
	return applied as FramescaperProject;
}

export function prepareFramescaperVideoTransitionAllocations(
	profile: unknown,
	project: unknown,
	command: FramescaperProjectCommand,
	createId: (prefix?: string) => string,
): FramescaperProjectCommand {
	assertFramescaperProjectRuntimeProfile(profile);
	validateFramescaperProject(profile, project);
	return prepareFramescaperVideoTransitionAllocationsAssistance(
		profile,
		project,
		command,
		createId,
	);
}
