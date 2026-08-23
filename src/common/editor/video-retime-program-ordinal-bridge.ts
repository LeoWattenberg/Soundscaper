/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createRegisteredVideoRetimeWebCorePreviewResolver,
	type VideoRetimeWebCorePreviewResolver,
} from './video-retime-web-core-preview.ts';
import { videoTimingRegistryToken } from './video-source-time.ts';

type DataRecord = Readonly<Record<string, unknown>>;

export interface VideoRetimeProgramOrdinalBridge {
	readonly ownerProject: DataRecord;
}

export interface VideoRetimeProgramOrdinalRequest {
	readonly project: DataRecord;
	readonly clip: DataRecord;
	readonly source: DataRecord;
	readonly timelineSample: number;
}

interface BridgeState {
	readonly ownerProject: DataRecord;
	readonly authorityProject: DataRecord;
	registryToken: Readonly<object> | null;
	preview: VideoRetimeWebCorePreviewResolver | null;
	failure: unknown;
}

const BRIDGES = new WeakMap<object, BridgeState>();

/**
 * Bind one selected-route document to the product's maintained playback
 * projection. Exact timing is refreshed when the verified registry changes.
 */
export function createVideoRetimeProgramOrdinalBridge(
	ownerProjectValue: unknown,
	authorityProjectValue: unknown,
): VideoRetimeProgramOrdinalBridge {
	const ownerProject = record(ownerProjectValue, 'video retime program-ordinal owner project');
	const authorityProject = record(authorityProjectValue, 'video retime program-ordinal authority project');
	const bridge = Object.freeze({ ownerProject });
	BRIDGES.set(bridge, {
		ownerProject,
		authorityProject,
		registryToken: null,
		preview: null,
		failure: null,
	});
	return bridge;
}

export class VideoRetimeProgramOrdinalUnavailableError extends Error {
	readonly code = 'VIDEO_RETIME_PROGRAM_ORDINAL_UNAVAILABLE' as const;

	constructor(cause?: unknown) {
		super(
			'The exact video retime program ordinal is unavailable.',
			cause === undefined || cause === null ? {} : { cause },
		);
		this.name = 'VideoRetimeProgramOrdinalUnavailableError';
	}
}

/** Return null only for an unretimed occurrence; exact-state failures throw. */
export function resolveVideoRetimeProgramOrdinal(
	bridgeValue: VideoRetimeProgramOrdinalBridge,
	requestValue: VideoRetimeProgramOrdinalRequest,
): number | null {
	const state = bridgeState(bridgeValue);
	const request = record(requestValue, 'video retime program-ordinal request');
	const project = record(
		data(request, 'project', 'video retime program-ordinal request'),
		'video retime program-ordinal request project',
	);
	if (project !== state.ownerProject) {
		throw new TypeError('The video retime program-ordinal bridge belongs to another project state.');
	}
	const clip = record(data(request, 'clip', 'video retime program-ordinal request'), 'video retime program clip');
	if (!records(
		data(state.ownerProject, 'clips', 'video retime program-ordinal owner project'),
		'video retime program-ordinal owner project.clips',
	).includes(clip)) {
		throw new TypeError('The video retime program clip does not belong to the bridge project state.');
	}
	if (data(clip, 'kind', 'video retime program clip') !== 'video') return null;
	const retimeMap = optionalData(clip, 'retimeMap', 'video retime program clip');
	if (retimeMap === null) return null;
	const source = record(
		data(request, 'source', 'video retime program-ordinal request'),
		'video retime program source',
	);
	if (!records(
		data(state.ownerProject, 'sources', 'video retime program-ordinal owner project'),
		'video retime program-ordinal owner project.sources',
	).includes(source)) {
		throw new TypeError('The video retime program source does not belong to the bridge project state.');
	}
	const timelineSample = data(request, 'timelineSample', 'video retime program-ordinal request');
	if (!Number.isSafeInteger(timelineSample) || Number(timelineSample) < 0) {
		throw new RangeError('Video retime program timelineSample must be a non-negative safe integer.');
	}
	refreshBridgeState(state);
	if (state.preview === null) throw new VideoRetimeProgramOrdinalUnavailableError(state.failure);
	let presentation;
	try {
		presentation = state.preview.resolveClipPresentation({
			clip,
			source,
			timelineSample: Number(timelineSample),
		});
	} catch (error: unknown) {
		throw new VideoRetimeProgramOrdinalUnavailableError(error);
	}
	if (presentation === null) throw new VideoRetimeProgramOrdinalUnavailableError();
	const ordinal = presentation.drawableSourceFrame;
	if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
		throw new VideoRetimeProgramOrdinalUnavailableError();
	}
	return ordinal;
}

function bridgeState(value: unknown): BridgeState {
	if (!value || typeof value !== 'object' || !BRIDGES.has(value)) {
		throw new TypeError('An authentic video retime program-ordinal bridge is required.');
	}
	return BRIDGES.get(value)!;
}

function refreshBridgeState(state: BridgeState): void {
	const token = videoTimingRegistryToken();
	if (state.registryToken === token) return;
	state.registryToken = token;
	state.preview = null;
	state.failure = null;
	try {
		state.preview = createRegisteredVideoRetimeWebCorePreviewResolver(state.authorityProject);
	} catch (error: unknown) {
		state.failure = error;
	}
}

function record(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a record.`);
	return value as DataRecord;
}

function records(value: unknown, name: string): readonly DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((entry, index) => record(entry, `${name}[${String(index)}]`));
}

function data(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function optionalData(value: object, key: string, name: string): unknown {
	if (!Object.hasOwn(value, key)) return null;
	return data(value, key, name);
}
