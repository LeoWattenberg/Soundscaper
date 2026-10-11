/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionLayer } from '../common/editor/motion-composition.ts';
import { motionColor, motionScalar, motionVector, type MotionColor, type MotionScalarProperty, type MotionVector3, type MotionVector3Property } from '../common/editor/motion-property.ts';
import { freezeMotionValue, motionBoolean, motionEnum, motionId, motionNumber, motionString } from '../common/editor/motion-values.ts';
import { createMotionLayer } from './editor-project.ts';
import { normalizeMotionscaperProject } from './editor-project-validation.ts';
import { applyMotionscaperCommands, type MotionscaperProjectCommand } from './editor-project-commands.ts';
export type MotionscaperSceneEdit =
	| { readonly type: 'add-camera'; readonly id: string; readonly name: string }
	| { readonly type: 'add-light'; readonly id: string; readonly name: string; readonly lightType: 'ambient' | 'point' | 'spot' }
	| { readonly type: 'transform'; readonly is3D?: boolean; readonly anchor?: MotionVector3; readonly position?: MotionVector3; readonly scale?: MotionVector3; readonly rotation?: MotionVector3 }
	| { readonly type: 'camera'; readonly projection?: 'perspective' | 'orthographic'; readonly zoom?: number; readonly near?: number; readonly far?: number; readonly focusDistance?: number; readonly aperture?: number }
	| { readonly type: 'light'; readonly lightType?: 'ambient' | 'point' | 'spot'; readonly color?: MotionColor; readonly intensity?: number; readonly coneAngle?: number; readonly coneFeather?: number; readonly castsShadows?: boolean }
	| { readonly type: 'material'; readonly acceptsLights?: boolean; readonly castsShadows?: boolean; readonly receivesShadows?: boolean; readonly ambient?: number; readonly diffuse?: number; readonly specular?: number; readonly shininess?: number };

/** Base scene settings preserve existing property curves and expression authority. */
export function createMotionscaperSceneCommands(options: Readonly<{ project: unknown; compositionId: string; layerId?: string; edit: MotionscaperSceneEdit }>): readonly MotionscaperProjectCommand[] {
	const project = normalizeMotionscaperProject(options.project), id = motionId(options.compositionId);
	const composition = project.compositions.find(value => value.id === id); if (!composition) throw new ReferenceError('Scene composition is missing.');
	const edit = options.edit; let layers: readonly MotionLayer[];
	if (edit.type === 'add-camera' || edit.type === 'add-light') {
		const zoom = Math.max(composition.width, composition.height);
		const content = edit.type === 'add-camera' ? { kind: 'camera' as const, projection: 'perspective' as const, zoom: motionScalar(zoom), near: 0.001, far: 1e9, focusDistance: motionScalar(zoom), aperture: motionScalar(0) }
			: { kind: 'light' as const, lightType: motionEnum(edit.lightType, ['ambient', 'point', 'spot'], 'light type'), color: motionColor([1, 1, 1, 1]), intensity: motionScalar(1), coneAngle: motionScalar(90), coneFeather: motionScalar(0.5), castsShadows: false };
		const layer = createMotionLayer({ id: motionId(edit.id), name: motionString(edit.name.trim().normalize('NFC'), 'scene layer name', 512), durationFrames: composition.durationFrames, content });
		layers = [{ ...layer, is3D: true, transform: { ...layer.transform, position: motionVector([composition.width / 2, composition.height / 2, -zoom]) } }, ...composition.layers];
	} else {
		const layer = composition.layers.find(value => value.id === motionId(options.layerId)); if (!layer) throw new ReferenceError('Scene layer is missing.');
		let next: MotionLayer;
		if (edit.type === 'transform') {
			const is3D = boolean(layer.is3D, edit.is3D);
			if (is3D && layer.kind === 'adjustment') throw new Error('Place 3D adjustment content in an isolated precomposition first.');
			next = { ...layer, is3D, transform: { ...layer.transform, anchor: vector(layer.transform.anchor, edit.anchor), position: vector(layer.transform.position, edit.position), scale: vector(layer.transform.scale, edit.scale), rotation: vector(layer.transform.rotation, edit.rotation) } };
			if ((is3D || layer.kind === 'camera' || layer.kind === 'light') && next.transform.scale.value.some(value => value === 0)) throw new RangeError('A 3D scene scale must be nonsingular.');
		} else if (edit.type === 'camera') {
			if (layer.kind !== 'camera') throw new TypeError('Camera optics require a camera layer.');
			const near = motionNumber(edit.near ?? layer.near, 'camera near', 0.001, 1e9), far = motionNumber(edit.far ?? layer.far, 'camera far', near, 1e9);
			if (far <= near) throw new RangeError('Camera far must exceed near.');
			next = { ...layer, projection: motionEnum(edit.projection ?? layer.projection, ['perspective', 'orthographic'], 'camera projection'), near, far,
				zoom: scalar(layer.zoom, edit.zoom, 'camera zoom', 1e-6, 1e9), focusDistance: scalar(layer.focusDistance, edit.focusDistance, 'camera focus distance', 1e-6, 1e9), aperture: scalar(layer.aperture, edit.aperture, 'camera aperture', 0, 32768) };
		} else if (edit.type === 'light') {
			if (layer.kind !== 'light') throw new TypeError('Light settings require a light layer.');
			next = { ...layer, lightType: motionEnum(edit.lightType ?? layer.lightType, ['ambient', 'point', 'spot'], 'light type'), castsShadows: boolean(layer.castsShadows, edit.castsShadows),
				color: edit.color === undefined ? layer.color : { ...layer.color, value: motionColor(edit.color).value }, intensity: scalar(layer.intensity, edit.intensity, 'light intensity', 0, 64), coneAngle: scalar(layer.coneAngle, edit.coneAngle, 'light cone angle', 0, 180), coneFeather: scalar(layer.coneFeather, edit.coneFeather, 'light cone feather', 0, 1) };
		} else {
			if (['null', 'camera', 'light', 'adjustment'].includes(layer.kind)) throw new TypeError('Material settings require a pixel layer.');
			const material = layer.material; next = { ...layer, material: { acceptsLights: boolean(material.acceptsLights, edit.acceptsLights), castsShadows: boolean(material.castsShadows, edit.castsShadows), receivesShadows: boolean(material.receivesShadows, edit.receivesShadows),
				ambient: scalar(material.ambient, edit.ambient, 'material ambient', 0, 1), diffuse: scalar(material.diffuse, edit.diffuse, 'material diffuse', 0, 1), specular: scalar(material.specular, edit.specular, 'material specular', 0, 1), shininess: scalar(material.shininess, edit.shininess, 'material shininess', 0, 1024) } };
		}
		layers = composition.layers.map(value => value.id === layer.id ? next : value);
	}
	const commands: readonly MotionscaperProjectCommand[] = [{ type: 'composition/replace', composition: { ...composition, layers } }];
	applyMotionscaperCommands(project, commands); return freezeMotionValue(commands);
}
function scalar(prior: MotionScalarProperty, value: number | undefined, label: string, minimum: number, maximum: number): MotionScalarProperty { return value === undefined ? prior : { ...prior, value: motionNumber(value, label, minimum, maximum) }; }
function vector(prior: MotionVector3Property, value: MotionVector3 | undefined): MotionVector3Property { if (value === undefined) return prior; const normalized = motionVector(value); normalized.value.forEach(value => motionNumber(value, 'scene transform', -1e9, 1e9)); return { ...prior, value: normalized.value }; }
function boolean(prior: boolean, value: boolean | undefined): boolean { return value === undefined ? prior : motionBoolean(value, 'scene setting'); }
