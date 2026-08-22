/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed cumulative render authority for dormant Framescaper plans V9–V12. */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';
import {
	canonicalizeNativeMediaPlan,
	fingerprintNativeMediaPlan,
	type NativeMediaPlanFingerprint,
} from './native-media-plan-canonical-form.ts';
import { isVideoCanvasFit, type VideoCanvasFit } from './video-canvas-fit.ts';
import { isVideoDeliveryAudioLayout, type VideoDeliveryAudioLayout } from './video-delivery-audio-layout.ts';
import {
	normalizeUnifiedExactRenderClipNode,
	normalizeUnifiedExactRenderSources,
	normalizeUnifiedExactRenderTransitionNode,
	normalizeUnifiedExactTransitionOrder,
	type UnifiedExactRenderClipNode,
	type UnifiedExactRenderPlanSource,
	type UnifiedExactRenderSourceIndex,
	type UnifiedExactRenderTemporalContext,
	type UnifiedExactRenderTransitionNode,
} from './unified-exact-render-plan-v9.ts';
import {
	normalizeUnifiedExactRenderVisualNode,
	type UnifiedExactRenderVisualNode,
	type UnifiedExactVisualModelKind,
} from './unified-exact-render-plan-v10.ts';
import {
	normalizeUnifiedExactRenderProfessionalNode,
	type UnifiedExactRenderProfessionalMediaNode,
} from './unified-exact-render-plan-v11.ts';
import {
	normalizeUnifiedExactRenderOpenFxNode,
	type UnifiedExactRenderOpenFxNode,
} from './unified-exact-render-plan-v12.ts';

export type {
	UnifiedExactRenderClipNode,
	UnifiedExactRenderPlanSource,
	UnifiedExactRenderTransitionNode,
	UnifiedExactRenderVisualNode,
	UnifiedExactVisualModelKind,
	UnifiedExactRenderProfessionalMediaNode,
	UnifiedExactRenderOpenFxNode,
};

export const UNIFIED_EXACT_RENDER_PLAN_VERSIONS = Object.freeze([9, 10, 11, 12] as const);
export type UnifiedExactRenderPlanVersion = (typeof UNIFIED_EXACT_RENDER_PLAN_VERSIONS)[number];

export type UnifiedExactRenderNode =
	| UnifiedExactRenderClipNode
	| UnifiedExactRenderTransitionNode
	| UnifiedExactRenderVisualNode
	| UnifiedExactRenderProfessionalMediaNode
	| UnifiedExactRenderOpenFxNode;

export interface UnifiedExactRenderPlan extends Readonly<Record<string, unknown>> {
	readonly version: UnifiedExactRenderPlanVersion;
	readonly strategy: 'framescaper-unified-exact-v1';
	readonly project: Readonly<{ readonly id: string; readonly revision: number }>;
	readonly format: Readonly<{
		readonly container: 'mp4' | 'webm';
		readonly extension: 'mp4' | 'webm';
		readonly mimeType: 'video/mp4' | 'video/webm';
	}>;
	readonly codecs: Readonly<{
		readonly video: string;
		readonly videoEncoder: string;
		readonly audio: string | null;
		readonly audioEncoder: string | null;
		readonly pixelFormat: string;
	}>;
	readonly timebase: Readonly<{
		readonly sampleStart: number;
		readonly sampleDuration: number;
		readonly sampleRate: number;
		readonly sequenceId: string;
		readonly sequenceRate: Readonly<{ readonly num: number; readonly den: number }>;
	}>;
	readonly output: Readonly<{
		readonly frameRate: Readonly<{ readonly num: number; readonly den: number }>;
		readonly frameCount: number;
		readonly canvas: Readonly<{
			readonly width: number;
			readonly height: number;
			readonly fit: VideoCanvasFit;
			readonly pixelFormat: string;
			readonly backgroundColor: string;
		}>;
		readonly includeAudio: boolean;
		readonly audioLayout: VideoDeliveryAudioLayout | null;
	}>;
	readonly sources: readonly UnifiedExactRenderPlanSource[];
	readonly nodes: readonly UnifiedExactRenderNode[];
}

export type UnifiedExactRenderPlanV9 = UnifiedExactRenderPlan & Readonly<{ readonly version: 9 }>;
export type UnifiedExactRenderPlanV10 = UnifiedExactRenderPlan & Readonly<{ readonly version: 10 }>;
export type UnifiedExactRenderPlanV11 = UnifiedExactRenderPlan & Readonly<{ readonly version: 11 }>;
export type UnifiedExactRenderPlanV12 = UnifiedExactRenderPlan & Readonly<{ readonly version: 12 }>;

