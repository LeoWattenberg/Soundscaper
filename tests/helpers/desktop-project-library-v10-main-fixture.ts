/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import {
	createFramescaperDesktopLibraryProxyMediaBinding,
} from '../../desktop/project-library-v10-media-binding.ts';
import type {
	FramescaperDesktopProjectLibraryV10PublicationBeginRequest,
} from '../../desktop/project-library-v10-publication-transport.ts';
import type {
	FramescaperDesktopProjectLibraryV10MainSession,
} from '../../desktop/project-library-v10-main-session.ts';
import type { FramescaperProjectV18 } from '../../src/framescaper/editor-project-v18.ts';
import {
	ARCHIVE_PROXY_BYTES,
	ARCHIVE_TIMING,
	archiveProject,
} from './framescaper-v18-archive-fixture.ts';

export const V10_MAIN_PROJECT_ID = 'framescaper-v10-main-project';

export interface V10MainPublicationFixture {
	readonly request: Readonly<FramescaperDesktopProjectLibraryV10PublicationBeginRequest>;
	readonly bodies: readonly Uint8Array[];
}

export function v10MainPublication(revision = 1): V10MainPublicationFixture {
	const project = archiveProject({
		id: V10_MAIN_PROJECT_ID,
		revision,
		title: 'Framescaper V10 main publication',
	});
	return {
		request: {
			expectedMetadataRevision: revision - 1,
			expectedProject: revision === 1 ? null : expectedProject(project, revision - 1),
			project,
			bodies: descriptors(project),
		},
		bodies: [ARCHIVE_PROXY_BYTES, ARCHIVE_TIMING.bytes],
	};
}

export async function uploadV10MainPublication(
	session: FramescaperDesktopProjectLibraryV10MainSession,
	fixture: V10MainPublicationFixture = v10MainPublication(),
) {
	const admission = await session.beginPublication(fixture.request);
	for (const [bodyIndex, bytes] of fixture.bodies.entries()) {
		const midpoint = Math.max(1, Math.floor(bytes.byteLength / 2));
		let offset = 0;
		for (const chunk of [bytes.slice(0, midpoint), bytes.slice(midpoint)].filter(
			(candidate) => candidate.byteLength > 0,
		)) {
			const acknowledgement = await session.writePublicationChunk({
				publicationId: admission.publicationId,
				bodyIndex,
				offset,
				bytes: chunk,
			});
			offset += chunk.byteLength;
			if (acknowledgement.nextOffset !== offset) {
				throw new Error('V10 fixture received a non-sequential acknowledgement');
			}
		}
	}
	return session.finishPublication({ publicationId: admission.publicationId });
}

function descriptors(project: FramescaperProjectV18) {
	const source = project.sources.find((candidate) => candidate.kind === 'video');
	if (!source || source.kind !== 'video' || !source.proxyAttachment) {
		throw new Error('V10 main fixture requires one attached video source');
	}
	const attachment = source.proxyAttachment;
	const documentSha256 = digest(new TextEncoder().encode(JSON.stringify(project)));
	const binding = createFramescaperDesktopLibraryProxyMediaBinding(
		String(project.id), attachment.storageKey, Number(project.revision), documentSha256,
	);
	return [{
		kind: 'video-proxy' as const,
		encoding: 'video-proxy-v1' as const,
		bindingId: binding.id,
		sourceId: attachment.storageKey,
		storageKey: attachment.storageKey,
		mimeType: attachment.mimeType,
		byteLength: attachment.byteLength,
		sha256: attachment.sha256,
	}, {
		kind: 'video-timing' as const,
		encoding: 'soundscaper-video-timing-v1' as const,
		sourceId: attachment.timingAsset.storageKey,
		storageKey: attachment.timingAsset.storageKey,
		mimeType: 'application/vnd.soundscaper.video-timing' as const,
		byteLength: attachment.timingAsset.byteLength,
		sha256: attachment.timingAsset.sha256,
	}];
}

function expectedProject(project: FramescaperProjectV18, revision: number) {
	const previous = archiveProject({
		id: String(project.id), revision, title: String(project.title),
	});
	return {
		projectRevision: revision,
		projectSha256: digest(new TextEncoder().encode(JSON.stringify(previous))),
	};
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
