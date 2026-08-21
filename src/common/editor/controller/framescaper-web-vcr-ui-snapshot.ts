/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	WebVcrCapability,
	WebVcrDimensions,
	WebVcrLifecyclePhase,
	WebVcrResolution,
	WebVcrSnapshot,
} from '../web-vcr-domain.ts';
import type { FramescaperWebVcrUiSnapshot } from './framescaper-web-vcr-controller-types.ts';

const FULL_CROP = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });
const EMPTY_NAVIGATION = Object.freeze({
	url: 'about:blank', canGoBack: false, canGoForward: false, loading: false, generation: 0,
});

export interface FramescaperWebVcrUiSnapshotOptions {
	readonly capability: Readonly<WebVcrCapability>;
	readonly phase: WebVcrLifecyclePhase;
	readonly modeActive: boolean;
	readonly host: Readonly<WebVcrSnapshot> | null;
	readonly dimensions: Readonly<{
		readonly inputSize: Readonly<WebVcrDimensions>;
		readonly outputSize: Readonly<WebVcrDimensions>;
	}> | null;
	readonly previewStream?: unknown;
	readonly failure: string | null;
}

export function createFramescaperWebVcrUiSnapshot(
	options: Readonly<FramescaperWebVcrUiSnapshotOptions>,
): Readonly<FramescaperWebVcrUiSnapshot> {
	const { capability, host, dimensions } = options;
	const selected = host?.target;
	const availableResolutions = capability.status === 'available'
		? Object.freeze(capability.resolutions.filter((value) => value !== '4k'))
		: Object.freeze([] as WebVcrResolution[]);
	const output = dimensions?.outputSize ?? host?.outputSize ?? null;
	const intrinsic = dimensions?.inputSize ?? selected?.intrinsicSize ?? null;
	return Object.freeze({
		capability: capability.status === 'unavailable'
			? Object.freeze({ status: 'unavailable' as const, reason: capability.reason })
			: capability.status === 'available'
				? Object.freeze({ status: 'available' as const, reason: null })
				: Object.freeze({ status: 'checking' as const, reason: null }),
		phase: options.phase,
		modeActive: options.modeActive,
		navigation: host ? Object.freeze({
			url: host.navigation.url,
			canGoBack: host.navigation.canGoBack,
			canGoForward: host.navigation.canGoForward,
			loading: host.navigation.isLoading,
			generation: host.navigation.generation,
		}) : EMPTY_NAVIGATION,
		resolution: host?.resolution ?? '1080p',
		availableResolutions,
		autoCrop: host?.autoCrop ?? true,
		aspect: host?.aspect ?? 'free',
		crop: host?.crop ?? FULL_CROP,
		monitorMuted: host?.monitorMuted ?? false,
		autoStop: host?.autoStop ?? false,
		surface: host?.captureSurface ?? null,
		output,
		intrinsic,
		target: selected ? Object.freeze({ id: selected.targetId, generation: selected.generation }) : null,
		lowerResolutionWarning: Boolean(intrinsic && host?.captureSurface
			&& (intrinsic.width < host.captureSurface.width || intrinsic.height < host.captureSurface.height)),
		...(options.previewStream === undefined ? {} : { previewStream: options.previewStream }),
		error: options.failure,
	});
}
