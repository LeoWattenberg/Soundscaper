/* SPDX-License-Identifier: AGPL-3.0-only */
export type MotionAeLayerBlend = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'difference';
/** Closed named SDK subset. This admits structural intent, never color/alpha equivalence. */
export function motionAeLayerBlend(layer: Readonly<{ blendMode: unknown; adjustment: unknown; threeD: unknown; compositing?: unknown }>): MotionAeLayerBlend | null {
	const capture = layer.compositing;
	let neutral = false;
	if (capture !== undefined) {
		if (capture === null || typeof capture !== 'object' || Object.prototype.toString.call(capture) === '[object Array]') throw new Error('AE compositing metadata requires an object.');
		const fields = capture as Record<string, unknown>; let count = 0;
		for (const key in fields) if (Object.prototype.hasOwnProperty.call(fields, key)) {
			if (++count > 2 || key !== 'preserveTransparency' && key !== 'collapseTransformation') throw new Error('AE compositing metadata contains unsupported fields.');
		}
		if (count !== 2 || typeof fields.preserveTransparency !== 'boolean' || typeof fields.collapseTransformation !== 'boolean') throw new Error('AE compositing switches require booleans.');
		neutral = fields.preserveTransparency === false && fields.collapseTransformation === false;
	}
	if (capture !== undefined && !neutral) return null;
	if (layer.blendMode === 'normal') return 'normal';
	if (!neutral || layer.adjustment !== false || layer.threeD !== false) return null;
	const modes: readonly MotionAeLayerBlend[] = ['multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference'];
	for (let index = 0; index < modes.length; index++) if (layer.blendMode === modes[index]) return modes[index]!;
	return null;
}
