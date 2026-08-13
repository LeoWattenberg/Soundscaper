/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	videoBoundaryTime,
	videoSourceTimingView,
	sourceTimeToVideoBoundary,
	type ExactSourceTime,
} from '../common/editor/video-source-timing-view.ts';
import { resolveVideoSourceTimingViews } from '../common/editor/video-source-timing-views.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV18,
} from './editor-project-feature-requirements-v18.ts';
import {
	validateFramescaperMulticameraGroupsV18,
	type FramescaperMulticameraGroupV18,
	type FramescaperMulticameraMemberV18,
} from './editor-project-v18-multicam.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import {
	validateFramescaperProjectV18,
	type FramescaperProjectV18,
} from './editor-project-v18-validation.ts';

type DataRecord = Record<string, unknown>;

interface SequenceRate {
	readonly num: number;
	readonly den: number;
}

/**
 * Resolve persisted multicamera outputs into a detached exact-V18 transient.
 * The persisted output clip owns placement and group-local source time; only
 * an exact active-source boundary mapping may replace its canonical source.
 */
export function materializeFramescaperMulticameraPlaybackProjectV18(
	profile: EditorProjectRuntimeProfile | unknown,
	projectValue: FramescaperProjectV18 | unknown,
): FramescaperProjectV18 {
	assertFramescaperProjectV18Profile(profile);
	validateFramescaperProjectV18(profile, projectValue);
	const canonical = projectValue as FramescaperProjectV18;
	const groups = validateFramescaperMulticameraGroupsV18(
		profile,
		canonical,
		canonical.multicameraGroups,
	);
	const sourceById = uniqueById(canonical.sources, 'multicamera source');
	const sequenceById = uniqueById(canonical.sequences, 'multicamera sequence');
	const timingViews = resolveVideoSourceTimingViews(canonical);
	const draft = structuredClone(canonical) as unknown as DataRecord;
	const clips = recordArray(draft.clips, 'multicamera project.clips');
	const clipIndex = new Map(clips.map((clip, index) => [nonEmptyString(clip.id, 'multicamera clip.id'), index]));
	for (const group of groups) {
		const index = clipIndex.get(group.outputClipId);
		if (index === undefined) throw new ReferenceError(`Multicamera output clip ${group.outputClipId} is missing.`);
		const clip = clips[index]!;
		const member = activeMember(group);
		const source = sourceById.get(member.sourceId);
		if (!source || source.kind !== 'video') {
			throw new ReferenceError(`Multicamera member ${member.id} lost its canonical video source.`);
		}
		const sequence = sequenceById.get(group.sequenceId);
		if (!sequence) throw new ReferenceError(`Multicamera group ${group.id} lost its sequence.`);
		const rate = sequenceRate(sequence, group.id);
		const sourceInFrame = nonNegativeSafeInteger(clip.sourceInFrame, `multicamera clip ${group.outputClipId}.sourceInFrame`);
		const sourceFrameCount = positiveSafeInteger(
			clip.sourceFrameCount,
			`multicamera clip ${group.outputClipId}.sourceFrameCount`,
		);
		const groupStart = sequenceFrameTime(sourceInFrame, rate);
		const groupEnd = sequenceFrameTime(
			safeAdd(sourceInFrame, sourceFrameCount, `multicamera group ${group.id} source range`),
			rate,
		);
		const offset = sampleOffsetTime(member.syncOffsetSamples, canonical.sampleRate);
		const activeStart = addExact(groupStart, offset);
		const activeEnd = addExact(groupEnd, offset);
		const timingView = videoSourceTimingView(timingViews, source);
		const activeSourceInFrame = exactBoundary(timingView, activeStart, group.id, member.id, 'start');
		const activeSourceEndFrame = exactBoundary(timingView, activeEnd, group.id, member.id, 'end');
		if (activeSourceEndFrame <= activeSourceInFrame) {
			throw new RangeError(`Multicamera group ${group.id} active source range must be positive.`);
		}
		clips[index] = {
			...clip,
			sourceId: member.sourceId,
			sourceInFrame: activeSourceInFrame,
			sourceFrameCount: activeSourceEndFrame - activeSourceInFrame,
		};
	}
	draft.clips = clips;
	draft.multicameraGroups = [];
	draft.sources = recordArray(draft.sources, 'multicamera project.sources').map((source) => {
		const result = { ...source };
		if (result.kind === 'video') result.proxyAttachment = null;
		else delete result.proxyAttachment;
		return result;
	});
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV18(profile, draft);
	validateFramescaperProjectV18(profile, draft);
	return deepFreeze(draft) as unknown as FramescaperProjectV18;
}

