/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDIO_EDITOR_TIMELINE_ANNOTATION_LIMITS,
	createTimelineAnnotationsV11,
	type TimelineAnnotationV11,
} from './timeline-annotation.ts';
import { secondsToSampleFrame, type HoldTempoMap } from './timeline-time.ts';
import { audacityXmlAttribute, audacityXmlChildren } from './audacity-binary-xml.js';
import { addAup4CompatibilityItem } from './aup4-profile.js';

const INVALID_ANNOTATION_NAME_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const xmlChildren = audacityXmlChildren as unknown as (node: unknown, name?: string | null) => unknown[];
const xmlAttribute = audacityXmlAttribute as unknown as (node: unknown, name: string, fallback?: unknown) => unknown;

export interface AudacityAnnotationLabelInput {
	readonly title?: unknown;
	readonly startSeconds?: unknown;
	readonly endSeconds?: unknown;
	readonly selected?: unknown;
	readonly opaqueExtensions?: unknown;
}

export interface AudacityAnnotationTrackInput {
	readonly name?: unknown;
	readonly selected?: unknown;
	readonly labels?: readonly AudacityAnnotationLabelInput[];
	readonly opaqueExtensions?: unknown;
}

export interface AudacityAnnotationImportContext {
	readonly sampleRate: number;
	readonly tempoMap: HoldTempoMap;
	readonly sequenceId: string;
	readonly sequenceIds?: readonly string[];
	readonly idFactory: (prefix: string) => string;
}

export interface AudacityAnnotationImportResult {
	readonly annotations: readonly TimelineAnnotationV11[];
	readonly selectedAnnotationIds: readonly string[];
	readonly sourceTrackCount: number;
}

/** Read AUP4 label tracks without letting the near-limit project decoder own conversion policy. */
export function readAup4AnnotationTracks(
	root: unknown,
	compatibilityReport: Record<string, unknown>,
	opaqueNode: (node: unknown) => unknown,
): readonly AudacityAnnotationTrackInput[] {
	if (typeof opaqueNode !== 'function') throw new TypeError('AUP4 annotation import requires an opaque-node adapter.');
	return xmlChildren(root, 'labeltrack').map((labelNode, index) => {
		const labels = xmlChildren(labelNode, 'label').map((node) => ({
			title: String(xmlAttribute(node, 'title', '')),
			startSeconds: nonNegativeFinite(xmlAttribute(node, 't', 0), 'AUP4 label start'),
			endSeconds: nonNegativeFinite(
				xmlAttribute(node, 't1', xmlAttribute(node, 't', 0)),
				'AUP4 label end',
			),
			selected: Boolean(xmlAttribute(node, 'isSelected', false)),
			opaqueExtensions: { aup4Label: opaqueNode(node) },
		}));
		addAup4CompatibilityItem(compatibilityReport, {
			code: labels.length
				? 'AUDACITY_LABEL_TRACK_CONVERTED_TO_TIMELINE_ANNOTATIONS'
				: 'AUDACITY_EMPTY_LABEL_TRACK_OMITTED',
			severity: labels.length ? 'info' : 'warning',
			disposition: labels.length ? 'converted' : 'omitted',
			scope: { kind: 'label-track', trackIndex: index },
			data: { labelCount: labels.length, sharedBatchIdentity: labels.length > 1 },
		});
		return {
			name: String(xmlAttribute(labelNode, 'name', `Labels ${String(index + 1)}`)),
			selected: Boolean(xmlAttribute(labelNode, 'isSelected', false)),
			labels,
			opaqueExtensions: { aup4LabelTrack: opaqueNode(labelNode) },
		};
	});
}

