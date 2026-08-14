/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Deliberately standalone PDC reference model for V21 acceptance fixtures.
 *
 * This module owns neither production compilation nor runtime maps. It parses a
 * minimal V21 graph again, derives limiter latency directly from its documented
 * lookahead, and solves alignment as longest-path constraints. That makes it a
 * useful oracle for detecting a mutually-consistent compiler/runtime defect.
 */

type DataRecord = Readonly<Record<string, unknown>>;

interface ReferenceVertex {
	readonly key: string;
	readonly rackLatencyFrames: number;
	readonly effectPrefixFrames: ReadonlyMap<string, number>;
}

interface ReferenceEdge {
	readonly id: string;
	readonly enabled: boolean;
	readonly source: string;
	readonly destination:
		| Readonly<{
			readonly kind: 'vertex';
			readonly key: string;
			readonly effectPrefixFrames: number;
			readonly effectSidechain: boolean;
		}>
		| Readonly<{ readonly kind: 'output'; readonly id: string }>;
	readonly targetsMasterEffect: boolean;
}

interface ReferenceModel {
	readonly vertices: ReadonlyMap<string, ReferenceVertex>;
	readonly trackKeys: ReadonlyMap<string, string>;
	readonly edges: readonly ReferenceEdge[];
	readonly outputIds: readonly string[];
}

interface ReferenceSolution {
	readonly nodeInputLatencyFrames: ReadonlyMap<string, number>;
	readonly nodeOutputLatencyFrames: ReadonlyMap<string, number>;
	readonly edgeCompensationFrames: ReadonlyMap<string, number>;
	readonly outputLatencyFrames: ReadonlyMap<string, number>;
	readonly latencyFrames: number;
	readonly landmarks: readonly ProjectPdcReferenceLandmarkV21[];
}

export interface ProjectPdcReferenceLandmarkV21 {
	readonly edgeId: string;
	readonly sourceOffsetFrames: number;
	readonly compensationFrames: number;
	readonly arrivalOffsetFrames: number;
	readonly targetOffsetFrames: number;
}

export interface ProjectPdcReferenceConsumerOffsetsV21 {
	readonly live: number;
	readonly monitoring: number;
	readonly offline: number;
	readonly stemsByTrack: ReadonlyMap<string, number>;
	readonly freezeByTrack: ReadonlyMap<string, number>;
}

export interface IndependentProjectPdcReferenceV21 {
	readonly nodeInputLatencyFrames: ReadonlyMap<string, number>;
	readonly nodeOutputLatencyFrames: ReadonlyMap<string, number>;
	readonly edgeCompensationFrames: ReadonlyMap<string, number>;
	readonly outputLatencyFrames: ReadonlyMap<string, number>;
	readonly landmarks: readonly ProjectPdcReferenceLandmarkV21[];
	readonly consumerOffsets: ProjectPdcReferenceConsumerOffsetsV21;
	automationLatencyFrames(address: unknown): number;
}

export interface IndependentProjectPdcReferenceOptionsV21 {
	readonly sampleRate?: number;
}

const DEFAULT_SAMPLE_RATE = 48_000;

