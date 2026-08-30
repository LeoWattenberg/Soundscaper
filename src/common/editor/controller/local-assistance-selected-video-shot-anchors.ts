/* SPDX-License-Identifier: AGPL-3.0-only */

/** Recover only exact, currently-bound shot markers accepted by the owned publisher. */

import type { AssistanceSelectionFence } from '../assistance/proposal-session.ts';
import { sequenceFrameBoundarySample } from '../sequence-frame-navigation.ts';

type DataRecord = Readonly<Record<string, unknown>>;

export interface LocalAssistanceSelectedVideoShotAnchorRequest {
	readonly project: DataRecord;
	readonly source: DataRecord;
	readonly sequence: DataRecord;
	readonly fence: AssistanceSelectionFence;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly mapSourceBoundary: (sourceFrame: number) => number | null;
	readonly readSourceFrameTick: (sourceFrame: number) => Readonly<{
		readonly timescale: number;
		readonly presentationTick: string;
	}> | null;
}

const EXTENSION_KEY = 'org.soundscaper.assistance-shot-boundaries-v1';
const EXTENSION_FIELDS = Object.freeze([
	'schemaVersion', 'operation', 'detector', 'timescale', 'sourceFrameCount', 'sourceId',
	'sourceSha256', 'sourceStartFrame', 'sourceEndFrame', 'timingAuthoritySha256',
	'sourceFrame', 'presentationTick', 'score',
]);
const SHOT_ID = /^assistance-shot:([a-f\d]{64}):(\d+)$/u;

export function readLocalAssistanceSelectedVideoShotAnchorFrames(
	request: LocalAssistanceSelectedVideoShotAnchorRequest,
): readonly number[] {
	const annotations = Array.isArray(request.project.timelineAnnotations)
		? request.project.timelineAnnotations : [];
	const frames: number[] = [];
	for (const candidate of annotations) {
		const annotation = record(candidate);
		if (!annotation || typeof annotation.id !== 'string'
			|| !annotation.id.startsWith('assistance-shot:')) continue;
		const match = SHOT_ID.exec(annotation.id);
		if (!match || annotation.batchId !== `assistance-shot-batch:${match[1]!}`
			|| annotation.kind !== 'marker' || annotation.anchor !== 'sample'
			|| typeof annotation.sequenceId !== 'string') {
			throw new TypeError('An accepted assistance shot marker lost its exact identity.');
		}
		if (annotation.sequenceId !== request.fence.sequenceId) continue;
		const extensions = record(annotation.opaqueExtensions);
		const extension = record(extensions?.[EXTENSION_KEY]);
		if (!extension || !exactFields(extension, EXTENSION_FIELDS)) {
			throw new TypeError('An accepted assistance shot marker lost its owned authority.');
		}
		if (extension.sourceId !== request.fence.sourceId
			|| extension.sourceSha256 !== request.fence.sourceSha256) continue;
		const sourceFrame = integer(extension.sourceFrame, 0, 'shot-anchor source frame');
		if (match[2] !== String(sourceFrame) || extension.schemaVersion !== 1
			|| extension.operation !== 'shot-detection'
			|| (extension.detector !== 'ffmpeg-scdet' && extension.detector !== 'transnetv2')
			|| extension.sourceStartFrame !== request.sourceStartFrame
			|| extension.sourceEndFrame !== request.sourceEndFrame
			|| extension.timingAuthoritySha256 !== request.fence.timingAuthoritySha256
			|| sourceFrame <= request.sourceStartFrame || sourceFrame >= request.sourceEndFrame) {
			throw new RangeError('An accepted assistance shot marker is stale for this source range.');
		}
		const sourceFrameCount = integer(request.source.sourceFrameCount, 1,
			'video source frame count');
		if (extension.sourceFrameCount !== sourceFrameCount
			&& extension.sourceFrameCount !== request.sourceEndFrame) {
			throw new RangeError('An accepted assistance shot marker changed source-frame authority.');
		}
		const tick = request.readSourceFrameTick(sourceFrame);
		if (!tick || extension.timescale !== tick.timescale
			|| extension.presentationTick !== tick.presentationTick
			|| typeof extension.score !== 'number' || !Number.isFinite(extension.score)
			|| extension.score < 0 || extension.score > 1) {
			throw new RangeError('An accepted assistance shot marker changed exact source timing.');
		}
		const mapped = request.mapSourceBoundary(sourceFrame);
		const sequenceRate = record(request.sequence.rate);
		if (mapped === null || !sequenceRate
			|| annotation.positionFrame !== sequenceFrameBoundarySample(mapped, {
				num: integer(sequenceRate.num, 1, 'sequence-rate numerator'),
				den: integer(sequenceRate.den, 1, 'sequence-rate denominator'),
			}, integer(request.project.sampleRate, 1, 'project sample rate'))) {
			throw new RangeError('An accepted assistance shot marker changed timeline mapping.');
		}
		frames.push(sourceFrame);
	}
	frames.sort((left, right) => left - right);
	if (new Set(frames).size !== frames.length) {
		throw new RangeError('Accepted assistance shot anchors must remain unique.');
	}
	return Object.freeze(frames);
}

function exactFields(value: DataRecord, fields: readonly string[]): boolean {
	const keys = Reflect.ownKeys(value);
	return keys.length === fields.length
		&& keys.every((key) => typeof key === 'string' && fields.includes(key));
}

function record(value: unknown): DataRecord | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as DataRecord : null;
}

function integer(value: unknown, minimum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}
