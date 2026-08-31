/* SPDX-License-Identifier: AGPL-3.0-only */

/** Addon-shaped async proxy for the actually isolated professional plug-in peer. */

import { lstat, readdir, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type { HelperFileIdentity, HelperPluginFormat } from './helper-job-grant.ts';
import { nativeChildFileIdentityFromStat } from './native-child-file-identity.ts';
import {
	isEnforcedNativeChildLaunch,
	type NativeChildIsolationArtifactDescriptor,
	type NativeChildIsolationLaunch,
	type NativeChildIsolationPathGrant,
} from './native-child-isolation-launcher.ts';
import type { HelperJobResourcePolicy } from './helper-resource-policy.ts';
import { snapshotAuthenticatedPluginCandidate } from './plugin-candidate-snapshot.mjs';

const VERSION = 1;
const MAXIMUM_FRAME_BYTES = 16 * 1024 ** 2;
const MAXIMUM_STATE_BYTES = MAXIMUM_FRAME_BYTES - 64;
const MAXIMUM_CANDIDATES = 512;
const MAXIMUM_DEPTH = 16;
const OPERATION = Object.freeze({
	scan: 1, open: 2, process: 3, latency: 4, save: 5, load: 6, close: 7, vendor: 8,
});
const STATUS = Object.freeze([
	'ok', 'backend-unavailable', 'server-unavailable', 'device-unavailable', 'format-refused',
	'mode-refused', 'unreadable', 'malformed', 'state-too-large', 'state-rejected', 'unsupported',
]);

export interface ProfessionalPluginPeerContext {
	readonly identity: Readonly<HelperFileIdentity>;
	readonly byteLength: number;
	readonly sha256: string;
	readonly resourcePolicy: HelperJobResourcePolicy;
}

export interface ProfessionalPluginPeerLauncher {
	launch(request: Readonly<{
		readonly executable: NativeChildIsolationArtifactDescriptor;
		readonly arguments: readonly string[];
		readonly readOnly: readonly NativeChildIsolationPathGrant[];
		readonly readExecute: readonly NativeChildIsolationPathGrant[];
		readonly writeOnly: readonly NativeChildIsolationPathGrant[];
		readonly runtimeClosure: readonly NativeChildIsolationArtifactDescriptor[];
		readonly workloadPayload: NativeChildIsolationArtifactDescriptor;
		readonly resourcePolicy: Readonly<{ maximumJobDurationMs: number; maximumRssBytes: number }>;
		readonly framedControl: Readonly<{
			readonly protocolVersion: 1;
			readonly maximumMessageBytes: number;
			readonly maximumInFlightMessages: number;
		}>;
	}>): Promise<NativeChildIsolationLaunch>;
}

interface PeerDescription {
	readonly status: 'ok';
	readonly stableId: string;
	readonly name: string;
	readonly vendor: string;
	readonly version: string;
	readonly classification: 'effect' | 'instrument';
	readonly inputChannels: number;
	readonly outputChannels: number;
	readonly realtime: true;
	readonly offline: true;
	readonly reportedLatencyFrames: number;
}

interface PeerInstance {
	readonly session: PeerSession;
	readonly description: PeerDescription;
	latency: number;
	vendorWindowCapability: string | null;
}

interface PeerSession {
	readonly launch: NativeChildIsolationLaunch;
	readonly pluginPath: string;
	request(operation: number, build?: (writer: BinaryWriter) => void): Promise<BinaryReader>;
	close(): Promise<void>;
}

const instances = new WeakSet<object>();

export function createSoundscaperProfessionalPluginPeer(options: Readonly<{
	readonly launcher: ProfessionalPluginPeerLauncher;
	readonly peerExecutable: NativeChildIsolationArtifactDescriptor;
	readonly entryExecutable?: NativeChildIsolationArtifactDescriptor;
	readonly entryArguments?: readonly string[];
	readonly runtimeReadExecute: readonly NativeChildIsolationArtifactDescriptor[];
	readonly pluginFormats: readonly Exclude<HelperPluginFormat, 'fixture'>[];
}>) {
	const formats = pluginFormats(options.pluginFormats);
	const executable = options.peerExecutable;
	const entryExecutable = options.entryExecutable ?? executable;
	const entryArguments = options.entryArguments === undefined
		? (entryExecutable.path === executable.path ? [] : ['--library-path', dirname(entryExecutable.path)])
		: entryExecutable.path === executable.path && Array.isArray(options.entryArguments)
			&& options.entryArguments.length === 0
			? Object.freeze([]) : loaderArguments(options.entryArguments);
	const runtimeReadExecute = Object.freeze([...options.runtimeReadExecute]);
	return Object.freeze({
		describe: async () => Object.freeze({
			addonVersion: '1.0.0', buildId: 'soundscaper-professional-isolated-peer', napiVersion: 0,
			maximumChannelCount: 4096, maximumFrameCount: 65_536, pluginFormats: formats,
		}),
		listPluginCandidates,
		inspectPluginCandidate: async (path: string, format: HelperPluginFormat, context: ProfessionalPluginPeerContext) => {
			admittedFormat(formats, format);
			const session = await openSession(options.launcher, executable, entryExecutable, entryArguments,
				runtimeReadExecute, path, context);
			let scanCompleted = false;
			let operationFailed = false;
			let operationError: unknown;
			try {
				const answer = await session.request(OPERATION.scan, (writer) => {
					writer.text(format); writer.text(session.pluginPath);
				});
				const count = answer.unsigned32();
				if (count < 1 || count > 256) throw new Error('The isolated peer returned an ambiguous descriptor set.');
				const descriptions = Array.from({ length: count }, () => readDescription(answer));
				answer.done();
				scanCompleted = true;
				if (new Set(descriptions.map(({ stableId }) => stableId)).size !== descriptions.length) {
					throw new Error('The isolated peer returned duplicate stable plug-in IDs.');
				}
				return Object.freeze(descriptions);
			} catch (error) {
				operationFailed = true;
				operationError = error;
				throw error;
			} finally {
				try { await session.close(); }
				catch (closeError) {
					if (operationFailed) throw new AggregateError(
						[operationError, closeError],
						`The isolated professional scan and shutdown both failed; scan-completed=${String(scanCompleted)}.`,
					);
					throw closeError;
				}
			}
		},
		openPluginInstance: async (
			path: string, sampleRate: number, maximumFrames: number, format: HelperPluginFormat,
			stableId: string, context: ProfessionalPluginPeerContext,
		) => {
			admittedFormat(formats, format);
			const session = await openSession(options.launcher, executable, entryExecutable, entryArguments,
				runtimeReadExecute, path, context);
			try {
				const answer = await session.request(OPERATION.open, (writer) => {
					writer.text(format); writer.text(session.pluginPath); writer.text(stableId);
					writer.number(sampleRate); writer.unsigned32(maximumFrames);
				});
				const description = readDescription(answer);
				answer.done();
				if (description.stableId !== stableId) throw new Error('The isolated peer opened a different descriptor.');
				const instance = {
					session, description, latency: description.reportedLatencyFrames,
					vendorWindowCapability: null,
				};
				instances.add(instance);
				return instance;
			} catch (error) { await session.close(); throw error; }
		},
		processPluginBlock: async (
			value: PeerInstance, frames: number, input: readonly Float32Array[] | null,
			output: readonly Float32Array[],
		) => {
			const instance = liveInstance(value);
			const inputs = input ?? [];
			planes(inputs, instance.description.inputChannels, frames);
			planes(output, instance.description.outputChannels, frames);
			const answer = await instance.session.request(OPERATION.process, (writer) => {
				writer.unsigned32(frames); writer.unsigned32(inputs.length);
				for (const plane of inputs) writer.floats(plane);
				writer.unsigned32(output.length);
			});
			instance.latency = answer.unsigned32();
			const outputCount = answer.unsigned32();
			if (outputCount !== output.length) throw new Error('The isolated peer changed output topology.');
			for (const plane of output) answer.floats(plane);
			answer.done();
			return frames;
		},
		pluginLatencyFrames: async (value: PeerInstance) => {
			const instance = liveInstance(value);
			const answer = await instance.session.request(OPERATION.latency);
			instance.latency = answer.unsigned32(); answer.done(); return instance.latency;
		},
		savePluginState: async (value: PeerInstance) => {
			const answer = await liveInstance(value).session.request(OPERATION.save);
			const state = answer.blob(MAXIMUM_STATE_BYTES); answer.done(); return state;
		},
		loadPluginState: async (value: PeerInstance, state: Uint8Array) => {
			const answer = await liveInstance(value).session.request(OPERATION.load, (writer) => writer.blob(state));
			answer.done(); return true;
		},
		openPluginVendorWindow: async (value: PeerInstance, windowCapability: string) => {
			const instance = liveInstance(value);
			const capability = opaqueWindowCapability(windowCapability);
			if (instance.vendorWindowCapability !== null
				&& instance.vendorWindowCapability !== capability) {
				throw new Error('The isolated peer already owns a different vendor window.');
			}
			const answer = await instance.session.request(OPERATION.vendor, (writer) => {
				writer.byte(1); writer.text(capability);
			});
			if (answer.byte() !== 1) throw new Error('The isolated peer did not open its vendor window.');
			answer.done();
			instance.vendorWindowCapability = capability;
			return true;
		},
		closePluginVendorWindow: async (value: PeerInstance, windowCapability: string) => {
			const instance = liveInstance(value);
			const capability = opaqueWindowCapability(windowCapability);
			if (instance.vendorWindowCapability !== capability) {
				throw new Error('The isolated peer refused a different vendor window capability.');
			}
			const answer = await instance.session.request(OPERATION.vendor, (writer) => {
				writer.byte(2); writer.text(capability);
			});
			if (answer.byte() !== 1) throw new Error('The isolated peer did not close its vendor window.');
			answer.done();
			instance.vendorWindowCapability = null;
			return true;
		},
		closePluginInstance: async (value: PeerInstance) => {
			const instance = liveInstance(value); instances.delete(instance); await instance.session.close(); return true;
		},
	});
}

async function openSession(
	launcher: ProfessionalPluginPeerLauncher,
	peerExecutable: NativeChildIsolationArtifactDescriptor,
	entryExecutable: NativeChildIsolationArtifactDescriptor,
	entryArguments: readonly string[],
	runtimeReadExecute: readonly NativeChildIsolationArtifactDescriptor[],
	pluginPath: string,
	context: ProfessionalPluginPeerContext,
): Promise<PeerSession> {
	const snapshot = await snapshotAuthenticatedPluginCandidate(pluginPath, context);
	let launch;
	try {
		const pluginGrant = await exactPathGrant(snapshot.path, snapshot.authentication.identity);
		const arguments_ = entryExecutable.path === peerExecutable.path ? []
			: [...entryArguments, peerExecutable.path];
		launch = await launcher.launch({
			executable: entryExecutable, workloadPayload: peerExecutable, arguments: arguments_,
			readOnly: [], readExecute: [pluginGrant], writeOnly: [],
			runtimeClosure: runtimeReadExecute,
			resourcePolicy: {
				maximumJobDurationMs: context.resourcePolicy.maximumJobDurationMs,
				maximumRssBytes: context.resourcePolicy.maximumRssBytes,
			},
			framedControl: { protocolVersion: 1, maximumMessageBytes: MAXIMUM_FRAME_BYTES, maximumInFlightMessages: 1 },
		});
	} catch (error) { await snapshot.dispose(); throw error; }
	if (!isEnforcedNativeChildLaunch(launch.enforcement) || !launch.control) {
		launch.kill('SIGKILL');
		await snapshot.dispose();
		throw new Error('The professional plug-in peer has no enforced framed child transport.');
	}
	let tail = Promise.resolve();
	let closed = false;
	const request = async (operation: number, build?: (writer: BinaryWriter) => void) => {
		const perform = async () => {
			if (closed) throw new Error('The isolated professional plug-in peer is closed.');
			const writer = new BinaryWriter(); writer.byte(VERSION); writer.byte(operation); build?.(writer);
			await launch.control!.send(writer.value());
			return response(await launch.control!.receive(), operation);
		};
		const answer = tail.then(perform);
		tail = answer.then(() => undefined, () => undefined);
		return answer;
	};
	const close = async () => {
		if (closed) return;
		let closeAcknowledged = false;
		try {
			const answer = await request(OPERATION.close); answer.done();
			closeAcknowledged = true;
		}
		finally {
			closed = true;
			try {
				const completion = await launch.completion;
				if (completion.exitCode !== 0) throw new Error(
					`The isolated professional peer exited ${String(completion.exitCode)}; `
					+ `signal=${completion.signal ?? 'none'}; close-acknowledged=${String(closeAcknowledged)}.`,
				);
			} finally { await snapshot.dispose(); }
		}
	};
	return Object.freeze({ launch, pluginPath: snapshot.path, request, close });
}

function loaderArguments(value: readonly string[]): readonly string[] {
	if (!Array.isArray(value) || value.length !== 3 || value[0] !== '--inhibit-cache'
		|| value[1] !== '--library-path' || typeof value[2] !== 'string'
		|| value[2].length < 1 || value[2].length > 32_768 || value[2].includes('\0')
		|| value[2].split(':').length > 48 || value[2].split(':').some((path) => (
			path.length < 1 || resolve(path) !== path
		))) throw new TypeError('The professional peer loader arguments are invalid.');
	return Object.freeze([...value]);
}

async function listPluginCandidates(root: string, suffix: string): Promise<readonly string[]> {
	if (!suffix.startsWith('.') || suffix.includes('/') || suffix.includes('\\')) throw new TypeError('Invalid plug-in suffix.');
	if (await realpath(root) !== root) throw new Error('A plug-in root must remain canonical.');
	const output: string[] = [];
	async function visit(directory: string, depth: number): Promise<void> {
		if (depth > MAXIMUM_DEPTH || output.length > MAXIMUM_CANDIDATES) return;
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
		for (const entry of entries) {
			const path = resolve(directory, entry.name);
			const metadata = await lstat(path);
			if (metadata.isSymbolicLink()) continue;
			if (path.endsWith(suffix) && (metadata.isFile() || metadata.isDirectory())) output.push(path);
			else if (metadata.isDirectory()) await visit(path, depth + 1);
			if (output.length > MAXIMUM_CANDIDATES) return;
		}
	}
	await visit(root, 0);
	return Object.freeze(output);
}

async function exactPathGrant(path: string, expected: Readonly<HelperFileIdentity>) {
	const metadata = await lstat(path, { bigint: true });
	const identity = nativeChildFileIdentityFromStat(metadata);
	if (metadata.isSymbolicLink() || (!metadata.isFile() && !metadata.isDirectory())
		|| Number(BigInt.asUintN(64, metadata.dev)) !== expected.dev
		|| Number(BigInt.asUintN(64, metadata.ino)) !== expected.ino
		|| await realpath(path) !== path) throw new Error('The plug-in path changed before isolated launch.');
	return Object.freeze({
		path, kind: metadata.isDirectory() ? 'directory' as const : 'file' as const,
		identity,
	});
}

function readDescription(reader: BinaryReader): PeerDescription {
	reader.text(16); // format is bound independently by the admitted request.
	const stableId = reader.text(512);
	const name = reader.text(512);
	const vendor = reader.text(512);
	const version = reader.text(512);
	const inputChannels = reader.unsigned32();
	const outputChannels = reader.unsigned32();
	const instrument = reader.unsigned32();
	const reportedLatencyFrames = reader.unsigned32();
	return Object.freeze({
		status: 'ok', stableId, name, vendor, version,
		classification: instrument === 1 ? 'instrument' : 'effect', inputChannels, outputChannels,
		realtime: true, offline: true, reportedLatencyFrames,
	});
}

function response(value: Uint8Array, operation: number): BinaryReader {
	const reader = new BinaryReader(value);
	if (reader.byte() !== VERSION || reader.byte() !== operation) throw new Error('The isolated peer response is misbound.');
	const status = reader.unsigned32();
	if (status !== 0) throw Object.assign(new Error(reader.text(2_048)), { code: STATUS[status] ?? 'unsupported' });
	return new BinaryReader(reader.blob(MAXIMUM_FRAME_BYTES - 16));
}

class BinaryWriter {
	readonly #parts: Buffer[] = [];
	#length = 0;
	byte(value: number) { this.#append(Buffer.from([bounded(value, 0xff)])); }
	unsigned32(value: number) { const bytes = Buffer.allocUnsafe(4); bytes.writeUInt32LE(bounded(value, 0xffff_ffff)); this.#append(bytes); }
	number(value: number) { if (!Number.isFinite(value)) throw new TypeError('A finite peer number is required.'); const bytes = Buffer.allocUnsafe(8); bytes.writeDoubleLE(value); this.#append(bytes); }
	text(value: string) { const bytes = Buffer.from(value, 'utf8'); if (bytes.byteLength < 1 || bytes.includes(0)) throw new TypeError('Peer text is invalid.'); this.blob(bytes); }
	blob(value: Uint8Array) { const bytes = ordinaryBytes(value); this.unsigned32(bytes.byteLength); this.#append(bytes); }
	floats(value: Float32Array) { this.#append(Buffer.from(value.buffer, value.byteOffset, value.byteLength)); }
	value() { return new Uint8Array(Buffer.concat(this.#parts)); }
	#append(bytes: Buffer) { if (bytes.byteLength > MAXIMUM_FRAME_BYTES - this.#length) throw new RangeError('A peer request is oversized.'); this.#parts.push(bytes); this.#length += bytes.byteLength; }
}

class BinaryReader {
	readonly #bytes: Buffer;
	#offset = 0;
	constructor(value: Uint8Array) { this.#bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength); }
	byte() { return this.#take(1).readUInt8(0); }
	unsigned32() { return this.#take(4).readUInt32LE(0); }
	text(maximum: number) { const bytes = this.blob(maximum); const value = Buffer.from(bytes).toString('utf8'); if (!value || value.includes('\0')) throw new Error('The peer returned invalid text.'); return value; }
	blob(maximum: number) { const length = this.unsigned32(); if (length > maximum) throw new Error('The peer returned an oversized blob.'); return new Uint8Array(this.#take(length)); }
	floats(output: Float32Array) { const bytes = this.#take(output.byteLength); for (let index = 0; index < output.length; index += 1) output[index] = bytes.readFloatLE(index * 4); }
	done() { if (this.#offset !== this.#bytes.byteLength) throw new Error('The peer response has trailing bytes.'); }
	#take(length: number) { if (length > this.#bytes.byteLength - this.#offset) throw new Error('The peer response ended early.'); const value = this.#bytes.subarray(this.#offset, this.#offset + length); this.#offset += length; return value; }
}

function liveInstance(value: PeerInstance): PeerInstance {
	if (!value || typeof value !== 'object' || !instances.has(value)) throw new TypeError('A live isolated peer instance is required.');
	return value;
}

function planes(value: readonly Float32Array[], count: number, frames: number) {
	if (value.length !== count || value.some((plane) => !(plane instanceof Float32Array) || plane.length !== frames)) {
		throw new TypeError('Peer plug-in planes do not match the authenticated topology.');
	}
}

function pluginFormats(value: readonly Exclude<HelperPluginFormat, 'fixture'>[]) {
	if (!Array.isArray(value) || value.length < 1 || new Set(value).size !== value.length
		|| value.some((format) => !['vst3', 'clap', 'au', 'lv2'].includes(format))) {
		throw new TypeError('The isolated peer needs exact professional formats.');
	}
	return Object.freeze([...value]);
}

function admittedFormat(formats: readonly string[], value: HelperPluginFormat) {
	if (!formats.includes(value)) throw new Error(`The isolated professional peer does not admit ${value}.`);
}

function opaqueWindowCapability(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
		throw new TypeError('A bounded opaque vendor-window capability is required.');
	}
	return value;
}

function ordinaryBytes(value: Uint8Array) {
	if (!(value instanceof Uint8Array) || value.byteLength > MAXIMUM_STATE_BYTES
		|| (typeof SharedArrayBuffer !== 'undefined' && value.buffer instanceof SharedArrayBuffer)) {
		throw new TypeError('Peer bytes must be bounded ordinary memory.');
	}
	return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function bounded(value: number, maximum: number) {
	if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new RangeError('A peer integer is out of range.');
	return value;
}
