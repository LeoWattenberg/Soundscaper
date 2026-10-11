/* SPDX-License-Identifier: AGPL-3.0-only */
import { renderMotionAeInstalledComposition, type MotionAeOwnedRenderEntry } from './motion-ae-installed-render.ts';
import { exportMotionAeHostProject, type MotionAeExportHost, type MotionAeExportTransaction } from './motion-ae-host-export.ts';
import { readMotionAeHostProperty, type MotionAePropertyHost, type MotionAePropertyReadHost } from './motion-ae-host-property.ts';
import type { MotionAeComposition, MotionAeFootage, MotionAeLayer, MotionAeProperty, MotionAeReportEntry, MotionAeText } from './motion-ae-exchange-types.ts';

interface AeFile {
	readonly name: string; readonly fsName: string; readonly exists: boolean; readonly length: number;
	encoding: string; open(mode: string): boolean; write(text: string): boolean; close(): boolean;
	copy(destination: string): boolean; remove(): boolean; rename(name: string): boolean;
}
interface AeFolder { readonly fsName: string; readonly exists: boolean; create(): boolean; remove(): boolean }
interface AeItem {
	readonly id: number; readonly name: string; readonly width: number; readonly height: number; readonly pixelAspect: number;
	readonly frameRate: number; readonly duration: number; readonly hasVideo: boolean; readonly hasAudio: boolean;
	readonly file: AeFile | null; readonly mainSource?: { readonly isStill: boolean };
}
interface AeLayer {
	readonly index: number; readonly name: string; readonly parent: AeLayer | null; readonly source?: AeItem;
	readonly startTime: number; readonly inPoint: number; readonly outPoint: number; readonly stretch: number;
	readonly enabled: boolean; readonly threeDLayer?: boolean; readonly adjustmentLayer?: boolean; readonly nullLayer?: boolean;
	readonly blendingMode?: unknown; readonly trackMatteType?: unknown; readonly trackMatteLayer?: AeLayer | null;
	property(name: string): MotionAePropertyHost | null;
}
interface AeComposition extends AeItem {
	readonly numLayers: number; readonly displayStartTime: number; readonly bgColor: readonly [number, number, number]; layer(index: number): AeLayer;
}
interface AeProject {
	readonly activeItem?: AeItem | null; readonly numItems: number; readonly file: AeFile | null; readonly workingSpace: string; readonly linearBlending: boolean; readonly bitsPerChannel: 8 | 16 | 32;
	item(index: number): AeItem;
}
interface AeTextDocument extends MotionAeText { readonly justification: never }
declare const app: { readonly version: string; readonly project: AeProject | null };
declare const File: { new(path: string): AeFile };
declare const Folder: { new(path: string): AeFolder; selectDialog(prompt: string): AeFolder | null };
declare const CompItem: { new(): AeComposition };
declare const FootageItem: { new(): AeItem };
declare const CameraLayer: { new(): AeLayer & { readonly cameraLayerBrand: true } };
declare const LightLayer: { new(): AeLayer & { readonly lightLayerBrand: true } };
declare const TextLayer: { new(): AeLayer & { readonly textLayerBrand: true } };
declare const ShapeLayer: { new(): AeLayer & { readonly shapeLayerBrand: true } };
declare const PropertyType: { PROPERTY: unknown };
declare const PropertyValueType: { OneD: unknown; TwoD: unknown; ThreeD: unknown; TwoD_SPATIAL: unknown; ThreeD_SPATIAL: unknown; COLOR: unknown; SHAPE: unknown; TEXT_DOCUMENT: unknown };
declare const KeyframeInterpolationType: { HOLD: unknown; LINEAR: unknown; BEZIER: unknown };
declare const ParagraphJustification: { LEFT_JUSTIFY: unknown; CENTER_JUSTIFY: unknown; RIGHT_JUSTIFY: unknown };
declare const BlendingMode: Record<string, unknown>;
declare const TrackMatteType: { NO_TRACK_MATTE: unknown; ALPHA: unknown; ALPHA_INVERTED: unknown; LUMA: unknown; LUMA_INVERTED: unknown };
declare function alert(message: string): void;
declare function confirm(message: string): boolean;