const PLAN_FIELDS = Object.freeze([
	'version', 'strategy', 'project', 'format', 'codecs', 'timebase', 'output', 'sources', 'nodes',
]);
const PROJECT_FIELDS = Object.freeze(['id', 'revision']);
const FORMAT_FIELDS = Object.freeze(['container', 'extension', 'mimeType']);
const CODEC_FIELDS = Object.freeze(['video', 'videoEncoder', 'audio', 'audioEncoder', 'pixelFormat']);
const TIMEBASE_FIELDS = Object.freeze([
	'sampleStart', 'sampleDuration', 'sampleRate', 'sequenceId', 'sequenceRate',
]);
const OUTPUT_FIELDS = Object.freeze(['frameRate', 'frameCount', 'canvas', 'includeAudio', 'audioLayout']);
const CANVAS_FIELDS = Object.freeze(['width', 'height', 'fit', 'pixelFormat', 'backgroundColor']);
const RATE_FIELDS = Object.freeze(['num', 'den']);
const ALL_NODE_FIELDS = Object.freeze([
	'kind', 'nodeId', 'clipId', 'trackId', 'sourceNodeId', 'sequenceStartFrame',
	'sequenceFrameCount', 'sourceInFrame', 'sourceFrameCount', 'sourceTimeMapping',
	'transition', 'edges', 'modelId', 'modelKind', 'authoredState', 'freshness',
	'frozenFallback', 'characteristics', 'imageSequence', 'proxyAttachment',
	'exportAuthority', 'state',
]);
const MAXIMUM_NODES = 100_000;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,4095}$/u;

/** Normalize, detach, and deeply freeze one exact generation. */
export function createUnifiedExactRenderPlan(value: unknown): UnifiedExactRenderPlan {
	const normalized = normalizePlan(value);
	const canonical = canonicalizeNativeMediaPlan(normalized);
	const detached = normalizePlan(JSON.parse(canonical) as unknown);
	return deepFreeze(detached);
}

/** Require an already-normalized canonical V9–V12 wire. */
export function assertUnifiedExactRenderPlan(value: unknown): asserts value is UnifiedExactRenderPlan {
	const normalized = normalizePlan(value);
	if (canonicalizeNativeMediaPlan(value) !== canonicalizeNativeMediaPlan(normalized)) {
		throw new TypeError('A unified exact render plan must use its canonical semantic order and values.');
	}
}

export function assertUnifiedExactRenderPlanV9(value: unknown): asserts value is UnifiedExactRenderPlanV9 {
	assertGeneration(value, 9);
}

export function assertUnifiedExactRenderPlanV10(value: unknown): asserts value is UnifiedExactRenderPlanV10 {
	assertGeneration(value, 10);
}

export function assertUnifiedExactRenderPlanV11(value: unknown): asserts value is UnifiedExactRenderPlanV11 {
	assertGeneration(value, 11);
}

export function assertUnifiedExactRenderPlanV12(value: unknown): asserts value is UnifiedExactRenderPlanV12 {
	assertGeneration(value, 12);
}

export function canonicalizeUnifiedExactRenderPlan(value: unknown): string {
	assertUnifiedExactRenderPlan(value);
	return canonicalizeNativeMediaPlan(value);
}

export function fingerprintUnifiedExactRenderPlan(value: unknown): NativeMediaPlanFingerprint {
	assertUnifiedExactRenderPlan(value);
	return fingerprintNativeMediaPlan(value);
}

