/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeMotionAeGaussianProfile } from './motion-ae-gaussian-profile.ts';
import type { MotionAeComposition, MotionAeExchange, MotionAeFootage, MotionAeLayer, MotionAeProperty, MotionAeReportEntry } from './motion-ae-exchange-types.ts';
import { MOTION_AE_EXCHANGE_LIMITS as limits } from './motion-ae-exchange-types.ts';
import { motionAeVector, normalizeMotionAeProperties, type MotionAeCustodyBudget } from './motion-ae-property-custody.ts';
import { freezeMotionValue, motionArray, motionBoolean, motionDigest, motionEnum, motionId, motionInteger, motionNumber, motionRecord, uniqueMotionIds } from './motion-values.ts';
import { motionAeCustodyString as motionString } from './motion-ae-custody-string.ts';

/** Portable package paths never contain source-machine paths or platform aliases. */
export function motionAeMediaPath(value: unknown): string {
	const path = motionString(value, 'AE media path', 256);
	if (!/^media\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.[A-Za-z0-9]{1,12}$/u.test(path)
		|| /^media\/(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])\./iu.test(path)) throw new TypeError('AE media path must be a portable file inside media/.');
	return path;
}
function footage(value: unknown): MotionAeFootage {
	const r = motionRecord(value, ['id', 'name', 'path', 'byteLength', 'sha256', 'width', 'height', 'pixelAspect', 'frameRate', 'duration', 'hasVideo', 'hasAudio', 'still'], 'AE footage');
	return { id: motionId(r.id), name: motionString(r.name, 'AE footage name', 1024), path: r.path === null ? null : motionAeMediaPath(r.path),
		byteLength: r.byteLength === null ? null : motionInteger(r.byteLength, 'AE media bytes', 0, limits.mediaBytes), sha256: r.sha256 === null ? null : motionDigest(r.sha256),
		width: motionInteger(r.width, 'AE footage width', 0, 32_768), height: motionInteger(r.height, 'AE footage height', 0, 32_768), pixelAspect: motionNumber(r.pixelAspect, 'AE pixel aspect', 0.01, 100),
		frameRate: motionNumber(r.frameRate, 'AE footage rate', 0, 1000), duration: motionNumber(r.duration, 'AE footage duration', 0, 1e6),
		hasVideo: motionBoolean(r.hasVideo, 'AE has video'), hasAudio: motionBoolean(r.hasAudio, 'AE has audio'), still: motionBoolean(r.still, 'AE still footage') };
}
function layer(value: unknown, budget: MotionAeCustodyBudget): MotionAeLayer {
	const r = motionRecord(value, ['id', 'name', 'kind', 'sourceId', 'parentId', 'matte', 'startTime', 'inPoint', 'outPoint', 'stretch', 'enabled', 'threeD', 'adjustment', 'blendMode', 'properties', 'scene', 'compositing', 'effectsActive'], 'AE layer', ['id', 'name', 'kind', 'sourceId', 'parentId', 'matte', 'startTime', 'inPoint', 'outPoint', 'stretch', 'enabled', 'threeD', 'adjustment', 'blendMode', 'properties']);
	const compositing = r.compositing === undefined ? undefined : motionRecord(r.compositing, ['preserveTransparency', 'collapseTransformation'], 'AE compositing');
	const scene = r.scene === undefined ? undefined : motionRecord(r.scene, ['autoOrient', 'lightType'], 'AE scene metadata', ['autoOrient']);
	if (scene && (r.kind !== 'camera' && r.kind !== 'light' || (r.kind === 'camera' && scene.lightType !== undefined))) throw new TypeError('AE scene metadata must match its camera/light owner.');
	const matte = r.matte === null ? null : motionRecord(r.matte, ['layerId', 'type'], 'AE matte');
	const inPoint = motionNumber(r.inPoint, 'AE layer in point', -1e6, 1e6), outPoint = motionNumber(r.outPoint, 'AE layer out point', -1e6, 1e6);
	const stretch = motionNumber(r.stretch, 'AE layer stretch', -9900, 9900); if (stretch === 0 || outPoint < inPoint) throw new RangeError('AE layer timing is invalid.');
	return { id: motionId(r.id), name: motionString(r.name, 'AE layer name', 1024, true),
		kind: motionEnum(r.kind, ['footage', 'composition', 'null', 'solid', 'text', 'shape', 'camera', 'light'], 'AE layer kind'), sourceId: r.sourceId === null ? null : motionId(r.sourceId), parentId: r.parentId === null ? null : motionId(r.parentId),
		matte: matte === null ? null : { layerId: motionId(matte.layerId), type: motionEnum(matte.type, ['alpha', 'alpha-inverted', 'luma', 'luma-inverted'], 'AE matte type') },
		startTime: motionNumber(r.startTime, 'AE layer start time', -1e6, 1e6), inPoint, outPoint, stretch,
		enabled: motionBoolean(r.enabled, 'AE layer enabled'), threeD: motionBoolean(r.threeD, 'AE layer 3D'), adjustment: motionBoolean(r.adjustment, 'AE layer adjustment'),
		blendMode: motionString(r.blendMode, 'AE blend mode', 128), properties: normalizeMotionAeProperties(r.properties, budget),
		...(r.effectsActive === undefined ? {} : { effectsActive: motionBoolean(r.effectsActive, 'AE effects active') }),
		...(compositing ? { compositing: { preserveTransparency: motionBoolean(compositing.preserveTransparency, 'AE preserve transparency'), collapseTransformation: motionBoolean(compositing.collapseTransformation, 'AE collapse transformation') } } : {}),
		...(scene ? { scene: { autoOrient: motionEnum(scene.autoOrient, ['none', 'point-of-interest', 'along-path', 'characters', 'unavailable'], 'AE automatic orientation'),
			...(scene.lightType === undefined ? {} : { lightType: motionEnum(scene.lightType, ['ambient', 'point', 'spot', 'parallel', 'environment', 'unavailable'], 'AE light type') }) } } : {}) };
}
function composition(value: unknown, budget: MotionAeCustodyBudget): MotionAeComposition {
	const r = motionRecord(value, ['id', 'name', 'width', 'height', 'pixelAspect', 'frameRate', 'duration', 'displayStartTime', 'background', 'layers'], 'AE composition');
	return { id: motionId(r.id), name: motionString(r.name, 'AE composition name', 1024), width: motionInteger(r.width, 'AE composition width', 1, 32_768), height: motionInteger(r.height, 'AE composition height', 1, 32_768),
		pixelAspect: motionNumber(r.pixelAspect, 'AE composition pixel aspect', 0.01, 100), frameRate: motionNumber(r.frameRate, 'AE composition rate', 1, 1000),
		duration: motionNumber(r.duration, 'AE composition duration', Number.MIN_VALUE, 1e6), displayStartTime: motionNumber(r.displayStartTime, 'AE display start', -1e6, 1e6),
		background: motionAeVector(r.background, 'AE background', 3, true) as readonly [number, number, number], layers: motionArray(r.layers, limits.layers, 'AE composition layers').map((v) => layer(v, budget)) };
}
function report(value: unknown): MotionAeReportEntry {
	const r = motionRecord(value, ['scopeId', 'propertyPath', 'status', 'code', 'message', 'mediaId'], 'AE report', ['scopeId', 'propertyPath', 'status', 'code', 'message']);
	return { scopeId: motionId(r.scopeId), propertyPath: motionString(r.propertyPath, 'AE report property path', 2048, true),
		status: motionEnum(r.status, ['editable', 'sampled', 'rendered', 'unsupported'], 'AE transfer status'), code: motionId(r.code), message: motionString(r.message, 'AE report message', 4096),
		...(r.mediaId === undefined ? {} : { mediaId: motionId(r.mediaId) }) };
}
function acyclic(ids: readonly string[], edges: (id: string) => readonly string[], name: string): void {
	const pending = new Set<string>(), done = new Set<string>();
	function visit(id: string): void {
		if (pending.has(id)) throw new RangeError(`AE ${name} cycle detected.`); if (done.has(id)) return;
		pending.add(id); for (const target of edges(id)) visit(target); pending.delete(id); done.add(id);
	}
	for (const id of ids) visit(id);
}
function validateClosure(value: MotionAeExchange): void {
	const footage = uniqueMotionIds(value.footage, 'AE footage'), compositions = uniqueMotionIds(value.compositions, 'AE compositions');
	const allIds = new Set<string>([value.transferId]);
	let layersCount = 0, mediaBytes = 0; const paths = new Set<string>();
	for (const source of value.footage) {
		if (source.path === null && !value.report.some((entry) => entry.scopeId === source.id && entry.code === 'missing-media' && entry.status === 'unsupported')) throw new Error('AE missing-media requires an explicit unsupported report.');
		if (source.path !== null && source.byteLength === null) throw new Error('AE present media requires a byte length.');
		if (source.path === null && (source.byteLength !== null || source.sha256 !== null)) throw new Error('AE missing-media cannot claim retained bytes.');
		if (source.path !== null) { const path = source.path.toLowerCase(); if (paths.has(path)) throw new Error('AE media path collides across platforms.'); paths.add(path); }
		mediaBytes += source.byteLength ?? 0; if (mediaBytes > limits.mediaBytes) throw new RangeError('AE media byte budget exceeded.');
	}
	for (const item of [...value.footage, ...value.compositions, ...value.compositions.flatMap((comp) => comp.layers)]) {
		if (allIds.has(item.id)) throw new Error('AE transfer identities must be globally unique.'); allIds.add(item.id);
	}
	for (const comp of value.compositions) {
		layersCount += comp.layers.length; if (layersCount > limits.layers) throw new RangeError('AE layer budget exceeded.');
		const layers = uniqueMotionIds(comp.layers, 'AE layers');
		for (const item of comp.layers) {
			if (item.parentId !== null && !layers.has(item.parentId)) throw new Error('AE layer parent is outside its composition.');
			if (item.matte !== null && (!layers.has(item.matte.layerId) || item.matte.layerId === item.id)) throw new Error('AE matte source is invalid.');
			if (item.kind === 'footage' ? item.sourceId === null || !footage.has(item.sourceId) : item.kind === 'composition' ? item.sourceId === null || !compositions.has(item.sourceId) : item.sourceId !== null) throw new Error('AE layer source does not match its kind.');
			validatePropertyReports(item.properties, item.id, value.report);
		}
		acyclic([...layers.keys()], (id) => { const item = layers.get(id)!; return item.parentId === null ? [] : [item.parentId]; }, 'parent');
		acyclic([...layers.keys()], (id) => { const item = layers.get(id)!; return item.matte === null ? [] : [item.matte.layerId]; }, 'matte');
	}
	acyclic([...compositions.keys()], (id) => compositions.get(id)!.layers.filter((item) => item.kind === 'composition').map((item) => item.sourceId!), 'composition');
	for (const entry of value.report) {
		if (!allIds.has(entry.scopeId)) throw new Error('AE report scope does not exist.');
		if (entry.status === 'rendered' && (entry.mediaId === undefined || footage.get(entry.mediaId)?.path == null)) throw new Error('AE rendered status requires retained media.');
		if (entry.mediaId !== undefined && !footage.has(entry.mediaId)) throw new Error('AE report media does not exist.');
	}
}
function validatePropertyReports(properties: readonly MotionAeProperty[], layerId: string, report: readonly MotionAeReportEntry[], prefix = ''): void {
	for (let index = 0; index < properties.length; index++) {
		const property = properties[index]!, path = `${prefix}${String(index)}:${property.matchName}`;
		if (property.kind === 'group') { validatePropertyReports(property.children, layerId, report, `${path}/`); continue; }
		if (property.kind === 'unsupported') {
			if (!report.some((entry) => entry.scopeId === layerId && entry.propertyPath === path && entry.status === 'unsupported')) throw new Error('AE unsupported property requires a report.'); continue;
		}
		if (property.expression?.enabled) {
			const disposition = property.expression.disposition;
			if (disposition === 'sampled' && (property.kind !== 'numeric' || property.samples === undefined)) throw new Error('AE sampled expression requires retained frame-grid samples.');
			if (!report.some((entry) => entry.scopeId === layerId && entry.propertyPath === path && entry.code === 'expression' && entry.status === (disposition === 'translated' ? 'editable' : disposition))) throw new Error('AE expression requires an explicit matching transfer report.');
		}
		if (property.kind === 'numeric' && property.samples !== undefined && !report.some((entry) => entry.scopeId === layerId && entry.propertyPath === path && entry.status === 'sampled')) throw new Error('AE samples require an explicit matching transfer report.');
	}
}
export function normalizeMotionAeExchange(value: unknown): MotionAeExchange {
	admitMotionAeCustodyInput(value);
	const r = motionRecord(value, ['format', 'version', 'transferId', 'producer', 'source', 'color', 'footage', 'compositions', 'report', 'gaussianProfile'], 'AE exchange', ['format', 'version', 'transferId', 'producer', 'source', 'color', 'footage', 'compositions', 'report']);
	if (r.format !== 'org.motionscaper.ae-exchange' || r.version !== 1) throw new Error('AE exchange format/version is unsupported.');
	const producer = motionRecord(r.producer, ['application', 'version', 'bridgeVersion'], 'AE producer'), source = motionRecord(r.source, ['name', 'revisionDigest'], 'AE source');
	const color = motionRecord(r.color, ['workingSpace', 'linearBlending', 'bitsPerChannel'], 'AE color');
	if (color.bitsPerChannel !== 8 && color.bitsPerChannel !== 16 && color.bitsPerChannel !== 32) throw new Error('AE color depth is unsupported.');
	const budget = { properties: 0, keys: 0 };
	const result: MotionAeExchange = { format: r.format, version: 1, transferId: motionId(r.transferId),
		producer: { application: motionEnum(producer.application, ['after-effects', 'motionscaper'], 'AE producer application'), version: motionString(producer.version, 'AE producer version', 256), bridgeVersion: motionString(producer.bridgeVersion, 'AE bridge version', 64) },
		source: { name: motionString(source.name, 'AE source project name', 1024), revisionDigest: source.revisionDigest === null ? null : motionDigest(source.revisionDigest) },
		color: { workingSpace: motionString(color.workingSpace, 'AE working space', 256, true), linearBlending: motionBoolean(color.linearBlending, 'AE linear blending'), bitsPerChannel: color.bitsPerChannel },
		footage: motionArray(r.footage, limits.footage, 'AE footage').map(footage), compositions: motionArray(r.compositions, limits.compositions, 'AE compositions', 1).map((v) => composition(v, budget)),
		report: motionArray(r.report, limits.reportEntries, 'AE report').map(report),
		...(r.gaussianProfile === undefined ? {} : { gaussianProfile: normalizeMotionAeGaussianProfile(r.gaussianProfile) }) };
	validateClosure(result); requireByteBudget(JSON.stringify(result)); return freezeMotionValue(result);
}
/** Bound direct unknown-object callers too, before copying property values or serializing them. */
export function admitMotionAeCustodyInput(value: unknown): void {
	let units = 0;
	const active = new Set<object>();
	function inspect(item: unknown, depth: number): void {
		if (depth > 64) throw new RangeError('AE exchange nesting budget exceeded.');
		units += 1;
		if (typeof item === 'string') units += item.length;
		if (units > limits.jsonBytes) throw new RangeError('AE exchange input budget exceeded.');
		if (item === null || typeof item !== 'object') return;
		if (active.has(item)) throw new TypeError('AE exchange contains a cyclic object.');
		active.add(item);
		const array = Array.isArray(item);
		if (!array && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new TypeError('AE exchange requires plain objects.');
		for (const key of Reflect.ownKeys(item)) {
			if (array && key === 'length') continue;
			const field = Object.getOwnPropertyDescriptor(item, key);
			if (typeof key !== 'string' || !field || !Object.hasOwn(field, 'value') || !field.enumerable) throw new TypeError('AE exchange requires inert own data.');
			units += key.length; inspect(field.value as unknown, depth + 1);
		}
		active.delete(item);
	}
	inspect(value, 0);
}
/** Conversion reports use the same closed scope/media authority as their retained source exchange. */
export function normalizeMotionAeConversionReport(input: unknown, exchange: MotionAeExchange): readonly MotionAeReportEntry[] {
	admitMotionAeCustodyInput(input);
	const entries = motionArray(input, limits.reportEntries, 'AE conversion report').map(report);
	validateClosure({ ...exchange, report: entries }); requireByteBudget(JSON.stringify(entries)); return freezeMotionValue(entries);
}
function requireByteBudget(text: string): void {
	if (text.length > limits.jsonBytes || new TextEncoder().encode(text).byteLength > limits.jsonBytes) throw new RangeError('AE exchange JSON byte budget exceeded.');
}
export function parseMotionAeExchange(text: string): MotionAeExchange { requireByteBudget(text); return normalizeMotionAeExchange(JSON.parse(text) as unknown); }
export function serializeMotionAeExchange(value: MotionAeExchange): string { return JSON.stringify(normalizeMotionAeExchange(value)); }
