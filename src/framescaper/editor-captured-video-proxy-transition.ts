/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoProxyAttachmentV18 } from '../common/editor/video-proxy-attachment-v18.ts';
import type { CapturedVideoProxySchedulerDependencies } from './editor-captured-video-proxy-scheduler-composition.ts';
import {
	cloneCapturedVideoProxyProject,
} from './editor-captured-video-proxy-project.ts';
import type {
	FramescaperCapturedVideoProxyProject,
} from './editor-captured-video-proxy-preservation.ts';
import { sameCapturedVideoProxyAttachment } from './editor-captured-video-proxy-request.ts';

/** Build only the exact next null-to-new or old-to-new attachment revision. */
export function nextCapturedVideoProxyAttachmentProject(
	dependencies: CapturedVideoProxySchedulerDependencies,
	base: FramescaperCapturedVideoProxyProject,
	sourceId: string,
	attachment: Readonly<VideoProxyAttachmentV18>,
	expectedAttachment?: Readonly<VideoProxyAttachmentV18>,
): FramescaperCapturedVideoProxyProject {
	if (base.revision === Number.MAX_SAFE_INTEGER) {
		throw new RangeError('The captured proxy revision cannot advance.');
	}
	const draft = structuredClone(base) as unknown as Record<string, unknown>;
	const source = videoSource(draft as unknown as FramescaperCapturedVideoProxyProject, sourceId);
	if (expectedAttachment
		? !sameCapturedVideoProxyAttachment(source.proxyAttachment, expectedAttachment)
		: source.proxyAttachment !== null) {
		throw new Error('The captured proxy attachment changed before its exact swap.');
	}
	source.proxyAttachment = attachment;
	draft.revision = Number(base.revision) + 1;
	const baseTime = new Date(String(base.updatedAt)).getTime();
	draft.updatedAt = new Date(Math.max(Date.now(), baseTime + 1)).toISOString();
	draft.featureRequirements = dependencies.reconcileProjectRequirements(draft);
	return cloneCapturedVideoProxyProject(dependencies, draft);
}

function videoSource(
	project: FramescaperCapturedVideoProxyProject,
	sourceId: string,
): Record<string, unknown> & { proxyAttachment: VideoProxyAttachmentV18 | null } {
	const sources = (project as unknown as {
		readonly sources: readonly Readonly<Record<string, unknown>>[];
	}).sources;
	const matches = sources.filter((source) => source.id === sourceId);
	if (matches.length !== 1 || matches[0]!.kind !== 'video') {
		throw new ReferenceError(`Captured video proxy source ${sourceId} is missing or ambiguous.`);
	}
	return matches[0] as Record<string, unknown> & {
		proxyAttachment: VideoProxyAttachmentV18 | null;
	};
}
