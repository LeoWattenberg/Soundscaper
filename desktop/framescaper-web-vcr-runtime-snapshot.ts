/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateWebVcrSnapshotV1,
	type WebVcrCapability,
	type WebVcrNormalizedCrop,
	type WebVcrPhase,
	type WebVcrResolution,
	type WebVcrSessionReferenceV1,
	type WebVcrSnapshot,
	type WebVcrTargetSummary,
} from './framescaper-web-vcr-contract.ts';
import { framescaperWebVcrCaptureSurface } from './framescaper-web-vcr-electron-window.ts';

export interface FramescaperWebVcrSnapshotStateV1 {
	readonly reference: Readonly<WebVcrSessionReferenceV1>;
	readonly resolution: WebVcrResolution;
	readonly captureState: WebVcrPhase;
	readonly visible: boolean;
	readonly aspect: WebVcrSnapshot['aspect'];
	readonly crop: Readonly<WebVcrNormalizedCrop>;
	readonly autoCrop: boolean;
	readonly monitorMuted: boolean;
	readonly autoStop: boolean;
	readonly targetEndedRecordingToken: string | null;
	readonly navigation: WebVcrSnapshot['navigation'];
	readonly target: Readonly<WebVcrTargetSummary> | null;
	readonly failure: string | null;
}

export function createFramescaperWebVcrSnapshotV1(
	state: Readonly<FramescaperWebVcrSnapshotStateV1>,
	capability: Readonly<WebVcrCapability>,
): Readonly<WebVcrSnapshot> {
	return validateWebVcrSnapshotV1({
		version: 1,
		sessionId: state.reference.sessionId,
		generation: state.reference.generation,
		phase: state.captureState,
		capability,
		resolution: state.resolution,
		aspect: state.aspect,
		crop: state.autoCrop && state.target ? state.target.aperture : state.crop,
		autoCrop: state.autoCrop,
		monitorMuted: state.monitorMuted,
		autoStop: state.autoStop,
		targetEndedRecordingToken: state.targetEndedRecordingToken,
		visible: state.visible,
		navigation: state.navigation,
		target: state.target,
		captureSurface: framescaperWebVcrCaptureSurface(state.resolution),
		outputSize: null,
		metrics: null,
		failure: state.failure,
	});
}

export function createClosedFramescaperWebVcrSnapshotV1(
	resolution: WebVcrResolution,
	generation: number,
	capability: Readonly<WebVcrCapability>,
): Readonly<WebVcrSnapshot> {
	return validateWebVcrSnapshotV1({
		version: 1,
		sessionId: null,
		generation,
		phase: 'closed',
		capability,
		resolution,
		aspect: 'free',
		crop: { x: 0, y: 0, width: 1, height: 1 },
		autoCrop: true,
		monitorMuted: false,
		autoStop: false,
		targetEndedRecordingToken: null,
		visible: false,
		navigation: {
			generation: 0, url: 'about:blank', canGoBack: false, canGoForward: false, isLoading: false,
		},
		target: null,
		captureSurface: framescaperWebVcrCaptureSurface(resolution),
		outputSize: null,
		metrics: null,
		failure: null,
	});
}
