/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Which proxy attachments survive an edit, and which the edit invalidates.
 *
 * A proxy stands in for exactly one state of one original. Everything the
 * attachment records — the digest it was generated from, the frame count it
 * conforms to, the occurrence it belongs to — is a claim about the source as it
 * was when the coordinator installed it. An edit that leaves those claims true
 * may keep the pointer; an edit that makes any of them false must drop it, in
 * the same transaction, or the project would carry a proxy for a source that no
 * longer exists.
 *
 * That rule is not invented here. `validateFramescaperProjectSequence` already
 * refuses a document whose attachment disagrees with its source, so this is the
 * same set of conditions asked *before* the document is built rather than after:
 *
 * - the digest the proxy was generated from is still the source's content;
 * - the frame count it conforms to is still the source's frame count;
 * - the source is still placed somewhere, because a proxy for material no
 *   occurrence uses is retention with no purpose.
 *
 * Retime is deliberately absent from that list. Proxy conformance is proved in
 * source-frame ordinals; preview selects that source-domain proxy frame before
 * applying an occurrence's retime map. Retime therefore changes presentation,
 * not the source identity or boundaries recorded by the attachment.
 *
 * Relink, changed-content relink, replace, reprobe, reimport, trim-media and
 * consolidate all land as one of the first two. Deleting the last clip that uses
 * a source lands as the third. None of them needs to know a proxy exists: they
 * change the source, and the attachment falls away because it stopped being
 * true. That is what makes this the atomic invalidation the attachment wire was
 * always specified to need — before it existed, those commands were refused
 * outright on an attached project, which is why an attached document could not
 * be edited at all.
 */

import type { VideoProxyAttachmentV18 } from '../common/editor/video-proxy-attachment-v18.ts';

interface SourceRecord extends Record<string, unknown> {
	readonly id?: unknown;
	readonly kind?: unknown;
	readonly contentSha256?: unknown;
	readonly sourceFrameCount?: unknown;
}

interface ClipRecord extends Record<string, unknown> {
	readonly sourceId?: unknown;
	readonly retimeMap?: unknown;
}

interface ProjectRecord extends Record<string, unknown> {
	readonly sources?: unknown;
	readonly clips?: unknown;
	readonly projectBin?: unknown;
}

/** Read every attachment a project currently holds, by source ID. */
export function framescaperVideoProxyAttachmentsSequence(
	project: unknown,
): ReadonlyMap<string, Readonly<VideoProxyAttachmentV18>> {
	const attachments = new Map<string, Readonly<VideoProxyAttachmentV18>>();
	for (const source of sourcesOf(project)) {
		if (source.kind !== 'video') continue;
		const attachment = source.proxyAttachment as Readonly<VideoProxyAttachmentV18> | null | undefined;
		if (attachment) attachments.set(String(source.id), attachment);
	}
	return attachments;
}

/**
 * Carry attachments across an edit, dropping every one the edit invalidated.
 *
 * The commanded project is rewritten in place — it is the draft the caller is
 * still building — because a video source must end up with an explicit
 * `proxyAttachment` either way, and an audio source must carry none at all.
 */
export function retainFramescaperVideoProxyAttachmentsSequence(
	commanded: unknown,
	attachments: ReadonlyMap<string, Readonly<VideoProxyAttachmentV18>>,
): void {
	const occurrences = occurrencesBySource(commanded);
	for (const source of sourcesOf(commanded)) {
		if (source.kind !== 'video') {
			delete (source as Record<string, unknown>).proxyAttachment;
			continue;
		}
		const previous = attachments.get(String(source.id)) ?? null;
		(source as Record<string, unknown>).proxyAttachment = previous
			&& stillTrue(previous, source, occurrences.get(String(source.id)) ?? [])
			? previous
			: null;
	}
}

function stillTrue(
	attachment: Readonly<VideoProxyAttachmentV18>,
	source: SourceRecord,
	occurrences: readonly ClipRecord[],
): boolean {
	if (attachment.originalSha256 !== source.contentSha256) return false;
	if (attachment.frameCount !== source.sourceFrameCount) return false;
	return occurrences.length > 0;
}

function sourcesOf(project: unknown): readonly SourceRecord[] {
	const record = (project && typeof project === 'object' ? project : null) as ProjectRecord | null;
	return Array.isArray(record?.sources) ? record.sources as SourceRecord[] : [];
}

function occurrencesBySource(project: unknown): ReadonlyMap<string, readonly ClipRecord[]> {
	const record = (project && typeof project === 'object' ? project : null) as ProjectRecord | null;
	const bin = (record?.projectBin && typeof record.projectBin === 'object'
		? record.projectBin
		: null) as Readonly<{ clips?: unknown }> | null;
	const clips = [
		...(Array.isArray(record?.clips) ? record.clips as ClipRecord[] : []),
		...(Array.isArray(bin?.clips) ? bin.clips as ClipRecord[] : []),
	];
	const grouped = new Map<string, ClipRecord[]>();
	for (const clip of clips) {
		if (!clip || typeof clip !== 'object') continue;
		const sourceId = String(clip.sourceId);
		const existing = grouped.get(sourceId);
		if (existing) existing.push(clip);
		else grouped.set(sourceId, [clip]);
	}
	return grouped;
}
