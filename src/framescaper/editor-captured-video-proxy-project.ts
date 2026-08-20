/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	framescaperCapturedVideoProxyProjectFingerprint,
	type FramescaperCapturedVideoProxyProject,
	type FramescaperCapturedVideoProxySchemaVersion,
} from './editor-captured-video-proxy-preservation.ts';
import { cloneFramescaperProjectV18 } from './editor-project-v18.ts';
import { cloneFramescaperProjectV19 } from './editor-project-v19.ts';

interface CapturedVideoProxyProjectCodec {
	readonly schemaVersion: FramescaperCapturedVideoProxySchemaVersion;
	readonly profile: EditorProjectRuntimeProfile;
}

export function cloneCapturedVideoProxyProject(
	codec: CapturedVideoProxyProjectCodec,
	project: unknown,
): FramescaperCapturedVideoProxyProject {
	return codec.schemaVersion === 18
		? cloneFramescaperProjectV18(codec.profile, project)
		: cloneFramescaperProjectV19(codec.profile, project);
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
