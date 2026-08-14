/* SPDX-License-Identifier: AGPL-3.0-only */

import { ReviewedEffectError, reviewedEffectError } from './errors.ts';
import {
	REVIEWED_EFFECT_ABI_VERSION,
	REVIEWED_EFFECT_LATENCY_EXPORT,
	REVIEWED_EFFECT_MEMORY_EXPORT,
	REVIEWED_EFFECT_PROCESS_EXPORT,
	REVIEWED_EFFECT_TAIL_EXPORT,
	REVIEWED_EFFECT_VERSION_EXPORT,
	type ReviewedEffectManifest,
} from './manifest.ts';

const WASM_PAGE_BYTES = 65_536;
const REQUIRED_EXPORTS = Object.freeze([
	Object.freeze({ name: REVIEWED_EFFECT_MEMORY_EXPORT, kind: 'memory' }),
	Object.freeze({ name: REVIEWED_EFFECT_VERSION_EXPORT, kind: 'global' }),
	Object.freeze({ name: REVIEWED_EFFECT_LATENCY_EXPORT, kind: 'global' }),
	Object.freeze({ name: REVIEWED_EFFECT_TAIL_EXPORT, kind: 'global' }),
	Object.freeze({ name: REVIEWED_EFFECT_PROCESS_EXPORT, kind: 'function' }),
]);
const PROCESS_PARAMETERS = Object.freeze([0x7f, 0x7f, 0x7f, 0x7f, 0x7d, 0x7f, 0x7f]);
const PROCESS_RESULTS = Object.freeze([0x7f]);

interface FunctionType {
	readonly parameters: readonly number[];
	readonly results: readonly number[];
}

interface BinaryInspection {
	readonly minimumMemoryPages: number;
	readonly maximumMemoryPages: number;
}

export interface ValidatedReviewedEffectModule extends BinaryInspection {
	readonly module: WebAssembly.Module;
}

/** Compile only after the closed ABI and declared resource envelope pass. */
export async function compileReviewedEffectWasm(
	bytes: Uint8Array,
	manifest: ReviewedEffectManifest,
): Promise<ValidatedReviewedEffectModule> {
	if (!(bytes instanceof Uint8Array)) throw new TypeError('Reviewed effect WASM must be a Uint8Array.');
	if (bytes.byteLength > manifest.resources.maximumModuleBytes) {
		throw reviewedEffectError('WASM_LIMIT', 'Reviewed effect WASM exceeds its declared module byte limit.');
	}
	let inspection: BinaryInspection;
	try {
		inspection = inspectBinary(bytes, manifest);
	} catch (error) {
		if (error instanceof ReviewedEffectError) throw error;
		throw reviewedEffectError(
			'ABI_INVALID',
			error instanceof Error ? error.message : 'Reviewed effect WASM has a malformed binary ABI.',
			error,
		);
	}
	let module: WebAssembly.Module;
	try {
		module = await WebAssembly.compile(Uint8Array.from(bytes));
	} catch (error) {
		throw reviewedEffectError('ABI_INVALID', 'Reviewed effect WASM could not be compiled.', error);
	}
	if (WebAssembly.Module.imports(module).length !== 0) {
		throw reviewedEffectError('FORBIDDEN_IMPORT', 'Reviewed effect WASM contains forbidden imports.');
	}
	const exports = WebAssembly.Module.exports(module);
	if (!sameDescriptors(exports, REQUIRED_EXPORTS)) {
		throw reviewedEffectError('ABI_INVALID', 'Reviewed effect WASM exports do not match the closed ABI.');
	}
	let instance: WebAssembly.Instance;
	try {
		instance = new WebAssembly.Instance(module, {});
	} catch (error) {
		throw reviewedEffectError('ABI_INVALID', 'Reviewed effect WASM could not be instantiated.', error);
	}
	const memory = instance.exports[REVIEWED_EFFECT_MEMORY_EXPORT];
	const version = instance.exports[REVIEWED_EFFECT_VERSION_EXPORT];
	const latency = instance.exports[REVIEWED_EFFECT_LATENCY_EXPORT];
	const tail = instance.exports[REVIEWED_EFFECT_TAIL_EXPORT];
	const process = instance.exports[REVIEWED_EFFECT_PROCESS_EXPORT];
	if (!(memory instanceof WebAssembly.Memory)
		|| !(version instanceof WebAssembly.Global)
		|| version.value !== REVIEWED_EFFECT_ABI_VERSION
		|| !(latency instanceof WebAssembly.Global)
		|| latency.value !== manifest.latencyFrames
		|| !(tail instanceof WebAssembly.Global)
		|| tail.value !== manifest.tailFrames
		|| typeof process !== 'function'
		|| process.length !== PROCESS_PARAMETERS.length
		|| memory.buffer.byteLength > manifest.resources.maximumMemoryPages * WASM_PAGE_BYTES) {
		throw reviewedEffectError('ABI_INVALID', 'Reviewed effect WASM runtime exports do not match ABI v1.');
	}
	return Object.freeze({ module, ...inspection });
}

