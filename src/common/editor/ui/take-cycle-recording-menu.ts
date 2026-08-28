/* SPDX-License-Identifier: AGPL-3.0-only */

import { isTakeCompProjectSchema } from '../project-schema-version.ts';

type DataRecord = Readonly<Record<string, unknown>>;

export type TakeCycleStartBlockReason =
	| 'product'
	| 'recovery'
	| 'read-only'
	| 'busy'
	| 'loop'
	| 'sound-activation'
	| 'tracks'
	| 'routing';

export interface TakeCycleRecordingMenuInput {
	readonly snapshot: DataRecord;
	readonly copy: Readonly<Record<string, string>>;
	start(): unknown;
	openRecovery(): unknown;
}

export interface TakeCycleStartAdmission {
	readonly allowed: boolean;
	readonly reason: TakeCycleStartBlockReason | null;
}

/** Exact menu admission for the dedicated routed cycle-capture path. */
export function selectTakeCycleStartAdmission(snapshot: DataRecord): Readonly<TakeCycleStartAdmission> {
	if (snapshot.productId !== 'soundscaper' || dataRecord(snapshot.capabilities)?.takeComp !== true) {
		return blocked('product');
	}
	if (snapshot.takeCycleRecovery != null) return blocked('recovery');
	if (snapshot.readOnly === true) return blocked('read-only');
	if (snapshot.importing === true || snapshot.exporting === true
		|| snapshot.recording === true || snapshot.recordingStarting === true
		|| snapshot.recordingScheduling === true || snapshot.scheduledRecording != null
		|| snapshot.transportState === 'playing') return blocked('busy');
	const project = dataRecord(snapshot.project);
	const loop = dataRecord(project?.loop);
	if (!project || !isTakeCompProjectSchema(project) || loop?.enabled !== true
		|| !nonNegativeSafeInteger(loop.startFrame)
		|| !nonNegativeSafeInteger(loop.endFrame)
		|| Number(loop.endFrame) <= Number(loop.startFrame)) return blocked('loop');
	const inputs = dataRecord(snapshot.recordingInputs);
	const activation = dataRecord(dataRecord(inputs?.soundActivation)?.preferences);
	if (activation?.enabled === true) return blocked('sound-activation');
	const tracks = dataRecords(project.tracks);
	const armed = tracks.filter(({ type, armed }) => type === 'audio' && armed === true);
	if (!armed.length || armed.some(({ locked }) => locked === true)) return blocked('tracks');
	const routes = dataRecord(inputs?.routes);
	const sequences = dataRecords(project.sequences);
	const routed = routes && armed.every(({ id }) => typeof id === 'string'
		&& dataRecord(routes[id]) !== null
		&& sequences.filter(({ trackIds }) => Array.isArray(trackIds) && trackIds.includes(id)).length === 1);
	return routed ? Object.freeze({ allowed: true, reason: null }) : blocked('routing');
}

/** Soundscaper-only items injected into the existing Record split-button menu. */
export function createTakeCycleRecordingMenuItems(input: TakeCycleRecordingMenuInput) {
	const capability = dataRecord(input.snapshot.capabilities)?.takeComp === true;
	if (input.snapshot.productId !== 'soundscaper' || !capability) return Object.freeze([]);
	const admission = selectTakeCycleStartAdmission(input.snapshot);
	return Object.freeze([
		Object.freeze({
			id: 'record-loop-into-takes',
			label: input.copy.takeCycleRecordMenu,
			disabled: !admission.allowed,
			onClick: input.start,
		}),
		...(input.snapshot.takeCycleRecovery ? [Object.freeze({
			id: 'take-cycle-recovery',
			label: input.copy.takeCycleRecoveryMenu,
			disabled: false,
			onClick: input.openRecovery,
		})] : []),
	]);
}

function blocked(reason: TakeCycleStartBlockReason): Readonly<TakeCycleStartAdmission> {
	return Object.freeze({ allowed: false, reason });
}

function dataRecord(value: unknown): DataRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as DataRecord
		: null;
}

function dataRecords(value: unknown): readonly DataRecord[] {
	return Array.isArray(value) ? value.map(dataRecord).filter((item): item is DataRecord => item !== null) : [];
}

function nonNegativeSafeInteger(value: unknown): boolean {
	return Number.isSafeInteger(value) && Number(value) >= 0;
}
