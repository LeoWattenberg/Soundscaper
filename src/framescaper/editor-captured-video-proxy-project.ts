/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	framescaperCapturedVideoProxyProjectFingerprint,
	type FramescaperCapturedVideoProxyProject,
	type FramescaperCapturedVideoProxySchemaVersion,
} from './editor-captured-video-proxy-preservation.ts';
import { cloneFramescaperProject } from './editor-project.ts';

interface CapturedVideoProxyProjectCodec {
	readonly schemaVersion: FramescaperCapturedVideoProxySchemaVersion;
	readonly profile: EditorProjectRuntimeProfile;
}

export function cloneCapturedVideoProxyProject(
	codec: CapturedVideoProxyProjectCodec,
	project: unknown,
): FramescaperCapturedVideoProxyProject {
	return cloneFramescaperProject(codec.profile, project);
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
