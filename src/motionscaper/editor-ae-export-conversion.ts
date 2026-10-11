/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAsset } from '../common/editor/motion-asset.ts';
import type { MotionComposition, MotionLayer } from '../common/editor/motion-composition.ts';
import type { MotionAeExchange, MotionAeLayer, MotionAeProperty, MotionAeReportEntry } from '../common/editor/motion-ae-exchange-types.ts';
import { normalizeMotionAeExchange } from '../common/editor/motion-ae-exchange.ts';
import { exportMotionAeNumeric } from '../common/editor/motion-ae-export-property.ts';
import { exportMotionAeMasks } from '../common/editor/motion-ae-mask-conversion.ts';
import { exportMotionAeMattes } from '../common/editor/motion-ae-matte-conversion.ts';
import { freezeMotionValue } from '../common/editor/motion-values.ts';
import { createMotionscaperRevision, type MotionscaperRevision } from './editor-project-revision.ts';
import type { Rational } from '../common/editor/timeline-time.ts';

export interface PreparedMotionscaperAeExport {
	readonly revision: MotionscaperRevision; readonly exchange: MotionAeExchange;
	readonly media: readonly { readonly path: string; readonly asset: MotionAsset }[];
}
const preparedExports = new WeakSet<PreparedMotionscaperAeExport>();
export function assertPreparedMotionscaperAeExport(value: PreparedMotionscaperAeExport): void {
	if (!preparedExports.has(value)) throw new TypeError('Review a Motion AE export before packaging it.');
}
const number = (value: Rational) => value.num / value.den;
const extensions: Readonly<Record<string, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/tiff': 'tiff', 'image/exr': 'exr',
	'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-matroska': 'mkv', 'video/x-msvideo': 'avi' };
