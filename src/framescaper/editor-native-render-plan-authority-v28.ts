/* SPDX-License-Identifier: AGPL-3.0-only */

import { sequenceFrameBoundarySample } from '../common/editor/sequence-frame-navigation.ts';
import { nativeMediaV14EncodeDispatch } from '../common/editor/native-media-v14-native-dispatch.ts';
import { resolveVideoSourceTimingViews } from '../common/editor/video-source-timing-views.ts';
import {
	framescaperV28ImageSequenceDeliveryDescriptor,
	framescaperV28NativeDeliveryProfile,
	snapshotFramescaperNativeRenderDeliveryRequestV28,
	type FramescaperNativeRenderDeliveryRequestV28,
} from './editor-native-project-action-requests-v28.ts';
import { framescaperProjectV27FoundationShapeV28 } from './editor-project-v28-foundation.ts';
import type { FramescaperProjectV28 } from './editor-project-v28.ts';
import { createFramescaperVideoExportVisualFreshnessV27 } from './video-export-visual-freshness-v27.ts';

/** One shared authority for queue admission and renderer-owned V14 carrier production. */
export function createFramescaperNativeRenderPlanAuthorityV28(
	project: FramescaperProjectV28,
	deliveryValue?: FramescaperNativeRenderDeliveryRequestV28,
) {
	const delivery = snapshotFramescaperNativeRenderDeliveryRequestV28(deliveryValue);
	const profile = framescaperV28NativeDeliveryProfile(delivery);
	const dispatch = nativeMediaV14EncodeDispatch(profile);
	const sequenceId = stableId(project.primarySequenceId, 'primary sequence ID');
	const sequence = records(project.sequences, 'sequences').find(({ id }) => id === sequenceId);
	if (!sequence) throw new ReferenceError('The selected V28 primary sequence is unavailable.');
	const rate = rational(sequence.rate, 'primary sequence rate');
	const sampleRate = integer(project.sampleRate, 'project sample rate', 1);
	const endFrame = records(project.clips, 'clips').reduce((maximum, clip) => (
		clip.sequenceId === sequenceId && ['video', 'still', 'generator'].includes(String(clip.kind))
			? Math.max(maximum, safeAdd(
				integer(clip.sequenceStartFrame, 'clip sequence start', 0),
				integer(clip.sequenceFrameCount, 'clip sequence duration', 1),
			)) : maximum
	), 0);
	if (endFrame < 1) throw new Error('The selected V28 sequence has no renderable picture duration.');
	const sampleDuration = sequenceFrameBoundarySample(endFrame, rate, sampleRate);
	const includeAudio = delivery.kind === 'encoded-mov' && sequenceHasAudio(project, sequence);
	const masterChannels = integer(project.masterChannels, 'project master channels', 1);
	const audioLayout = includeAudio
		? masterChannels === 1 ? 'mono' as const : masterChannels === 2 ? 'stereo' as const : 'preserve' as const
		: null;
	const foundation = framescaperProjectV27FoundationShapeV28(project);
	const sequenceDescriptor = delivery.kind === 'image-sequence'
		? framescaperV28ImageSequenceDeliveryDescriptor(delivery.format) : null;
	return Object.freeze({
		sequenceId, sampleStart: 0, sampleDuration,
		outputRate: delivery.kind === 'image-sequence' ? delivery.frameRate : rate,
		format: sequenceDescriptor === null
			? Object.freeze({ container: 'mov', extension: 'mov', mimeType: 'video/quicktime' })
			: Object.freeze({
				container: 'image2', extension: sequenceDescriptor.extension,
				mimeType: sequenceDescriptor.mimeType,
			}),
		codecs: Object.freeze({
			video: delivery.kind === 'encoded-mov' ? 'prores' : dispatch.encoder,
			videoEncoder: dispatch.encoder,
			audio: includeAudio ? dispatch.audioEncoder : null,
			audioEncoder: includeAudio ? dispatch.audioEncoder : null,
			pixelFormat: dispatch.pixelFormat,
		}),
		canvas: Object.freeze({
			width: 1_920, height: 1_080, fit: 'contain', pixelFormat: dispatch.pixelFormat,
			backgroundColor: delivery.kind === 'image-sequence' ? '#00000000' : '#000000',
		}),
		quality: 'balanced' as const, includeAudio, audioLayout,
		timingViews: resolveVideoSourceTimingViews(project),
		visualFreshnessByModelId: createFramescaperVideoExportVisualFreshnessV27(
			foundation, Object.freeze({ startFrame: 0, durationFrames: sampleDuration }),
		),
	});
}

function sequenceHasAudio(project: FramescaperProjectV28, sequence: Record<string, unknown>): boolean {
	const trackIds = new Set(ids(sequence.trackIds, 'primary sequence track IDs'));
	const audioClipIds = new Set(records(project.clips, 'clips')
		.filter(({ kind }) => kind === 'audio').map(({ id }) => stableId(id, 'audio clip ID')));
	return records(project.tracks, 'tracks').some((track) => track.type === 'audio'
		&& trackIds.has(stableId(track.id, 'audio track ID'))
		&& ids(track.clipIds, 'audio track clip IDs').some((id) => audioClipIds.has(id)));
}

function ids(value: unknown, name: string): string[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((id) => stableId(id, name));
}

function rational(value: unknown, name: string): Readonly<{ num: number; den: number }> {
	const row = record(value, name);
	return Object.freeze({ num: integer(row.num, `${name}.num`, 1), den: integer(row.den, `${name}.den`, 1) });
}
function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}
function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}
function integer(value: unknown, name: string, minimum: number): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new RangeError(`${name} is invalid.`);
	return Number(value);
}
function safeAdd(left: number, right: number): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError('The selected V28 render range overflows.');
	return result;
}
