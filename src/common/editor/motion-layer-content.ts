/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionLayerContent, MotionShape, MotionTextDocument } from './motion-composition.ts';
import { motionPropertyOfKind } from './motion-property.ts';
import { normalizeMotionShapeOperators, normalizeMotionTextAnimators } from './motion-authoring-operators.ts';
import { normalizeMotionFill } from './motion-fill.ts';
import { freezeMotionValue, motionArray, motionBoolean, motionEnum, motionId, motionNumber, motionRecord, motionString, uniqueMotionIds } from './motion-values.ts';

export const MOTION_LAYER_CONTENT_FIELDS = {
	footage: ['assetId', 'audioEnabled', 'audioGain'], image: ['assetId'], text: ['document'], shapes: ['shapes', 'operators'],
	solid: ['color', 'size'], null: [], adjustment: ['targetLayerIds'], precomp: ['compositionId'],
	camera: ['projection', 'zoom', 'near', 'far', 'focusDistance', 'aperture'],
	light: ['lightType', 'color', 'intensity', 'coneAngle', 'coneFeather', 'castsShadows'],
} as const;

/** A separate discriminated content boundary prevents executable extension bags. */
export function normalizeMotionLayerContent(value: unknown): MotionLayerContent {
	const input = motionRecord(value, ['kind', ...new Set(Object.values(MOTION_LAYER_CONTENT_FIELDS).flat())], 'layer content', ['kind']);
	const kind = motionEnum(input.kind, ['footage', 'image', 'text', 'shapes', 'solid', 'null', 'adjustment', 'precomp', 'camera', 'light'], 'layer kind');
	const fields = ['kind', ...MOTION_LAYER_CONTENT_FIELDS[kind]];
	const record = motionRecord(value, fields, 'layer content', fields.filter((field) => field !== 'operators'));
	switch (kind) {
		case 'footage': return freezeMotionValue({ kind, assetId: motionId(record.assetId), audioEnabled: motionBoolean(record.audioEnabled, 'footage audio enabled'), audioGain: motionPropertyOfKind(record.audioGain, 'scalar') });
		case 'image': return Object.freeze({ kind, assetId: motionId(record.assetId) });
		case 'text': return freezeMotionValue({ kind, document: normalizeText(record.document) });
		case 'shapes': {
			const shapes = motionArray(record.shapes, 1024, 'layer shapes', 1).map(normalizeShape);
			uniqueMotionIds(shapes, 'layer shapes');
			return freezeMotionValue({ kind, shapes, ...(Object.hasOwn(record, 'operators') ? { operators: normalizeMotionShapeOperators(record.operators) } : {}) });
		}
		case 'solid': return freezeMotionValue({ kind, color: motionPropertyOfKind(record.color, 'color'), size: motionPropertyOfKind(record.size, 'vector2') });
		case 'null': return Object.freeze({ kind });
		case 'adjustment': {
			const targetLayerIds = motionArray(record.targetLayerIds, 4096, 'adjustment targets').map((id) => motionId(id));
			if (new Set(targetLayerIds).size !== targetLayerIds.length) throw new RangeError('Adjustment targets must be unique.');
			return freezeMotionValue({ kind, targetLayerIds });
		}
		case 'precomp': return Object.freeze({ kind, compositionId: motionId(record.compositionId) });
		case 'camera': {
			const near = motionNumber(record.near, 'camera near', 0.001);
			const far = motionNumber(record.far, 'camera far', near);
			if (far <= near) throw new RangeError('Camera far must exceed near.');
			return freezeMotionValue({ kind, projection: motionEnum(record.projection, ['perspective', 'orthographic'], 'camera projection'),
				zoom: motionPropertyOfKind(record.zoom, 'scalar'), near, far,
				focusDistance: motionPropertyOfKind(record.focusDistance, 'scalar'), aperture: motionPropertyOfKind(record.aperture, 'scalar') });
		}
		case 'light': return freezeMotionValue({ kind, lightType: motionEnum(record.lightType, ['ambient', 'point', 'spot'], 'light type'),
			color: motionPropertyOfKind(record.color, 'color'), intensity: motionPropertyOfKind(record.intensity, 'scalar'),
			coneAngle: motionPropertyOfKind(record.coneAngle, 'scalar'), coneFeather: motionPropertyOfKind(record.coneFeather, 'scalar'), castsShadows: motionBoolean(record.castsShadows, 'light shadows') });
	}
}

function normalizeText(value: unknown): MotionTextDocument {
	const record = motionRecord(value, ['runs', 'align', 'lineHeight', 'boxSize', 'animators'], 'text document', ['runs', 'align', 'lineHeight', 'boxSize']);
	let length = 0;
	const runs = motionArray(record.runs, 1024, 'text runs', 1).map((item) => {
		const run = motionRecord(item, ['text', 'fontAssetId', 'fontSize', 'color', 'tracking'], 'text run');
		const text = motionString(run.text, 'text', 65_536, true);
		length += text.length;
		if (length > 65_536) throw new RangeError('Text document exceeds its character budget.');
		return { text, fontAssetId: motionId(run.fontAssetId), fontSize: motionPropertyOfKind(run.fontSize, 'scalar'),
			color: motionPropertyOfKind(run.color, 'color'), tracking: motionPropertyOfKind(run.tracking, 'scalar') };
	});
	return freezeMotionValue({ runs, align: motionEnum(record.align, ['left', 'center', 'right', 'justify'], 'text alignment'),
		lineHeight: motionPropertyOfKind(record.lineHeight, 'scalar'), boxSize: motionPropertyOfKind(record.boxSize, 'vector2'),
		...(Object.hasOwn(record, 'animators') ? { animators: normalizeMotionTextAnimators(record.animators) } : {}) });
}

function normalizeShape(value: unknown): MotionShape {
	const record = motionRecord(value, ['id', 'path', 'fill', 'stroke'], 'motion shape');
	const stroke = record.stroke === null ? null : motionRecord(record.stroke, ['color', 'width', 'lineCap', 'lineJoin'], 'shape stroke');
	return freezeMotionValue({ id: motionId(record.id), path: motionPropertyOfKind(record.path, 'path'),
		fill: record.fill === null ? null : normalizeMotionFill(record.fill),
		stroke: stroke === null ? null : { color: motionPropertyOfKind(stroke.color, 'color'), width: motionPropertyOfKind(stroke.width, 'scalar'),
			lineCap: motionEnum(stroke.lineCap, ['butt', 'round', 'square'], 'stroke cap'), lineJoin: motionEnum(stroke.lineJoin, ['miter', 'round', 'bevel'], 'stroke join') } });
}