/** Evaluate V21 path offsets without consulting any production PDC derivation. */
export function evaluateIndependentProjectPdcReferenceV21(
	projectValue: unknown,
	options: IndependentProjectPdcReferenceOptionsV21 = {},
): IndependentProjectPdcReferenceV21 {
	const project = record(projectValue, 'V21 PDC reference project');
	const sampleRate = normalizedSampleRate(options.sampleRate ?? optionalData(project, 'sampleRate') ?? DEFAULT_SAMPLE_RATE);
	const model = createReferenceModel(project, sampleRate);
	const full = solveReferenceModel(model, true);
	const stem = solveReferenceModel(model, false);
	const stemsByTrack = new Map<string, number>();
	const freezeByTrack = new Map<string, number>();
	for (const [trackId, key] of model.trackKeys) {
		stemsByTrack.set(trackId, stem.latencyFrames);
		freezeByTrack.set(trackId, model.vertices.get(key)?.rackLatencyFrames ?? 0);
	}
	const consumerOffsets = Object.freeze({
		live: full.latencyFrames,
		monitoring: full.latencyFrames,
		offline: full.latencyFrames,
		stemsByTrack,
		freezeByTrack,
	});
	return Object.freeze({
		nodeInputLatencyFrames: full.nodeInputLatencyFrames,
		nodeOutputLatencyFrames: full.nodeOutputLatencyFrames,
		edgeCompensationFrames: full.edgeCompensationFrames,
		outputLatencyFrames: full.outputLatencyFrames,
		landmarks: full.landmarks,
		consumerOffsets,
		automationLatencyFrames: createAutomationReference(model, full),
	});
}

function createReferenceModel(project: DataRecord, sampleRate: number): ReferenceModel {
	const vertices = new Map<string, ReferenceVertex>();
	const trackKeys = new Map<string, string>();
	for (const [index, value] of array(data(project, 'tracks'), 'V21 PDC reference tracks').entries()) {
		const track = record(value, `V21 PDC reference tracks[${String(index)}]`);
		if (optionalData(track, 'type') !== 'audio') continue;
		const id = identifier(data(track, 'id'), `V21 PDC reference track ${String(index)}`);
		const key = `track:${id}`;
		addVertex(vertices, key, effectHost(track, key, sampleRate));
		trackKeys.set(id, key);
	}
	const mixer = record(data(project, 'mixer'), 'V21 PDC reference mixer');
	for (const collectionName of ['groups', 'sends', 'cues'] as const) {
		for (const [index, value] of array(
			data(mixer, collectionName),
			`V21 PDC reference mixer.${collectionName}`,
		).entries()) {
			const strip = record(value, `V21 PDC reference mixer.${collectionName}[${String(index)}]`);
			const id = identifier(data(strip, 'id'), `V21 PDC reference ${collectionName} ${String(index)}`);
			const key = `mixer-node:${id}`;
			addVertex(vertices, key, effectHost(strip, key, sampleRate));
		}
	}
	addVertex(vertices, 'master', effectHost(
		record(data(project, 'master'), 'V21 PDC reference master'),
		'master',
		sampleRate,
	));
	const outputs = array(data(mixer, 'outputs'), 'V21 PDC reference outputs');
	const outputIds = outputs.map((value, index) => identifier(
		data(record(value, `V21 PDC reference outputs[${String(index)}]`), 'id'),
		`V21 PDC reference output ${String(index)}`,
	));
	if (new Set(outputIds).size !== outputIds.length) throw new RangeError('V21 PDC reference outputs must be unique.');
	const outputSet = new Set(outputIds);
	const edgeIds = new Set<string>();
	const edges = array(data(mixer, 'edges'), 'V21 PDC reference edges').map((value, index) => {
		const edge = record(value, `V21 PDC reference edges[${String(index)}]`);
		const id = identifier(data(edge, 'id'), `V21 PDC reference edge ${String(index)}`);
		if (edgeIds.has(id)) throw new RangeError(`Duplicate V21 PDC reference edge ${id}.`);
		edgeIds.add(id);
		const source = endpointKey(data(edge, 'source'), vertices, `V21 PDC reference edge ${id} source`);
		const destination = referenceDestination(data(edge, 'destination'), vertices, outputSet, id);
		const enabled = data(edge, 'enabled');
		if (typeof enabled !== 'boolean') throw new TypeError(`V21 PDC reference edge ${id}.enabled must be boolean.`);
		return Object.freeze({
			id,
			enabled,
			source,
			destination,
			targetsMasterEffect: destination.kind === 'vertex'
				&& destination.key === 'master' && destination.effectSidechain,
		});
	});
	return Object.freeze({ vertices, trackKeys, edges: Object.freeze(edges), outputIds: Object.freeze(outputIds) });
}

