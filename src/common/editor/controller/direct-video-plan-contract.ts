/* SPDX-License-Identifier: AGPL-3.0-only */

import { isVideoKeyframeExportPlanV7 } from '../video-keyframe-export-plan-v7.ts';
import { getVideoExportFormat } from '../video-export.js';
import { isVideoCanvasFit } from '../video-canvas-fit.ts';
import {
	CANONICAL_VIDEO_EXPORT_PLAN_VERSION,
	VIDEO_KEYFRAME_EXPORT_PLAN_VERSION,
} from '../video-export-plan-version.ts';

export interface VideoFormatDescriptor {
	readonly audioCodec: string;
	readonly audioEncoder: string;
	readonly container: string;
	readonly extension: string;
	readonly id: 'mp4' | 'webm';
	readonly mimeType: 'video/mp4' | 'video/webm';
	readonly pixelFormat: string;
	readonly videoCodec: string;
	readonly videoEncoder: string;
}

export interface DirectVideoPlan extends Readonly<Record<string, unknown>> {
	readonly canvas?: unknown;
	readonly codecs?: unknown;
	readonly container?: unknown;
	readonly durationSeconds?: unknown;
	readonly extension?: unknown;
	readonly filterPlan?: unknown;
	readonly format?: unknown;
	readonly inputs?: unknown;
	readonly mimeType?: unknown;
	readonly outputFrameCount?: unknown;
	readonly range?: unknown;
	readonly version?: unknown;
}

export interface DirectVideoContract {
	readonly descriptor: VideoFormatDescriptor;
	readonly fileName: string;
	readonly fingerprint: string;
}

/** Capture either the unchanged canonical FFmpeg graph or one exact detached V7 RGBA plan. */
export function captureDirectVideoContract(
	plan: DirectVideoPlan,
	fileName: string,
): DirectVideoContract | null {
	try {
		if (!isRecord(plan)) return null;
		const versionProperty = Object.getOwnPropertyDescriptor(plan, 'version');
		if (!versionProperty?.enumerable || !Object.hasOwn(versionProperty, 'value')) return null;
		const version = versionProperty.value;
		if (version === VIDEO_KEYFRAME_EXPORT_PLAN_VERSION) {
			if (!isVideoKeyframeExportPlanV7(plan)) return null;
		} else if (version !== CANONICAL_VIDEO_EXPORT_PLAN_VERSION
			|| !Array.isArray(plan.inputs)) return null;
		const descriptor = getVideoExportFormat(String(plan.format || '')) as VideoFormatDescriptor;
		if ((descriptor.id !== 'mp4' && descriptor.id !== 'webm')
			|| plan.format !== descriptor.id
			|| plan.container !== descriptor.container
			|| plan.extension !== descriptor.extension
			|| plan.mimeType !== descriptor.mimeType
			|| !canonicalFileName(fileName, descriptor.extension)) return null;
		if (version === CANONICAL_VIDEO_EXPORT_PLAN_VERSION) {
			if (!canonicalVideoGeometry(plan, descriptor)
				|| !canonicalVideoInputs(plan, descriptor)) return null;
		}
		const fingerprint = JSON.stringify(plan);
		if (typeof fingerprint !== 'string' || !fingerprint) return null;
		return Object.freeze({ descriptor, fileName, fingerprint });
	} catch {
		return null;
	}
}

function canonicalVideoGeometry(
	plan: DirectVideoPlan,
	descriptor: VideoFormatDescriptor,
): boolean {
	const canvas = isRecord(plan.canvas) ? plan.canvas : null;
	const codecs = isRecord(plan.codecs) ? plan.codecs : null;
	const range = isRecord(plan.range) ? plan.range : null;
	if (!canvas || !codecs || !range
		|| !positiveEvenInteger(canvas.width) || !positiveEvenInteger(canvas.height)
		|| !positiveNumber(canvas.frameRate)
		|| !isVideoCanvasFit(canvas.fit)
		|| canvas.pixelFormat !== descriptor.pixelFormat
		|| codecs.pixelFormat !== descriptor.pixelFormat
		|| codecs.video !== descriptor.videoCodec
		|| codecs.videoEncoder !== descriptor.videoEncoder
		|| !positiveNumber(plan.durationSeconds)
		|| !positiveSafeInteger(plan.outputFrameCount)
		|| !nonNegativeSafeInteger(range.startFrame)
		|| !positiveSafeInteger(range.endFrame)
		|| !positiveSafeInteger(range.durationFrames)
		|| Number(range.endFrame) - Number(range.startFrame) !== range.durationFrames) return false;
	return true;
}

function canonicalVideoInputs(
	plan: DirectVideoPlan,
	descriptor: VideoFormatDescriptor,
): boolean {
	const inputs = plan.inputs as readonly unknown[];
	const codecs = plan.codecs as Readonly<Record<string, unknown>>;
	let audioInputs = 0;
	let videoInputs = 0;
	const videoSourceIds = new Set<string>();
	for (const [index, input] of inputs.entries()) {
		if (!isRecord(input) || input.inputIndex !== index) return false;
		if (input.kind === 'staged-audio-mix') audioInputs += 1;
		else if (input.kind === 'video-source') {
			if (typeof input.sourceId !== 'string' || !input.sourceId
				|| input.sourceId.includes('\0') || videoSourceIds.has(input.sourceId)) return false;
			videoSourceIds.add(input.sourceId);
			videoInputs += 1;
		} else return false;
	}
	const finalInput = inputs.at(-1);
	if (videoInputs === 0 || audioInputs > 1
		|| (audioInputs === 1 && (!isRecord(finalInput) || finalInput.kind !== 'staged-audio-mix'))) return false;
	const filterPlan = isRecord(plan.filterPlan) ? plan.filterPlan : null;
	const filterAudio = filterPlan && isRecord(filterPlan.audio) ? filterPlan.audio : null;
	return audioInputs === 1
		? codecs.audio === descriptor.audioCodec
			&& codecs.audioEncoder === descriptor.audioEncoder
			&& filterAudio?.strategy === 'staged-mix'
		: codecs.audio === null
			&& codecs.audioEncoder === null
			&& filterAudio?.strategy === 'none';
}

function canonicalFileName(fileName: string, extension: string): boolean {
	return typeof fileName === 'string'
		&& fileName.length > extension.length + 1
		&& fileName.toLowerCase().endsWith(`.${extension}`)
		&& !fileName.includes('\0')
		&& !fileName.includes('/')
		&& !fileName.includes('\\');
}

function positiveEvenInteger(value: unknown): boolean {
	return Number.isSafeInteger(value) && Number(value) >= 2 && Number(value) % 2 === 0;
}

function positiveSafeInteger(value: unknown): boolean {
	return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonNegativeSafeInteger(value: unknown): boolean {
	return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveNumber(value: unknown): boolean {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
