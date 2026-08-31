/* SPDX-License-Identifier: AGPL-3.0-only */

/** One-frame, main-owned OpenFX transform for the selected V14 live carrier. */

import { createHash, type Hash } from 'node:crypto';

import {
	NATIVE_RGBA_FRAME_PACK_V1_FILE_HEADER_BYTES,
	NATIVE_RGBA_FRAME_PACK_V1_FRAME_HEADER_BYTES,
	nativeRgbaFramePackV1ByteLength,
} from '../src/common/editor/native-rgba-frame-pack-v1-contract.ts';
import { nativeMediaV14OpenFxCarrierFilter } from '../src/common/editor/native-media-v14-openfx-carrier.ts';
import {
	framescaperOpenFxPluginProjectionV1,
	type FramescaperOpenFxPluginProjectionV1,
} from '../src/common/editor/native-ofx-service-contract.ts';
import {
	assertUnifiedExactRenderPlanWithDeferredTimingReferences,
	type UnifiedExactRenderOpenFxNode,
	type UnifiedExactRenderPlanV14,
} from '../src/common/editor/unified-exact-render-plan.ts';
import { verifyFramescaperOpenFxEffectOpenFx } from '../src/framescaper/editor-native-openfx-authoring.ts';
import { HELPER_DATA_CHUNK_MAXIMUM_BYTES } from './helper-data-plane.ts';
import type {
	FramescaperOpenFxExecutionRequestV1,
} from './openfx-main-execution-request.ts';
import type { FramescaperOpenFxExecutionResultV1 } from './openfx-main-service.ts';

const MAGIC = new TextEncoder().encode('framescaper-rgba-frame-pack-v1\n');
const SHA256 = /^[a-f\d]{64}$/u;
const STREAM_ID = /^[a-f\d]{40}$/u;
const FACTORIES = new WeakSet<FramescaperOpenFxLiveFrameTransformFactory>();
const AUDITS = new WeakSet<FramescaperOpenFxLiveFrameTransformAudit>();
type TransformPhase = 'file-header' | 'frame-header' | 'frame' | 'done';

export interface FramescaperOpenFxLiveFrameTransformPorts {
	inventory(): readonly FramescaperOpenFxPluginProjectionV1[];
	execute(request: FramescaperOpenFxExecutionRequestV1): Promise<FramescaperOpenFxExecutionResultV1>;
}

export interface FramescaperOpenFxLiveFrameTransformSink {
	write(bytes: Uint8Array<ArrayBuffer>): PromiseLike<void> | void;
}

export interface FramescaperOpenFxLiveFrameTransformAudit {
	readonly rendererInput: Readonly<{ readonly byteLength: number; readonly sha256: string }>;
	readonly transformedOutput: Readonly<{ readonly byteLength: number; readonly sha256: string }>;
	readonly frameCount: number;
	readonly reportsDegradation: boolean;
}

export interface FramescaperOpenFxLiveFrameTransformSession {
	write(bytes: unknown): Promise<void>;
	complete(trailer: unknown): Promise<FramescaperOpenFxLiveFrameTransformAudit>;
	abort(reason?: unknown): void;
}

export type FramescaperOpenFxLiveFrameTransformFactory = (request: Readonly<{
	readonly plan: unknown;
	readonly signal: AbortSignal;
	readonly sink: FramescaperOpenFxLiveFrameTransformSink;
}>) => FramescaperOpenFxLiveFrameTransformSession | null;

export function createFramescaperOpenFxLiveFrameTransformFactory(
	portsValue: FramescaperOpenFxLiveFrameTransformPorts,
): FramescaperOpenFxLiveFrameTransformFactory {
	const ports = exactPorts(portsValue);
	const factory: FramescaperOpenFxLiveFrameTransformFactory = (requestValue) => {
		const request = exactRequest(requestValue);
		const binding = resolveBinding(request.plan, ports.inventory());
		return binding === null ? null : new LiveFrameTransform(request, ports, binding);
	};
	FACTORIES.add(factory);
	return Object.freeze(factory);
}

