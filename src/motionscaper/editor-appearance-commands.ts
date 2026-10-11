/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionComposition, MotionLayer, MotionShape, MotionTextRun, MotionTextDocument } from '../common/editor/motion-composition.ts';
import type { MotionAsset } from '../common/editor/motion-asset.ts';
import { normalizeMotionAsset } from '../common/editor/motion-asset.ts';
import type { MotionFill, MotionGradientStop } from '../common/editor/motion-fill.ts';
import { normalizeMotionFill } from '../common/editor/motion-fill.ts';
import { motionLayerProperties } from '../common/editor/motion-project-graph.ts';
import { remapMotionTextRunLinks } from '../common/editor/motion-text-run-links.ts';
import { motionColor, motionScalar, motionVector, type MotionColor, type MotionVector2, type MotionProperty, type MotionScalarProperty, type MotionColorProperty, type MotionVector2Property } from '../common/editor/motion-property.ts';
import { freezeMotionValue, motionArray, motionId, motionInteger, motionNumber, motionRecord, motionString } from '../common/editor/motion-values.ts';
import { normalizeMotionscaperProject } from './editor-project-validation.ts';
import { applyMotionscaperCommands, type MotionscaperProjectCommand } from './editor-project-commands.ts';

export type MotionAppearanceFillEdit = Readonly<{
	type: 'fill'; shapeId: string; kind: 'none' | MotionFill['kind']; color?: MotionColor;
	start?: MotionVector2; end?: MotionVector2; center?: MotionVector2; radius?: number;
	stops?: readonly Readonly<{ id: string; offset: number; color: MotionColor }>[];
}>;
export type MotionscaperAppearanceEdit =
	| { readonly type: 'text-run'; readonly index: number; readonly text?: string; readonly fontAssetId?: string; readonly fontSize?: number; readonly color?: MotionColor; readonly tracking?: number }
	| { readonly type: 'add-text-run'; readonly index: number; readonly run: MotionTextRun }
	| { readonly type: 'remove-text-run'; readonly index: number }
	| { readonly type: 'move-text-run'; readonly index: number; readonly toIndex: number }
	| { readonly type: 'text-layout'; readonly align?: MotionTextDocument['align']; readonly lineHeight?: number; readonly boxSize?: MotionVector2 }
	| MotionAppearanceFillEdit
	| { readonly type: 'stroke'; readonly shapeId: string; readonly stroke: Readonly<{ color: MotionColor; width: number; lineCap: NonNullable<MotionShape['stroke']>['lineCap']; lineJoin: NonNullable<MotionShape['stroke']>['lineJoin'] }> | null }
	| { readonly type: 'solid'; readonly color?: MotionColor; readonly size?: MotionVector2 };

