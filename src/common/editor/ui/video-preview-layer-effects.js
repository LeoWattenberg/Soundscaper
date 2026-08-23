/* SPDX-License-Identifier: AGPL-3.0-only */

import { EFFECT_CODES } from './video-preview-effects.js';
import { videoPreviewBlurViewport } from './video-preview-viewports.js';
import { drawVideoPreviewCompositionBlend } from './video-preview-composition-blend.ts';
import { recordVideoPreviewLayerRendered } from './video-preview-render-ledger.js';

const COPY_PASS = Object.freeze({});
const RECT_COPY_PASS = Object.freeze({ code: 8 });
const EMPTY_EFFECTS = Object.freeze([]);

/** Apply an adjustment stack and blend the completed layer into the picture target. */
export function compositeVideoPreviewAdjustedLayer(
	compositor, ledger, layer, sourceTarget, destinationTarget, referenceWidth, referenceHeight,
) {
	const previewScale = {
		x: compositor.canvas.width / referenceWidth,
		y: compositor.canvas.height / referenceHeight,
	};
	const adjusted = applyVideoPreviewLayerEffects(
		compositor, compositor.targets.layer, layer.effects || EMPTY_EFFECTS, previewScale,
	);
	recordVideoPreviewLayerRendered(ledger, layer);
	drawVideoPreviewCompositionBlend(compositor.gl, compositor.compositionBlend, {
		backdropTexture: sourceTarget.texture,
		sourceTexture: adjusted.texture,
		target: destinationTarget,
		blendMode: layer.blendMode || 'normal',
	});
	compositor.currentProgram = null;
	return destinationTarget;
}

/** Execute an adjustment-layer effect stack against a completed layer target. */
export function applyVideoPreviewLayerEffects(compositor, sourceTarget, effects, previewScale) {
	const passes = compositor.passesForEffects(effects || EMPTY_EFFECTS, previewScale);
	if (!passes.length) return sourceTarget;
	const viewport = {
		x: 0, y: 0, width: compositor.canvas.width, height: compositor.canvas.height,
	};
	const targets = compositor.targets;
	compositor.clearTarget(targets.ping);
	compositor.draw(sourceTarget.texture, targets.ping, COPY_PASS, 1, viewport);
	let current = targets.ping;
	for (const pass of passes) {
		if (pass.preserveSource) {
			compositor.clearTarget(targets.anchor);
			compositor.draw(current.texture, targets.anchor, RECT_COPY_PASS, 1,
				null, viewport, viewport, current);
		}
		if (pass.code === EFFECT_CODES['gaussian-blur']) {
			current = applyBlurPass(compositor, current, pass, viewport);
			continue;
		}
		const destination = current === targets.ping ? targets.pong : targets.ping;
		compositor.clearTarget(destination);
		compositor.draw(current.texture, destination, pass, 1, null, viewport,
			null, null, null, pass.auxiliary ? targets.anchor.texture : null);
		current = destination;
	}
	return current;
}

function applyBlurPass(compositor, current, pass, viewport) {
	const targets = compositor.targets;
	if (pass.direction?.[0] === 1) {
		const blurViewport = videoPreviewBlurViewport(
			viewport, compositor.canvas.width, compositor.canvas.height,
			targets.blurPing.width, targets.blurPing.height,
			pass.params1?.[0], compositor.blurContentViewport,
		);
		compositor.clearTarget(targets.blurPing);
		compositor.draw(current.texture, targets.blurPing, RECT_COPY_PASS, 1,
			null, blurViewport, viewport, current);
		compositor.clearTarget(targets.blurPong);
		compositor.draw(targets.blurPing.texture, targets.blurPong, pass, 1,
			null, blurViewport);
		return targets.blurPong;
	}
	compositor.clearTarget(targets.blurPing);
	compositor.draw(current.texture, targets.blurPing, pass, 1,
		null, compositor.blurContentViewport);
	compositor.clearTarget(targets.ping);
	compositor.draw(targets.blurPing.texture, targets.ping, RECT_COPY_PASS, 1,
		null, viewport, compositor.blurContentViewport, targets.blurPing);
	return targets.ping;
}
