/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareRationals } from './timeline-time.ts';
import { MOTION_BLEND_MODES, type MotionLayer, type MotionMaterial, type MotionTransform, type MotionMask, type MotionEffect, type MotionAudioPlacement } from './motion-composition.ts';
import { MOTION_LAYER_CONTENT_FIELDS, normalizeMotionLayerContent } from './motion-layer-content.ts';
import { motionPropertyOfKind, normalizeMotionProperty } from './motion-property.ts';
import { freezeMotionValue, motionArray, motionBoolean, motionEnum, motionId, motionRational, motionRecord, motionString, uniqueMotionIds } from './motion-values.ts';

const LAYER_FIELDS = ['id', 'name', 'kind', 'enabled', 'parentId', 'startFrame', 'inFrame', 'outFrame', 'sourceStart', 'timeScale', 'timeRemap', 'transform', 'is3D', 'material', 'blendMode', 'masks', 'matte', 'effects'];

export function normalizeMotionLayer(value: unknown): MotionLayer {
	const candidate = motionRecord(value, [...LAYER_FIELDS, ...new Set(Object.values(MOTION_LAYER_CONTENT_FIELDS).flat())], 'motion layer', ['kind']);
	const kind = motionEnum(candidate.kind, ['footage', 'image', 'text', 'shapes', 'solid', 'null', 'adjustment', 'precomp', 'camera', 'light'], 'layer kind');
	const contentFields = MOTION_LAYER_CONTENT_FIELDS[kind];
	const fields = [...LAYER_FIELDS, ...contentFields];
	const record = motionRecord(candidate, fields, 'motion layer', fields.filter((field) => field !== 'operators'));
	const content = normalizeMotionLayerContent(Object.fromEntries(['kind', ...contentFields].filter((field) => Object.hasOwn(record, field)).map((field) => [field, record[field]])));
	const inFrame = motionRational(record.inFrame, 'layer in frame');
	const outFrame = motionRational(record.outFrame, 'layer out frame');
	if (compareRationals(inFrame, outFrame) >= 0) throw new RangeError('Layer out frame must exceed its in frame.');
	const masks = motionArray(record.masks, 256, 'layer masks').map(normalizeMask);
	const effects = motionArray(record.effects, 256, 'layer effects').map(normalizeEffect);
	uniqueMotionIds(masks, 'layer masks'); uniqueMotionIds(effects, 'layer effects');
	const matte = record.matte === null ? null : motionRecord(record.matte, ['layerId', 'mode'], 'layer matte');
	return freezeMotionValue({
		id: motionId(record.id, 'layer ID'), name: motionString(record.name, 'layer name'),
		enabled: motionBoolean(record.enabled, 'layer enabled'), parentId: record.parentId === null ? null : motionId(record.parentId),
		startFrame: motionRational(record.startFrame, 'layer start frame'), inFrame, outFrame,
		sourceStart: motionRational(record.sourceStart, 'layer source start'), timeScale: motionRational(record.timeScale, 'layer time scale'),
		timeRemap: record.timeRemap === null ? null : motionPropertyOfKind(record.timeRemap, 'scalar'),
		transform: normalizeTransform(record.transform), is3D: motionBoolean(record.is3D, 'layer 3D'), material: normalizeMaterial(record.material),
		blendMode: motionEnum(record.blendMode, MOTION_BLEND_MODES, 'layer blend mode'), masks, effects,
		matte: matte === null ? null : { layerId: motionId(matte.layerId), mode: motionEnum(matte.mode, ['alpha', 'alpha-inverted', 'luma', 'luma-inverted'], 'matte mode') },
		...content,
	});
}

function normalizeTransform(value: unknown): MotionTransform {
	const record = motionRecord(value, ['anchor', 'position', 'scale', 'rotation', 'opacity'], 'layer transform');
	return freezeMotionValue({ anchor: motionPropertyOfKind(record.anchor, 'vector3'), position: motionPropertyOfKind(record.position, 'vector3'),
		scale: motionPropertyOfKind(record.scale, 'vector3'), rotation: motionPropertyOfKind(record.rotation, 'vector3'), opacity: motionPropertyOfKind(record.opacity, 'scalar') });
}
function normalizeMaterial(value: unknown): MotionMaterial {
	const record = motionRecord(value, ['acceptsLights', 'castsShadows', 'receivesShadows', 'ambient', 'diffuse', 'specular', 'shininess'], 'layer material');
	return freezeMotionValue({ acceptsLights: motionBoolean(record.acceptsLights, 'material lighting'), castsShadows: motionBoolean(record.castsShadows, 'material cast shadows'),
		receivesShadows: motionBoolean(record.receivesShadows, 'material receive shadows'), ambient: motionPropertyOfKind(record.ambient, 'scalar'),
		diffuse: motionPropertyOfKind(record.diffuse, 'scalar'), specular: motionPropertyOfKind(record.specular, 'scalar'), shininess: motionPropertyOfKind(record.shininess, 'scalar') });
}
function normalizeMask(value: unknown): MotionMask {
	const record = motionRecord(value, ['id', 'path', 'opacity', 'feather', 'expansion', 'inverted', 'operation'], 'motion mask');
	return freezeMotionValue({ id: motionId(record.id), path: motionPropertyOfKind(record.path, 'path'), opacity: motionPropertyOfKind(record.opacity, 'scalar'),
		feather: motionPropertyOfKind(record.feather, 'vector2'), expansion: motionPropertyOfKind(record.expansion, 'scalar'),
		inverted: motionBoolean(record.inverted, 'mask inverted'), operation: motionEnum(record.operation, ['add', 'subtract', 'intersect', 'difference'], 'mask operation') });
}
function normalizeEffect(value: unknown): MotionEffect {
	const record = motionRecord(value, ['id', 'type', 'enabled', 'parameters'], 'motion effect');
	const parameters = motionArray(record.parameters, 256, 'effect parameters').map((item) => {
		const parameter = motionRecord(item, ['id', 'value'], 'effect parameter');
		return { id: motionId(parameter.id), value: normalizeMotionProperty(parameter.value) };
	});
	uniqueMotionIds(parameters, 'effect parameters');
	return freezeMotionValue({ id: motionId(record.id), type: motionId(record.type, 'effect type'), enabled: motionBoolean(record.enabled, 'effect enabled'), parameters });
}

export function normalizeMotionAudioPlacement(value: unknown): MotionAudioPlacement {
	const record = motionRecord(value, ['id', 'assetId', 'startFrame', 'inFrame', 'outFrame', 'sourceStart', 'timeScale', 'enabled', 'gain'], 'motion audio placement');
	const inFrame = motionRational(record.inFrame, 'audio in frame');
	const outFrame = motionRational(record.outFrame, 'audio out frame');
	if (compareRationals(inFrame, outFrame) >= 0) throw new RangeError('Audio out frame must exceed its in frame.');
	return freezeMotionValue({ id: motionId(record.id), assetId: motionId(record.assetId),
		startFrame: motionRational(record.startFrame, 'audio start frame'), inFrame, outFrame,
		sourceStart: motionRational(record.sourceStart, 'audio source start'), timeScale: motionRational(record.timeScale, 'audio time scale'),
		enabled: motionBoolean(record.enabled, 'audio enabled'), gain: motionPropertyOfKind(record.gain, 'scalar') });
}
