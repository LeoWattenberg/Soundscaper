/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict selected-video authority and atomic F31 publication for reviewed reframes. */

import {
	reviewAssistanceOwnedVideoHighlightTransformResultV1,
} from '../common/editor/assistance/owned-video-highlight-transform-results-v1.ts';
import type {
	AssistanceOwnedReframePathV1,
} from '../common/editor/assistance/owned-video-highlight-transform-types-v1.ts';
import {
	validateAssistanceWorkflowFenceV1,
	type AssistanceWorkflowFenceV1,
} from '../common/editor/assistance/workflow.ts';
import {
	AssistanceProposalStaleError,
	validateAssistanceSelectionFence,
} from '../common/editor/assistance/proposal-session.ts';
import { createSetVideoKeyframesCommand } from '../common/editor/commands/factories.ts';
import {
	mapLocalAssistanceSelectedVideoSourceBoundary,
	readLocalAssistanceSelectedVideoSourceFrameTick,
	type LocalAssistanceSelectedVideoAuthority,
} from '../common/editor/controller/local-assistance-selected-video.ts';
import {
	normalizeVideoClipComposition,
} from '../common/editor/video-clip-composition.ts';
import {
	normalizeVideoKeyframeCurves,
	type VideoKeyframeCurves,
} from '../common/editor/video-keyframe-curves.ts';
import { mapVideoKeyframeVisiblePosition } from
	'../common/editor/video-keyframe-time-domain.ts';
import { compareRationals, type Rational } from '../common/editor/timeline-time.ts';
import {
	applyFramescaperProjectCommandV31,
	type FramescaperProjectCommandV31,
} from './editor-project-v31-commands.ts';
import { normalizeFramescaperProjectCommandV19 } from './editor-project-v19-commands.ts';
import {
	FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE,
} from './editor-project-runtime-profile-v31.ts';
import {
	validateFramescaperProjectV31,
	type FramescaperProjectV31,
} from './editor-project-v31.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;
type DataRecord = Readonly<Record<string, unknown>>;

export interface FramescaperAssistanceReframeAuthority {
	readonly selection: LocalAssistanceSelectedVideoAuthority;
	readonly fence: AssistanceWorkflowFenceV1;
}

export interface FramescaperAssistanceReframePublicationDependencies {
	readonly currentAuthority: () => FramescaperAssistanceReframeAuthority;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly commit: (command: FramescaperProjectCommandV31) => Awaitable<void>;
}

export interface FramescaperAssistanceReframeAcceptanceRequest {
	readonly fence: AssistanceWorkflowFenceV1;
	readonly result: AssistanceOwnedReframePathV1;
}

export interface FramescaperAssistanceReframePublication {
	acceptReviewed(value: unknown): Promise<void>;
}

interface NormalizedAuthority {
	readonly project: FramescaperProjectV31;
	readonly selection: LocalAssistanceSelectedVideoAuthority;
	readonly fence: AssistanceWorkflowFenceV1;
	readonly clip: DataRecord;
	readonly source: DataRecord;
	readonly result: AssistanceOwnedReframePathV1;
	readonly fingerprint: string;
}

interface MappedCrop {
	readonly position: Rational;
	readonly crop: AssistanceOwnedReframePathV1['path']['keyframes'][number]['crop'];
}

const REQUEST_FIELDS = Object.freeze(['fence', 'result'] as const);
const CROP_PARAMETERS = Object.freeze(['bottom', 'left', 'right', 'top'] as const);
const CROP_PARAMETER_IDS = new Set(CROP_PARAMETERS.map((name) => `crop.${name}`));

export function createFramescaperAssistanceReframePublication(
	dependencies: FramescaperAssistanceReframePublicationDependencies,
): Readonly<FramescaperAssistanceReframePublication> {
	assertDependencies(dependencies);
	return Object.freeze({ acceptReviewed });

	async function acceptReviewed(value: unknown): Promise<void> {
		const request = reviewRequest(value);
		const initial = normalizeAuthority(dependencies.currentAuthority(), request);
		const command = publicationCommand(initial);
		applyFramescaperProjectCommandV31(
			FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE,
			initial.project,
			command,
			{ now: String(initial.project.updatedAt) },
		);
		const token = dependencies.captureProject();
		assertAuthorityCurrent(dependencies, request, initial);
		dependencies.assertProject(token);
		assertAuthorityCurrent(dependencies, request, initial);
		await dependencies.commit(command);
	}
}

function reviewRequest(value: unknown): FramescaperAssistanceReframeAcceptanceRequest {
	const row = exactRecord(value, REQUEST_FIELDS, 'Reframe acceptance request');
	const fence = validateAssistanceWorkflowFenceV1(row.fence);
	const reviewed = reviewAssistanceOwnedVideoHighlightTransformResultV1({
		schemaVersion: 1,
		transformId: 'plan-crops',
		outputs: { 'reframe-path': row.result },
	});
	if (reviewed.transformId !== 'plan-crops') {
		throw new TypeError('Reframe acceptance lost its reviewed terminal identity.');
	}
	return Object.freeze({ fence, result: reviewed.outputs['reframe-path'] });
}

