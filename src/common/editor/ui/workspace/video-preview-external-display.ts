/* SPDX-License-Identifier: AGPL-3.0-only */

/** Publish the already-evaluated preview framebuffer to the session-only display sink. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { NATIVE_EXTERNAL_DISPLAY_MAXIMUM_RGBA_BYTES } from '../../native-external-display.ts';
import { canonicalizeNativeMediaSummaryValue } from '../../native-media-plan-canonical-form.ts';
import {
	framescaperNativeServicesStoreFor,
	resolveFramescaperNativeServicesBridge,
	type FramescaperNativeServicesBridge,
} from '../framescaper-native-services-bridge.ts';

interface EvaluatedPreviewFrame {
	readonly width: number;
	readonly height: number;
	readonly rgba: Uint8Array;
}

interface EvaluatedPreviewCompositor {
	captureEvaluatedRgba(): EvaluatedPreviewFrame | null;
}

interface ExternalDisplayProjectIdentity {
	readonly id: string;
	readonly revision: number;
}

interface PublisherState {
	sequence: number;
	inFlight: boolean;
}

export interface VideoPreviewExternalDisplayPublishRequest {
	readonly compositor: EvaluatedPreviewCompositor;
	readonly project: ExternalDisplayProjectIdentity | null | undefined;
	readonly timelineFrame: number;
}

export interface VideoPreviewExternalDisplayPublisherDependencies {
	readonly resolveBridge?: () => FramescaperNativeServicesBridge | null;
}

const STATES = new WeakMap<FramescaperNativeServicesBridge, PublisherState>();

/**
 * Start one publication when a clean-display session is active. A frame that
 * arrives while the previous one is awaiting its sink acknowledgement is
 * dropped; the preview render loop must never queue an output-sized schedule.
 */
export function publishEvaluatedVideoPreviewFrame(
	request: VideoPreviewExternalDisplayPublishRequest,
	dependencies: VideoPreviewExternalDisplayPublisherDependencies = {},
): boolean {
	const bridge = (dependencies.resolveBridge ?? resolveFramescaperNativeServicesBridge)();
	if (bridge === null || typeof bridge.presentExternalDisplay !== 'function') return false;
	const store = framescaperNativeServicesStoreFor(bridge);
	if (store.getSnapshot()?.activeExternalDisplayId === null
		|| store.getSnapshot() === null) return false;
	const project = projectIdentity(request.project);
	const timelineFrame = frame(request.timelineFrame);
	const state = stateFor(bridge);
	if (state.inFlight) return false;
	const evaluated = capturedFrame(request.compositor.captureEvaluatedRgba());
	if (evaluated === null) return false;
	const sequence = state.sequence;
	state.sequence += 1;
	state.inFlight = true;
	const rgbaSha256 = bytesToHex(sha256(evaluated.rgba));
	const evaluationFingerprint = bytesToHex(sha256(new TextEncoder().encode(
		canonicalizeNativeMediaSummaryValue({
			schemaVersion: 1,
			kind: 'framescaper-evaluated-video-preview-frame',
			projectId: project.id,
			projectRevision: project.revision,
			timelineFrame,
			width: evaluated.width,
			height: evaluated.height,
			rgbaSha256,
		}),
	)));
	void bridge.presentExternalDisplay(Object.freeze({
		sequence,
		evaluationFingerprint,
		width: evaluated.width,
		height: evaluated.height,
		dynamicRange: 'sdr',
		rgbaSha256,
		rgba: evaluated.rgba,
	})).catch(() => {
		void store.refresh().catch(() => null);
	}).finally(() => { state.inFlight = false; });
	return true;
}

function stateFor(bridge: FramescaperNativeServicesBridge): PublisherState {
	let state = STATES.get(bridge);
	if (!state) {
		state = { sequence: 0, inFlight: false };
		STATES.set(bridge, state);
	}
	return state;
}

function capturedFrame(value: unknown): EvaluatedPreviewFrame | null {
	if (value === null) return null;
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Reflect.ownKeys(value).length !== 3) {
		throw new TypeError('An evaluated preview frame must be an exact record.');
	}
	const frameValue = value as Partial<EvaluatedPreviewFrame>;
	const width = dimension(frameValue.width, 'width');
	const height = dimension(frameValue.height, 'height');
	const byteLength = width * height * 4;
	if (!Number.isSafeInteger(byteLength)
		|| byteLength > NATIVE_EXTERNAL_DISPLAY_MAXIMUM_RGBA_BYTES
		|| !(frameValue.rgba instanceof Uint8Array) || frameValue.rgba.byteLength !== byteLength) {
		throw new RangeError('The evaluated preview frame exceeds its exact RGBA geometry.');
	}
	return Object.freeze({ width, height, rgba: Uint8Array.from(frameValue.rgba) });
}

function projectIdentity(value: unknown): ExternalDisplayProjectIdentity {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('External display publication requires an active project.');
	}
	const project = value as Partial<ExternalDisplayProjectIdentity>;
	if (typeof project.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(project.id)
		|| !Number.isSafeInteger(project.revision) || Number(project.revision) < 0) {
		throw new TypeError('External display publication requires an exact project identity.');
	}
	return Object.freeze({ id: project.id, revision: Number(project.revision) });
}

function frame(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError('External display publication requires an exact timeline frame.');
	}
	return value;
}

function dimension(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 32_768) {
		throw new RangeError(`The evaluated preview ${name} is invalid.`);
	}
	return value;
}
