/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAsset } from '../common/editor/motion-asset.ts';
import type { MotionAssetBody } from '../common/editor/motion-asset-body.ts';
import type { MotionCompositionOffer } from '../common/editor/motion-link-protocol.ts';
import type { MotionCompositionLinkRasterLease } from '../common/editor/motion-link-rendering.ts';
import type { MotionCompositionLinkAudioLease } from '../common/editor/motion-link-audio-rendering.ts';
import { createMotionMediaProvider } from '../common/editor/motion-media-provider.ts';
import { createMotionExpressionAudioPreparation, motionProjectUsesAudioAmplitude } from '../common/editor/motion-expression-audio-preparation.ts';
import { loadMotionscaperAssetBytes } from '../common/editor/motion-render-resources.ts';

export type FramescaperCompositionAssetReader = (asset: MotionAsset, signal?: AbortSignal) => Promise<MotionAssetBody | null>;
/** These providers can read only the saved composition's receiver-owned, digest-addressed originals. */
export function createFramescaperCompositionResources(readAsset: FramescaperCompositionAssetReader) {
	if (typeof readAsset !== 'function') throw new TypeError('Retained composition bytes are required.');
	function createAudio(offer: MotionCompositionOffer) {
		const permitted = new Map(offer.revision.project.assets.map(asset => [asset.id, asset]));
		const loadAsset = (asset: MotionAsset, signal?: AbortSignal) => {
			if (JSON.stringify(permitted.get(asset.id)) !== JSON.stringify(asset)) return Promise.reject(new Error('Composition media is outside its pinned closure.'));
			return loadMotionscaperAssetBytes(asset, { readAsset: value => readAsset(value, signal) }, signal);
		};
		const provider = createMotionMediaProvider({ loadAsset });
		const expressionAudio = motionProjectUsesAudioAmplitude(offer.revision.project) ? createMotionExpressionAudioPreparation({ project: offer.revision.project, provider }) : undefined;
		return { provider, expressionAudio, loadAsset, async release() { expressionAudio?.dispose(); provider.dispose(); } };
	}
	return Object.freeze({
		async acquireAudio(offer: MotionCompositionOffer, signal?: AbortSignal): Promise<MotionCompositionLinkAudioLease> { signal?.throwIfAborted(); return createAudio(offer); },
		async acquireRaster(offer: MotionCompositionOffer, signal?: AbortSignal): Promise<MotionCompositionLinkRasterLease> {
			signal?.throwIfAborted(); const resources = createAudio(offer);
			try {
				const { createMotionBrowserRasterizer } = await import('../common/editor/controller/composition/motion-raster-runtime.ts');
				const rasterizer = await createMotionBrowserRasterizer({ assets: offer.revision.project.assets, loadAsset: resources.loadAsset, decodeFootage: resources.provider.decodeFootage }, signal);
				return { rasterizer, expressionAudio: resources.expressionAudio, release: resources.release };
			} catch (error) { await resources.release(); throw error; }
		},
	});
}
