/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	OfflineRenderOutputMemoryLimitError,
	planOfflineRenderOutputAdmission,
	type OfflineRenderOutputAdmissionPlan,
	type OfflineRenderOutputGeometry,
} from './engine/offline-render-admission.ts';
import { projectGraphLatencyFrames } from './engine/project-graph.ts';
import { getProjectDurationFrames } from './engine/buffer-math.ts';
import type { EngineProject } from './engine/types.ts';

const MAXIMUM_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
const EXPORT_MAXIMUM_PRE_ROLL_SECONDS = 10;

export type ExportOfflineRenderStrategy = 'offline' | 'realtime-stream';
export type ExportOfflineRenderRefusalReason = 'offline-render-output-memory';

export interface ExportOfflineRenderStrategyAdmissionInput {
	readonly project: EngineProject;
	readonly rangeStartFrame: number;
	readonly requestedRenderFrames: number;
	/** Override the render width for a transient authored output snapshot. */
	readonly channelCount?: number;
	/** Select one track for a stem render; null selects the complete mix. */
	readonly trackId?: unknown;
	/** Include the master rack when deriving graph latency. */
	readonly includeMaster?: boolean;
	/** Lower-only test seam inherited from the central output admission. */
	readonly maximumUsefulBinaryBytes?: number;
}

interface ExportOfflineRenderStrategyAdmissionBase {
	readonly geometry: Readonly<OfflineRenderOutputGeometry>;
	readonly preRollFrames: number;
	readonly graphLatencyFrames: number;
	readonly peakUsefulBinaryBytes: number;
	readonly maximumUsefulBinaryBytes: number;
}

export interface AdmittedExportOfflineRenderStrategy
	extends ExportOfflineRenderStrategyAdmissionBase {
	readonly admitted: true;
	readonly strategy: 'offline';
	readonly reason: null;
	readonly outputAdmission: Readonly<OfflineRenderOutputAdmissionPlan>;
}

export interface RefusedExportOfflineRenderStrategy
	extends ExportOfflineRenderStrategyAdmissionBase {
	readonly admitted: false;
	readonly strategy: 'realtime-stream';
	readonly reason: ExportOfflineRenderRefusalReason;
	readonly outputAdmission: null;
}

export type ExportOfflineRenderStrategyAdmission =
	| AdmittedExportOfflineRenderStrategy
	| RefusedExportOfflineRenderStrategy;

/**
 * Aligns export's optimistic strategy choice with the exact central
 * OfflineAudioContext output admission. Requested frames are the project-rate
 * frames passed to renderMix, before any encode-rate resampling. The modeled
 * crop offset is export's ten-second pre-roll plus maintained graph latency.
 */
export function planExportOfflineRenderStrategyAdmission(
	input: ExportOfflineRenderStrategyAdmissionInput,
): Readonly<ExportOfflineRenderStrategyAdmission> {
	const candidate = input as Partial<ExportOfflineRenderStrategyAdmissionInput> | null;
	const project = requireProject(candidate?.project);
	const sampleRate = safeIntegerRange(
		project.sampleRate,
		1,
		Number.MAX_SAFE_INTEGER,
		'Export offline render sample rate',
	);
	const channelCount = safeIntegerRange(
		candidate?.channelCount === undefined
			? project.masterChannels
			: candidate.channelCount,
		1,
		32,
		'Export offline render channel count',
	);
	const rangeStartFrame = safeIntegerRange(
		candidate?.rangeStartFrame,
		0,
		Number.MAX_SAFE_INTEGER,
		'Export offline render range start frame',
	);
	const requestedFrames = safeIntegerRange(
		candidate?.requestedRenderFrames,
		1,
		Number.MAX_SAFE_INTEGER,
		'Export offline render requested frames',
	);
	const includeMaster = optionalBoolean(
		candidate?.includeMaster,
		true,
		'Export offline render include-master flag',
	);
	const maximumPreRollValue = BigInt(sampleRate)
		* BigInt(EXPORT_MAXIMUM_PRE_ROLL_SECONDS);
	const renderDurationFrames = safeIntegerRange(
		getProjectDurationFrames(project),
		0,
		Number.MAX_SAFE_INTEGER,
		'Export offline render project duration frames',
	);
	const preRollFrames = safeFrameNumber(
		minimumBigInt(
			minimumBigInt(BigInt(rangeStartFrame), BigInt(renderDurationFrames)),
			maximumPreRollValue,
		),
		'Export offline render pre-roll frames',
	);
	const graphLatencyFrames = safeIntegerRange(
		projectGraphLatencyFrames(project, {
			trackId: candidate?.trackId ?? null,
			includeMaster,
			sampleRate,
		}),
		0,
		Number.MAX_SAFE_INTEGER,
		'Export offline render graph latency frames',
	);
	const captureOffsetFrames = safeFrameNumber(
		BigInt(preRollFrames) + BigInt(graphLatencyFrames),
		'Export offline render capture offset frames',
	);
	const contextFrames = safeFrameNumber(
		BigInt(captureOffsetFrames) + BigInt(requestedFrames),
		'Export offline render context frames',
	);
	const geometry: Readonly<OfflineRenderOutputGeometry> = Object.freeze({
		channelCount,
		sampleRate,
		contextFrames,
		captureOffsetFrames,
		requestedFrames,
	});

	try {
		const outputAdmission = planOfflineRenderOutputAdmission(geometry, {
			maximumUsefulBinaryBytes: candidate?.maximumUsefulBinaryBytes,
		});
		return Object.freeze({
			admitted: true,
			strategy: 'offline',
			reason: null,
			geometry,
			preRollFrames,
			graphLatencyFrames,
			peakUsefulBinaryBytes: outputAdmission.peakUsefulBinaryWorkingSet.bytes,
			maximumUsefulBinaryBytes: outputAdmission.maximumUsefulBinaryBytes,
			outputAdmission,
		});
	} catch (error) {
		if (!(error instanceof OfflineRenderOutputMemoryLimitError)) throw error;
		return Object.freeze({
			admitted: false,
			strategy: 'realtime-stream',
			reason: 'offline-render-output-memory',
			geometry,
			preRollFrames,
			graphLatencyFrames,
			peakUsefulBinaryBytes: error.peakUsefulBinaryBytes,
			maximumUsefulBinaryBytes: error.maximumUsefulBinaryBytes,
			outputAdmission: null,
		});
	}
}

function requireProject(value: unknown): EngineProject {
	if (!value || typeof value !== 'object') {
		throw new TypeError('Export offline render project is required.');
	}
	return value as EngineProject;
}

function safeIntegerRange(
	value: unknown,
	minimum: number,
	maximum: number,
	field: string,
): number {
	if (typeof value !== 'number'
		|| !Number.isSafeInteger(value)
		|| value < minimum
		|| value > maximum) {
		throw new RangeError(`${field} must be a safe integer between ${minimum} and ${maximum}.`);
	}
	return value;
}

function safeFrameNumber(value: bigint, field: string): number {
	if (value < 0n || value > MAXIMUM_SAFE_INTEGER) {
		throw new RangeError(`${field} exceeds the supported safe integer range.`);
	}
	return Number(value);
}

function optionalBoolean(value: unknown, fallback: boolean, field: string): boolean {
	if (value === undefined) return fallback;
	if (typeof value !== 'boolean') throw new TypeError(`${field} must be boolean.`);
	return value;
}

function minimumBigInt(left: bigint, right: bigint): bigint {
	return left < right ? left : right;
}
