/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionComposition, MotionLayer, MotionLayerContent } from '../common/editor/motion-composition.ts';
import { motionColor, motionScalar, motionVector } from '../common/editor/motion-property.ts';
import { motionEllipsePath, motionPolygonPath, motionRectanglePath } from '../common/editor/motion-shape-primitives.ts';
import { decodeMotionChannel } from '../common/editor/motion-surface.ts';
import { normalizeMotionLayer } from '../common/editor/motion-layer-validation.ts';
import { motionEnum, motionNumber, motionString } from '../common/editor/motion-values.ts';
import { createMotionLayer } from './editor-project.ts';

export const MOTION_AUTHORED_LAYER_KINDS = ['solid', 'text', 'rectangle', 'ellipse', 'star'] as const;
export type MotionAuthoredLayerKind = typeof MOTION_AUTHORED_LAYER_KINDS[number];
export interface MotionLayerDraft {
	readonly kind: MotionAuthoredLayerKind; readonly name: string; readonly x: number; readonly y: number;
	readonly width: number; readonly height: number; readonly color: string; readonly opacity: number;
	readonly text: string; readonly fontSize: number;
}

/** Color controls are sRGB; persisted scene values and rendering use linear Rec.709. */
export function createAuthoredMotionLayer(id: string, composition: MotionComposition, draft: MotionLayerDraft, fontAssetId?: string): MotionLayer {
	const kind = motionEnum(draft.kind, MOTION_AUTHORED_LAYER_KINDS, 'layer kind');
	const name = motionString(draft.name.trim().normalize('NFC'), 'layer name', 512);
	const width = motionNumber(draft.width, 'layer width', 1, 32768);
	const height = motionNumber(draft.height, 'layer height', 1, 32768);
	const x = motionNumber(draft.x, 'layer x'); const y = motionNumber(draft.y, 'layer y');
	const opacity = motionNumber(draft.opacity, 'layer opacity', 0, 100) / 100;
	if (!/^#[0-9a-f]{6}$/iu.test(draft.color)) throw new TypeError('A layer color must be an sRGB hex triplet.');
	const channel = (offset: number) => decodeMotionChannel(Number.parseInt(draft.color.slice(offset, offset + 2), 16) / 255, 'srgb');
	const color = motionColor([channel(1), channel(3), channel(5), 1]);
	let content: MotionLayerContent;
	if (kind === 'solid') content = { kind, color, size: motionVector([width, height]) };
	else if (kind === 'text') {
		if (!fontAssetId) throw new TypeError('Text requires a retained font asset.');
		content = { kind, document: {
			runs: [{ text: motionString(draft.text, 'layer text', 100000), fontAssetId,
				fontSize: motionScalar(motionNumber(draft.fontSize, 'font size', 1, 4096)), color, tracking: motionScalar(0) }],
			align: 'left', lineHeight: motionScalar(1.2), boxSize: motionVector([width, height]),
		} };
	} else {
		const path = kind === 'rectangle' ? motionRectanglePath({ x: 0, y: 0, width, height })
			: kind === 'ellipse' ? motionEllipsePath({ center: [width / 2, height / 2], radius: [width / 2, height / 2] })
				: motionPolygonPath({ center: [width / 2, height / 2], radius: Math.min(width, height) / 2, innerRadius: Math.min(width, height) / 5, points: 5 });
		content = { kind: 'shapes', shapes: [{ id: `${id}-shape`, path, fill: color, stroke: null }] };
	}
	const layer = createMotionLayer({ id, name, durationFrames: composition.durationFrames, content });
	return normalizeMotionLayer({ ...layer, transform: { ...layer.transform, position: motionVector([x, y, 0]), opacity: motionScalar(opacity) } });
}