function normalizePlan(value: unknown): UnifiedExactRenderPlan {
	const input = readClosedDomainRecord(value, 'unified exact render plan', PLAN_FIELDS);
	const version = planVersion(field(input, 'version', 'unified exact render plan'));
	if (field(input, 'strategy', 'unified exact render plan') !== 'framescaper-unified-exact-v1') {
		throw new RangeError('A unified exact render plan has an unsupported strategy.');
	}
	const project = normalizeProject(field(input, 'project', 'unified exact render plan'));
	const format = normalizeFormat(field(input, 'format', 'unified exact render plan'));
	const codecs = normalizeCodecs(field(input, 'codecs', 'unified exact render plan'));
	const timebase = normalizeTimebase(field(input, 'timebase', 'unified exact render plan'));
	const output = normalizeOutput(field(input, 'output', 'unified exact render plan'), codecs);
	const expectedCount = ceilingRatio(
		BigInt(timebase.sampleDuration) * BigInt(output.frameRate.num),
		BigInt(timebase.sampleRate) * BigInt(output.frameRate.den),
	);
	if (expectedCount !== BigInt(output.frameCount)) {
		throw new RangeError('Unified render output frameCount is not exact.');
	}
	const sourceResult = normalizeUnifiedExactRenderSources(field(input, 'sources', 'unified exact render plan'));
	const context: UnifiedExactRenderTemporalContext = Object.freeze({
		sampleStart: timebase.sampleStart,
		sampleDuration: timebase.sampleDuration,
		sampleRate: timebase.sampleRate,
		sequenceId: timebase.sequenceId,
		sequenceRate: timebase.sequenceRate,
		outputRate: output.frameRate,
		outputFrameCount: output.frameCount,
	});
	const nodes = normalizeNodes(
		field(input, 'nodes', 'unified exact render plan'), version, project.id,
		context, sourceResult.index,
	);
	return {
		version,
		strategy: 'framescaper-unified-exact-v1',
		project,
		format,
		codecs,
		timebase,
		output,
		sources: sourceResult.sources,
		nodes,
	};
}

function normalizeNodes(
	value: unknown,
	version: UnifiedExactRenderPlanVersion,
	projectId: string,
	context: UnifiedExactRenderTemporalContext,
	sources: UnifiedExactRenderSourceIndex,
): readonly UnifiedExactRenderNode[] {
	const candidates = readClosedDomainArray(value, 'unified render nodes', 0, MAXIMUM_NODES);
	const kinds = candidates.map((candidate, index) => {
		const name = `unified render nodes[${String(index)}]`;
		const record = readClosedDomainRecord(candidate, name, ALL_NODE_FIELDS, ['kind']);
		return field(record, 'kind', name);
	});
	const normalized = new Map<number, UnifiedExactRenderNode>();
	const clipsById = new Map<string, UnifiedExactRenderClipNode>();
	for (let index = 0; index < candidates.length; index += 1) {
		if (kinds[index] !== 'clip') continue;
		const clip = normalizeUnifiedExactRenderClipNode(candidates[index], context, sources);
		if (clipsById.has(clip.clipId)) throw new RangeError('Unified clip IDs must be unique.');
		clipsById.set(clip.clipId, clip);
		normalized.set(index, clip);
	}
	for (let index = 0; index < candidates.length; index += 1) {
		const kind = kinds[index];
		if (kind === 'clip' || kind === 'openfx') continue;
		let node: UnifiedExactRenderNode;
		if (kind === 'transition') {
			node = normalizeUnifiedExactRenderTransitionNode(candidates[index], context, clipsById, sources);
		} else if (kind === 'visual') {
			requireGeneration(version, 10, kind);
			node = normalizeUnifiedExactRenderVisualNode(candidates[index], context.sequenceId, sources.bySourceId);
		} else if (kind === 'professional-media') {
			requireGeneration(version, 11, kind);
			node = normalizeUnifiedExactRenderProfessionalNode(candidates[index], sources.byNodeId);
		} else throw new RangeError('Unified exact render plan node kind is unsupported.');
		normalized.set(index, node);
	}
	const identities = graphIdentities(projectId, sources, normalized.values());
	for (let index = 0; index < candidates.length; index += 1) {
		if (kinds[index] !== 'openfx') continue;
		requireGeneration(version, 12, 'openfx');
		const effect = normalizeUnifiedExactRenderOpenFxNode(candidates[index], identities, sources.bySourceId);
		normalized.set(index, effect);
	}
	const result = candidates.map((_candidate, index) => required(normalized.get(index)));
	assertUniqueNodeAndFeatureIdentities(result, sources);
	const orderedTransitions = normalizeUnifiedExactTransitionOrder(
		result.filter((node): node is UnifiedExactRenderTransitionNode => node.kind === 'transition'),
	);
	let transitionIndex = 0;
	return Object.freeze(result.map((node) => (
		node.kind === 'transition' ? orderedTransitions[transitionIndex++]! : node
	)));
}

