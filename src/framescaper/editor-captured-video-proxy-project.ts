/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	framescaperCapturedVideoProxyProjectFingerprint,
	type FramescaperCapturedVideoProxyProject,
	type FramescaperCapturedVideoProxySchemaVersion,
} from './editor-captured-video-proxy-preservation.ts';
import { cloneFramescaperProjectV18 } from './editor-project-v18.ts';
import { cloneFramescaperProjectV19 } from './editor-project-v19.ts';
import { cloneFramescaperProjectV20 } from './editor-project-v20.ts';
import { cloneFramescaperProjectV27 } from './editor-project-v27.ts';

interface CapturedVideoProxyProjectCodec {
	readonly schemaVersion: FramescaperCapturedVideoProxySchemaVersion;
	readonly profile: EditorProjectRuntimeProfile;
}

export function cloneCapturedVideoProxyProject(
	codec: CapturedVideoProxyProjectCodec,
	project: unknown,
): FramescaperCapturedVideoProxyProject {
	if (codec.schemaVersion === 18) return cloneFramescaperProjectV18(codec.profile, project);
	if (codec.schemaVersion === 19) return cloneFramescaperProjectV19(codec.profile, project);
	if (codec.schemaVersion === 20) return cloneFramescaperProjectV20(codec.profile, project);
	return cloneFramescaperProjectV27(codec.profile, project);
}

export function capturedVideoProxyProjectFingerprint(
	codec: CapturedVideoProxyProjectCodec,
	project: unknown,
): string {
	return framescaperCapturedVideoProxyProjectFingerprint(
		codec.schemaVersion,
		codec.profile,
		project,
	);
}
