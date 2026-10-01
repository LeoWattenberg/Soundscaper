/* SPDX-License-Identifier: AGPL-3.0-only */

import { EFFECT_CODES } from './video-preview-effects.js';
import { videoPreviewBlurViewport } from './video-preview-viewports.js';

const COPY_PASS = Object.freeze({});
const RECT_COPY_PASS = Object.freeze({ code: 8 });

/** Evaluate a clip's effects independently of its changing composition geometry. */
export function applyVideoPreviewEntryEffects(compositor, videoTexture, passes, contentViewport, frameVersion) {
	const cacheInput = frameVersion == null ? null : {
		texture: videoTexture, frameVersion, passes,
		targets: compositor.targets,
		width: compositor.canvas.width, height: compositor.canvas.height,
		viewport: contentViewport,
	};
	const cached = cacheInput && compositor.effectResultCache.get(cacheInput);
	if (cached) return cached;
	const gl = compositor.gl;
	gl.disable(gl.BLEND);
	compositor.clearTarget(compositor.targets.ping);
	compositor.draw(
		videoTexture,
		compositor.targets.ping,
		COPY_PASS,
		1,
		contentViewport,
	);
	let sourceTarget = compositor.targets.ping;
	for (const pass of passes) {
		if (pass.preserveSource) {
			compositor.clearTarget(compositor.targets.anchor);
			compositor.draw(
				sourceTarget.texture,
				compositor.targets.anchor,
				RECT_COPY_PASS,
				1,
				null,
				contentViewport,
				contentViewport,
				sourceTarget,
			);
		}
		if (pass.code === EFFECT_CODES['gaussian-blur']) {
			const isHorizontalPass = pass.direction?.[0] === 1;
			if (isHorizontalPass) {
				const blurViewport = videoPreviewBlurViewport(
					contentViewport,
					compositor.canvas.width,
					compositor.canvas.height,
					compositor.targets.blurPing.width,
					compositor.targets.blurPing.height,
					pass.params1?.[0],
					compositor.blurContentViewport,
				);
				compositor.clearTarget(compositor.targets.blurPing);
				compositor.draw(
					sourceTarget.texture,
					compositor.targets.blurPing,
					RECT_COPY_PASS,
					1,
					null,
					blurViewport,
					contentViewport,
					sourceTarget,
				);
				compositor.clearTarget(compositor.targets.blurPong);
				compositor.draw(
					compositor.targets.blurPing.texture,
					compositor.targets.blurPong,
					pass,
					1,
					null,
					blurViewport,
				);
				sourceTarget = compositor.targets.blurPong;
			} else {
				compositor.clearTarget(compositor.targets.blurPing);
				compositor.draw(
					sourceTarget.texture,
					compositor.targets.blurPing,
					pass,
					1,
					null,
					compositor.blurContentViewport,
				);
				compositor.clearTarget(compositor.targets.ping);
				compositor.draw(
					compositor.targets.blurPing.texture,
					compositor.targets.ping,
					RECT_COPY_PASS,
					1,
					null,
					contentViewport,
					compositor.blurContentViewport,
					compositor.targets.blurPing,
				);
				sourceTarget = compositor.targets.ping;
			}
			continue;
		}
		const destinationTarget = sourceTarget === compositor.targets.ping
			? compositor.targets.pong
			: compositor.targets.ping;
		compositor.clearTarget(destinationTarget);
		compositor.draw(
			sourceTarget.texture,
			destinationTarget,
			pass,
			1,
			null,
			contentViewport,
			null,
			null,
			null,
			pass.auxiliary ? compositor.targets.anchor.texture : null,
		);
		sourceTarget = destinationTarget;
	}
	if (!cacheInput) return sourceTarget;
	const target = compositor.targets.effectCache;
	compositor.clearTarget(target);
	compositor.draw(sourceTarget.texture, target, COPY_PASS);
	compositor.effectResultCache.store(cacheInput, target);
	return target;
}