function inspectBinary(bytes: Uint8Array, manifest: ReviewedEffectManifest): BinaryInspection {
	const cursor = new Cursor(bytes);
	for (const expected of [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]) {
		if (cursor.byte() !== expected) throw new RangeError('Invalid WebAssembly header.');
	}
	let types: readonly FunctionType[] | null = null;
	let functions: readonly number[] | null = null;
	let memory: BinaryInspection | null = null;
	let metadataGlobals: readonly number[] | null = null;
	let exports: ReadonlyMap<string, Readonly<{ kind: number; index: number }>> | null = null;
	const seen = new Set<number>();
	while (!cursor.done) {
		const sectionId = cursor.byte();
		const section = cursor.section(cursor.u32());
		if (sectionId !== 0 && seen.has(sectionId)) throw new RangeError('Duplicate WebAssembly section.');
		if (sectionId !== 0) seen.add(sectionId);
		switch (sectionId) {
			case 0:
				break;
			case 1:
				types = readTypes(section);
				break;
			case 2:
				if (section.u32() !== 0) {
					throw reviewedEffectError('FORBIDDEN_IMPORT', 'Reviewed effect WASM contains forbidden imports.');
				}
				section.requireDone();
				break;
			case 3:
				functions = readU32Vector(section);
				break;
			case 4:
				throw reviewedEffectError('ABI_INVALID', 'Reviewed effect WASM tables are outside the closed ABI.');
			case 5:
				memory = readMemory(section, manifest);
				break;
			case 6:
				metadataGlobals = readMetadataGlobals(section);
				break;
			case 7:
				exports = readExports(section);
				break;
			case 8:
				throw reviewedEffectError('ABI_INVALID', 'Reviewed effect WASM start functions are forbidden.');
			default:
				break;
		}
	}
	if (!types || !functions || !memory || !metadataGlobals || !exports) {
		throw new RangeError('Reviewed effect WASM is missing required ABI sections.');
	}
	const memoryExport = exports.get(REVIEWED_EFFECT_MEMORY_EXPORT);
	const versionExport = exports.get(REVIEWED_EFFECT_VERSION_EXPORT);
	const latencyExport = exports.get(REVIEWED_EFFECT_LATENCY_EXPORT);
	const tailExport = exports.get(REVIEWED_EFFECT_TAIL_EXPORT);
	const processExport = exports.get(REVIEWED_EFFECT_PROCESS_EXPORT);
	if (exports.size !== 5
		|| memoryExport?.kind !== 2 || memoryExport.index !== 0
		|| versionExport?.kind !== 3 || versionExport.index !== 0
		|| latencyExport?.kind !== 3 || latencyExport.index !== 1
		|| tailExport?.kind !== 3 || tailExport.index !== 2
		|| processExport?.kind !== 0) {
		throw new RangeError('Reviewed effect WASM exports do not match the closed ABI.');
	}
	const processTypeIndex = functions[processExport.index];
	const processType = processTypeIndex === undefined ? undefined : types[processTypeIndex];
	if (!processType
		|| !sameNumbers(processType.parameters, PROCESS_PARAMETERS)
		|| !sameNumbers(processType.results, PROCESS_RESULTS)) {
		throw new RangeError('Reviewed effect process export has the wrong function signature.');
	}
	if (metadataGlobals[0] !== REVIEWED_EFFECT_ABI_VERSION
		|| metadataGlobals[1] !== manifest.latencyFrames
		|| metadataGlobals[2] !== manifest.tailFrames) {
		throw new RangeError('Reviewed effect latency, tail, or ABI metadata does not match its manifest.');
	}
	return memory;
}

function readTypes(cursor: Cursor): readonly FunctionType[] {
	const count = cursor.u32();
	const types: FunctionType[] = [];
	for (let index = 0; index < count; index += 1) {
		if (cursor.byte() !== 0x60) throw new RangeError('Unsupported WebAssembly type form.');
		types.push(Object.freeze({ parameters: readValueTypes(cursor), results: readValueTypes(cursor) }));
	}
	cursor.requireDone();
	return Object.freeze(types);
}

function readValueTypes(cursor: Cursor): readonly number[] {
	const count = cursor.u32();
	const values: number[] = [];
	for (let index = 0; index < count; index += 1) values.push(cursor.byte());
	return Object.freeze(values);
}

function readU32Vector(cursor: Cursor): readonly number[] {
	const count = cursor.u32();
	const values = Array.from({ length: count }, () => cursor.u32());
	cursor.requireDone();
	return Object.freeze(values);
}

