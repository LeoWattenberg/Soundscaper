/* SPDX-License-Identifier: AGPL-3.0-only */

import { sequenceFrameBoundarySample } from '../common/editor/sequence-frame-navigation.ts';
import type { VideoCanvasFit } from '../common/editor/video-canvas-fit.ts';
import type { VideoSourceTimingView } from '../common/editor/video-source-timing-view.ts';
import type { UnifiedExactRenderPlanV13 } from '../common/editor/unified-exact-render-plan.ts';
import type { UnifiedExactRenderPlanV16 } from '../common/editor/unified-exact-render-plan-v16.ts';
import type { FramescaperProjectFinishing } from './editor-project-finishing.ts';
import { createFramescaperProjectUnifiedExactRenderPlanFinishing } from './editor-project-unified-render-plan-finishing.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV16 } from './editor-project-unified-render-plan-v16.ts';
import { createFramescaperVideoExportVisualFreshnessFinishing } from './video-export-visual-freshness-finishing.ts';
type Data = Readonly<Record<string, unknown>>;

export function createSelectedPreviewPlan(
	profile: unknown,
	project: Data,
	canvas: Readonly<{ width: number; height: number; fit?: VideoCanvasFit }>,
	timingViews: ReadonlyMap<string, VideoSourceTimingView>,
	resourcePicture: boolean,
): UnifiedExactRenderPlanV13 | UnifiedExactRenderPlanV16 {
	const sequence = primarySequence(project);
	const rate = rational(sequence.rate, 'Selected finishing sequence rate');
	const sampleRate = positiveInteger(project.sampleRate, 'Selected finishing sample rate');
	const maximumFrame = records(project.clips, 'Selected finishing clips').reduce((maximum, clip) => (
		clip.sequenceId === sequence.id && ['video', 'still', 'generator'].includes(String(clip.kind))
			? Math.max(maximum, safeEnd(clip)) : maximum
	), 0);
	if (maximumFrame < 1) throw new RangeError('Selected finishing visual preview requires a non-empty picture range.');
	const sampleDuration = sequenceFrameBoundarySample(maximumFrame, rate, sampleRate);
	const create = resourcePicture ? createFramescaperProjectUnifiedExactRenderPlanV16 : createFramescaperProjectUnifiedExactRenderPlanFinishing;
	return create(profile, project, {
		sequenceId: stableId(sequence.id, 'Selected finishing sequence ID'),
		sampleStart: 0,
		sampleDuration,
		outputRate: rate,
		format: { container: 'mp4', extension: 'mp4', mimeType: 'video/mp4' },
		codecs: {
			video: 'h264', videoEncoder: 'libx264', audio: null, audioEncoder: null,
			pixelFormat: 'yuv420p',
		},
		canvas: {
			...canvas,
			fit: canvas.fit ?? 'contain',
			pixelFormat: 'yuv420p',
			backgroundColor: '#000000',
		},
		quality: 'balanced',
		includeAudio: false,
		audioLayout: null,
		timingViews,
		visualFreshnessByModelId: createFramescaperVideoExportVisualFreshnessFinishing(
			project as unknown as FramescaperProjectFinishing,
			{ startFrame: 0, durationFrames: sampleDuration },
		),
	});
}


function primarySequence(project: Data): Data {
	const id = stableId(project.primarySequenceId, 'Selected finishing primary sequence ID');
	const sequence = records(project.sequences, 'Selected finishing sequences').find((candidate) => candidate.id === id);
	if (!sequence) throw new ReferenceError(`Selected finishing primary sequence ${id} is unavailable.`);
	return sequence;
}


function safeEnd(clip: Data): number {
	const start = nonNegativeInteger(clip.sequenceStartFrame, 'clip sequence start');
	const count = positiveInteger(clip.sequenceFrameCount, 'clip sequence duration');
	if (!Number.isSafeInteger(start + count)) throw new RangeError('Clip sequence range overflows.');
	return start + count;
}


function rational(value: unknown, name: string): Readonly<{ num: number; den: number }> {
	const input = record(value, name);
	return Object.freeze({
		num: positiveInteger(input.num, `${name} numerator`),
		den: positiveInteger(input.den, `${name} denominator`),
	});
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
		throw new TypeError(`${name} must be a stable ID.`);
	}
	return value;
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function record(value: unknown, name: string): Data {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Data;
}

function records(value: unknown, name: string): Data[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