export function isFramescaperOpenFxLiveFrameTransformFactory(
	value: unknown,
): value is FramescaperOpenFxLiveFrameTransformFactory {
	return typeof value === 'function' && FACTORIES.has(value as FramescaperOpenFxLiveFrameTransformFactory);
}

export function isFramescaperOpenFxLiveFrameTransformAudit(
	value: unknown,
): value is FramescaperOpenFxLiveFrameTransformAudit {
	return Boolean(value && typeof value === 'object'
		&& AUDITS.has(value as FramescaperOpenFxLiveFrameTransformAudit));
}

interface TransformRequest {
	readonly plan: UnifiedExactRenderPlanV14;
	readonly signal: AbortSignal;
	readonly sink: FramescaperOpenFxLiveFrameTransformSink;
}

interface TransformBinding {
	readonly node: UnifiedExactRenderOpenFxNode;
	readonly plugin: FramescaperOpenFxPluginProjectionV1;
	readonly width: number;
	readonly height: number;
	readonly frameCount: number;
	readonly frameBytes: number;
	readonly expectedBytes: number;
}

class LiveFrameTransform implements FramescaperOpenFxLiveFrameTransformSession {
	readonly #request: TransformRequest;
	readonly #ports: FramescaperOpenFxLiveFrameTransformPorts;
	readonly #binding: TransformBinding;
	readonly #abort = new AbortController();
	readonly #inputHash = createHash('sha256');
	readonly #outputHash = createHash('sha256');
	readonly #forwardAbort: () => void;
	#phase: TransformPhase = 'file-header';
	#segment = new Uint8Array(NATIVE_RGBA_FRAME_PACK_V1_FILE_HEADER_BYTES);
	#segmentOffset = 0;
	#ordinal = 0;
	#inputBytes = 0;
	#outputBytes = 0;
	#writing = false;
	#failed = false;
	#closed = false;
	#reportsDegradation = false;