/** Convert Audacity label-track peers into fresh, batch-associated V11 annotations. */
export function createAudacityAnnotationImport(
	tracks: readonly AudacityAnnotationTrackInput[],
	context: AudacityAnnotationImportContext,
): AudacityAnnotationImportResult {
	if (!Array.isArray(tracks)) throw new TypeError('Audacity annotation tracks must be an array.');
	const sampleRate = positiveSafeInteger(context.sampleRate, 'Audacity annotation sampleRate');
	const sequenceId = canonicalId(context.sequenceId, 'Audacity annotation sequenceId');
	if (typeof context.idFactory !== 'function') throw new TypeError('Audacity annotation import requires an ID factory.');
	const candidates: Record<string, unknown>[] = [];
	const selectedAnnotationIds: string[] = [];
	let sourceTrackCount = 0;
	for (const [trackIndex, track] of tracks.entries()) {
		if (!track || typeof track !== 'object') {
			throw new TypeError(`Audacity annotation track ${String(trackIndex)} must be an object.`);
		}
		const labels = track.labels ?? [];
		if (!Array.isArray(labels)) throw new TypeError(`Audacity annotation track ${String(trackIndex)} labels must be an array.`);
		if (!labels.length) continue;
		sourceTrackCount += 1;
		const batchId = labels.length > 1
			? canonicalId(context.idFactory('annotation-batch'), 'imported annotation batch ID')
			: null;
		const trackName = String(track.name ?? `Labels ${String(trackIndex + 1)}`);
		for (const [labelIndex, label] of labels.entries()) {
			if (!label || typeof label !== 'object') {
				throw new TypeError(`Audacity annotation label ${String(trackIndex)}:${String(labelIndex)} must be an object.`);
			}
			const startSeconds = nonNegativeFinite(label.startSeconds, 'Audacity label startSeconds');
			const endSeconds = nonNegativeFinite(label.endSeconds ?? startSeconds, 'Audacity label endSeconds');
			if (endSeconds < startSeconds) throw new RangeError('Audacity label endSeconds cannot precede startSeconds.');
			const startFrame = secondsToSampleFrame(startSeconds, sampleRate, 'point');
			const resolvedEndFrame = secondsToSampleFrame(endSeconds, sampleRate, 'point');
			const positiveRegion = endSeconds > startSeconds;
			const endFrame = positiveRegion && resolvedEndFrame <= startFrame
				? safeAdd(startFrame, 1, 'minimum Audacity annotation region end')
				: resolvedEndFrame;
			const id = canonicalId(context.idFactory('annotation'), 'imported annotation ID');
			const originalTitle = String(label.title ?? '');
			const common = {
				id,
				sequenceId,
				name: canonicalAnnotationName(originalTitle),
				color: 'auto' as const,
				batchId,
				opaqueExtensions: {
					audacityLabel: {
						trackName,
						trackIndex,
						labelIndex,
						originalTitle,
						label: cloneOpaque(label.opaqueExtensions),
						...(labelIndex === 0 ? { track: cloneOpaque(track.opaqueExtensions) } : {}),
					},
				},
			};
			candidates.push(positiveRegion
				? { ...common, kind: 'region', anchor: 'sample', startFrame, endFrame }
				: { ...common, kind: 'marker', anchor: 'sample', positionFrame: startFrame });
			if (Boolean(track.selected) || Boolean(label.selected)) selectedAnnotationIds.push(id);
		}
	}
	const annotations = createTimelineAnnotationsV11(candidates, {
		tempoMap: context.tempoMap,
		sampleRate,
		sequenceIds: context.sequenceIds ?? [sequenceId],
	});
	return Object.freeze({
		annotations,
		selectedAnnotationIds: Object.freeze(selectedAnnotationIds),
		sourceTrackCount,
	});
}

function canonicalAnnotationName(value: string): string {
	return value.replace(INVALID_ANNOTATION_NAME_TEXT, ' ').trim()
		.slice(0, AUDIO_EDITOR_TIMELINE_ANNOTATION_LIMITS.maximumNameCodeUnits);
}

function cloneOpaque(value: unknown): unknown {
	if (value === undefined) return {};
	try {
		return structuredClone(value);
	} catch {
		throw new TypeError('Audacity annotation opaque data must be cloneable.');
	}
}

function canonicalId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value || value !== value.trim()) throw new TypeError(`${name} must be a canonical ID.`);
	return value;
}

function nonNegativeFinite(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isFinite(number) || number < 0) throw new RangeError(`${name} must be finite and non-negative.`);
	return number;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}

function safeAdd(value: number, increment: number, name: string): number {
	const result = value + increment;
	if (!Number.isSafeInteger(result) || result < 0) throw new RangeError(`${name} is outside the safe frame domain.`);
	return result;
}
