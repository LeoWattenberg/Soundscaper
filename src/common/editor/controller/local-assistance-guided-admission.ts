/* SPDX-License-Identifier: AGPL-3.0-only */

import { PROJECT_SCHEMA_VERSION, readProjectSchemaIdentity } from '../project-schema-identity.ts';
import type { LocalAssistanceGuidedPreparationUnavailableReason } from
	'../assistance/local-assistance-preparation.ts';
import type { LocalAssistanceGuidedPrimitiveFence } from './local-assistance-guided-transcript-context.ts';
import { reviewLocalAssistanceSelectedVideoSourceTimeDescriptorV1 } from
	'./local-assistance-selected-video-source-time.ts';

/**
 * What a guided workflow will and will not prepare from.
 *
 * Everything here refuses rather than repairs, and refuses with a named reason, because a
 * guided workflow that proceeded from a project it could not fully account for would hand
 * a model material the user never selected. Reversed clips, warped audio, live sources,
 * nested sequences and multicamera groups are each turned away by name, so the surface can
 * tell the user which authority was missing rather than that something went wrong.
 */

const SHA256 = /^[a-f\d]{64}$/u;

type PrimitiveFence = LocalAssistanceGuidedPrimitiveFence;

export interface InventorySource { readonly sourceId: string; readonly mediaKind: string }

export function primitiveFence(value: unknown): PrimitiveFence {
	const row = dataRecord(value, 'primitive selection fence');
	const identity = readProjectSchemaIdentity(row);
	if (identity.schemaVersion !== PROJECT_SCHEMA_VERSION) {
		throw new RangeError('Primitive selection requires the current project schema.');
	}
	const occurrenceIds = Array.isArray(row.occurrenceIds)
		? row.occurrenceIds.map((id) => String(id)) : [];
	if (occurrenceIds.length < 1) throw new TypeError('Primitive selection occurrences are unavailable.');
	return Object.freeze({ projectId: String(row.projectId), schemaFamily: identity.schemaFamily,
		schemaVersion: PROJECT_SCHEMA_VERSION,
		revision: Number(row.revision), sequenceId: String(row.sequenceId),
		occurrenceIds: Object.freeze(occurrenceIds), sourceId: String(row.sourceId),
		sourceSha256: digest(row.sourceSha256), sourceStartFrame: positiveFrame(row.sourceStartFrame, 0),
		sourceEndFrame: positiveFrame(row.sourceEndFrame, 1),
		linkMembershipSha256: digest(row.linkMembershipSha256),
		timingAuthoritySha256: digest(row.timingAuthoritySha256) });
}

export function normalizeInventory(value: unknown): readonly InventorySource[] {
	const row = dataRecord(value, 'selected-media inventory');
	if (!Array.isArray(row.sources)) throw new TypeError('Selected-media inventory is unavailable.');
	return Object.freeze(row.sources.map((candidate) => {
		const source = dataRecord(candidate, 'selected-media source');
		return Object.freeze({ sourceId: String(source.sourceId), mediaKind: String(source.mediaKind) });
	}));
}

export function assertSafeProjectTopology(project: Record<string, unknown>): void {
	if (recordArray(project.subsequences).length > 0 || recordArray(project.multicameraGroups).length > 0) {
		throw new UnavailableError('timing-authority-unavailable');
	}
	const selectedClipId = project.selectedClipId;
	const clips = recordArray(project.clips).filter(({ id }) => id === selectedClipId);
	if (clips.length !== 1) throw new UnavailableError('selected-media-unavailable');
	const clip = clips[0]!;
	if (clip.reversed === true || (typeof clip.speedRatio === 'number' && clip.speedRatio <= 0)
		|| (clip.kind === 'audio' && (clip.speedRatio !== 1 || clip.warpMap != null))) {
		throw new UnavailableError('timing-authority-unavailable');
	}
	const source = recordArray(project.sources).filter(({ id }) => id === clip.sourceId);
	if (source.length !== 1 || liveSource(source[0]!)) {
		throw new UnavailableError('source-custody-unavailable');
	}
}

export function projectRecord(value: unknown, selectedClipIdValue: string | null): Record<string, unknown> {
	const row = dataRecord(value, 'aggregate project');
	const selectedClipId = typeof selectedClipIdValue === 'string' && selectedClipIdValue.length > 0
		? selectedClipIdValue : null;
	return { ...row, selectedClipId };
}

export function recordArray(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => (
		Boolean(item) && typeof item === 'object' && !Array.isArray(item)
	)) : [];
}

export function correlateSelectedVideoDescriptor(value: unknown, fence: PrimitiveFence): unknown {
	const descriptor = reviewLocalAssistanceSelectedVideoSourceTimeDescriptorV1(value);
	const row = dataRecord(descriptor, 'selected-video source-time descriptor');
	if (row.descriptorVersion !== 1 || row.kind !== 'selected-video-source-time-authority'
		|| row.schemaFamily !== fence.schemaFamily || row.schemaVersion !== fence.schemaVersion
		|| row.projectId !== fence.projectId || row.projectRevision !== fence.revision
		|| row.sequenceId !== fence.sequenceId || row.sourceId !== fence.sourceId
		|| row.sourceSha256 !== fence.sourceSha256
		|| row.timingAuthoritySha256 !== fence.timingAuthoritySha256
		|| row.sourceStartFrame !== fence.sourceStartFrame
		|| row.sourceEndFrame !== fence.sourceEndFrame
		|| typeof row.videoOccurrenceId !== 'string'
		|| !fence.occurrenceIds.includes(row.videoOccurrenceId)) {
		throw new UnavailableError('timing-authority-unavailable');
	}
	return descriptor;
}

export function liveSource(source: Record<string, unknown>): boolean {
	return source.live === true || source.liveCapture === true || source.captureState === 'live';
}

export function digest(value: unknown): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError('Aggregate digest authority is invalid.');
	return value;
}

export function positiveFrame(value: unknown, minimum: number): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new RangeError('Aggregate frame authority is invalid.');
	return Number(value);
}

export function dataRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a record.`);
	}
	return value as Record<string, unknown>;
}

export class UnavailableError extends Error {
	readonly reason: LocalAssistanceGuidedPreparationUnavailableReason;
	constructor(reason: LocalAssistanceGuidedPreparationUnavailableReason) {
		super(`Guided preparation is unavailable: ${reason}`); this.reason = reason;
	}
}