function normalizeAuthority(
	value: FramescaperAssistanceReframeAuthority,
	request: FramescaperAssistanceReframeAcceptanceRequest,
): NormalizedAuthority {
	if (!value || typeof value !== 'object' || !value.selection) {
		throw new TypeError('Reframe publication requires selected F31 video authority.');
	}
	const currentFence = validateAssistanceWorkflowFenceV1(value.fence);
	if (!same(currentFence, request.fence)) throw new AssistanceProposalStaleError();
	validateFramescaperProjectV31(
		FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE,
		value.selection.project,
	);
	const project = value.selection.project as unknown as FramescaperProjectV31;
	if (project.id !== request.fence.projectId || project.schemaVersion !== request.fence.schemaVersion
		|| project.revision !== request.fence.revision) throw new AssistanceProposalStaleError();
	const selectedFence = validateAssistanceSelectionFence(value.selection.fence);
	const ranges = request.fence.sourceRanges.filter(({ mediaKind }) => mediaKind === 'video');
	if (ranges.length !== 1 || request.fence.sourceRanges.length !== 1) {
		throw new TypeError('Reframe publication requires one exact video source range.');
	}
	const range = ranges[0]!;
	const expectedRetime = value.selection.timingAuthority.mapping === 'forward-retime-v2'
		? 'monotonic-forward' : 'identity';
	if (request.fence.sequenceId !== selectedFence.sequenceId
		|| range.sourceId !== selectedFence.sourceId
		|| range.sourceSha256 !== selectedFence.sourceSha256
		|| range.sourceStartFrame !== selectedFence.sourceStartFrame
		|| range.sourceEndFrame !== selectedFence.sourceEndFrame
		|| range.linkMembershipSha256 !== selectedFence.linkMembershipSha256
		|| range.timingAuthoritySha256 !== selectedFence.timingAuthoritySha256
		|| range.retimeKind !== expectedRetime
		|| !same(range.occurrenceIds, selectedFence.occurrenceIds)) {
		throw new AssistanceProposalStaleError();
	}
	const clip = value.selection.clip;
	const source = value.selection.source;
	if (!range.occurrenceIds.includes(identifier(clip.id, 'selected video clip ID'))
		|| source.id !== range.sourceId
		|| source.contentSha256 !== range.sourceSha256) throw new AssistanceProposalStaleError();
	assertPathAuthority(value.selection, source, request.result);
	return Object.freeze({ project, selection: value.selection, fence: currentFence,
		clip, source, result: request.result,
		fingerprint: JSON.stringify({ fence: currentFence, project }) });
}

function assertPathAuthority(
	selection: LocalAssistanceSelectedVideoAuthority,
	source: DataRecord,
	result: AssistanceOwnedReframePathV1,
): void {
	if (result.authority.width !== integer(source.width, 1, 'video source width')
		|| result.authority.height !== integer(source.height, 1, 'video source height')) {
		throw new RangeError('The reviewed Reframe geometry disagrees with its selected video source.');
	}
	for (const frame of result.authority.frames) {
		const current = readLocalAssistanceSelectedVideoSourceFrameTick(selection, frame.sourceFrame);
		if (current === null || current.timescale !== result.authority.timescale
			|| current.presentationTick !== frame.presentationTick) {
			throw new AssistanceProposalStaleError();
		}
	}
	const start = mapLocalAssistanceSelectedVideoSourceBoundary(
		selection, selection.sourceStartFrame,
	);
	const end = mapLocalAssistanceSelectedVideoSourceBoundary(
		selection, selection.sourceEndFrame,
	);
	const clipStart = integer(selection.clip.sequenceStartFrame, 0, 'video clip sequence start');
	const clipCount = integer(selection.clip.sequenceFrameCount, 1, 'video clip sequence count');
	if (start !== clipStart || end !== clipStart + clipCount) {
		throw new RangeError('Reframe selected-video boundary authority is no longer exact.');
	}
}