function readMemory(cursor: Cursor, manifest: ReviewedEffectManifest): BinaryInspection {
	if (cursor.u32() !== 1 || cursor.u32() !== 1) {
		throw reviewedEffectError('ABI_INVALID', 'Reviewed effect WASM requires one bounded, unshared 32-bit memory.');
	}
	const minimumMemoryPages = cursor.u32();
	const maximumMemoryPages = cursor.u32();
	cursor.requireDone();
	const requiredBytes = manifest.resources.maximumInputBytes
		+ manifest.resources.maximumOutputBytes
		+ manifest.parameters.length * Float32Array.BYTES_PER_ELEMENT;
	if (minimumMemoryPages < 1 || maximumMemoryPages < minimumMemoryPages
		|| maximumMemoryPages > manifest.resources.maximumMemoryPages
		|| maximumMemoryPages * WASM_PAGE_BYTES < requiredBytes) {
		throw reviewedEffectError('WASM_LIMIT', 'Reviewed effect WASM memory exceeds its declared page limit.');
	}
	return Object.freeze({ minimumMemoryPages, maximumMemoryPages });
}

function readMetadataGlobals(cursor: Cursor): readonly number[] {
	const count = cursor.u32();
	if (count !== 3) throw new RangeError('Reviewed effect WASM must declare exactly three metadata globals.');
	const values: number[] = [];
	for (let index = 0; index < count; index += 1) {
		if (cursor.byte() !== 0x7f || cursor.byte() !== 0 || cursor.byte() !== 0x41) {
			throw new RangeError('Reviewed effect WASM metadata globals must be immutable i32 constants.');
		}
		values.push(cursor.i32());
		if (cursor.byte() !== 0x0b) throw new RangeError('Reviewed effect WASM metadata global is malformed.');
	}
	cursor.requireDone();
	return Object.freeze(values);
}

function readExports(cursor: Cursor): ReadonlyMap<string, Readonly<{ kind: number; index: number }>> {
	const count = cursor.u32();
	const exports = new Map<string, Readonly<{ kind: number; index: number }>>();
	for (let index = 0; index < count; index += 1) {
		const name = cursor.text();
		if (exports.has(name)) throw new RangeError('Duplicate WebAssembly export.');
		exports.set(name, Object.freeze({ kind: cursor.byte(), index: cursor.u32() }));
	}
	cursor.requireDone();
	return exports;
}

function sameDescriptors(
	actual: readonly WebAssembly.ModuleExportDescriptor[],
	expected: readonly Readonly<{ name: string; kind: string }>[],
): boolean {
	return actual.length === expected.length && expected.every((descriptor) => actual.some(
		(candidate) => candidate.name === descriptor.name && candidate.kind === descriptor.kind,
	));
}

function sameNumbers(actual: readonly number[], expected: readonly number[]): boolean {
	return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

class Cursor {
	readonly bytes: Uint8Array;
	position = 0;

	constructor(bytes: Uint8Array) {
		this.bytes = bytes;
	}

	get done(): boolean { return this.position === this.bytes.byteLength; }

	byte(): number {
		if (this.position >= this.bytes.byteLength) throw new RangeError('Unexpected end of WebAssembly binary.');
		return this.bytes[this.position++]!;
	}

	u32(): number {
		let result = 0;
		for (let shift = 0; shift < 35; shift += 7) {
			const byte = this.byte();
			result += (byte & 0x7f) * 2 ** shift;
			if ((byte & 0x80) === 0) {
				if (!Number.isSafeInteger(result) || result > 0xffff_ffff) throw new RangeError('Invalid unsigned LEB128.');
				return result;
			}
		}
		throw new RangeError('Invalid unsigned LEB128.');
	}

	i32(): number {
		let result = 0;
		let shift = 0;
		let byte = 0;
		do {
			byte = this.byte();
			result |= (byte & 0x7f) << shift;
			shift += 7;
		} while ((byte & 0x80) !== 0 && shift < 35);
		if ((byte & 0x80) !== 0) throw new RangeError('Invalid signed LEB128.');
		if (shift < 32 && (byte & 0x40) !== 0) result |= ~0 << shift;
		return result | 0;
	}

	text(): string {
		const length = this.u32();
		const end = this.position + length;
		if (end > this.bytes.byteLength) throw new RangeError('Invalid WebAssembly name length.');
		const value = new TextDecoder('utf-8', { fatal: true }).decode(this.bytes.subarray(this.position, end));
		this.position = end;
		return value;
	}

	section(length: number): Cursor {
		const end = this.position + length;
		if (!Number.isSafeInteger(end) || end > this.bytes.byteLength) throw new RangeError('Invalid WebAssembly section length.');
		const section = new Cursor(this.bytes.subarray(this.position, end));
		this.position = end;
		return section;
	}

	requireDone(): void {
		if (!this.done) throw new RangeError('Unexpected data in WebAssembly section.');
	}
}