function flat(layer: MotionLayer): boolean {
	const { anchor, position, scale, rotation } = layer.transform;
	return !layer.is3D && anchor.value[2] === 0 && !anchor.curves[2] && position.value[2] === 0 && !position.curves[2]
		&& scale.value[2] === 1 && !scale.curves[2] && rotation.value[0] === 0 && rotation.value[1] === 0 && !rotation.curves[0] && !rotation.curves[1];
}
function transform(layer: MotionLayer, id: string, comp: MotionComposition, report: MotionAeReportEntry[]): readonly MotionAeProperty[] {
	const definitions = [
		{ field: 'anchor', matchName: 'ADBE Anchor Point', name: 'Anchor Point', axes: [0, 1], scale: 1, spatial: true },
		{ field: 'position', matchName: 'ADBE Position', name: 'Position', axes: [0, 1], scale: 1, spatial: true },
		{ field: 'scale', matchName: 'ADBE Scale', name: 'Scale', axes: [0, 1], scale: 100, spatial: false },
		{ field: 'rotation', matchName: 'ADBE Rotate Z', name: 'Rotation', axes: [2], scale: 1, spatial: false },
		{ field: 'opacity', matchName: 'ADBE Opacity', name: 'Opacity', axes: [0], scale: 100, spatial: false },
	] as const;
	return [{ kind: 'group', matchName: 'ADBE Transform Group', name: 'Transform', children: definitions.map((definition, index) => {
		const converted = exportMotionAeNumeric(layer.transform[definition.field], { ...definition, rate: number(comp.frameRate), startFrame: layer.startFrame });
		const propertyPath = `0:ADBE Transform Group/${String(index)}:${definition.matchName}`;
		report.push({ scopeId: id, propertyPath, status: converted.unsupported ? 'unsupported' : 'editable', code: 'curve-mapping',
			message: converted.unsupported ?? 'Numeric units and admitted transform keys are structurally mapped. Installed AE interpolation qualification remains pending.' });
		if (converted.property.expression?.enabled) report.push({ scopeId: id, propertyPath, status: 'unsupported', code: 'expression', message: 'Motion expression text is inert and is not activated in After Effects. Authored intent remains in original.mscape.' });
		return converted.property;
	}) }];
}
/** Immutable, deterministic partial transfer. The companion archive must retain this exact source revision. */
export function prepareMotionscaperAeExport(input: unknown): PreparedMotionscaperAeExport {
	const revision = createMotionscaperRevision(input), project = revision.project, transferId = `motion-${revision.digest}`;
	for (const comp of project.compositions) {
		const rate = number(comp.frameRate);
		if (comp.width < 4 || comp.height < 4 || comp.width > 30000 || comp.height > 30000 || rate < 1 || rate > 99 || comp.durationFrames / rate > 10800) {
			throw new RangeError('AE editable composition export requires dimensions 4–30000, frame rate 1–99 and duration at most three hours. Keep a full .mscape copy or prepare a composition within these documented host limits.');
		}
	}
	const report: MotionAeReportEntry[] = [];
	const add = (scopeId: string, code: string, message: string, propertyPath = '') => report.push({ scopeId, propertyPath, status: 'unsupported', code, message });
	add(transferId, 'qualification', 'Development bridge: installed After Effects reimport, color/alpha, source interpretation and reference-frame qualification remain unverified. Inspect every transferred composition before use.');
	add(transferId, 'audio-policy', 'This editable export is video-only. The importer mutes all exported layers, including nested compositions. All original audio and authored intent remain in original.mscape.');
	add(transferId, 'color-profile', 'Open a separate AE destination project with working space None, linear blending enabled and 32 bits per channel. This is an explicit bridge staging profile, not a claim of color or alpha fidelity.');
	const compIds = new Map(project.compositions.map((comp, index) => [comp.id, `composition-${String(index)}`]));
	const media: { path: string; asset: MotionAsset }[] = [], mediaIds = new Map<string, string>();
	const footage: MotionAeExchange['footage'][number][] = [];
	for (const asset of project.assets) {
		const ext = extensions[asset.mimeType];
		if ((asset.kind !== 'image' && asset.kind !== 'footage') || !ext || asset.width > 32768 || asset.height > 32768) {
			add(transferId, 'asset-custody', `Asset “${asset.name}” is preserved only in original.mscape; its type or dimensions are outside this AE editable subset.`, `assets/${asset.id}`); continue;
		}
		const id = `media-${String(media.length)}`, path = `media/${id}.${ext}`; mediaIds.set(asset.id, id); media.push({ path, asset });
		footage.push({ id, name: asset.name, path, byteLength: asset.byteLength, sha256: asset.sha256, width: asset.width, height: asset.height, pixelAspect: 1,
			frameRate: asset.kind === 'image' ? 1 : number(asset.frameRate), duration: asset.kind === 'image' ? 0 : number(asset.duration), hasVideo: true,
			hasAudio: asset.kind === 'footage' && asset.hasAudio, still: asset.kind === 'image' });
	}
	let serial = 0;
	const compositions = project.compositions.map(comp => {
		const id = compIds.get(comp.id)!, layerIds = new Map(comp.layers.map(layer => [layer.id, `layer-${String(serial++)}`]));
		if (comp.temporal || comp.depthOfFieldSamples !== undefined) add(id, 'temporal-render', 'Motion shutter sampling and depth of field are not mapped. Render the original composition when those features affect appearance.');
		if (comp.background.some(value => value !== 0)) add(id, 'background', 'Motion background color and alpha are retained in original.mscape; AE composition background has different rendering semantics.');
		if (comp.audio.length) add(id, 'audio-placements', 'Authored audio placements are retained only in original.mscape. The editable AE subset is muted.');
		if (comp.tracking?.length || comp.trackingApplications?.length) add(id, 'tracking-custody', 'Tracking analysis and application authority stay in original.mscape; mapped transform curves do not carry analysis authority.');
		const layers: MotionAeLayer[] = comp.layers.map(layer => {
			const layerId = layerIds.get(layer.id)!; let kind: MotionAeLayer['kind'] = 'null', sourceId: string | null = null, enabled = layer.enabled;
			const scale = number(layer.timeScale), validTiming = scale > 0 && 100 / scale >= 1 && 100 / scale <= 9900 && !layer.timeRemap;
			if (!flat(layer)) { enabled = false; add(layerId, '3d', 'This layer uses 3D or nonplanar transform channels and becomes a disabled named null. Original geometry remains in original.mscape.'); }
			else if (!validTiming) { enabled = false; add(layerId, 'source-timing', 'Held, reversed, remapped or out-of-range source timing becomes a disabled named null. Render the original composition to preserve playback.'); }
			else if (layer.kind === 'precomp') { kind = 'composition'; sourceId = compIds.get(layer.compositionId)!; }
			else if (layer.kind === 'footage' || layer.kind === 'image') {
				sourceId = mediaIds.get(layer.assetId) ?? null;
				if (sourceId) kind = 'footage'; else { enabled = false; add(layerId, 'media-mapping', 'The layer media is retained in original.mscape and is not admitted by this AE import subset.'); }
			} else if (layer.kind !== 'null') { enabled = false; add(layerId, 'layer-kind', `Layer kind “${layer.kind}” becomes a disabled named null. Its full authored content remains in original.mscape.`); }
			if (layer.effects.some(effect => effect.enabled) || layer.blendMode !== 'normal') add(layerId, 'compositing', 'Enabled effects and non-normal blend modes are not mapped by this subset. Render the original composition to preserve their appearance.');
			const startTime = number(layer.startFrame) / number(comp.frameRate) - (validTiming ? number(layer.sourceStart) / scale : 0);
			const inPoint = number(layer.inFrame) / number(comp.frameRate), outPoint = number(layer.outFrame) / number(comp.frameRate);
			if ([startTime, inPoint, outPoint].some(time => Math.abs(time) > 10800)) throw new RangeError('AE layer timing exceeds its documented ±three-hour range. Retain original.mscape or prepare timing within that host range.');
			return { id: layerId, name: layer.name, kind, sourceId, parentId: layer.parentId === null ? null : layerIds.get(layer.parentId)!, matte: null,
				startTime, inPoint, outPoint, stretch: validTiming ? 100 / scale : 100,
				enabled, threeD: false, adjustment: false, blendMode: 'normal', properties: [...transform(layer, layerId, comp, report), ...exportMotionAeMasks(layer, layerId, number(comp.frameRate), report)] };
		});
		return { id, name: comp.name, width: comp.width, height: comp.height, pixelAspect: 1, frameRate: number(comp.frameRate),
			duration: comp.durationFrames / number(comp.frameRate), displayStartTime: 0, background: comp.background.slice(0, 3) as [number, number, number], layers: exportMotionAeMattes(comp.layers, layers, report) };
	});
	const exchange = normalizeMotionAeExchange({ format: 'org.motionscaper.ae-exchange', version: 1, transferId,
		producer: { application: 'motionscaper', version: '0.1.0-alpha.1', bridgeVersion: '0.1.0' }, source: { name: project.title, revisionDigest: revision.digest },
		color: { workingSpace: '', linearBlending: true, bitsPerChannel: 32 }, footage, compositions, report });
	const prepared = freezeMotionValue({ revision, exchange, media }); preparedExports.add(prepared); return prepared;
}
