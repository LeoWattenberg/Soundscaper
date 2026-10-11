/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAsset } from './motion-asset.ts';
import type { MotionAeComposition, MotionAeExchange } from './motion-ae-exchange-types.ts';

type MotionImageAsset = Extract<MotionAsset, { kind: 'image' }>;

/** An explicit complete-composition claim can never silently become a still or a partial draft. */
export function motionAeRenderedSequence(exchange: MotionAeExchange, composition: MotionAeComposition, media: ReadonlyMap<string, MotionAsset>): readonly MotionImageAsset[] | null {
	const claims = exchange.report.filter(entry => entry.scopeId === composition.id && entry.code === 'composition-render-frame');
	if (!claims.length) return null;
	const exactCount = composition.duration * composition.frameRate, count = Math.round(exactCount);
	if (count < 1 || count > 256 || Math.abs(exactCount - count) > 0.000001 || composition.pixelAspect !== 1 || claims.length !== count) throw new Error('AE rendered fallback requires a complete square-pixel frame sequence within the current 256-frame carrier budget. Split longer compositions before rendering.');
	const frames = new Map<number, MotionImageAsset>(), used = new Set<string>();
	for (const claim of claims) {
		const match = /^frame\/(0|[1-9][0-9]*)$/u.exec(claim.propertyPath), index = match ? Number(match[1]) : -1;
		const source = exchange.footage.find(item => item.id === claim.mediaId), asset = claim.mediaId ? media.get(claim.mediaId) : undefined;
		if (claim.status !== 'rendered' || index < 0 || index >= count || frames.has(index) || !source || used.has(source.id)
			|| source.width !== composition.width || source.height !== composition.height || source.pixelAspect !== 1 || source.frameRate !== composition.frameRate
			|| !source.still || !source.hasVideo || source.hasAudio || !source.path?.endsWith('.png')
			|| !asset || asset.kind !== 'image' || asset.mimeType !== 'image/png' || !asset.hasAlpha) throw new Error('AE rendered frame sequence is incomplete, duplicated or does not match its retained PNG geometry.');
		frames.set(index, asset); used.add(source.id);
	}
	return Array.from({ length: count }, (_, index) => frames.get(index)!);
}