/** Style controls change base values only; existing temporal curves, expressions and unrelated intent remain authored. */
export function createMotionscaperAppearanceCommands(options: Readonly<{
	project: unknown; compositionId: string; layerId: string; edit: MotionscaperAppearanceEdit; fonts?: readonly MotionAsset[];
}>): readonly MotionscaperProjectCommand[] {
	const project = normalizeMotionscaperProject(options.project); const id = motionId(options.compositionId), layerId = motionId(options.layerId);
	const composition = project.compositions.find(value => value.id === id); if (!composition) throw new ReferenceError('Appearance composition is missing.');
	const layer = composition.layers.find(value => value.id === layerId); if (!layer) throw new ReferenceError('Appearance layer is missing.');
	const edit = options.edit; let next: MotionLayer = layer; let indices: ReadonlyMap<number, number> | undefined;
	if (edit.type === 'text-layout') {
		if (layer.kind !== 'text') throw new TypeError('Text layout requires a text layer.');
		next = { ...layer, document: { ...layer.document, align: edit.align ?? layer.document.align,
			lineHeight: scalar(layer.document.lineHeight, edit.lineHeight, 'line height', 0.01, 100), boxSize: vector(layer.document.boxSize, edit.boxSize, true) } };
	} else if (edit.type === 'text-run' || edit.type === 'add-text-run' || edit.type === 'remove-text-run' || edit.type === 'move-text-run') {
		if (layer.kind !== 'text') throw new TypeError('Text runs require a text layer.');
		const runs = [...layer.document.runs]; const index = motionInteger(edit.index, 'text run index', 0, runs.length - (edit.type === 'add-text-run' ? 0 : 1));
		const order = runs.map((_, index) => index);
		if (edit.type === 'text-run') { const run = runs[index]!; runs[index] = { ...run,
			text: edit.text === undefined ? run.text : motionString(edit.text, 'text', 65_536, true), fontAssetId: edit.fontAssetId === undefined ? run.fontAssetId : motionId(edit.fontAssetId),
			fontSize: scalar(run.fontSize, edit.fontSize, 'font size', 1, 4096), color: color(run.color, edit.color), tracking: scalar(run.tracking, edit.tracking, 'tracking', -4096, 4096) }; }
		else if (edit.type === 'add-text-run') { runs.splice(index, 0, edit.run); order.splice(index, 0, -1); }
		else if (edit.type === 'remove-text-run') { if (runs.length === 1) throw new RangeError('A text document must keep at least one run.'); runs.splice(index, 1); order.splice(index, 1); }
		else { const to = motionInteger(edit.toIndex, 'text run destination', 0, runs.length - 1); runs.splice(to, 0, runs.splice(index, 1)[0]!); order.splice(to, 0, order.splice(index, 1)[0]!); }
		if (edit.type !== 'text-run') indices = new Map(order.map((prior, next) => [prior, next]));
		next = { ...layer, document: { ...layer.document, runs } };
	} else if (edit.type === 'solid') {
		if (layer.kind !== 'solid') throw new TypeError('Solid appearance requires a solid layer.'); next = { ...layer, color: color(layer.color, edit.color), size: vector(layer.size, edit.size, true) };
	} else {
		if (layer.kind !== 'shapes') throw new TypeError('Shape appearance requires a shapes layer.');
		const index = layer.shapes.findIndex(shape => shape.id === motionId(edit.shapeId)); if (index < 0) throw new ReferenceError('Appearance shape is missing.');
		const shape = layer.shapes[index]!; const prefix = `shapes.${index}.${edit.type}`;
		if ((edit.type === 'fill' && edit.kind !== (shape.fill?.kind ?? 'none')) || (edit.type === 'stroke' && edit.stroke === null)) {
			if (motionLayerProperties(layer).some(entry => (entry.path === prefix || entry.path.startsWith(`${prefix}.`)) && animated(entry.property))) throw new Error('Changing this appearance type would remove animation. Clear or bake that animation in Properties and Keyframes first.');
		}
		const changed = edit.type === 'fill' ? { ...shape, fill: fill(shape.fill, edit) } : { ...shape, stroke: edit.stroke === null ? null : {
			color: color(shape.stroke?.color ?? motionColor([0, 0, 0, 1]), edit.stroke.color), width: scalar(shape.stroke?.width ?? motionScalar(1), edit.stroke.width, 'stroke width', 0, 65536), lineCap: edit.stroke.lineCap, lineJoin: edit.stroke.lineJoin } };
		next = { ...layer, shapes: layer.shapes.map((value, offset) => offset === index ? changed : value) };
	}
	let candidate: MotionComposition = { ...composition, layers: composition.layers.map(value => value.id === layer.id ? next : value) };
	if (indices) candidate = remapMotionTextRunLinks(candidate, layer.id, indices);
	const commands: MotionscaperProjectCommand[] = motionArray(options.fonts ?? [], 16, 'prepared fonts').map(value => {
		const asset = normalizeMotionAsset(value); if (asset.kind !== 'font') throw new TypeError('Appearance may import only retained font assets.'); return { type: 'asset/add', asset };
	});
	commands.push({ type: 'composition/replace', composition: candidate }); applyMotionscaperCommands(project, commands); return freezeMotionValue(commands);
}
function scalar(previous: MotionScalarProperty, value: number | undefined, label: string, minimum: number, maximum: number): MotionScalarProperty {
	return value === undefined ? previous : { ...previous, value: motionNumber(value, label, minimum, maximum) };
}
function color(previous: MotionColorProperty, value: MotionColor | undefined): MotionColorProperty { return value === undefined ? previous : { ...previous, value: motionColor(value).value }; }
function vector(previous: MotionVector2Property, value: MotionVector2 | undefined, positive = false): MotionVector2Property {
	if (value === undefined) return previous; const normalized = motionVector(value); for (const number of normalized.value) motionNumber(number, 'appearance coordinate', positive ? 1 : -1e6, positive ? 65536 : 1e6);
	return { ...previous, value: normalized.value };
}
function animated(property: MotionProperty): boolean { return property.expression !== null || (property.kind === 'scalar' ? property.curve !== null : property.kind === 'path' ? property.keyframes.length > 0 : property.curves.some(value => value !== null)); }
function fill(previous: MotionFill | null, edit: MotionAppearanceFillEdit): MotionFill | null {
	if (edit.kind === 'none') return null;
	if (edit.kind === 'color') return color(previous?.kind === 'color' ? previous : motionColor([1, 1, 1, 1]), edit.color);
	const oldStops = previous && previous.kind !== 'color' ? previous.stops : [];
	const stops: readonly MotionGradientStop[] = edit.stops === undefined ? (oldStops.length ? oldStops : [{ id: 'start', offset: motionScalar(0), color: previous?.kind === 'color' ? previous : motionColor([1, 1, 1, 1]) }, { id: 'end', offset: motionScalar(1), color: motionColor([0, 0, 0, 1]) }])
		: motionArray(edit.stops, 64, 'gradient stops', 2).map(value => { const stop = motionRecord(value, ['id', 'offset', 'color'], 'gradient stop'); const prior = oldStops.find(value => value.id === stop.id); return { id: motionId(stop.id), offset: scalar(prior?.offset ?? motionScalar(0), motionNumber(stop.offset, 'gradient offset', 0, 1), 'gradient offset', 0, 1), color: color(prior?.color ?? motionColor([1, 1, 1, 1]), stop.color as MotionColor) }; });
	if (stops.some((stop, index) => index > 0 && stop.offset.value < stops[index - 1]!.offset.value)) throw new RangeError('Gradient stop offsets must be ordered.');
	return normalizeMotionFill(edit.kind === 'linear-gradient' ? { kind: edit.kind, start: vector(previous?.kind === edit.kind ? previous.start : motionVector([0, 0]), edit.start), end: vector(previous?.kind === edit.kind ? previous.end : motionVector([100, 0]), edit.end), stops }
		: { kind: edit.kind, center: vector(previous?.kind === edit.kind ? previous.center : motionVector([0, 0]), edit.center), radius: scalar(previous?.kind === edit.kind ? previous.radius : motionScalar(100), edit.radius, 'gradient radius', 0.001, 65536), stops });
}