function publicationCommand(authority: NormalizedAuthority): FramescaperProjectCommandV31 {
	const clipId = identifier(authority.clip.id, 'selected video clip ID');
	const duration = integer(authority.clip.sequenceFrameCount, 1, 'video clip duration');
	const composition = normalizeVideoClipComposition(authority.clip.videoComposition,
		`video clip ${clipId} composition`);
	const context = Object.freeze({ duration: { num: duration, den: 1 }, composition,
		videoEffects: authority.clip.videoEffects });
	const current = normalizeVideoKeyframeCurves(authority.clip.videoKeyframes, context,
		`video clip ${clipId} keyframes`);
	const crops = mappedCrops(authority, current, duration);
	const nextComposition = normalizeVideoClipComposition({
		...composition,
		crop: crops[0]!.crop,
	}, 'Reframe composition');
	const retained = current.curves.filter(({ target }) => target.kind !== 'composition'
		|| !CROP_PARAMETER_IDS.has(target.parameterId));
	const curves = crops.length === 1 ? retained : [...retained, ...cropCurves(crops)];
	const next = normalizeVideoKeyframeCurves({
		schemaVersion: 1,
		timeDomain: current.timeDomain,
		curves,
	}, context, 'Reframe keyframes');
	const keyframes = createSetVideoKeyframesCommand(clipId, current, next);
	const compositionCommand = normalizeFramescaperProjectCommandV19({
		type: 'video-composition/set', clipId,
		expectedComposition: composition,
		composition: nextComposition,
	});
	return Object.freeze({
		type: 'batch',
		commands: Object.freeze([
			keyframes as FramescaperProjectCommandV31,
			compositionCommand as unknown as FramescaperProjectCommandV31,
		]),
	}) as FramescaperProjectCommandV31;
}

function mappedCrops(
	authority: NormalizedAuthority,
	current: VideoKeyframeCurves,
	duration: number,
): readonly MappedCrop[] {
	const clipStart = integer(authority.clip.sequenceStartFrame, 0, 'video clip sequence start');
	const result: MappedCrop[] = [];
	for (const keyframe of authority.result.path.keyframes) {
		const sequenceFrame = mapLocalAssistanceSelectedVideoSourceBoundary(
			authority.selection, keyframe.sourceFrame,
		);
		if (sequenceFrame === null) throw new AssistanceProposalStaleError();
		const local = sequenceFrame - clipStart;
		if (!Number.isSafeInteger(local) || local < 0 || local >= duration) {
			throw new RangeError('A reviewed Reframe keyframe escaped the selected occurrence.');
		}
		const position = mapVideoKeyframeVisiblePosition(
			current.timeDomain, { num: duration, den: 1 }, { num: local, den: 1 },
		);
		if (result.length > 0 && compareRationals(result.at(-1)!.position, position) >= 0) {
			throw new RangeError('Reframe timing cannot preserve distinct exact keyframe positions.');
		}
		assertCropAspect(authority, keyframe.crop);
		result.push(Object.freeze({ position, crop: keyframe.crop }));
	}
	if (result.length < 1) throw new RangeError('Reframe publication requires a non-empty crop path.');
	return Object.freeze(result);
}

function cropCurves(crops: readonly MappedCrop[]): readonly DataRecord[] {
	return Object.freeze(CROP_PARAMETERS.map((parameter) => Object.freeze({
		target: Object.freeze({ kind: 'composition', parameterId: `crop.${parameter}` }),
		curve: Object.freeze({
			anchors: Object.freeze(crops.map(({ position, crop }) => Object.freeze({
				position, value: crop[parameter],
			}))),
			segments: Object.freeze(Array.from(
				{ length: crops.length - 1 }, () => Object.freeze({ kind: 'linear' }),
			)),
		}),
	})));
}

function assertCropAspect(
	authority: NormalizedAuthority,
	crop: AssistanceOwnedReframePathV1['path']['keyframes'][number]['crop'],
): void {
	const visibleWidth = authority.result.authority.width * (1 - crop.left - crop.right);
	const visibleHeight = authority.result.authority.height * (1 - crop.top - crop.bottom);
	const expected = authority.result.path.targetAspect.width / authority.result.path.targetAspect.height;
	const actual = visibleWidth / visibleHeight;
	if (!Number.isFinite(actual) || Math.abs(actual - expected) > Math.max(1, expected) * 1e-8) {
		throw new RangeError('A reviewed Reframe crop does not preserve its target aspect.');
	}
}

function assertAuthorityCurrent(
	dependencies: FramescaperAssistanceReframePublicationDependencies,
	request: FramescaperAssistanceReframeAcceptanceRequest,
	expected: NormalizedAuthority,
): void {
	const current = normalizeAuthority(dependencies.currentAuthority(), request);
	if (current.fingerprint !== expected.fingerprint) throw new AssistanceProposalStaleError();
}

function assertDependencies(
	value: unknown,
): asserts value is FramescaperAssistanceReframePublicationDependencies {
	if (!value || typeof value !== 'object'
		|| typeof (value as FramescaperAssistanceReframePublicationDependencies).currentAuthority !== 'function'
		|| typeof (value as FramescaperAssistanceReframePublicationDependencies).captureProject !== 'function'
		|| typeof (value as FramescaperAssistanceReframePublicationDependencies).assertProject !== 'function'
		|| typeof (value as FramescaperAssistanceReframePublicationDependencies).commit !== 'function') {
		throw new TypeError('Reframe publication requires exact F31 command ports.');
	}
}

function exactRecord(
	value: unknown,
	fields: readonly string[],
	name: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The ${name} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`The ${name} fields are invalid.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function identifier(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
		throw new TypeError(`The ${name} is invalid.`);
	}
	return value;
}

function integer(value: unknown, minimum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`The ${name} is invalid.`);
	}
	return Number(value);
}

function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
