/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from '../closed-domain-value.ts';
import { normalizeStripRef } from '../parameter-address.ts';
import type { StripRef } from '../parameter-address.ts';

export interface StripAnalysisCandidate {
	readonly strip: StripRef;
	readonly visible: boolean;
	readonly armed: boolean;
	readonly costFrames: number;
}

export type ScheduledStripAnalysis = StripAnalysisCandidate;

export interface DeferredStripAnalysis extends StripAnalysisCandidate {
	readonly reason: 'strip-budget' | 'over-budget';
}

export interface StripAnalysisPlan {
	readonly scheduled: readonly ScheduledStripAnalysis[];
	readonly deferred: readonly DeferredStripAnalysis[];
	readonly usedFrames: number;
	readonly maximumFrames: number;
	readonly maximumStrips: number;
	readonly eligibleCount: number;
}

export interface StripAnalysisScheduler {
	plan(candidates: unknown): StripAnalysisPlan;
	reset(): void;
}

const MAXIMUM_CANDIDATES = 4_096;
const MAXIMUM_STRIPS_PER_TICK = 128;
const MAXIMUM_FRAMES_PER_TICK = 16 * 1_024 * 1_024;
const CANDIDATE_FIELDS = ['strip', 'visible', 'armed', 'costFrames'] as const;

/**
 * One round-robin planner replaces per-strip polling loops. Hidden idle strips
 * never enter the eligible set; visible or explicitly armed strips share both
 * strip-count and frame-work budgets.
 */
export function createStripAnalysisScheduler(optionsValue: unknown): StripAnalysisScheduler {
	const options = readClosedDomainRecord(
		optionsValue,
		'strip analysis scheduler options',
		['maximumStripsPerTick', 'maximumFramesPerTick'],
	);
	const maximumStrips = boundedInteger(
		readClosedDomainField(options, 'maximumStripsPerTick', 'strip analysis scheduler options'),
		'maximum strips per analysis tick',
		1,
		MAXIMUM_STRIPS_PER_TICK,
	);
	const maximumFrames = boundedInteger(
		readClosedDomainField(options, 'maximumFramesPerTick', 'strip analysis scheduler options'),
		'maximum frames per analysis tick',
		1,
		MAXIMUM_FRAMES_PER_TICK,
	);
	let cursor = 0;

	return Object.freeze({
		plan(candidatesValue: unknown): StripAnalysisPlan {
			const candidates = normalizeCandidates(candidatesValue, maximumFrames);
			if (candidates.length === 0) return emptyPlan(maximumStrips, maximumFrames);
			const start = cursor % candidates.length;
			const scheduled: ScheduledStripAnalysis[] = [];
			const deferred: DeferredStripAnalysis[] = [];
			let usedFrames = 0;
			let eligibleCount = 0;
			let lastScheduledIndex: number | null = null;
			for (let offset = 0; offset < candidates.length; offset += 1) {
				const index = (start + offset) % candidates.length;
				const candidate = candidates[index]!;
				if (!candidate.visible && !candidate.armed) continue;
				eligibleCount += 1;
				if (scheduled.length >= maximumStrips) {
					deferred.push(Object.freeze({ ...candidate, reason: 'strip-budget' }));
					continue;
				}
				if (candidate.costFrames > maximumFrames - usedFrames) {
					deferred.push(Object.freeze({ ...candidate, reason: 'over-budget' }));
					continue;
				}
				scheduled.push(candidate);
				usedFrames += candidate.costFrames;
				lastScheduledIndex = index;
			}
			if (lastScheduledIndex !== null) cursor = (lastScheduledIndex + 1) % candidates.length;
			return Object.freeze({
				scheduled: Object.freeze(scheduled),
				deferred: Object.freeze(deferred),
				usedFrames,
				maximumFrames,
				maximumStrips,
				eligibleCount,
			});
		},
		reset(): void {
			cursor = 0;
		},
	});
}

function normalizeCandidates(value: unknown, maximumFrames: number): readonly StripAnalysisCandidate[] {
	const values = readClosedDomainArray(value, 'strip analysis candidates', 0, MAXIMUM_CANDIDATES);
	const keys = new Set<string>();
	return Object.freeze(values.map((candidateValue, index) => {
		const name = `strip analysis candidates[${String(index)}]`;
		const record = readClosedDomainRecord(candidateValue, name, CANDIDATE_FIELDS);
		const strip = normalizeStripRef(readClosedDomainField(record, 'strip', name));
		const key = stripKey(strip);
		if (keys.has(key)) throw new RangeError('Strip analysis candidates must have unique strip identities.');
		keys.add(key);
		const visible = readClosedDomainField(record, 'visible', name);
		const armed = readClosedDomainField(record, 'armed', name);
		if (typeof visible !== 'boolean' || typeof armed !== 'boolean') {
			throw new TypeError(`${name} visibility and armed state must be boolean.`);
		}
		const costFrames = boundedInteger(
			readClosedDomainField(record, 'costFrames', name),
			`${name}.costFrames`,
			1,
			maximumFrames,
		);
		return Object.freeze({ strip, visible, armed, costFrames });
	}));
}

function emptyPlan(maximumStrips: number, maximumFrames: number): StripAnalysisPlan {
	return Object.freeze({
		scheduled: Object.freeze([]),
		deferred: Object.freeze([]),
		usedFrames: 0,
		maximumFrames,
		maximumStrips,
		eligibleCount: 0,
	});
}

function stripKey(strip: StripRef): string {
	return strip.kind === 'master' ? '["master"]' : JSON.stringify([strip.kind, strip.id]);
}

function boundedInteger(value: unknown, name: string, minimum: number, maximum: number): number {
	if (!Number.isSafeInteger(value) || Object.is(value, -0) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`${name} must be an integer from ${String(minimum)} through ${String(maximum)}.`);
	}
	return Number(value);
}