function effectHost(host: DataRecord, key: string, sampleRate: number): ReferenceVertex {
	const active = optionalData(host, 'effectsActive') !== false;
	const values = optionalData(host, 'effects');
	const effects = values === undefined ? [] : array(values, `${key} effects`);
	let latency = 0;
	const prefixes = new Map<string, number>();
	for (const [index, value] of effects.entries()) {
		const effect = record(value, `${key} effects[${String(index)}]`);
		const idValue = optionalData(effect, 'id');
		if (typeof idValue === 'string' && idValue.length > 0) {
			if (prefixes.has(idValue)) throw new RangeError(`${key} contains duplicate effect ${idValue}.`);
			prefixes.set(idValue, latency);
		}
		if (!active || optionalData(effect, 'enabled') === false || optionalData(effect, 'bypassed') === true) continue;
		latency = safeAdd(latency, independentEffectLatency(effect, sampleRate), `${key} rack latency`);
	}
	return Object.freeze({ key, rackLatencyFrames: latency, effectPrefixFrames: prefixes });
}

function independentEffectLatency(effect: DataRecord, sampleRate: number): number {
	const type = String(optionalData(effect, 'type') ?? optionalData(effect, 'kind') ?? '').toLowerCase();
	if (type !== 'limiter') {
		if (type.startsWith('audacity-')) {
			throw new RangeError(`The independent PDC oracle has no release-pinned latency formula for ${type}.`);
		}
		return 0;
	}
	const paramsValue = optionalData(effect, 'params');
	const params = paramsValue === undefined ? Object.freeze({}) : record(paramsValue, 'V21 PDC reference limiter params');
	const lookaheadValue = optionalData(params, 'lookahead') ?? 0;
	if (typeof lookaheadValue !== 'number' || !Number.isFinite(lookaheadValue)
		|| Object.is(lookaheadValue, -0) || lookaheadValue < 0) {
		throw new RangeError('V21 PDC reference limiter lookahead must be a non-negative finite number.');
	}
	const frames = Math.ceil(lookaheadValue * sampleRate);
	if (!Number.isSafeInteger(frames)) throw new RangeError('V21 PDC reference limiter latency exceeds safe integer range.');
	return frames;
}

function referenceDestination(
	value: unknown,
	vertices: ReadonlyMap<string, ReferenceVertex>,
	outputs: ReadonlySet<string>,
	edgeId: string,
): ReferenceEdge['destination'] {
	const endpoint = record(value, `V21 PDC reference edge ${edgeId} destination`);
	const kind = data(endpoint, 'kind');
	if (kind === 'output') {
		const id = identifier(data(endpoint, 'id'), `V21 PDC reference edge ${edgeId} output`);
		if (!outputs.has(id)) throw new ReferenceError(`V21 PDC reference edge ${edgeId} has unknown output ${id}.`);
		return Object.freeze({ kind: 'output', id });
	}
	if (kind === 'effect-sidechain') {
		const key = endpointKey(
			data(endpoint, 'strip'), vertices, `V21 PDC reference edge ${edgeId} sidechain strip`,
		);
		const effectId = identifier(
			data(endpoint, 'effectId'), `V21 PDC reference edge ${edgeId} sidechain effect`,
		);
		const prefix = vertices.get(key)?.effectPrefixFrames.get(effectId);
		if (prefix === undefined) throw new ReferenceError(`V21 PDC reference edge ${edgeId} has unknown effect ${effectId}.`);
		return Object.freeze({ kind: 'vertex', key, effectPrefixFrames: prefix, effectSidechain: true });
	}
	return Object.freeze({
		kind: 'vertex',
		key: endpointKey(endpoint, vertices, `V21 PDC reference edge ${edgeId} destination`),
		effectPrefixFrames: 0,
		effectSidechain: false,
	});
}