function graphIdentities(
	projectId: string,
	sources: UnifiedExactRenderSourceIndex,
	nodes: Iterable<UnifiedExactRenderNode>,
): ReadonlySet<string> {
	const values = new Set<string>([projectId]);
	for (const source of sources.byNodeId.values()) { values.add(source.nodeId); values.add(source.sourceId); }
	for (const node of nodes) {
		values.add(node.nodeId);
		if (node.kind === 'clip') values.add(node.clipId);
		else if (node.kind === 'transition') values.add(node.transition.id);
		else if (node.kind === 'visual') {
			values.add(node.modelId);
			if ('clip' in node.authoredState) values.add(node.authoredState.clip.id);
		}
	}
	return values;
}

function assertUniqueNodeAndFeatureIdentities(
	nodes: readonly UnifiedExactRenderNode[],
	sources: UnifiedExactRenderSourceIndex,
): void {
	const nodeIds = new Set(sources.byNodeId.keys());
	const featureIds = new Set<string>();
	for (const node of nodes) {
		if (nodeIds.has(node.nodeId)) throw new RangeError('Unified render node IDs must be unique.');
		nodeIds.add(node.nodeId);
		const featureId = node.kind === 'clip' ? node.clipId
			: node.kind === 'transition' ? node.transition.id
				: node.kind === 'visual' ? node.modelId
					: node.kind === 'openfx' ? node.state.instanceId : node.sourceNodeId;
		if (featureIds.has(featureId)) throw new RangeError('Unified feature identities must be unique per family.');
		featureIds.add(featureId);
	}
}

function normalizeProject(value: unknown) {
	const record = readClosedDomainRecord(value, 'unified render project', PROJECT_FIELDS);
	return Object.freeze({
		id: stableId(field(record, 'id', 'unified render project'), 'unified render project.id'),
		revision: integer(field(record, 'revision', 'unified render project'), 'unified render project.revision', 0),
	});
}

function normalizeFormat(value: unknown): UnifiedExactRenderPlan['format'] {
	const record = readClosedDomainRecord(value, 'unified render format', FORMAT_FIELDS);
	const container = field(record, 'container', 'unified render format');
	if (container !== 'mp4' && container !== 'webm') throw new RangeError('Unified render container is unsupported.');
	if (field(record, 'extension', 'unified render format') !== container
		|| field(record, 'mimeType', 'unified render format') !== `video/${container}`) {
		throw new RangeError('Unified render format metadata is not canonical.');
	}
	return Object.freeze({ container, extension: container, mimeType: `video/${container}` });
}

function normalizeCodecs(value: unknown): UnifiedExactRenderPlan['codecs'] {
	const record = readClosedDomainRecord(value, 'unified render codecs', CODEC_FIELDS);
	const audio = nullableText(field(record, 'audio', 'unified render codecs'), 'unified render codecs.audio');
	const audioEncoder = nullableText(field(record, 'audioEncoder', 'unified render codecs'), 'unified render codecs.audioEncoder');
	if ((audio === null) !== (audioEncoder === null)) throw new RangeError('Audio codec and encoder must both be null or text.');
	return Object.freeze({
		video: text(field(record, 'video', 'unified render codecs'), 'unified render codecs.video'),
		videoEncoder: text(field(record, 'videoEncoder', 'unified render codecs'), 'unified render codecs.videoEncoder'),
		audio,
		audioEncoder,
		pixelFormat: text(field(record, 'pixelFormat', 'unified render codecs'), 'unified render codecs.pixelFormat'),
	});
}

function normalizeTimebase(value: unknown): UnifiedExactRenderPlan['timebase'] {
	const record = readClosedDomainRecord(value, 'unified render timebase', TIMEBASE_FIELDS);
	const sampleStart = integer(field(record, 'sampleStart', 'unified render timebase'), 'sampleStart', 0);
	const sampleDuration = integer(field(record, 'sampleDuration', 'unified render timebase'), 'sampleDuration', 1);
	if (!Number.isSafeInteger(sampleStart + sampleDuration)) throw new RangeError('Unified render sample range overflows.');
	return Object.freeze({
		sampleStart,
		sampleDuration,
		sampleRate: integer(field(record, 'sampleRate', 'unified render timebase'), 'sampleRate', 1),
		sequenceId: stableId(field(record, 'sequenceId', 'unified render timebase'), 'sequenceId'),
		sequenceRate: rational(field(record, 'sequenceRate', 'unified render timebase'), 'sequenceRate'),
	});
}

