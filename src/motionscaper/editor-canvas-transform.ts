/* SPDX-License-Identifier: AGPL-3.0-only */
import { motionLocalSourceBounds, type MotionLocalSourceBounds } from '../common/editor/motion-local-raster.ts';
import { assertMotion2DMatrix } from '../common/editor/motion-surface.ts';
import { inverseMotionAffineMatrix, transformMotionPoint, transformMotionDirection } from '../common/editor/motion-transform-inverse.ts';
import { motionTransformMatrix, multiplyMotionMatrices, type MotionMatrix4 } from '../common/editor/motion-transform.ts';
import { compareRationals, divideRationals, type Rational } from '../common/editor/timeline-time.ts';
import { freezeMotionValue } from '../common/editor/motion-values.ts';
import type { MotionLayer } from '../common/editor/motion-composition.ts';
import type { MotionVector2 } from '../common/editor/motion-property.ts';
import type { MotionEvaluatedLayer } from '../common/editor/motion-composition-evaluation.ts';
import { compileMotionscaperProject } from './editor-project-evaluation.ts';
import { createMotionscaperRevision } from './editor-project-revision.ts';
import { applyMotionscaperCommands, type MotionscaperProjectCommand } from './editor-project-commands.ts';
import type { MotionscaperProject } from './editor-project-types.ts';
export type MotionCanvasMode = 'move' | 'scale' | 'rotate';
export interface MotionCanvasLayerGeometry {
	readonly layerId: string; readonly name: string; readonly corners: readonly [MotionVector2, MotionVector2, MotionVector2, MotionVector2];
	readonly anchor: MotionVector2; readonly rotationHandle: MotionVector2; readonly scaleCorner: number;
	readonly bounds: MotionLocalSourceBounds; readonly inverseWorld: MotionMatrix4 | null;
	readonly editable: boolean; readonly reason: string | null;
}
export interface MotionCanvasScene { readonly revisionDigest: string; readonly width: number; readonly height: number; readonly layers: readonly MotionCanvasLayerGeometry[] }
interface SceneOptions { readonly project: unknown; readonly compositionId: string; readonly frame: Rational }
interface SceneContext { readonly project: MotionscaperProject; readonly layers: readonly MotionEvaluatedLayer[]; readonly revisionDigest: string; readonly width: number; readonly height: number }
function context(options: SceneOptions): SceneContext {
	const revision = createMotionscaperRevision(options.project); const composition = revision.project.compositions.find(item => item.id === options.compositionId);
	if (!composition) throw new Error('The canvas composition is unavailable.');
	if (compareRationals(options.frame, { num: 0, den: 1 }) < 0 || compareRationals(options.frame, composition.durationFrames) >= 0) throw new RangeError('Choose a canvas frame within the authored composition.');
	const frame = compileMotionscaperProject(revision.project).evaluate({ compositionId: composition.id, time: divideRationals(options.frame, composition.frameRate) });
	return { project: revision.project, layers: frame.layers, revisionDigest: revision.digest, width: frame.width, height: frame.height };
}
const xy = (value: readonly number[]): MotionVector2 => [value[0]!, value[1]!];
function checkPoint(point: MotionVector2): void { if (point.length !== 2 || point.some(value => !Number.isFinite(value) || Math.abs(value) > 1e9)) throw new RangeError('Canvas coordinates must remain finite and bounded.'); }
function writableTransform(project: MotionscaperProject, compositionId: string, layer: MotionLayer): void {
	const composition = project.compositions.find(item => item.id === compositionId)!;
	for (let ancestor: MotionLayer | undefined = layer; ancestor; ancestor = composition.layers.find(item => item.id === ancestor!.parentId)) {
		if (ancestor.is3D) throw new Error('Use 3D Scene and Quality to edit this layer or its 3D parent.');
	}
	for (const property of [layer.transform.position, layer.transform.anchor, layer.transform.scale, layer.transform.rotation]) {
		if (property.expression?.enabled || property.curves.some(Boolean)) throw new Error('Use Properties and Keyframes for animated or expression-driven transforms.');
	}
}
function localBounds(layer: MotionEvaluatedLayer, project: MotionscaperProject, width: number, height: number): MotionLocalSourceBounds | null {
	if (layer.state.kind === 'camera' || layer.state.kind === 'light') return null;
	if (layer.state.kind === 'null') return { origin: [-8, -8], width: 16, height: 16, empty: false };
	if (layer.state.kind === 'adjustment') return { origin: [0, 0], width, height, empty: false };
	if (layer.state.kind === 'precomp') {
		const nested = layer.precomposition; return nested ? { origin: [0, 0], width: nested.width, height: nested.height, empty: false } : null;
	}
	return motionLocalSourceBounds(layer.state, new Map(project.assets.map(asset => [asset.id, asset])));
}
export function motionscaperCanvasScene(options: SceneOptions): MotionCanvasScene {
	const scene = context(options); const authored = scene.project.compositions.find(item => item.id === options.compositionId)!;
	const matteIds = new Set(scene.layers.flatMap(layer => layer.state.matte ? [layer.state.matte.layerId] : []));
	const layers: MotionCanvasLayerGeometry[] = [];
	for (const layer of scene.layers) {
		if (layer.state.is3D || matteIds.has(layer.state.id) || !layer.sourceAvailable) continue;
		try { assertMotion2DMatrix(layer.worldMatrix); } catch { continue; }
		const bounds = localBounds(layer, scene.project, scene.width, scene.height); if (!bounds || bounds.empty) continue;
		const [x, y] = bounds.origin; const point = (a: number, b: number): MotionVector2 => xy(transformMotionPoint(layer.worldMatrix, [a, b, 0]));
		const corners = [point(x, y), point(x + bounds.width, y), point(x + bounds.width, y + bounds.height), point(x, y + bounds.height)] as const;
		const anchor = xy(transformMotionPoint(layer.worldMatrix, layer.state.transform.anchor));
		let reason: string | null = null; let inverseWorld: MotionMatrix4 | null = null;
		try { writableTransform(scene.project, options.compositionId, authored.layers.find(item => item.id === layer.state.id)!); inverseWorld = inverseMotionAffineMatrix(layer.worldMatrix); }
		catch (failure) { reason = failure instanceof Error ? failure.message : String(failure); try { inverseWorld = inverseMotionAffineMatrix(layer.worldMatrix); } catch { /* No hit testing a singular layer. */ } }
		const top = [(corners[0][0] + corners[1][0]) / 2, (corners[0][1] + corners[1][1]) / 2] as const;
		const dx = top[0] - anchor[0], dy = top[1] - anchor[1], distance = Math.hypot(dx, dy);
		const rotationHandle: MotionVector2 = distance > 1e-8 ? [top[0] + dx * 24 / distance, top[1] + dy * 24 / distance] : [top[0], top[1] - 24];
		let scaleCorner = 0; let largest = -1;
		const locals = [[x, y], [x + bounds.width, y], [x + bounds.width, y + bounds.height], [x, y + bounds.height]];
		for (let index = 0; index < 4; index++) { const value = Math.abs((locals[index]![0]! - layer.state.transform.anchor[0]) * (locals[index]![1]! - layer.state.transform.anchor[1])); if (value > largest) { largest = value; scaleCorner = index; } }
		layers.push({ layerId: layer.state.id, name: layer.state.name, corners, anchor, rotationHandle, scaleCorner, bounds, inverseWorld, editable: reason === null, reason });
	}
	return freezeMotionValue({ revisionDigest: scene.revisionDigest, width: scene.width, height: scene.height, layers });
}
/** Source-control bounds follow the renderer's local raster bounds; they do not claim pixel-alpha hit testing. */
export function hitMotionscaperCanvas(scene: MotionCanvasScene, point: MotionVector2): string | null {
	checkPoint(point);
	for (const layer of scene.layers) {
		if (!layer.inverseWorld) continue; const local = transformMotionPoint(layer.inverseWorld, [...point, 0]); const { origin, width, height } = layer.bounds;
		if (local[0] >= origin[0] && local[0] <= origin[0] + width && local[1] >= origin[1] && local[1] <= origin[1] + height) return layer.layerId;
	}
	return null;
}
export interface MotionCanvasTransformGesture {
	readonly revisionDigest: string;
	preview(point: MotionVector2): Readonly<{ project: MotionscaperProject; commands: readonly MotionscaperProjectCommand[] }>;
	commit(currentProject: unknown, point: MotionVector2): readonly MotionscaperProjectCommand[];
}
export function beginMotionscaperCanvasTransform(options: SceneOptions & Readonly<{ layerId: string; mode: MotionCanvasMode; start: MotionVector2 }>): MotionCanvasTransformGesture {
	if (!['move', 'scale', 'rotate'].includes(options.mode)) throw new RangeError('Choose a supported canvas transform.');
	checkPoint(options.start); const scene = context(options); const composition = scene.project.compositions.find(item => item.id === options.compositionId)!;
	const layer = composition.layers.find(item => item.id === options.layerId); const evaluated = scene.layers.find(item => item.state.id === options.layerId);
	if (!layer || !evaluated || layer.kind === 'camera' || layer.kind === 'light') throw new Error('Select a layer visible at the current canvas frame.');
	writableTransform(scene.project, composition.id, layer); assertMotion2DMatrix(evaluated.worldMatrix);
	const parent = multiplyMotionMatrices(evaluated.worldMatrix, inverseMotionAffineMatrix(motionTransformMatrix(evaluated.state.transform)));
	const inverseParent = inverseMotionAffineMatrix(parent); const start = transformMotionPoint(inverseParent, [...options.start, 0]);
	const position = layer.transform.position.value; const rotation = layer.transform.rotation.value; const scale = layer.transform.scale.value;
	const unrotate = (point: readonly number[]): MotionVector2 => { const angle = -rotation[2] * Math.PI / 180, x = point[0]! - position[0], y = point[1]! - position[1]; return [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)]; };
	const preview = (point: MotionVector2) => {
		checkPoint(point); let transform = layer.transform; const target = transformMotionPoint(inverseParent, [...point, 0]);
		if (options.mode === 'move') {
			const delta = transformMotionDirection(inverseParent, [point[0] - options.start[0], point[1] - options.start[1], 0]);
			transform = { ...transform, position: { ...transform.position, value: [position[0] + delta[0], position[1] + delta[1], position[2]] } };
		} else if (options.mode === 'rotate') {
			if (Math.hypot(start[0] - position[0], start[1] - position[1]) < 1e-8 || Math.hypot(target[0] - position[0], target[1] - position[1]) < 1e-8) throw new RangeError('Move the rotation handle away from the layer anchor.');
			const radians = Math.atan2(target[1] - position[1], target[0] - position[0]) - Math.atan2(start[1] - position[1], start[0] - position[0]);
			transform = { ...transform, rotation: { ...transform.rotation, value: [rotation[0], rotation[1], rotation[2] + radians * 180 / Math.PI] } };
		} else {
			const a = unrotate(start), b = unrotate(target);
			if (a.some(value => Math.abs(value) < 1e-8)) throw new RangeError('Choose a scale handle away from the layer anchor axes.');
			const x = scale[0] * b[0] / a[0], y = scale[1] * b[1] / a[1];
			if ([x, y].some(value => !Number.isFinite(value) || Math.abs(value) < 1e-6 || Math.abs(value) > 1e6)) throw new RangeError('Canvas scale must stay finite and nonsingular.');
			transform = { ...transform, scale: { ...transform.scale, value: [x, y, scale[2]] } };
		}
		const commands: readonly MotionscaperProjectCommand[] = [{ type: 'layer/replace', compositionId: composition.id, layer: { ...layer, transform } }];
		return freezeMotionValue({ project: applyMotionscaperCommands(scene.project, commands), commands });
	};
	return Object.freeze({ revisionDigest: scene.revisionDigest, preview, commit(currentProject: unknown, point: MotionVector2) {
		if (createMotionscaperRevision(currentProject).digest !== scene.revisionDigest) throw new Error('The composition changed during this canvas gesture. Start the edit again.');
		return preview(point).commands;
	} });
}
