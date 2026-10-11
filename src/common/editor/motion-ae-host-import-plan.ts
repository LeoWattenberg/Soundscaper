/* SPDX-License-Identifier: AGPL-3.0-only */
import { readMotionAeHostScalarExpression } from './motion-ae-host-scalar-expression.ts';
import { readMotionAeImportShapes, type MotionAeImportShapeGroup } from './motion-ae-host-import-shape.ts';
import { readMotionAeImportText, type MotionAeImportText } from './motion-ae-host-import-text.ts';
import { parseMotionAeHostJson } from './motion-ae-host-json.ts';
import type { MotionAeKey, MotionAeLayer } from './motion-ae-exchange-types.ts';
import { readMotionAeImportMasks, type MotionAeImportMask } from './motion-ae-host-import-mask.ts';
export interface MotionAeImportNumeric {
	readonly matchName: string; readonly expression: string | null; readonly value: readonly number[]; readonly spatial: boolean; readonly keys: readonly MotionAeKey<readonly number[]>[];
}
export interface MotionAeImportLayer {
	readonly id: string; readonly name: string; readonly kind: 'footage' | 'composition' | 'null' | 'text' | 'shape'; readonly sourceId: string | null; readonly parentId: string | null;
	readonly startTime: number; readonly inPoint: number; readonly outPoint: number; readonly stretch: number;
	readonly enabled: boolean; readonly threeD: boolean; readonly properties: readonly MotionAeImportNumeric[];
	readonly text: MotionAeImportText | null; readonly shapes: readonly MotionAeImportShapeGroup[] | null;
	readonly masks: readonly MotionAeImportMask[];
	readonly matte: MotionAeLayer['matte'];
}
export interface MotionAeImportComposition {
	readonly id: string; readonly name: string; readonly width: number; readonly height: number; readonly pixelAspect: number;
	readonly frameRate: number; readonly duration: number; readonly displayStartTime: number; readonly background: readonly number[];
	readonly layers: readonly MotionAeImportLayer[];
}
export interface MotionAeImportFootage { readonly id: string; readonly name: string; readonly path: string; readonly byteLength: number; readonly sha256: string | null }
export interface MotionAeImportPlan {
	readonly transferId: string; readonly muteAudio: boolean; readonly footage: readonly MotionAeImportFootage[]; readonly compositions: readonly MotionAeImportComposition[]; readonly warnings: readonly string[];
	readonly color: { readonly workingSpace: string; readonly linearBlending: boolean; readonly bitsPerChannel: number };
}
function record(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Object.prototype.toString.call(value) === '[object Array]') throw new Error('AE import expected an object.'); return value as Record<string, unknown>;
}
function array(value: unknown, maximum: number): readonly unknown[] {
	if (Object.prototype.toString.call(value) !== '[object Array]' || (value as unknown[]).length > maximum) throw new Error('AE import array budget exceeded.'); return value as unknown[];
}
function number(value: unknown, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !isFinite(value) || value < minimum || value > maximum) throw new Error('AE import numeric range is invalid.'); return value;
}
function text(value: unknown, maximum = 1024): string { if (typeof value !== 'string' || value.length > maximum) throw new Error('AE import text budget exceeded.'); return value; }
function id(value: unknown): string { const result = text(value, 128); if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) throw new Error('AE import identity is invalid.'); return result; }
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') throw new Error('AE import expected a boolean.'); return value; }
function vector(value: unknown, dimensions?: number): readonly number[] {
	const input = array(value, dimensions ?? 4), result: number[] = [];
	if (input.length < 1 || (dimensions !== undefined && input.length !== dimensions)) throw new Error('AE import numeric dimensions differ.');
	for (let index = 0; index < input.length; index++) result.push(number(input[index], -1e12, 1e12)); return result;
}
function interpolation(value: unknown): 'hold' | 'linear' | 'bezier' {
	if (value !== 'hold' && value !== 'linear' && value !== 'bezier') throw new Error('AE interpolation is unsupported.'); return value;
}
function matte(input: unknown): MotionAeLayer['matte'] {
	if (input === null) return null; const value = record(input), mode = value.type;
	if (mode !== 'alpha' && mode !== 'alpha-inverted' && mode !== 'luma' && mode !== 'luma-inverted') throw new Error('AE matte mode is invalid.');
	return { layerId: id(value.layerId), type: mode };
}
function numericProperty(property: Record<string, unknown>, warnings: string[], budget: { properties: number; keys: number }): MotionAeImportNumeric {
	const value = vector(property.value), spatial = boolean(property.spatial), rawKeys = array(property.keys, 4096), keys: MotionAeKey<readonly number[]>[] = [];
	budget.keys += rawKeys.length; if (budget.keys > 262_144) throw new Error('AE import key budget exceeded.');
	if (spatial && value.length !== 2 && value.length !== 3) throw new Error('AE spatial dimensions are invalid.');
	const easeCount = spatial || value.length === 4 ? 1 : value.length;
	function ease(input: unknown) {
		const values = array(input, easeCount), result: { speed: number; influence: number }[] = [];
		if (values.length !== easeCount) throw new Error('AE temporal ease dimensions differ.');
		for (let entry = 0; entry < values.length; entry++) { const e = record(values[entry]); result.push({ speed: number(e.speed, -1e12, 1e12), influence: number(e.influence, 0.1, 100) }); } return result;
	}
	for (let keyIndex = 0; keyIndex < rawKeys.length; keyIndex++) {
		const key = record(rawKeys[keyIndex]), time = number(key.time, -1e6, 1e6), roving = boolean(key.roving);
		if (keyIndex > 0 && time <= keys[keyIndex - 1]!.time) throw new Error('AE import key times must increase.');
		if (roving && (!spatial || keyIndex === 0 || keyIndex === rawKeys.length - 1)) throw new Error('AE roving key position is invalid.');
		keys.push({ time, value: vector(key.value, value.length), inInterpolation: interpolation(key.inInterpolation), outInterpolation: interpolation(key.outInterpolation),
			inEase: ease(key.inEase), outEase: ease(key.outEase), inSpatialTangent: spatial ? vector(key.inSpatialTangent, value.length) : null,
			outSpatialTangent: spatial ? vector(key.outSpatialTangent, value.length) : null, roving });
	}
	let expression: string | null = null;
	if (property.expression !== null) {
		const authored = record(property.expression);
		if (boolean(authored.enabled)) {
			if (authored.disposition === 'translated') {
				if (value.length !== 1 || spatial) throw new Error('Translated expressions require a nonspatial scalar target. Use explicit sampling for vectors.');
				expression = readMotionAeHostScalarExpression(authored.source);
			} else warnings.push('Expression source is preserved in the package but is not activated in AE. Review sampled keys or render the original composition.');
		}
	}
	return { matchName: text(property.matchName, 256), value, spatial, keys, expression };
}
function properties(input: unknown, warnings: string[], budget: { properties: number; keys: number }): readonly MotionAeImportNumeric[] {
	const roots = array(input, 65_536), result: MotionAeImportNumeric[] = [];
	const allowed = ['ADBE Anchor Point', 'ADBE Position', 'ADBE Scale', 'ADBE Orientation', 'ADBE Rotate X', 'ADBE Rotate Y', 'ADBE Rotate Z', 'ADBE Opacity'];
	for (let rootIndex = 0; rootIndex < roots.length; rootIndex++) {
		if (++budget.properties > 65_536) throw new Error('AE import property budget exceeded.');
		const root = record(roots[rootIndex]);
		if (root.matchName === 'ADBE Mask Parade' || root.matchName === 'ADBE Text Properties' || root.matchName === 'ADBE Root Vectors Group') continue;
		if (root.kind !== 'group' || root.matchName !== 'ADBE Transform Group') { warnings.push('An unmapped property group is omitted; retain the source package and render its composition for visual fidelity.'); continue; }
		const children = array(root.children, 65_536), seen: Record<string, boolean> = {};
		for (let index = 0; index < children.length; index++) {
			if (++budget.properties > 65_536) throw new Error('AE import property budget exceeded.');
			const property = record(children[index]), name = text(property.matchName, 256); let supported = false;
			for (let candidate = 0; candidate < allowed.length; candidate++) if (allowed[candidate] === name) supported = true;
			if (!supported || property.kind !== 'numeric') { warnings.push('An unmapped transform property is omitted: ' + name); continue; }
			if (seen[name]) throw new Error('AE import has duplicate transform properties.'); seen[name] = true;
			result.push(numericProperty(property, warnings, budget));
		}
	}
	return result;
}
function verifyGraph(plan: MotionAeImportPlan): void {
	const all: Record<string, boolean> = {}, comps: Record<string, MotionAeImportComposition> = {}, footage: Record<string, boolean> = {};
	const own = (map: object, key: string) => Object.prototype.hasOwnProperty.call(map, key);
	function register(value: string): void { if (own(all, value)) throw new Error('AE import duplicate identity.'); all[value] = true; }
	for (let index = 0; index < plan.footage.length; index++) { const item = plan.footage[index]!; register(item.id); footage[item.id] = true; }
	for (let index = 0; index < plan.compositions.length; index++) { const comp = plan.compositions[index]!; register(comp.id); comps[comp.id] = comp; }
	for (let index = 0; index < plan.compositions.length; index++) {
		const comp = plan.compositions[index]!, layers: Record<string, MotionAeImportLayer> = {};
		for (let j = 0; j < comp.layers.length; j++) { const layer = comp.layers[j]!; register(layer.id); layers[layer.id] = layer; }
		for (let j = 0; j < comp.layers.length; j++) {
			const layer = comp.layers[j]!;
			if ((layer.kind === 'null' || layer.kind === 'text' || layer.kind === 'shape') ? layer.sourceId !== null : layer.sourceId === null || !own(layer.kind === 'footage' ? footage : comps, layer.sourceId)) throw new Error('AE import layer source is unresolved.');
			let parent = layer.parentId, visited = 0;
			while (parent !== null) { if (!own(layers, parent)) throw new Error('AE import parent is unresolved.'); if (++visited > comp.layers.length) throw new Error('AE import parent cycle.'); parent = layers[parent]!.parentId; }
			let matteId = layer.matte?.layerId ?? null; visited = 0;
			while (matteId !== null) { if (!own(layers, matteId)) throw new Error('AE import matte source is unresolved.'); if (++visited > comp.layers.length) throw new Error('AE import matte cycle.'); matteId = layers[matteId]!.matte?.layerId ?? null; }
		}
	}
	const active: Record<string, boolean> = {}, done: Record<string, boolean> = {};
	function visit(comp: MotionAeImportComposition): void {
		if (own(active, comp.id) && active[comp.id]) throw new Error('AE import composition cycle.'); if (own(done, comp.id) && done[comp.id]) return; active[comp.id] = true;
		for (let index = 0; index < comp.layers.length; index++) { const layer = comp.layers[index]!; if (layer.kind === 'composition') visit(comps[layer.sourceId!]!); }
		active[comp.id] = false; done[comp.id] = true;
	}
	for (let index = 0; index < plan.compositions.length; index++) visit(plan.compositions[index]!);
}
/** Parse the inert manifest and admit only operations implemented by this script version. No AE mutation occurs here. */
export function prepareMotionAeHostImport(json: string): MotionAeImportPlan {
	const input = record(parseMotionAeHostJson(json)); if (input.format !== 'org.motionscaper.ae-exchange' || input.version !== 1) throw new Error('AE import format/version is unsupported.');
	const muteAudio = input.producer !== undefined && record(input.producer).application === 'motionscaper';
	if (muteAudio && record(input.producer).bridgeVersion !== '0.1.0') throw new Error('Motion export bridge version is unsupported.');
	const warnings: string[] = [], footage: MotionAeImportFootage[] = [], compositions: MotionAeImportComposition[] = [], paths: Record<string, boolean> = {};
	const rawFootage = array(input.footage, 4096), rawComps = array(input.compositions, 256), budget = { properties: 0, keys: 0 }; let totalBytes = 0, totalLayers = 0;
	for (let index = 0; index < rawFootage.length; index++) {
		const item = record(rawFootage[index]); if (item.path === null) throw new Error('Relink missing media before importing this exchange.'); const path = text(item.path, 256);
		if (!/^media\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.(?:mp4|m4v|mov|avi|mkv|webm|mp3|wav|aif|aiff|flac|ogg|png|jpg|jpeg|tif|tiff|exr|dpx|psd)$/i.test(path)
			|| /^media\/(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])\./i.test(path)) throw new Error('AE import media path is unsafe or its format is unsupported.');
		if (paths[path.toLowerCase()]) throw new Error('AE import media path collision.'); paths[path.toLowerCase()] = true;
		const byteLength = number(item.byteLength, 0, 274_877_906_944); totalBytes += byteLength;
		if (byteLength !== Math.floor(byteLength) || totalBytes > 274_877_906_944) throw new Error('AE import media byte budget exceeded.');
		const sha256 = item.sha256 === null ? null : text(item.sha256, 64); if (sha256 !== null && !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('AE media SHA-256 is invalid.');
		footage.push({ id: id(item.id), name: text(item.name), path, byteLength, sha256 });
	}
	for (let index = 0; index < rawComps.length; index++) {
		const comp = record(rawComps[index]), rawLayers = array(comp.layers, 4096), layers: MotionAeImportLayer[] = [];
		totalLayers += rawLayers.length; if (totalLayers > 4096) throw new Error('AE import layer budget exceeded.');
		for (let j = 0; j < rawLayers.length; j++) {
			const layer = record(rawLayers[j]); if (layer.kind !== 'footage' && layer.kind !== 'composition' && layer.kind !== 'null' && layer.kind !== 'text' && layer.kind !== 'shape') throw new Error('This layer kind is not yet mapped. Render its complete composition in AE before transferring it.');
			if (layer.adjustment !== false || layer.blendMode !== 'normal') warnings.push('Adjustment or blend intent is not mapped; render the complete original composition for visual fidelity.');
			const inPoint = number(layer.inPoint, -10800, 10800), outPoint = number(layer.outPoint, -10800, 10800), stretch = number(layer.stretch, -9900, 9900);
			if (outPoint < inPoint || Math.abs(stretch) < 1) throw new Error('AE import layer timing is invalid.');
			const textDocument = layer.kind === 'text' ? readMotionAeImportText(layer.properties, warnings, budget) : null;
			if (layer.kind === 'text' && !textDocument) throw new Error('AE text layer requires reviewed Source Text; render the original composition when it cannot be captured.');
			layers.push({ shapes: layer.kind === 'shape' ? readMotionAeImportShapes(layer.properties, warnings, budget, numericProperty) : null, text: textDocument, id: id(layer.id), name: text(layer.name), kind: layer.kind, sourceId: layer.sourceId === null ? null : id(layer.sourceId), parentId: layer.parentId === null ? null : id(layer.parentId),
				startTime: number(layer.startTime, -10800, 10800), inPoint, outPoint, stretch, enabled: boolean(layer.enabled), threeD: boolean(layer.threeD), matte: matte(layer.matte), properties: properties(layer.properties, warnings, budget), masks: readMotionAeImportMasks(layer.properties, warnings, budget, numericProperty) });
		}
		const width = number(comp.width, 4, 30_000), height = number(comp.height, 4, 30_000);
		if (width !== Math.floor(width) || height !== Math.floor(height)) throw new Error('AE import dimensions must be integral.');
		const background = vector(comp.background, 3); for (let channel = 0; channel < 3; channel++) number(background[channel], 0, 1);
		compositions.push({ id: id(comp.id), name: text(comp.name), width, height, pixelAspect: number(comp.pixelAspect, 0.01, 100), frameRate: number(comp.frameRate, 1, 99),
			duration: number(comp.duration, 0.000001, 10800), displayStartTime: number(comp.displayStartTime, -1e6, 1e6), background, layers });
	}
	if (!compositions.length) throw new Error('AE import has no compositions.');
	const color = record(input.color), bits = number(color.bitsPerChannel, 8, 32); if (bits !== 8 && bits !== 16 && bits !== 32) throw new Error('AE color depth is unsupported.');
	const reports = array(input.report, 65_536);
	for (let index = 0; index < reports.length; index++) if (record(reports[index]).status === 'unsupported') { warnings.push('The source exchange contains unsupported content. Review its original transfer report and compare reference frames.'); break; }
	if (muteAudio) warnings.push('This Motion-authored editable subset is video-only. Imported footage and nested composition layers will be muted; original audio is preserved in original.mscape.');
	const plan = { muteAudio, transferId: id(input.transferId), footage, compositions, warnings, color: { workingSpace: text(color.workingSpace, 256), linearBlending: boolean(color.linearBlending), bitsPerChannel: bits } };
	verifyGraph(plan); return plan;
}