function endpointKey(
	value: unknown,
	vertices: ReadonlyMap<string, ReferenceVertex>,
	name: string,
): string {
	const endpoint = record(value, name);
	const kind = data(endpoint, 'kind');
	const key = kind === 'master' ? 'master'
		: kind === 'track' ? `track:${identifier(data(endpoint, 'id'), name)}`
			: kind === 'mixer-node' ? `mixer-node:${identifier(data(endpoint, 'id'), name)}` : null;
	if (!key || !vertices.has(key)) throw new ReferenceError(`${name} identifies an unknown V21 PDC vertex.`);
	return key;
}

function solveReferenceModel(model: ReferenceModel, includeMaster: boolean): ReferenceSolution {
	const activeEdges = model.edges.filter((edge) => (
		edge.enabled && (includeMaster || !edge.targetsMasterEffect)
	));
	const dependencies = activeEdges.filter((edge) => edge.destination.kind === 'vertex');
	assertAcyclic(model.vertices, dependencies);
	const inputs = new Map(Array.from(model.vertices.keys(), (key) => [key, 0]));
	for (let pass = 0; pass < model.vertices.size; pass += 1) {
		let changed = false;
		for (const edge of dependencies) {
			if (edge.destination.kind !== 'vertex') continue;
			const sourceOutput = vertexOutput(model, inputs, edge.source, includeMaster);
			const candidate = Math.max(0, sourceOutput - edge.destination.effectPrefixFrames);
			if (candidate <= (inputs.get(edge.destination.key) ?? 0)) continue;
			inputs.set(edge.destination.key, candidate);
			changed = true;
		}
		if (!changed) break;
	}
	const outputs = new Map<string, number>();
	for (const key of model.vertices.keys()) outputs.set(key, vertexOutput(model, inputs, key, includeMaster));
	const outputLatencyFrames = new Map(model.outputIds.map((id) => {
		const incoming = activeEdges.filter((edge) => edge.destination.kind === 'output' && edge.destination.id === id);
		return [id, Math.max(0, ...incoming.map((edge) => outputs.get(edge.source) ?? 0))] as const;
	}));
	const compensation = new Map<string, number>();
	for (const edge of model.edges) {
		if (!edge.enabled || (!includeMaster && edge.targetsMasterEffect)) {
			compensation.set(edge.id, 0);
			continue;
		}
		const source = outputs.get(edge.source) ?? 0;
		const target = edge.destination.kind === 'output'
			? outputLatencyFrames.get(edge.destination.id) ?? 0
			: (inputs.get(edge.destination.key) ?? 0) + edge.destination.effectPrefixFrames;
		const frames = target - source;
		if (!Number.isSafeInteger(frames) || frames < 0) {
			throw new Error(`V21 PDC reference edge ${edge.id} requires impossible negative compensation.`);
		}
		compensation.set(edge.id, frames);
	}
	const landmarks = activeEdges.map((edge) => {
		const sourceOffsetFrames = outputs.get(edge.source) ?? 0;
		const compensationFrames = compensation.get(edge.id) ?? 0;
		const arrivalOffsetFrames = sourceOffsetFrames + compensationFrames;
		const targetOffsetFrames = edge.destination.kind === 'output'
			? outputLatencyFrames.get(edge.destination.id) ?? 0
			: (inputs.get(edge.destination.key) ?? 0) + edge.destination.effectPrefixFrames;
		return Object.freeze({
			edgeId: edge.id,
			sourceOffsetFrames,
			compensationFrames,
			arrivalOffsetFrames,
			targetOffsetFrames,
		});
	});
	return Object.freeze({
		nodeInputLatencyFrames: inputs,
		nodeOutputLatencyFrames: outputs,
		edgeCompensationFrames: compensation,
		outputLatencyFrames,
		latencyFrames: Math.max(0, ...outputLatencyFrames.values()),
		landmarks: Object.freeze(landmarks),
	});
}

