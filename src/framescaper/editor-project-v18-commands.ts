/* SPDX-License-Identifier: AGPL-3.0-only */

import { applyEditorCommand } from '../common/editor/commands.js';
import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import {
	framescaperProjectV18HasProxyAttachment,
	validateFramescaperProjectV18,
	type FramescaperProjectV18,
} from './editor-project-v18-validation.ts';

export interface FramescaperProjectCommandOptionsV18 {
	readonly now?: Date | string;
}

/** Execute an existing command on a transient V17 projection, then restore exact V18 authority. */
export function applyFramescaperProjectCommandV18(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectV18 | unknown,
	command: AudioEditorCommand,
	options: FramescaperProjectCommandOptionsV18 = {},
): FramescaperProjectV18 {
	assertFramescaperProjectV18Profile(profile);
	validateFramescaperProjectV18(profile, project);
	const persisted = project as FramescaperProjectV18;
	if (framescaperProjectV18HasProxyAttachment(persisted)) {
		throw new RangeError('A proxy-attached Framescaper V18 project is intrinsically read-only.');
	}
	const v17Project = structuredClone(persisted) as unknown as Record<string, unknown>;
	v17Project.schemaVersion = 17;
	for (const source of v17Project.sources as Record<string, unknown>[]) delete source.proxyAttachment;
	const commanded = applyEditorCommand(v17Project, command, options) as unknown as Record<string, unknown>;
	commanded.schemaVersion = 18;
	for (const source of commanded.sources as Record<string, unknown>[]) {
		if (source.kind === 'video') source.proxyAttachment = null;
		else delete source.proxyAttachment;
	}
	validateFramescaperProjectV18(profile, commanded);
	return commanded as FramescaperProjectV18;
}
