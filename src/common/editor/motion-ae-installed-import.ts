/* SPDX-License-Identifier: AGPL-3.0-only */
import { applyMotionAeHostShapes } from './motion-ae-host-apply-shape.ts';
import { chooseMotionAeShapeProfile } from './motion-ae-installed-shape-profile.ts';
import type { MotionAeShapeProfile } from './motion-ae-host-shape-profile.ts';
import { applyMotionAeInstalledText, verifyMotionAeInstalledTextFont } from './motion-ae-installed-text.ts';
import { prepareMotionAeHostImport, type MotionAeImportFootage, type MotionAeImportNumeric, type MotionAeImportPlan } from './motion-ae-host-import-plan.ts';
import { importMotionAeHostPlan, type MotionAeImportHost, type MotionAeImportTransaction } from './motion-ae-host-import.ts';
import { createMotionAeHostSha256 } from './motion-ae-host-sha256.ts';
import type { MotionAeShape } from './motion-ae-exchange-types.ts';
interface AeFolder { readonly fsName: string; readonly alias: boolean }
interface AeFile { readonly exists: boolean; readonly length: number; readonly alias: boolean; readonly fsName: string; readonly parent: AeFolder; encoding: string; open(mode: string): boolean; read(count?: number): string; close(): boolean }
interface AeItem { name: string; parentFolder: AeItem; remove(): void }
interface AeProperty {
	readonly canSetExpression: boolean; expression: string; expressionEnabled: boolean; readonly expressionError: string; valueAtTime(time: number, preExpression: boolean): unknown;
	readonly value: unknown; readonly numKeys: number; readonly numProperties: number; readonly propertyIndex: number; readonly canSetEnabled: boolean; enabled: boolean; property(name: string | number): AeProperty;
	name: string; addProperty(name: string): AeProperty; maskMode: unknown; inverted: boolean; rotoBezier: boolean; maskFeatherFalloff: unknown; maskMotionBlur: unknown;
	setValue(value: unknown): void; setValueAtTime(time: number, value: unknown): void;
	setInterpolationTypeAtKey(index: number, incoming: unknown, outgoing: unknown): void;
	setTemporalEaseAtKey(index: number, incoming: readonly unknown[], outgoing: readonly unknown[]): void;
	setTemporalAutoBezierAtKey(index: number, value: boolean): void; setTemporalContinuousAtKey(index: number, value: boolean): void;
	setSpatialAutoBezierAtKey(index: number, value: boolean): void; setSpatialContinuousAtKey(index: number, value: boolean): void;
	setSpatialTangentsAtKey(index: number, incoming: readonly number[], outgoing: readonly number[]): void; setRovingAtKey(index: number, value: boolean): void;
}
interface AeLayer {
	name: string; enabled: boolean; audioEnabled: boolean; threeDLayer: boolean; startTime: number; inPoint: number; outPoint: number; stretch: number;
	setParentWithJump(parent: AeLayer): void; property(name: string): AeProperty;
	setTrackMatte?(source: AeLayer, type: unknown): void;
}
interface AeComposition extends AeItem { displayStartTime: number; bgColor: readonly number[]; readonly layers: { addShape(): AeLayer; add(item: AeItem): AeLayer; addNull(duration: number): AeLayer; addBoxText(size: readonly number[], text: string): AeLayer } }
interface AeProject {
	readonly workingSpace: string; readonly linearBlending: boolean; readonly bitsPerChannel: number;
	readonly items: { addFolder(name: string): AeItem; addComp(name: string, width: number, height: number, aspect: number, duration: number, frameRate: number): AeComposition };
	importFile(options: { file: AeFile; sequence: boolean; importAs: unknown }): AeItem;
}
declare const app: { readonly version: string; readonly project: AeProject | null; beginUndoGroup(name: string): void; endUndoGroup(): void };
declare const File: { new(path: string): AeFile; openDialog(prompt: string): AeFile | null };
declare const Folder: { new(path: string): AeFolder };
declare const ImportOptions: { new(file: AeFile): { file: AeFile; sequence: boolean; importAs: unknown } };
declare const ImportAsType: { FOOTAGE: unknown };
declare const KeyframeInterpolationType: { HOLD: unknown; LINEAR: unknown; BEZIER: unknown };
declare const KeyframeEase: { new(speed: number, influence: number): unknown };
declare const Shape: { new(): { closed: boolean; vertices: MotionAeShape['vertices']; inTangents: MotionAeShape['inTangents']; outTangents: MotionAeShape['outTangents'] } };
declare const MaskMode: Record<string, unknown>;
declare const MaskFeatherFalloff: { FFO_LINEAR: unknown; FFO_SMOOTH: unknown };
declare const MaskMotionBlur: { SAME_AS_LAYER: unknown; OFF: unknown };
declare const TrackMatteType: { ALPHA: unknown; ALPHA_INVERTED: unknown; LUMA: unknown; LUMA_INVERTED: unknown };
declare function alert(message: string): void;
declare function confirm(message: string): boolean;