function normalizeOutput(
	value: unknown,
	codecs: UnifiedExactRenderPlan['codecs'],
): UnifiedExactRenderPlan['output'] {
	const record = readClosedDomainRecord(value, 'unified render output', OUTPUT_FIELDS);
	const canvasRecord = readClosedDomainRecord(field(record, 'canvas', 'unified render output'), 'unified render canvas', CANVAS_FIELDS);
	const fit = field(canvasRecord, 'fit', 'unified render canvas');
	if (!isVideoCanvasFit(fit)) throw new RangeError('Unified render canvas fit is unsupported.');
	const pixelFormat = text(field(canvasRecord, 'pixelFormat', 'unified render canvas'), 'canvas.pixelFormat');
	if (pixelFormat !== codecs.pixelFormat) throw new RangeError('Unified render canvas and codec pixel formats disagree.');
	const includeAudio = field(record, 'includeAudio', 'unified render output');
	const audioLayout = field(record, 'audioLayout', 'unified render output');
	if (typeof includeAudio !== 'boolean') throw new TypeError('Unified render includeAudio must be boolean.');
	if (includeAudio ? (!isVideoDeliveryAudioLayout(audioLayout) || codecs.audio === null)
		: (audioLayout !== null || codecs.audio !== null)) {
		throw new RangeError('Unified render audio metadata is inconsistent.');
	}
	const backgroundColor = field(canvasRecord, 'backgroundColor', 'unified render canvas');
	if (typeof backgroundColor !== 'string' || !/^#[a-fA-F0-9]{6}(?:[a-fA-F0-9]{2})?$/u.test(backgroundColor)) {
		throw new RangeError('Unified render background color is not canonical hexadecimal RGB/RGBA.');
	}
	return Object.freeze({
		frameRate: rational(field(record, 'frameRate', 'unified render output'), 'output.frameRate'),
		frameCount: integer(field(record, 'frameCount', 'unified render output'), 'output.frameCount', 1),
		canvas: Object.freeze({
			width: integer(field(canvasRecord, 'width', 'unified render canvas'), 'canvas.width', 1),
			height: integer(field(canvasRecord, 'height', 'unified render canvas'), 'canvas.height', 1),
			fit,
			pixelFormat,
			backgroundColor,
		}),
		includeAudio,
		audioLayout: audioLayout as VideoDeliveryAudioLayout | null,
	});
}

function assertGeneration(value: unknown, version: UnifiedExactRenderPlanVersion): void {
	assertUnifiedExactRenderPlan(value);
	if (value.version !== version) throw new RangeError(`Expected unified exact render plan V${String(version)}.`);
}

function planVersion(value: unknown): UnifiedExactRenderPlanVersion {
	if (!(UNIFIED_EXACT_RENDER_PLAN_VERSIONS as readonly unknown[]).includes(value)) {
		throw new RangeError('Unified exact render plan version is unsupported.');
	}
	return value as UnifiedExactRenderPlanVersion;
}

function requireGeneration(actual: number, minimum: number, kind: unknown): void {
	if (actual < minimum) throw new RangeError(`${String(kind)} render node requires plan generation V${String(minimum)}.`);
}

function rational(value: unknown, name: string) {
	const record = readClosedDomainRecord(value, name, RATE_FIELDS);
	const num = integer(field(record, 'num', name), `${name}.num`, 1);
	const den = integer(field(record, 'den', name), `${name}.den`, 1);
	if (gcd(num, den) !== 1) throw new RangeError(`${name} must be reduced.`);
	return Object.freeze({ num, den });
}

function field(record: ClosedDomainRecord, key: string, name: string): unknown {
	return readClosedDomainField(record, key, name);
}

function integer(value: unknown, name: string, minimum: number): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new RangeError(`${name} must be a bounded safe integer.`);
	return Number(value);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${name} must be a canonical stable ID.`);
	return value;
}

function nullableText(value: unknown, name: string): string | null {
	return value === null ? null : text(value, name);
}

function text(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 4_096 || value.includes('\0')) {
		throw new TypeError(`${name} must be bounded nonempty text.`);
	}
	return value;
}

function ceilingRatio(numerator: bigint, denominator: bigint): bigint {
	return (numerator + denominator - 1n) / denominator;
}

function gcd(left: number, right: number): number {
	while (right !== 0) [left, right] = [right, left % right];
	return left;
}

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new RangeError('Unified render node normalization is incomplete.');
	return value;
}

function deepFreeze<Value>(value: Value): Value {
	if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
	return Object.freeze(value);
}