function propertyHost(sampling?: Readonly<{ frameRate: number; duration: number }>): MotionAePropertyReadHost {
	return {
		sampling,
		checkCancelled: () => {}, // AE's Escape interruption unwinds the running script; no event-pump globals are modified.
		kind: (property) => {
			if (property.propertyType !== PropertyType.PROPERTY) return 'group';
			const type = property.propertyValueType;
			if (type === PropertyValueType.SHAPE) return 'shape'; if (type === PropertyValueType.TEXT_DOCUMENT) return 'text';
			if (type === PropertyValueType.OneD || type === PropertyValueType.TwoD || type === PropertyValueType.ThreeD || type === PropertyValueType.TwoD_SPATIAL || type === PropertyValueType.ThreeD_SPATIAL || type === PropertyValueType.COLOR) return 'numeric';
			return 'unsupported';
		},
		interpolation: (value) => { if (value === KeyframeInterpolationType.HOLD) return 'hold'; if (value === KeyframeInterpolationType.LINEAR) return 'linear'; if (value === KeyframeInterpolationType.BEZIER) return 'bezier'; throw new Error('Unsupported AE interpolation.'); },
		text: (value) => {
			const text = value as AeTextDocument;
			if (text.justification !== ParagraphJustification.LEFT_JUSTIFY && text.justification !== ParagraphJustification.CENTER_JUSTIFY && text.justification !== ParagraphJustification.RIGHT_JUSTIFY) throw new Error('This paragraph alignment needs an explicit text mapping.');
			return { text: text.text, font: text.font, fontSize: text.fontSize, fillColor: [text.fillColor[0], text.fillColor[1], text.fillColor[2]], applyFill: text.applyFill,
				applyStroke: text.applyStroke, strokeColor: [text.strokeColor[0], text.strokeColor[1], text.strokeColor[2]], strokeWidth: text.strokeWidth, tracking: text.tracking,
				leading: text.leading, autoLeading: text.autoLeading, justification: text.justification === ParagraphJustification.CENTER_JUSTIFY ? 'center' : text.justification === ParagraphJustification.RIGHT_JUSTIFY ? 'right' : 'left' };
		},
	};
}
function layerKind(layer: AeLayer): MotionAeLayer['kind'] {
	if (layer instanceof CameraLayer) return 'camera'; if (layer instanceof LightLayer) return 'light';
	if (layer instanceof TextLayer) return 'text'; if (layer instanceof ShapeLayer) return 'shape'; if (layer.nullLayer) return 'null';
	if (layer.source instanceof CompItem) return 'composition'; if (layer.source?.file) return 'footage'; return 'solid';
}
function blendMode(value: unknown): string {
	const names = ['NORMAL', 'MULTIPLY', 'SCREEN', 'OVERLAY', 'ADD', 'DARKEN', 'LIGHTEN', 'DIFFERENCE', 'EXCLUSION'];
	for (let i = 0; i < names.length; i++) if (BlendingMode[names[i]!] === value) return names[i]!.toLowerCase(); return 'unsupported';
}
function readComposition(comp: AeComposition, report: MotionAeReportEntry[], budget: { properties: number; keys: number; layers: number }, sampled: boolean): MotionAeComposition {
	const id = 'comp-' + String(comp.id), layers: MotionAeLayer[] = [], reader = propertyHost(sampled ? { frameRate: comp.frameRate, duration: comp.duration } : undefined);
	const roots = ['ADBE Transform Group', 'ADBE Mask Parade', 'ADBE Effect Parade', 'ADBE Root Vectors Group', 'ADBE Text Properties', 'ADBE Camera Options Group', 'ADBE Light Options Group', 'ADBE Material Options Group', 'ADBE Audio Group', 'ADBE Time Remapping'];
	budget.layers += comp.numLayers; if (budget.layers > 4096) throw new Error('AE bridge layer budget exceeded.');
	for (let index = 1; index <= comp.numLayers; index++) {
		const source = comp.layer(index), layerId = id + '-layer-' + String(index), kind = layerKind(source), properties: MotionAeProperty[] = [];
		for (let root = 0; root < roots.length; root++) {
			const property = source.property(roots[root]!); if (!property) continue;
			const path = String(properties.length) + ':' + property.matchName;
			try { properties.push(readMotionAeHostProperty(property, reader, layerId, path, report, budget)); }
			catch (error) {
				if (String(error).indexOf('budget') >= 0) throw error;
				const reason = 'Property could not be captured: ' + String(error);
				properties.push({ kind: 'unsupported', matchName: property.matchName, name: property.name, reason });
				report.push({ scopeId: layerId, propertyPath: path, status: 'unsupported', code: 'property', message: reason });
			}
		}
		let matte: MotionAeLayer['matte'] = null;
		if (source.trackMatteType !== undefined && source.trackMatteType !== TrackMatteType.NO_TRACK_MATTE) {
			const target = source.trackMatteLayer;
			if (target) matte = { layerId: id + '-layer-' + String(target.index), type: source.trackMatteType === TrackMatteType.ALPHA ? 'alpha' : source.trackMatteType === TrackMatteType.ALPHA_INVERTED ? 'alpha-inverted' : source.trackMatteType === TrackMatteType.LUMA ? 'luma' : 'luma-inverted' };
			else report.push({ scopeId: layerId, propertyPath: '', status: 'unsupported', code: 'matte', message: 'This AE version does not expose the matte source. Use AE 23 or newer, or render the composition.' });
		}
		layers.push({ id: layerId, name: source.name, kind, sourceId: kind === 'composition' ? 'comp-' + String(source.source!.id) : kind === 'footage' ? 'footage-' + String(source.source!.id) : null,
			parentId: source.parent ? id + '-layer-' + String(source.parent.index) : null, matte,
			startTime: source.startTime, inPoint: source.inPoint, outPoint: source.outPoint, stretch: source.stretch,
			enabled: source.enabled, threeD: source.threeDLayer === true || kind === 'camera' || kind === 'light', adjustment: source.adjustmentLayer === true,
			blendMode: source.blendingMode === undefined ? 'normal' : blendMode(source.blendingMode), properties });
		report.push({ scopeId: layerId, propertyPath: '', status: 'unsupported', code: 'mapping', message: 'Captured authored data requires feature mapping and reference comparison; plug-ins, text runs, mask attributes, solids, footage interpretation and expressions may require an AE-rendered composition.' });
	}
	return { id, name: comp.name, width: comp.width, height: comp.height, pixelAspect: comp.pixelAspect, frameRate: comp.frameRate,
		duration: comp.duration, displayStartTime: comp.displayStartTime, background: [comp.bgColor[0], comp.bgColor[1], comp.bgColor[2]], layers };
}
function transaction(parent: AeFolder, transferId: string, sourceFiles: Record<string, AeFile>, renderedComposition?: AeComposition): MotionAeExportTransaction {
	const directory = new Folder(parent.fsName + '/' + transferId), media = new Folder(directory.fsName + '/media'), created: MotionAeOwnedRenderEntry[] = [];
	if (directory.exists) throw new Error('The transfer folder already exists. Choose another destination.');
	if (!directory.create()) throw new Error('The transfer folder could not be created. Enable script file access in AE preferences if needed.');
	if (!media.create()) { if (!directory.remove()) throw new Error('Could not create media folder or remove the empty transfer folder.'); throw new Error('Could not create media folder.'); }
	return {
		render: renderedComposition ? (compositions) => {
			let source: MotionAeComposition | undefined;
			for (let index = 0; index < compositions.length; index++) if (compositions[index]!.id === 'comp-' + String(renderedComposition.id)) source = compositions[index];
			if (!source) throw new Error('The active composition is absent from the captured exchange.');
			return renderMotionAeInstalledComposition(source, renderedComposition, media.fsName, (entry) => { created.push(entry); });
		} : undefined,
		copyMedia: (item) => {
			if (!item.path || !/^media\/[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,12}$/.test(item.path)) throw new Error('Unsafe bridge media path.');
			const source = sourceFiles[item.id], destination = new File(directory.fsName + '/' + item.path);
			if (!source || !source.exists || source.length !== item.byteLength || destination.exists) throw new Error('Source media changed or destination already exists.');
			created.push(destination);
			if (!source.copy(destination.fsName) || destination.length !== item.byteLength || source.length !== item.byteLength) throw new Error('Media copy failed or its byte length changed.');
		},
		publish: (manifest) => {
			const file = new File(directory.fsName + '/motionae.json.part'), final = new File(directory.fsName + '/motionae.json');
			if (file.exists || final.exists) throw new Error('Manifest destination already exists.'); created.push(file); file.encoding = 'UTF-8';
			if (!file.open('w')) throw new Error('Cannot open transfer manifest.');
			let written: boolean;
			try { written = file.write(manifest); } catch (error) {
				if (!file.close()) { const failure = new Error('Manifest write failed and its file could not close: ' + String(error), { cause: error }); failure.cause = error; throw failure; }
				throw error;
			}
			if (!file.close()) throw new Error('Cannot close transfer manifest.');
			if (!written || !file.rename('motionae.json')) throw new Error('Cannot publish transfer manifest.');
		},
		rollback: () => {
			let failed = false; for (let index = created.length - 1; index >= 0; index--) if (created[index]!.exists && !created[index]!.remove()) failed = true;
			if (!media.remove()) failed = true; if (!directory.remove()) failed = true;
			if (failed) throw new Error('Some files in the new transfer folder could not be removed. Original source files were not changed.');
		},
	};
}
/** Entry point for the readable installed-AE JSX. It never saves, imports, or modifies the source project. */
export function runMotionAeInstalledExport(sampled = false, rendered = false): void {
	try {
		const project = app.project; if (!project) throw new Error('Open the source project in After Effects first.');
		if (sampled && rendered) throw new Error('Choose numeric sampling or whole-composition rendering separately.');
		const active = rendered ? project.activeItem : undefined;
		if (rendered && !(active instanceof CompItem)) throw new Error('Select the complete composition to render in After Effects first.');
		if (rendered && !confirm('Render the complete active composition into a new 8-bit PNG sequence? Choose your installed full-size RGB+Alpha PNG template. This staged carrier accepts at most 256 frames and no audio. Alpha/color and installed-AE behavior remain unqualified. The native render call blocks; use AE cancellation controls, whose Escape behavior is unqualified. Existing queue items must be removed by you first. Original project and media files are never overwritten.')) return;
		if (sampled && !confirm('Evaluate existing numeric expressions and animated numeric properties in After Effects at each composition frame? This keeps original keys and expression text, but frame samples do not preserve subframe motion or motion blur. At most 4096 samples per property are allowed. Native expression calls may take time and cannot be interrupted by the bridge between calls.')) return;
		const parent = Folder.selectDialog('Choose a parent folder for a new Motionscaper exchange package.'); if (!parent) return;
		const transferId = 'motion-transfer-' + String(new Date().getTime()), sourceFiles: Record<string, AeFile> = {}, budget = { properties: 0, keys: 0, layers: 0 };
		const host: MotionAeExportHost = { version: app.version, projectName: project.file?.name ?? 'Untitled.aep',
			color: { workingSpace: project.workingSpace, linearBlending: project.linearBlending, bitsPerChannel: project.bitsPerChannel }, checkCancelled: () => {},
			begin: (id) => transaction(parent, id, sourceFiles, active instanceof CompItem ? active : undefined),
			compositions: (report) => {
				const result: MotionAeComposition[] = [];
				if (project.numItems > 8192) throw new Error('AE project item budget exceeded.');
				for (let index = 1; index <= project.numItems; index++) {
					const item = project.item(index); if (item instanceof CompItem) { if (result.length >= 256) throw new Error('AE composition budget exceeded.'); result.push(readComposition(item, report, budget, sampled)); }
				}
				if (!result.length) throw new Error('The project has no compositions.'); return result;
			},
			footage: (report) => {
				const result: MotionAeFootage[] = [];
				for (let index = 1; index <= project.numItems; index++) {
					const item = project.item(index); if (!(item instanceof FootageItem) || !item.file) continue;
					if (result.length >= 4096) throw new Error('AE footage budget exceeded.');
					const id = 'footage-' + String(item.id), extension = /\.([A-Za-z0-9]{1,12})$/.exec(item.file.name);
					const sequence = item.mainSource?.isStill !== true && extension !== null && /^(png|jpe?g|tiff?|bmp|dpx|exr|psd|tga)$/i.test(extension[1]!);
					const exists = item.file.exists && extension !== null && !sequence;
					if (exists) sourceFiles[id] = item.file; else report.push({ scopeId: id, propertyPath: '', status: 'unsupported', code: 'missing-media', message: sequence ? 'Original image-sequence footage requires collection of every source frame. This bridge cannot preserve it by copying only its first image. Retain and explicitly convert the original sequence before transferring.' : 'Relink this source or give it a portable file extension, then export again.' });
					result.push({ id, name: item.name, path: exists ? 'media/' + id + '.' + extension![1]!.toLowerCase() : null, byteLength: exists ? item.file.length : null, sha256: null,
						width: item.width, height: item.height, pixelAspect: item.pixelAspect, frameRate: item.frameRate, duration: item.duration, hasVideo: item.hasVideo, hasAudio: item.hasAudio, still: item.mainSource?.isStill === true });
				} return result;
			},
		};
		exportMotionAeHostProject(host, transferId); alert('Exchange written to ' + parent.fsName + '/' + transferId + '. Review motionae.json reports. This development bridge is not yet qualified in installed AE.');
	} catch (error) { alert('Motionscaper transfer did not complete: ' + String(error)); }
}