function activeMember(group: FramescaperMulticameraGroupV18): FramescaperMulticameraMemberV18 {
	const member = group.members.find((candidate) => candidate.id === group.activeMemberId);
	if (!member) throw new ReferenceError(`Multicamera group ${group.id} lost its active member.`);
	return member;
}

function exactBoundary(
	view: Parameters<typeof sourceTimeToVideoBoundary>[0],
	time: ExactSourceTime,
	groupId: string,
	memberId: string,
	edge: 'start' | 'end',
): number {
	const boundary = sourceTimeToVideoBoundary(view, time);
	if (!sameExact(videoBoundaryTime(view, boundary), time)) {
		throw new RangeError(
			`Multicamera group ${groupId} member ${memberId} ${edge} is not an exact active-source boundary.`,
		);
	}
	return boundary;
}

function sequenceFrameTime(frame: number, rate: SequenceRate): ExactSourceTime {
	return fraction(BigInt(frame) * BigInt(rate.den), BigInt(rate.num));
}

function sampleOffsetTime(offset: number, sampleRateValue: unknown): ExactSourceTime {
	if (!Number.isSafeInteger(offset)) throw new RangeError('A multicamera sync offset must be a signed safe integer.');
	return fraction(BigInt(offset), BigInt(positiveSafeInteger(sampleRateValue, 'multicamera project sample rate')));
}

function addExact(left: ExactSourceTime, right: ExactSourceTime): ExactSourceTime {
	return fraction(
		left.numerator * right.denominator + right.numerator * left.denominator,
		left.denominator * right.denominator,
	);
}

function sameExact(left: ExactSourceTime, right: ExactSourceTime): boolean {
	return left.numerator * right.denominator === right.numerator * left.denominator;
}

function fraction(numerator: bigint, denominator: bigint): ExactSourceTime {
	if (denominator <= 0n) throw new RangeError('An exact multicamera time denominator must be positive.');
	const divisor = gcd(numerator < 0n ? -numerator : numerator, denominator);
	return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function gcd(left: bigint, right: bigint): bigint {
	while (right !== 0n) [left, right] = [right, left % right];
	return left === 0n ? 1n : left;
}

function sequenceRate(value: Readonly<Record<string, unknown>>, groupId: string): SequenceRate {
	const rate = dataRecord(value.rate, `multicamera group ${groupId} sequence rate`);
	return {
		num: positiveSafeInteger(rate.num, `multicamera group ${groupId} sequence rate numerator`),
		den: positiveSafeInteger(rate.den, `multicamera group ${groupId} sequence rate denominator`),
	};
}

function uniqueById<Value extends Readonly<Record<string, unknown>>>(
	values: readonly Value[],
	name: string,
): ReadonlyMap<string, Value> {
	const result = new Map<string, Value>();
	for (const value of values) {
		const id = nonEmptyString(value.id, `${name}.id`);
		if (result.has(id)) throw new RangeError(`Duplicate ${name} ID: ${id}.`);
		result.set(id, value);
	}
	return result;
}

function recordArray(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((candidate, index) => dataRecord(candidate, `${name}[${String(index)}]`));
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as DataRecord;
}

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}

function safeAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result) || result < 0) throw new RangeError(`${name} exceeds the safe-integer range.`);
	return result;
}

function deepFreeze<Value>(value: Value, seen = new Set<object>()): Value {
	if (!value || typeof value !== 'object' || seen.has(value)) return value;
	seen.add(value);
	for (const child of Object.values(value)) deepFreeze(child, seen);
	return Object.freeze(value);
}