function closeOnError(file: AeFile, error: unknown): never {
	if (!file.close()) { const failure = new Error('AE read failed and its file could not close: ' + String(error), { cause: error }); failure.cause = error; throw failure; } throw error;
}
function mediaFile(root: AeFolder, item: MotionAeImportFootage): AeFile {
	const file = new File(root.fsName + '/' + item.path), media = new Folder(root.fsName + '/media');
	if (root.alias || media.alias || file.alias || !file.exists || file.length !== item.byteLength) throw new Error('Media is missing, aliased, or its byte length changed: ' + item.name);
	return file;
}
function verifyMedia(root: AeFolder, items: readonly MotionAeImportFootage[]): void {
	for (let index = 0; index < items.length; index++) {
		const item = items[index]!, file = mediaFile(root, item); if (item.sha256 === null) continue;
		file.encoding = 'BINARY'; if (!file.open('r')) throw new Error('Cannot read retained media: ' + item.name);
		const digest = createMotionAeHostSha256(); let read = 0;
		try {
			while (read < item.byteLength) { const bytes = file.read(Math.min(1_048_576, item.byteLength - read)); if (!bytes.length) throw new Error('Media ended before its declared length.'); digest.update(bytes); read += bytes.length; }
			if (read !== item.byteLength || file.length !== item.byteLength || digest.finish() !== item.sha256) throw new Error('Media SHA-256 changed: ' + item.name);
		} catch (error) { closeOnError(file, error); }
		if (!file.close()) throw new Error('Cannot close retained media: ' + item.name);
	}
}
function applyExpression(target: AeProperty, source: string | null, probeTime: number): void {
	if (source === null) return; if (!target.canSetExpression) throw new Error('This AE target cannot accept the reviewed scalar expression.');
	target.expression = source; target.expressionEnabled = true;
	if (!target.expressionEnabled || target.expressionError) throw new Error('AE rejected the reviewed scalar expression: ' + target.expressionError);
	const value = target.valueAtTime(probeTime, false);
	if (target.expressionError || typeof value !== 'number' || !isFinite(value)) throw new Error('AE scalar expression probe failed or returned a nonfinite value: ' + target.expressionError);
}
function applyProperty(target: AeProperty, property: MotionAeImportNumeric, probeTime: number): void {
	if (target.numKeys !== 0) throw new Error('New AE layer unexpectedly contains authored keys.');
	const value = (input: readonly number[]) => input.length === 1 ? input[0]! : input;
	if (!property.keys.length) { target.setValue(value(property.value)); applyExpression(target, property.expression, probeTime); return; }
	for (let index = 0; index < property.keys.length; index++) { const key = property.keys[index]!; target.setValueAtTime(key.time, value(key.value)); }
	const interpolation = (mode: string) => mode === 'hold' ? KeyframeInterpolationType.HOLD : mode === 'linear' ? KeyframeInterpolationType.LINEAR : KeyframeInterpolationType.BEZIER;
	for (let index = 0; index < property.keys.length; index++) {
		const key = property.keys[index]!, position = index + 1;
		target.setInterpolationTypeAtKey(position, interpolation(key.inInterpolation), interpolation(key.outInterpolation));
		if (key.inInterpolation === 'bezier' || key.outInterpolation === 'bezier') {
			target.setTemporalAutoBezierAtKey(position, false); target.setTemporalContinuousAtKey(position, false);
			const incoming: unknown[] = [], outgoing: unknown[] = [];
			for (let component = 0; component < key.inEase.length; component++) incoming.push(new KeyframeEase(key.inEase[component]!.speed, key.inEase[component]!.influence));
			for (let component = 0; component < key.outEase.length; component++) outgoing.push(new KeyframeEase(key.outEase[component]!.speed, key.outEase[component]!.influence));
			target.setTemporalEaseAtKey(position, incoming, outgoing);
		}
		if (property.spatial) {
			target.setSpatialAutoBezierAtKey(position, false); target.setSpatialContinuousAtKey(position, false);
			target.setSpatialTangentsAtKey(position, key.inSpatialTangent!, key.outSpatialTangent!);
		}
	}
	if (property.spatial) for (let index = 1; index < property.keys.length - 1; index++) target.setRovingAtKey(index + 1, property.keys[index]!.roving);
	applyExpression(target, property.expression, probeTime);
}
function beginImport(project: AeProject, root: AeFolder, plan: MotionAeImportPlan, shapeProfile: MotionAeShapeProfile | null): MotionAeImportTransaction {
	app.beginUndoGroup('Import Motionscaper exchange'); let folder: AeItem;
	try { folder = project.items.addFolder('Motionscaper ' + plan.transferId); } catch (error) { app.endUndoGroup(); throw error; }
	const created: AeItem[] = [folder], items: Record<string, AeItem> = {}, comps: Record<string, AeComposition> = {}, layers: Record<string, AeLayer> = {}; let ended = false;
	return {
		footage: (item) => {
			const options = new ImportOptions(mediaFile(root, item)); options.sequence = false; options.importAs = ImportAsType.FOOTAGE;
			const imported = project.importFile(options); created.push(imported); imported.parentFolder = folder; imported.name = item.name; items[item.id] = imported;
		},
		composition: (item) => {
			const comp = project.items.addComp(item.name, item.width, item.height, item.pixelAspect, item.duration, item.frameRate); created.push(comp); comp.parentFolder = folder;
			comp.displayStartTime = item.displayStartTime; comp.bgColor = item.background; comps[item.id] = comp; items[item.id] = comp;
		},
		layer: (comp, item) => {
			const target = comps[comp.id]!, layer = item.shapes ? target.layers.addShape() : item.text ? target.layers.addBoxText(item.text.layout.size, item.text.text) : item.kind === 'null' ? target.layers.addNull(comp.duration) : target.layers.add(items[item.sourceId!]!);
			layers[item.id] = layer; layer.name = item.name; layer.threeDLayer = item.threeD; layer.stretch = item.stretch; layer.startTime = item.startTime;
			layer.inPoint = item.inPoint; layer.outPoint = item.outPoint; layer.enabled = item.enabled; if (plan.muteAudio) layer.audioEnabled = false;
		},
		parent: (item) => { layers[item.id]!.setParentWithJump(layers[item.parentId!]!); },
		properties: (item) => {
			if (item.shapes) {
				if (!shapeProfile) throw new Error('Choose a reviewed shape profile before creating editable shapes.');
				applyMotionAeHostShapes(layers[item.id]!.property('ADBE Root Vectors Group'), item.shapes, shapeProfile, { hold: KeyframeInterpolationType.HOLD, linear: KeyframeInterpolationType.LINEAR, shape: (input) => {
					const shape = new Shape(); shape.closed = input.closed; shape.vertices = input.vertices; shape.inTangents = input.inTangents; shape.outTangents = input.outTangents; return shape;
				} });
			}
			if (item.text) applyMotionAeInstalledText(layers[item.id]!.property('ADBE Text Properties').property('ADBE Text Document'), item.text);
			if (item.matte) {
				const target = layers[item.id]!, source = layers[item.matte.layerId]!;
				if (!target.setTrackMatte) throw new Error('This AE host does not provide setTrackMatte. Use AE 23 or newer or render the original composition.');
				const type = item.matte.type === 'alpha' ? TrackMatteType.ALPHA : item.matte.type === 'alpha-inverted' ? TrackMatteType.ALPHA_INVERTED : item.matte.type === 'luma' ? TrackMatteType.LUMA : TrackMatteType.LUMA_INVERTED;
				target.setTrackMatte(source, type);
			}
			const transform = layers[item.id]!.property('ADBE Transform Group');
			for (let index = 0; index < item.properties.length; index++) { const property = item.properties[index]!; applyProperty(transform.property(property.matchName), property, item.inPoint); }
			for (let index = 0; index < item.masks.length; index++) {
				const mask = item.masks[index]!, target = layers[item.id]!.property('ADBE Mask Parade').addProperty('ADBE Mask Atom');
				target.name = mask.name; target.maskMode = MaskMode[mask.metadata.mode.toUpperCase()]; target.inverted = mask.metadata.inverted; target.rotoBezier = false;
				target.maskFeatherFalloff = mask.metadata.featherFalloff === 'linear' ? MaskFeatherFalloff.FFO_LINEAR : MaskFeatherFalloff.FFO_SMOOTH;
				target.maskMotionBlur = mask.metadata.motionBlur === 'off' ? MaskMotionBlur.OFF : MaskMotionBlur.SAME_AS_LAYER;
				const path = target.property('ADBE Mask Shape'), value = (input: MotionAeShape) => { const shape = new Shape(); shape.closed = input.closed; shape.vertices = input.vertices; shape.inTangents = input.inTangents; shape.outTangents = input.outTangents; return shape; };
				if (path.numKeys !== 0) throw new Error('New AE mask unexpectedly has authored keys.');
				if (!mask.path.keys.length) path.setValue(value(mask.path.value));
				for (let key = 0; key < mask.path.keys.length; key++) path.setValueAtTime(mask.path.keys[key]!.time, value(mask.path.keys[key]!.value));
				for (let key = 0; key < mask.path.keys.length; key++) path.setInterpolationTypeAtKey(key + 1, mask.path.keys[key]!.inInterpolation === 'hold' ? KeyframeInterpolationType.HOLD : KeyframeInterpolationType.LINEAR, mask.path.keys[key]!.outInterpolation === 'hold' ? KeyframeInterpolationType.HOLD : KeyframeInterpolationType.LINEAR);
				applyProperty(target.property('ADBE Mask Opacity'), mask.opacity, item.inPoint); target.property('ADBE Mask Feather').setValue([0, 0]); target.property('ADBE Mask Offset').setValue(0);
			}
		},
		finish: () => {
			// Host matte assignment can change source switches. Restore the explicit exchange visibility after all bindings.
			for (let comp = 0; comp < plan.compositions.length; comp++) for (let index = 0; index < plan.compositions[comp]!.layers.length; index++) {
				const item = plan.compositions[comp]!.layers[index]!; layers[item.id]!.enabled = item.enabled;
			}
			app.endUndoGroup(); ended = true;
		},
		rollback: () => {
			const failures: string[] = [];
			for (let index = created.length - 1; index >= 0; index--) try { created[index]!.remove(); } catch (error) { failures.push(String(error)); }
			if (!ended) { try { app.endUndoGroup(); } catch (error) { failures.push(String(error)); } ended = true; }
			if (failures.length) throw new Error('Created-object cleanup failed: ' + failures.join('; '));
		},
	};
}
/** Import into new AE items. The original project file, existing objects and media are never saved or overwritten. */
export function runMotionAeInstalledImport(): void {
	try {
		const project = app.project; if (!project) throw new Error('Open a destination project in After Effects first.');
		const file = File.openDialog('Choose motionae.json from a Motionscaper exchange package.'); if (!file) return;
		if (file.alias || file.length > 16_777_216) throw new Error('Exchange manifest is aliased or exceeds its byte budget.');
		file.encoding = 'UTF-8'; if (!file.open('r')) throw new Error('Cannot read the exchange manifest.'); let json: string;
		try { json = file.read(); } catch (error) { closeOnError(file, error); } if (!file.close()) throw new Error('Cannot close exchange manifest.');
		const plan = prepareMotionAeHostImport(json); let needsShapes = false, hasExpressions = false;
		for (let comp = 0; comp < plan.compositions.length; comp++) for (let index = 0; index < plan.compositions[comp]!.layers.length; index++) {
			const layer = plan.compositions[comp]!.layers[index]!;
			for (let property = 0; property < layer.properties.length; property++) if (layer.properties[property]!.expression !== null) hasExpressions = true;
			for (let mask = 0; mask < layer.masks.length; mask++) if (layer.masks[mask]!.opacity.expression !== null) hasExpressions = true;
			if (plan.compositions[comp]!.layers[index]!.shapes) needsShapes = true;
			const text = plan.compositions[comp]!.layers[index]!.text; if (text) verifyMotionAeInstalledTextFont(text.font);
			if (plan.compositions[comp]!.layers[index]!.matte && !(parseFloat(app.version) >= 23)) throw new Error('Editable track mattes require After Effects 23 or newer. Use rendered fallback on older hosts.');
		}
		const shapeProfile = needsShapes ? chooseMotionAeShapeProfile() : null; if (needsShapes && !shapeProfile) return;
		if (project.workingSpace !== plan.color.workingSpace || project.linearBlending !== plan.color.linearBlending || project.bitsPerChannel !== plan.color.bitsPerChannel) throw new Error('Open a separate AE project with matching working space, linear blending and bit depth. This script does not change existing project color settings.');
		let warning = 'This development bridge has no installed-AE qualification. It creates new items and never saves the original project. Compare the result before using it.';
		if (hasExpressions) warning += '\n\nThis package activates validated scalar Math/time/value expressions. Each target receives one evaluation probe at its layer in-point. This is not proof for every frame or subframe; compare the animation and retain the original.';
		for (let index = 0; index < Math.min(plan.warnings.length, 8); index++) warning += '\n\n' + plan.warnings[index];
		if (plan.warnings.length > 8) warning += '\n\nAdditional warnings: ' + String(plan.warnings.length - 8);
		if (!confirm(warning + '\n\nCreate this separate imported folder?')) return;
		const host: MotionAeImportHost = { checkCancelled: () => {}, verifyMedia: (items) => verifyMedia(file.parent, items), begin: (input) => beginImport(project, file.parent, input, shapeProfile) };
		importMotionAeHostPlan(plan, host); alert('Exchange imported into a new Motionscaper folder. Original files were not saved. Review unsupported content and compare reference frames; actual AE qualification remains pending.');
	} catch (error) { alert('Motionscaper import did not complete: ' + String(error)); }
}
