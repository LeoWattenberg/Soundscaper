/* SPDX-License-Identifier: AGPL-3.0-only */

/** Aggregate exact selected-source authorities without collapsing linked A/V custody. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type {
	AssistanceWorkflowFenceV1,
	AssistanceWorkflowModelBindingV1,
	AssistanceWorkflowSourceRangeV1,
	AssistanceWorkflowStageSpec,
} from '../assistance/workflow.ts';
import type { LocalAssistanceGuidedPreparationUnavailableReason } from
	'../ui/local-assistance-preparation.ts';
import type { LocalAssistanceGuidedPrimitiveFence } from
	'./local-assistance-guided-transcript-context.ts';
import { readProjectSchemaIdentity } from '../project-schema-identity.ts';

const SHA256 = /^[a-f\d]{64}$/u;

export class LocalAssistanceGuidedFenceUnavailableError extends Error {
	readonly reason: LocalAssistanceGuidedPreparationUnavailableReason;
	constructor(reason: LocalAssistanceGuidedPreparationUnavailableReason) {
		super(`Guided aggregate fence is unavailable: ${reason}`);
		this.reason = reason;
	}
}

export function createLocalAssistanceGuidedAggregateFenceV1(options: Readonly<{
	project: Record<string, unknown>;
	primitiveFences: readonly LocalAssistanceGuidedPrimitiveFence[];
	stages: readonly AssistanceWorkflowStageSpec[];
	settingsBody: string;
	models: readonly AssistanceWorkflowModelBindingV1[];
}>): AssistanceWorkflowFenceV1 {
	const { project, primitiveFences, stages, settingsBody, models } = options;
	if (primitiveFences.length < 1) unavailable('source-custody-unavailable');
	assertCompatibleAuthorities(project, primitiveFences);
	const identity = readProjectSchemaIdentity(project);
	if (identity.schemaVersion !== 1) unavailable('source-custody-unavailable');
	const sourceRanges = sourceRangeInventory(project, primitiveFences);
	return Object.freeze({
		fenceVersion: 1,
		projectId: identifier(project.id, 'project ID'),
		schemaFamily: identity.schemaFamily,
		schemaVersion: 1,
		revision: integer(project.revision, 0, 'project revision'),
		sequenceId: primitiveFences[0]!.sequenceId,
		sourceRanges,
		transcriptBodySha256: transcriptDigest(project,
			new Set(sourceRanges.map(({ sourceId }) => sourceId))),
		recipeSha256: hash({ recipeVersion: 1, stages }),
		settingsSha256: hashJson(settingsBody),
		modelBindingsSha256: hash(models),
	});
}

function assertCompatibleAuthorities(
	project: Record<string, unknown>,
	values: readonly LocalAssistanceGuidedPrimitiveFence[],
): void {
	const first = values[0]!;
	if (first.projectId !== project.id || first.schemaFamily !== project.schemaFamily
		|| first.schemaVersion !== project.schemaVersion
		|| first.revision !== project.revision) stale();
	assertLinkMembership(project, first.occurrenceIds);
	const occurrences = JSON.stringify(first.occurrenceIds);
	for (const value of values) {
		if (value.projectId !== first.projectId || value.schemaFamily !== first.schemaFamily
			|| value.schemaVersion !== first.schemaVersion
			|| value.revision !== first.revision || value.sequenceId !== first.sequenceId
			|| value.linkMembershipSha256 !== first.linkMembershipSha256
			|| JSON.stringify(value.occurrenceIds) !== occurrences) stale();
	}
}

function assertLinkMembership(project: Record<string, unknown>, occurrenceIds: readonly string[]): void {
	const clips = records(project.clips);
	const admitted = occurrenceIds.map((occurrenceId) => {
		const matches = clips.filter(({ id }) => id === occurrenceId);
		if (matches.length !== 1) unavailable('timing-authority-unavailable');
		return matches[0]!;
	});
	if (admitted.length === 1) return;
	const linkIds = new Set(admitted.map(({ avLinkId }) => avLinkId));
	if (linkIds.size !== 1 || typeof admitted[0]!.avLinkId !== 'string'
		|| admitted[0]!.avLinkId.length < 1) unavailable('timing-authority-unavailable');
	const complete = clips.filter(({ avLinkId }) => avLinkId === admitted[0]!.avLinkId)
		.map(({ id }) => identifier(id, 'linked occurrence ID')).sort();
	if (JSON.stringify(complete) !== JSON.stringify([...occurrenceIds].sort())) {
		unavailable('timing-authority-unavailable');
	}
}

function sourceRangeInventory(
	project: Record<string, unknown>,
	values: readonly LocalAssistanceGuidedPrimitiveFence[],
): readonly AssistanceWorkflowSourceRangeV1[] {
	const bySource = new Map<string, LocalAssistanceGuidedPrimitiveFence>();
	for (const value of values) {
		const prior = bySource.get(value.sourceId);
		if (prior && JSON.stringify(prior) !== JSON.stringify(value)) stale();
		bySource.set(value.sourceId, value);
	}
	const clips = records(project.clips);
	const sources = records(project.sources);
	const result = [...bySource.values()].map((primitive): AssistanceWorkflowSourceRangeV1 => {
		const occurrenceInventory = primitive.occurrenceIds.map((occurrenceId) => {
			const matches = clips.filter(({ id }) => id === occurrenceId);
			if (matches.length !== 1) unavailable('timing-authority-unavailable');
			return matches[0]!;
		});
		const occurrences = occurrenceInventory.filter(({ sourceId }) => sourceId === primitive.sourceId);
		if (occurrences.length < 1) unavailable('timing-authority-unavailable');
		const kinds = new Set(occurrences.map(({ kind }) => kind));
		if (kinds.size !== 1) unavailable('timing-authority-unavailable');
		const kind = [...kinds][0];
		if (kind !== 'audio' && kind !== 'video') unavailable('selected-media-unavailable');
		for (const occurrence of occurrences) assertForwardOccurrence(occurrence, kind);
		const matchingSources = sources.filter(({ id }) => id === primitive.sourceId);
		if (matchingSources.length !== 1 || matchingSources[0]!.kind !== kind
			|| liveSource(matchingSources[0]!)) unavailable('source-custody-unavailable');
		const source = matchingSources[0]!;
		// A source-only workflow still carries the complete selected linked set. Narrowing
		// this range to its source-local occurrence would make publication disagree with
		// the exact primitive selection fence. Multi-source workflows distribute the set
		// across their ranges and their publishers reconstruct its canonical union.
		const boundOccurrences = bySource.size === 1
			? occurrenceInventory
			: occurrences;
		return Object.freeze({
			slotId: kind === 'audio' ? 'primary-audio' : 'primary-video',
			mediaKind: kind,
			sourceId: primitive.sourceId,
			sourceSha256: digest(primitive.sourceSha256),
			sourceSampleRate: kind === 'audio'
				? integer(source.sampleRate ?? project.sampleRate, 8_000, 'audio sample rate') : null,
			occurrenceIds: Object.freeze(boundOccurrences
				.map(({ id }) => identifier(id, 'occurrence ID')).sort()),
			sourceStartFrame: primitive.sourceStartFrame,
			sourceEndFrame: primitive.sourceEndFrame,
			linkMembershipSha256: digest(primitive.linkMembershipSha256),
			timingAuthoritySha256: digest(primitive.timingAuthoritySha256),
			retimeKind: occurrences.some(({ retimeMap }) => retimeMap != null)
				? 'monotonic-forward' : 'identity',
		});
	});
	if (new Set(result.map(({ mediaKind }) => mediaKind)).size !== result.length) {
		unavailable('timing-authority-unavailable');
	}
	return Object.freeze(result.sort((left, right) => left.mediaKind.localeCompare(right.mediaKind)));
}

function assertForwardOccurrence(
	occurrence: Record<string, unknown>,
	kind: 'audio' | 'video',
): void {
	if (occurrence.reversed === true
		|| typeof occurrence.speedRatio === 'number' && occurrence.speedRatio <= 0
		|| kind === 'audio' && (occurrence.speedRatio !== 1 || occurrence.warpMap != null
			|| occurrence.stretchToTempo !== false)) {
		unavailable('timing-authority-unavailable');
	}
}

function transcriptDigest(
	project: Record<string, unknown>,
	sourceIds: ReadonlySet<string>,
): string | null {
	const digests = new Set(records(project.assistanceAssets)
		.filter((asset) => asset.kind === 'transcript-v1' && sourceIds.has(String(asset.sourceId)))
		.map((asset) => record(asset.body, 'transcript body').sha256)
		.map(digest));
	if (digests.size > 1) unavailable('transcript-custody-unavailable');
	return [...digests][0] ?? null;
}

function hash(value: unknown): string { return hashJson(canonicalJson(value)); }
function hashJson(value: string): string {
	return bytesToHex(sha256(new TextEncoder().encode(value)));
}
function canonicalJson(value: unknown): string {
	if (value === null || typeof value === 'boolean' || typeof value === 'string'
		|| typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	const row = record(value, 'canonical workflow digest');
	return `{${Object.keys(row).sort().map((key) => (
		`${JSON.stringify(key)}:${canonicalJson(row[key])}`
	)).join(',')}}`;
}

function records(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => (
		Boolean(item) && typeof item === 'object' && !Array.isArray(item)
	)) : [];
}
function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a record.`);
	}
	return value as Record<string, unknown>;
}
function liveSource(source: Record<string, unknown>): boolean {
	return source.live === true || source.liveCapture === true || source.captureState === 'live';
}
function digest(value: unknown): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError('Aggregate digest authority is invalid.');
	}
	return value;
}
function identifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
		throw new TypeError(`The aggregate ${label} is invalid.`);
	}
	return value;
}
function integer(value: unknown, minimum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`The aggregate ${label} is invalid.`);
	}
	return Number(value);
}
function unavailable(reason: LocalAssistanceGuidedPreparationUnavailableReason): never {
	throw new LocalAssistanceGuidedFenceUnavailableError(reason);
}
function stale(): never { throw new DOMException('stale', 'AbortError'); }
