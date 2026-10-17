/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeVectorStyle } from './motion-ae-exchange-types.ts';
import { motionEnum, motionRecord } from './motion-values.ts';
/** Semantic host capture is separate from unqualified numeric AE style enum values. */
export function normalizeMotionAeVectorStyle(value: unknown): MotionAeVectorStyle {
	const r = motionRecord(value, ['blendMode', 'fillRule', 'lineCap', 'lineJoin', 'pathDirection'], 'AE vector style', ['blendMode']);
	return { blendMode: motionEnum(r.blendMode, ['normal', 'unsupported', 'unavailable'], 'AE vector blend mode'),
		...(r.fillRule === undefined ? {} : { fillRule: motionEnum(r.fillRule, ['nonzero', 'evenodd', 'unavailable'], 'AE vector fill rule') }),
		...(r.lineCap === undefined ? {} : { lineCap: motionEnum(r.lineCap, ['butt', 'round', 'square', 'unavailable'], 'AE vector line cap') }),
		...(r.lineJoin === undefined ? {} : { lineJoin: motionEnum(r.lineJoin, ['miter', 'round', 'bevel', 'unavailable'], 'AE vector line join') }),
		...(r.pathDirection === undefined ? {} : { pathDirection: motionEnum(r.pathDirection, ['forward', 'reversed', 'unavailable'], 'AE vector path direction') }) };
}
