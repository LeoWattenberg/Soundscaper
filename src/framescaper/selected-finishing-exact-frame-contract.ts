/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FileSizeWarningConfirmation } from '../common/editor/controller/shared/file-size-warning.ts';
import type { UnifiedExactRenderPlanV13 } from '../common/editor/unified-exact-render-plan.ts';
import type { UnifiedExactRenderPlanV16 } from '../common/editor/unified-exact-render-plan-v16.ts';
import type { UnifiedExactRenderTimingSidecars } from '../common/editor/unified-exact-render-timing-authority.ts';
import type { UnifiedExactRenderRgbaFrameV13 } from '../common/editor/unified-exact-render-finishing-consumers-v13.ts';
import type { FramescaperProjectFinishing } from './editor-project-finishing.ts';
import type { FramescaperVideoExportVisualAssetStoreFinishing } from './video-export-visual-assets-finishing.ts';
import type { FramescaperVideoExportFinishingAssetStoreFinishing } from './video-export-finishing-finishing.ts';
import type { FramescaperSelectedOpenFxExecutionNativeMedia } from './selected-native-media-openfx-exact-planes.ts';
import type { FramescaperOpenFxFrameDispositionNativeMedia } from './editor-openfx-frame-graph-native-media.ts';
import type { FramescaperVideoFrameAddressFinishing } from './video-frame-address-finishing.ts';
type Data = Readonly<Record<string, unknown>>;
export interface FramescaperSelectedExactFrameExecutionFinishing {
	render(request: Readonly<{
		readonly sequencePosition: Readonly<{ readonly num: number; readonly den: number }>;
		readonly timelineSample?: number;
		readonly outputOrdinal?: number;
		readonly layers: readonly unknown[];
		readonly supplementalPictures?: readonly FramescaperSelectedExactSupplementalPictureFinishing[];
		readonly width: number;
		readonly height: number;
		readonly target: Uint8Array<ArrayBuffer>;
		readonly signal: AbortSignal;
	}>): Promise<Readonly<{
		readonly consumedNodeIds: readonly string[];
		readonly openFxDispositions: readonly FramescaperOpenFxFrameDispositionNativeMedia[];
		readonly reportsOpenFxDegradation: boolean;
	}>>;
	acceleratorDisposition(): Readonly<{
		readonly attempted: boolean;
		readonly active: boolean;
		readonly fallbackReasons: readonly string[];
	}>;
	dispose(): Promise<void>;
}

/** A plan-authenticated straight-linear picture supplied by a newer product generation. */
export interface FramescaperSelectedExactSupplementalPictureFinishing {
	readonly trackId: string;
	readonly clipId: string;
	readonly sourceId: string;
	readonly frame: UnifiedExactRenderRgbaFrameV13;
	readonly displayWidth: number;
	readonly displayHeight: number;
	readonly renderDescription: unknown;
	readonly opacity: number;
}
export type CaptureFrameFinishing = (entry: Data, signal: AbortSignal) => (
	PromiseLike<UnifiedExactRenderRgbaFrameV13> | UnifiedExactRenderRgbaFrameV13
);
export type ApplyEffectsFinishing = (frame: UnifiedExactRenderRgbaFrameV13, effects: readonly unknown[],
	signal: AbortSignal) => PromiseLike<UnifiedExactRenderRgbaFrameV13>;
export type SelectedExactFrameExecutionOptions<Plan extends UnifiedExactRenderPlanV13 | UnifiedExactRenderPlanV16> = Readonly<{
	readonly project: FramescaperProjectFinishing;
	readonly plan: Plan;
	readonly timingSidecars: UnifiedExactRenderTimingSidecars;
	readonly store?: FramescaperVideoExportVisualAssetStoreFinishing & FramescaperVideoExportFinishingAssetStoreFinishing;
	readonly sourceFrames?: FramescaperVideoFrameAddressFinishing;
	readonly captureFrame?: CaptureFrameFinishing;
	readonly applyEffects?: ApplyEffectsFinishing;
	readonly openFx?: FramescaperSelectedOpenFxExecutionNativeMedia;
	readonly createAcceleratorCanvas?: () => unknown;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void; readonly confirmFileSizeWarning?: FileSizeWarningConfirmation;
}>;