	constructor(
		request: TransformRequest,
		ports: FramescaperOpenFxLiveFrameTransformPorts,
		binding: TransformBinding,
	) {
		this.#request = request;
		this.#ports = ports;
		this.#binding = binding;
		this.#forwardAbort = () => this.abort(request.signal.reason);
		if (request.signal.aborted) this.#forwardAbort();
		else request.signal.addEventListener('abort', this.#forwardAbort, { once: true });
	}

	async write(bytesValue: unknown): Promise<void> {
		if (this.#writing) {
			const error = new Error('Concurrent OpenFX frame-pack writes are forbidden.');
			this.#fail(error); throw error;
		}
		this.#assertOpen();
		const bytes = exactBytes(bytesValue);
		this.#writing = true;
		try {
			this.#inputBytes += bytes.byteLength;
			if (this.#inputBytes > this.#binding.expectedBytes) {
				throw new RangeError('The OpenFX renderer carrier exceeds its exact plan length.');
			}
			this.#inputHash.update(bytes);
			for (let offset = 0; offset < bytes.byteLength;) {
				this.#assertOpen();
				if (this.#phase === 'done') throw new Error('The OpenFX frame-pack has trailing bytes.');
				const count = Math.min(bytes.byteLength - offset, this.#segment.length - this.#segmentOffset);
				this.#segment.set(bytes.subarray(offset, offset + count), this.#segmentOffset);
				this.#segmentOffset += count; offset += count;
				if (this.#segmentOffset === this.#segment.length) await this.#consumeSegment();
			}
		} catch (error) { this.#fail(error); throw error; }
		finally { this.#writing = false; }
	}

	async complete(trailerValue: unknown): Promise<FramescaperOpenFxLiveFrameTransformAudit> {
		this.#assertOpen();
		if (this.#writing) throw new Error('An OpenFX frame-pack cannot complete during a write.');
		const trailer = exactTrailer(trailerValue);
		try {
			if (this.#phase !== 'done' || this.#segmentOffset !== 0
				|| this.#inputBytes !== this.#binding.expectedBytes
				|| this.#outputBytes !== this.#binding.expectedBytes) {
				throw new Error('The OpenFX frame-pack ended before its exact plan shape.');
			}
			const rendererInput = descriptor(this.#inputBytes, this.#inputHash);
			if (trailer.byteLength !== rendererInput.byteLength || trailer.sha256 !== rendererInput.sha256) {
				throw new Error('The renderer and main disagree on the OpenFX carrier trailer.');
			}
			const transformedOutput = descriptor(this.#outputBytes, this.#outputHash);
			const audit = Object.freeze({
				rendererInput, transformedOutput, frameCount: this.#binding.frameCount,
				reportsDegradation: this.#reportsDegradation,
			});
			AUDITS.add(audit);
			this.#close();
			return audit;
		} catch (error) { this.#fail(error); throw error; }
	}

	abort(reason: unknown = new DOMException('OpenFX carrier transform was cancelled.', 'AbortError')): void {
		this.#fail(reason);
	}

	async #consumeSegment(): Promise<void> {
		if (this.#phase === 'file-header') {
			validateFileHeader(this.#segment, this.#request.plan, this.#binding);
			await this.#emit(this.#segment);
			this.#replaceSegment('frame-header', NATIVE_RGBA_FRAME_PACK_V1_FRAME_HEADER_BYTES);
			return;
		}
		if (this.#phase === 'frame-header') {
			validateFrameHeader(this.#segment, this.#ordinal, this.#binding.frameBytes);
			await this.#emit(this.#segment);
			this.#replaceSegment('frame', this.#binding.frameBytes);
			return;
		}
		if (this.#phase !== 'frame') throw new Error('The OpenFX frame-pack parser escaped its state.');
		const input = this.#segment;
		this.#segment = new Uint8Array(0); this.#segmentOffset = 0;
		try {
			const result = await this.#ports.execute(Object.freeze({
				pluginHandle: this.#binding.plugin.pluginHandle,
				plan: this.#request.plan,
				instanceId: this.#binding.node.state.instanceId,
				requestedBackend: 'cpu' as const,
				outputOrdinal: this.#ordinal,
				inputs: Object.freeze([Object.freeze({
					name: 'Source', sourceRef: this.#request.plan.sources[0]!.sourceId,
					width: this.#binding.width, height: this.#binding.height,
					rowBytes: this.#binding.width * 4, rgba: input,
				})]),
				retimerSourceTime: null, signal: this.#abort.signal,
			}));
			const output = exactRenderedFrame(result, this.#binding.frameBytes);
			this.#reportsDegradation ||= result.reportsDegradation;
			this.#ordinal += 1;
			if (this.#ordinal === this.#binding.frameCount) this.#replaceSegment('done', 0);
			else this.#replaceSegment('frame-header', NATIVE_RGBA_FRAME_PACK_V1_FRAME_HEADER_BYTES);
			await this.#emit(output);
			output.fill(0);
		} finally { input.fill(0); }
	}

	async #emit(value: Uint8Array): Promise<void> {
		for (let offset = 0; offset < value.byteLength; offset += HELPER_DATA_CHUNK_MAXIMUM_BYTES) {
			this.#assertOpen();
			const bytes = value.slice(offset, Math.min(value.byteLength,
				offset + HELPER_DATA_CHUNK_MAXIMUM_BYTES));
			this.#outputHash.update(bytes); this.#outputBytes += bytes.byteLength;
			await this.#request.sink.write(bytes);
		}
	}

	#replaceSegment(phase: TransformPhase, bytes: number): void {
		this.#segment.fill(0); this.#phase = phase;
		this.#segment = new Uint8Array(bytes); this.#segmentOffset = 0;
	}

	#assertOpen(): void {
		if (this.#failed || this.#closed) throw new Error('The OpenFX frame-pack transform is not active.');
		this.#abort.signal.throwIfAborted();
	}

	#fail(reason: unknown): void {
		if (this.#failed || this.#closed) return;
		this.#failed = true; this.#segment.fill(0);
		this.#abort.abort(reason); this.#dispose();
	}

	#close(): void { this.#closed = true; this.#segment.fill(0); this.#dispose(); }
	#dispose(): void { this.#request.signal.removeEventListener('abort', this.#forwardAbort); }
}

function exactPorts(value: unknown): FramescaperOpenFxLiveFrameTransformPorts {
	const row = exactRecord(value, ['inventory', 'execute'], 'OpenFX transform ports');
	if (typeof row.inventory !== 'function' || typeof row.execute !== 'function') {
		throw new TypeError('OpenFX transform ports must be main-owned methods.');
	}
	return value as FramescaperOpenFxLiveFrameTransformPorts;
}

function exactRequest(value: unknown): TransformRequest {
	const row = exactRecord(value, ['plan', 'signal', 'sink'], 'OpenFX transform request');
	assertUnifiedExactRenderPlanWithDeferredTimingReferences(row.plan);
	if (row.plan.version !== 14 || !(row.signal instanceof AbortSignal)) {
		throw new TypeError('OpenFX live transformation requires an exact V14 plan and cancellation.');
	}
	const sink = exactRecord(row.sink, ['write'], 'OpenFX transform sink');
	if (typeof sink.write !== 'function') throw new TypeError('OpenFX transformation requires one awaited sink.');
	return Object.freeze({
		plan: row.plan as UnifiedExactRenderPlanV14, signal: row.signal,
		sink: row.sink as FramescaperOpenFxLiveFrameTransformSink,
	});
}

function resolveBinding(
	plan: UnifiedExactRenderPlanV14,
	inventoryValue: readonly FramescaperOpenFxPluginProjectionV1[],
): TransformBinding | null {
	const openFxCount = plan.nodes.filter(({ kind }) => kind === 'openfx').length;
	if (openFxCount === 0) return null;
	const node = nativeMediaV14OpenFxCarrierFilter(plan);
	if (node === null) throw new Error(
		'Selected V28 live OpenFX admits one enabled source-bound identity filter.',
	);
	const state = node.state;
	const inventory = exactInventory(inventoryValue);
	const matches = inventory.filter((plugin) => plugin.pluginId === state.pluginId
		&& plugin.binarySha256 === state.binarySha256);
	if (matches.length !== 1) throw new Error('The exact OpenFX plug-in projection is unavailable or ambiguous.');
	const plugin = matches[0]!;
	if (plugin.state !== 'enabled' || plugin.quarantined || !plugin.supportedContexts.includes('filter')
		|| !plugin.components.includes('RGBA') || !plugin.pixelDepths.includes('byte')) {
		throw new Error('The exact OpenFX filter is not enabled for RGBA8 production.');
	}
	verifyFramescaperOpenFxEffectOpenFx(plugin, state);
	const width = plan.output.canvas.width; const height = plan.output.canvas.height;
	const frameCount = plan.output.frameCount; const frameBytes = width * height * 4;
	return Object.freeze({
		node, plugin, width, height, frameCount, frameBytes,
		expectedBytes: nativeRgbaFramePackV1ByteLength({ width, height, frameCount }),
	});
}

function exactInventory(value: unknown): readonly FramescaperOpenFxPluginProjectionV1[] {
	if (!Array.isArray(value) || value.length > 1_024
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError('OpenFX transformation requires a bounded dense inventory.');
	}
	return Object.freeze(value.map(framescaperOpenFxPluginProjectionV1));
}

function validateFileHeader(
	bytes: Uint8Array,
	plan: UnifiedExactRenderPlanV14,
	binding: TransformBinding,
): void {
	if (bytes.byteLength !== NATIVE_RGBA_FRAME_PACK_V1_FILE_HEADER_BYTES
		|| MAGIC.some((value, index) => bytes[index] !== value)) {
		throw new Error('The OpenFX frame-pack file header has invalid magic.');
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(31, true) !== 1 || view.getUint32(35, true) !== binding.width
		|| view.getUint32(39, true) !== binding.height
		|| view.getBigUint64(43, true) !== BigInt(binding.frameCount)
		|| view.getUint32(51, true) !== plan.output.frameRate.den
		|| view.getUint32(55, true) !== plan.output.frameRate.num) {
		throw new Error('The OpenFX frame-pack header disagrees with the exact V14 plan.');
	}
}

function validateFrameHeader(bytes: Uint8Array, ordinal: number, frameBytes: number): void {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.byteLength !== NATIVE_RGBA_FRAME_PACK_V1_FRAME_HEADER_BYTES
		|| view.getBigUint64(0, true) !== BigInt(ordinal)
		|| view.getBigInt64(8, true) !== BigInt(ordinal)
		|| view.getBigInt64(16, true) !== 1n
		|| view.getBigUint64(24, true) !== BigInt(frameBytes)) {
		throw new Error('The OpenFX frame header changed ordinal, timing, or RGBA shape.');
	}
}

function exactRenderedFrame(value: unknown, expectedBytes: number): Uint8Array<ArrayBuffer> {
	if (!value || typeof value !== 'object' || (value as { mode?: unknown }).mode !== 'render') {
		throw new Error('OpenFX live transformation refuses frozen or bypass recovery.');
	}
	const result = value as Extract<FramescaperOpenFxExecutionResultV1, { readonly mode: 'render' }>;
	if (result.availability !== 'available' || result.authoredStatePreserved !== true
		|| typeof result.reportsDegradation !== 'boolean' || result.backend !== 'cpu'
		|| result.retriedOnCpu !== false || !(result.rgba instanceof Uint8Array)
		|| Object.getPrototypeOf(result.rgba) !== Uint8Array.prototype
		|| !(result.rgba.buffer instanceof ArrayBuffer) || result.rgba.byteLength !== expectedBytes
		|| !result.output || typeof result.output !== 'object'
		|| !STREAM_ID.test(String(result.output.streamId))) {
		throw new Error('The OpenFX main service returned an invalid exact RGBA8 result.');
	}
	const bytes = new Uint8Array(result.rgba);
	const observed = digestBytes(bytes);
	if (result.output.byteLength !== bytes.byteLength || result.output.sha256 !== observed) {
		throw new Error('The OpenFX control and output planes disagree on the transformed frame.');
	}
	return bytes;
}

function exactBytes(value: unknown): Uint8Array<ArrayBuffer> {
	if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype
		|| !(value.buffer instanceof ArrayBuffer) || value.byteLength < 1
		|| value.byteLength > HELPER_DATA_CHUNK_MAXIMUM_BYTES) {
		throw new TypeError('An OpenFX frame-pack write must be one bounded owned Uint8Array.');
	}
	return new Uint8Array(value);
}

function exactTrailer(value: unknown): Readonly<{ byteLength: number; sha256: string }> {
	const row = exactRecord(value, ['byteLength', 'sha256'], 'OpenFX renderer trailer');
	if (!Number.isSafeInteger(row.byteLength) || Number(row.byteLength) < 1
		|| typeof row.sha256 !== 'string' || !SHA256.test(row.sha256)) {
		throw new TypeError('The OpenFX renderer trailer is invalid.');
	}
	return Object.freeze({ byteLength: Number(row.byteLength), sha256: row.sha256 });
}

function exactRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be one closed plain record.`);
	}
	const row = value as Record<string, unknown>; const keys = Reflect.ownKeys(row);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string'
		|| !fields.includes(key) || !Object.getOwnPropertyDescriptor(row, key)?.enumerable
		|| !Object.hasOwn(Object.getOwnPropertyDescriptor(row, key)!, 'value'))) {
		throw new TypeError(`${label} has unsupported fields.`);
	}
	return row;
}

function descriptor(byteLength: number, hash: Hash) {
	return Object.freeze({ byteLength, sha256: hash.digest('hex') });
}

function digestBytes(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