function vertexOutput(
	model: ReferenceModel,
	inputs: ReadonlyMap<string, number>,
	key: string,
	includeMaster: boolean,
): number {
	const vertex = model.vertices.get(key);
	if (!vertex) throw new ReferenceError(`Unknown V21 PDC reference vertex ${key}.`);
	const rackLatency = key === 'master' && !includeMaster ? 0 : vertex.rackLatencyFrames;
	return safeAdd(inputs.get(key) ?? 0, rackLatency, `${key} output latency`);
}

function assertAcyclic(
	vertices: ReadonlyMap<string, ReferenceVertex>,
	edges: readonly ReferenceEdge[],
): void {
	const outgoing = new Map(Array.from(vertices.keys(), (key) => [key, [] as string[]]));
	for (const edge of edges) {
		if (edge.destination.kind === 'vertex') outgoing.get(edge.source)?.push(edge.destination.key);
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (key: string): void => {
		if (visiting.has(key)) throw new TypeError('V21 PDC reference graph contains a cycle.');
		if (visited.has(key)) return;
		visiting.add(key);
		for (const next of outgoing.get(key) ?? []) visit(next);
		visiting.delete(key);
		visited.add(key);
	};
	for (const key of vertices.keys()) visit(key);
}

function createAutomationReference(
	model: ReferenceModel,
	solution: ReferenceSolution,
): (address: unknown) => number {
	const edges = new Map(model.edges.map((edge) => [edge.id, edge]));
	return (value: unknown): number => {
		const address = record(value, 'V21 PDC reference automation address');
		const kind = data(address, 'kind');
		if (kind === 'edge') {
			const id = identifier(data(address, 'edgeId'), 'V21 PDC reference automation edge');
			const edge = edges.get(id);
			if (!edge) throw new ReferenceError(`Unknown V21 PDC reference automation edge ${id}.`);
			return (solution.nodeOutputLatencyFrames.get(edge.source) ?? 0)
				+ (solution.edgeCompensationFrames.get(id) ?? 0);
		}
		const key = endpointKey(data(address, 'strip'), model.vertices, 'V21 PDC reference automation strip');
		if (kind === 'strip') return solution.nodeOutputLatencyFrames.get(key) ?? 0;
		if (kind !== 'effect') throw new RangeError('Unsupported V21 PDC reference automation address kind.');
		const effectId = identifier(data(address, 'effectId'), 'V21 PDC reference automation effect');
		const prefix = model.vertices.get(key)?.effectPrefixFrames.get(effectId);
		if (prefix === undefined) throw new ReferenceError(`Unknown V21 PDC reference automation effect ${effectId}.`);
		return (solution.nodeInputLatencyFrames.get(key) ?? 0) + prefix;
	};
}

function addVertex(vertices: Map<string, ReferenceVertex>, key: string, vertex: ReferenceVertex): void {
	if (vertices.has(key)) throw new RangeError(`Duplicate V21 PDC reference vertex ${key}.`);
	vertices.set(key, vertex);
}

function normalizedSampleRate(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 8_000 || Number(value) > 768_000) {
		throw new RangeError('V21 PDC reference sample rate must be an integer from 8000 through 768000.');
	}
	return Number(value);
}

function safeAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result) || result < 0) throw new RangeError(`${name} exceeds safe integer range.`);
	return result;
}

function identifier(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
		throw new TypeError(`${name} requires a bounded non-empty ID.`);
	}
	return value;
}

function array(value: unknown, name: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value;
}

function record(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain object.`);
	return value as DataRecord;
}

function data(value: DataRecord, field: string): unknown {
	const result = optionalData(value, field);
	if (result === undefined && !Object.hasOwn(value, field)) throw new TypeError(`V21 PDC reference requires ${field}.`);
	return result;
}

function optionalData(value: DataRecord, field: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	if (!descriptor) return undefined;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`V21 PDC reference ${field} must be an own enumerable data property.`);
	}
	return descriptor.value;
}
