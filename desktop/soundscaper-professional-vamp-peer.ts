/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact-library proxy for the M5A1 analyzer mode of the authenticated peer. */

import { lstat, readdir, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type { HelperFileIdentity } from './helper-job-grant.ts';
import { nativeChildFileIdentityFromStat } from './native-child-file-identity.ts';
import {
	isEnforcedNativeChildLaunch,
	type NativeChildIsolationArtifactDescriptor,
	type NativeChildIsolationLaunch,
	type NativeChildIsolationPathGrant,
} from './native-child-isolation-launcher.ts';
import type { HelperJobResourcePolicy } from './helper-resource-policy.ts';
import { snapshotAuthenticatedPluginCandidate } from './plugin-candidate-snapshot.mjs';
import { professionalPeerLoaderArgumentsValid } from './professional-peer-loader-arguments.ts';
import {
	admitVampAnalyzerConfiguration,
	admitVampAnalyzerFeatures,
	admitVampAnalyzerPcmChunk,
	type VampAnalyzerConfiguration,
	type VampAnalyzerDescriptor,
	type VampAnalyzerFeature,
	type VampAnalyzerOutputDescriptor,
	type VampAnalyzerPcmChunk,
} from './vamp-analyzer-contract.ts';
import {
	VAMP_PEER_MAXIMUM_FRAME_BYTES,
	VAMP_PEER_OPERATION,
	VAMP_PEER_VERSION,
	VampPeerReader,
	VampPeerWriter,
	readVampAnalyzerDescriptor,
	readVampAnalyzerDescriptors,
	readVampAnalyzerFeatures,
	readVampAnalyzerOutputs,
	splitVampPeerPcmChunkForTransport,
	vampPeerResponse,
	writeVampAnalyzerConfiguration,
	writeVampAnalyzerPcm,
} from './vamp-analyzer-peer-codec.ts';

const MAXIMUM_CANDIDATES = 512;
const MAXIMUM_DEPTH = 16;
export const VAMP_PEER_CHILD_CRASH_CODE = 'vamp-peer-crash';

export interface ProfessionalVampPeerContext {
	readonly identity: Readonly<HelperFileIdentity>;
	readonly byteLength: number;
	readonly sha256: string;
	readonly resourcePolicy: HelperJobResourcePolicy;
}

export interface ProfessionalVampPeerLauncher {
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
			readonly protocolFamily: 'M5A';
			readonly protocolVersion: 1;
			readonly maximumMessageBytes: number;
			readonly maximumInFlightMessages: number;
		}>;
	}>): Promise<NativeChildIsolationLaunch>;
}

interface VampPeerSession {
	readonly libraryPath: string;
	request(operation: number, build?: (writer: VampPeerWriter) => void): Promise<VampPeerReader>;
	close(): Promise<void>;
}

export interface ProfessionalVampPeerInstance {
	readonly descriptor: Readonly<VampAnalyzerDescriptor>;
}

interface MutableVampPeerInstance extends ProfessionalVampPeerInstance {
	readonly session: VampPeerSession;
	configuration: Readonly<VampAnalyzerConfiguration> | null;
	outputs: readonly Readonly<VampAnalyzerOutputDescriptor>[];
	nextFrame: number;
	cancelled: boolean;
	finished: boolean;
}

const instances = new WeakSet<object>();

export function createSoundscaperProfessionalVampPeer(options: Readonly<{
	readonly launcher: ProfessionalVampPeerLauncher;
	readonly peerExecutable: NativeChildIsolationArtifactDescriptor;
	readonly entryExecutable?: NativeChildIsolationArtifactDescriptor;
	readonly entryArguments?: readonly string[];
	readonly runtimeReadExecute: readonly NativeChildIsolationArtifactDescriptor[];
}>) {
	if (typeof options?.launcher?.launch !== 'function') throw new TypeError('A Vamp peer launcher is required.');
	const peerExecutable = options.peerExecutable;
	const entryExecutable = options.entryExecutable ?? peerExecutable;
	const entryArguments = options.entryArguments === undefined
		? (entryExecutable.path === peerExecutable.path ? [] : ['--library-path', dirname(entryExecutable.path)])
		: entryExecutable.path === peerExecutable.path && options.entryArguments.length === 0
			? Object.freeze([]) : loaderArguments(options.entryArguments);
	const runtimeReadExecute = Object.freeze([...options.runtimeReadExecute]);

	const scanExactLibrary = async (
		path: string, sampleRate: number, context: ProfessionalVampPeerContext,
	): Promise<readonly Readonly<VampAnalyzerDescriptor>[]> => {
		const admittedRate = sampleRateValue(sampleRate);
		const session = await openSession(options.launcher, peerExecutable, entryExecutable,
			entryArguments, runtimeReadExecute, path, context);
		return temporary(session, async () => {
			const answer = await session.request(VAMP_PEER_OPERATION.scan, (writer) => {
				writer.text(session.libraryPath); writer.number(admittedRate);
			});
			const descriptors = readVampAnalyzerDescriptors(answer);
			answer.done();
			return descriptors;
		});
	};

	const openExactAnalyzer = async (
		path: string, analyzerIdentifier: string, sampleRate: number, context: ProfessionalVampPeerContext,
	): Promise<ProfessionalVampPeerInstance> => {
		const session = await openSession(options.launcher, peerExecutable, entryExecutable,
			entryArguments, runtimeReadExecute, path, context);
		try {
			const answer = await session.request(VAMP_PEER_OPERATION.open, (writer) => {
				writer.text(session.libraryPath); writer.text(analyzerIdentifier, 256);
				writer.number(sampleRateValue(sampleRate));
			});
			const descriptors = readVampAnalyzerDescriptor(answer);
			answer.done();
			if (descriptors.identifier !== analyzerIdentifier) {
				throw new Error('The exact Vamp peer opened a different analyzer.');
			}
			const instance: MutableVampPeerInstance = {
				session, descriptor: descriptors, configuration: null, outputs: Object.freeze([]),
				nextFrame: 0, cancelled: false, finished: false,
			};
			instances.add(instance);
			return instance;
		} catch (error) { await session.close(); throw error; }
	};

	return Object.freeze({
		describe: async () => Object.freeze({
			addonVersion: '1.0.0', buildId: 'soundscaper-professional-vamp-m5a1', napiVersion: 0,
			maximumChannelCount: 64, maximumFrameCount: 65_536,
			pluginFormats: Object.freeze(['vamp']),
		}),
		listPluginCandidates: listVampLibraries,
		inspectPluginCandidate: async (
			path: string, format: string, context: ProfessionalVampPeerContext,
		) => {
			if (format !== 'vamp') throw new TypeError('The analyzer peer admits only the Vamp format.');
			return scanExactLibrary(path, 48_000, context);
		},
		scanExactLibrary,
		openExactAnalyzer,
		openAnalyzer: openExactAnalyzer,
		configureAnalyzer: async (
			value: ProfessionalVampPeerInstance, configuration: Readonly<VampAnalyzerConfiguration>,
		) => {
			const instance = liveInstance(value);
			if (instance.configuration !== null || instance.cancelled || instance.finished) {
				throw new Error('The exact Vamp analyzer is not configurable.');
			}
			const admitted = admitVampAnalyzerConfiguration(configuration, instance.descriptor);
			const answer = await instance.session.request(VAMP_PEER_OPERATION.configure,
				(writer) => writeVampAnalyzerConfiguration(writer, admitted));
			const outputs = readVampAnalyzerOutputs(answer);
			answer.done();
			instance.configuration = admitted;
			instance.outputs = outputs;
			return Object.freeze({ outputs });
		},
		processAnalyzerPcm: async (
			value: ProfessionalVampPeerInstance, chunk: Readonly<VampAnalyzerPcmChunk>,
		): Promise<readonly Readonly<VampAnalyzerFeature>[]> => {
			const instance = liveInstance(value);
			if (instance.configuration === null || instance.cancelled || instance.finished) {
				throw new Error('The exact Vamp analyzer is not processing.');
			}
			const admitted = admitVampAnalyzerPcmChunk({
				startFrame: chunk.startFrame, channels: chunk.channels,
			}, instance.configuration, instance.nextFrame);
			if (chunk.frameCount !== admitted.frameCount) throw new RangeError('The Vamp PCM frame count is inconsistent.');
			const features: Readonly<VampAnalyzerFeature>[] = [];
			for (const transportChunk of splitVampPeerPcmChunkForTransport(admitted)) {
				const answer = await instance.session.request(VAMP_PEER_OPERATION.process,
					(writer) => writeVampAnalyzerPcm(writer, transportChunk));
				for (const feature of readVampAnalyzerFeatures(answer, instance.outputs)) {
					features.push(feature);
				}
				answer.done();
			}
			instance.nextFrame += admitted.frameCount;
			return admitVampAnalyzerFeatures(features, instance.outputs);
		},
		finishAnalyzer: async (value: ProfessionalVampPeerInstance) => {
			const instance = liveInstance(value);
			if (instance.configuration === null || instance.cancelled || instance.finished
				|| instance.nextFrame !== instance.configuration.frameCount) {
				throw new Error('The exact Vamp analyzer cannot finish this stream.');
			}
			const answer = await instance.session.request(VAMP_PEER_OPERATION.finish);
			const features = readVampAnalyzerFeatures(answer, instance.outputs);
			answer.done();
			instance.finished = true;
			return features;
		},
		cancelAnalyzer: async (value: ProfessionalVampPeerInstance) => {
			const instance = liveInstance(value);
			if (instance.cancelled || instance.finished) return;
			const answer = await instance.session.request(VAMP_PEER_OPERATION.cancel);
			answer.done();
			instance.cancelled = true;
		},
		closeAnalyzer: async (value: ProfessionalVampPeerInstance) => {
			const instance = liveInstance(value);
			instances.delete(instance);
			await instance.session.close();
		},
	});
}

async function openSession(
	launcher: ProfessionalVampPeerLauncher,
	peerExecutable: NativeChildIsolationArtifactDescriptor,
	entryExecutable: NativeChildIsolationArtifactDescriptor,
	entryArguments: readonly string[],
	runtimeReadExecute: readonly NativeChildIsolationArtifactDescriptor[],
	libraryPath: string,
	context: ProfessionalVampPeerContext,
): Promise<VampPeerSession> {
	const snapshot = await snapshotAuthenticatedPluginCandidate(libraryPath, context);
	let launch: NativeChildIsolationLaunch;
	try {
		const libraryGrant = await exactFileGrant(snapshot.path, snapshot.authentication.identity);
		const arguments_ = entryExecutable.path === peerExecutable.path
			? ['--vamp-analyzer'] : [...entryArguments, peerExecutable.path, '--vamp-analyzer'];
		launch = await launcher.launch({
			executable: entryExecutable, workloadPayload: peerExecutable, arguments: arguments_,
			readOnly: [], readExecute: [libraryGrant], writeOnly: [], runtimeClosure: runtimeReadExecute,
			resourcePolicy: {
				maximumJobDurationMs: context.resourcePolicy.maximumJobDurationMs,
				maximumRssBytes: context.resourcePolicy.maximumRssBytes,
			},
			framedControl: {
				protocolFamily: 'M5A', protocolVersion: 1,
				maximumMessageBytes: VAMP_PEER_MAXIMUM_FRAME_BYTES, maximumInFlightMessages: 1,
			},
		});
	} catch (error) { await snapshot.dispose(); throw error; }
	if (!isEnforcedNativeChildLaunch(launch.enforcement) || !launch.control) {
		launch.kill('SIGKILL');
		await snapshot.dispose();
		throw new Error('The Vamp analyzer peer has no enforced M5A1 child transport.');
	}
	let tail = Promise.resolve();
	let closed = false;
	const request = async (operation: number, build?: (writer: VampPeerWriter) => void) => {
		const perform = async () => {
			if (closed) throw new Error('The exact Vamp analyzer peer is closed.');
			const writer = new VampPeerWriter();
			writer.byte(VAMP_PEER_VERSION); writer.byte(operation); build?.(writer);
			try { await launch.control!.send(writer.value()); }
			catch (error) {
				throw vampPeerChildCrash('The isolated Vamp peer transport closed while sending.', error);
			}
			let response: Uint8Array;
			try { response = await launch.control!.receive(); }
			catch (error) {
				throw vampPeerChildCrash('The isolated Vamp peer transport closed before answering.', error);
			}
			return vampPeerResponse(response, operation);
		};
		const answer = tail.then(perform);
		tail = answer.then(() => undefined, () => undefined);
		return answer;
	};
	const close = async () => {
		if (closed) return;
		const failures: unknown[] = [];
		try { const answer = await request(VAMP_PEER_OPERATION.close); answer.done(); }
		catch (error) { failures.push(error); }
		closed = true;
		try {
			const completion = await launch.completion;
			if (completion.exitCode !== 0) failures.push(vampPeerChildCrash(
				`The Vamp analyzer peer exited ${String(completion.exitCode)} (${completion.signal ?? 'no signal'}).`,
			));
		} catch (error) {
			failures.push(vampPeerChildCrash('The isolated Vamp peer completion failed.', error));
		}
		try { await snapshot.dispose(); } catch (error) { failures.push(error); }
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw vampPeerAggregateError(
			failures, 'The Vamp analyzer peer close phases failed.',
		);
	};
	return Object.freeze({ libraryPath: snapshot.path, request, close });
}

async function temporary<T>(session: VampPeerSession, operation: () => Promise<T>): Promise<T> {
	let result: T | undefined;
	let operationError: unknown = null;
	try { result = await operation(); } catch (error) { operationError = error; }
	let closeError: unknown = null;
	try { await session.close(); } catch (error) { closeError = error; }
	if (operationError !== null && closeError !== null) {
		throw vampPeerAggregateError(
			[operationError, closeError], 'Vamp scan and peer shutdown both failed.',
		);
	}
	if (operationError !== null) throw operationError;
	if (closeError !== null) throw closeError;
	return result as T;
}

function vampPeerChildCrash(message: string, cause?: unknown): Error & { readonly code: string } {
	return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), {
		code: VAMP_PEER_CHILD_CRASH_CODE,
	});
}

function vampPeerAggregateError(errors: readonly unknown[], message: string): AggregateError {
	const aggregate = new AggregateError(errors, message, { cause: errors[0] });
	if (errors.some((error) => (
		error !== null && typeof error === 'object'
		&& (error as { code?: unknown }).code === VAMP_PEER_CHILD_CRASH_CODE
	))) Object.assign(aggregate, { code: VAMP_PEER_CHILD_CRASH_CODE });
	return aggregate;
}

async function listVampLibraries(root: string, suffix: string): Promise<readonly string[]> {
	if (!['.so', '.dylib', '.dll'].includes(suffix)) throw new TypeError('Invalid Vamp library suffix.');
	if (await realpath(root) !== root) throw new Error('A Vamp library root must remain canonical.');
	const output: string[] = [];
	async function visit(directory: string, depth: number): Promise<void> {
		if (depth > MAXIMUM_DEPTH || output.length > MAXIMUM_CANDIDATES) return;
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
		for (const entry of entries) {
			const path = resolve(directory, entry.name);
			const metadata = await lstat(path);
			if (metadata.isSymbolicLink()) continue;
			if (metadata.isFile() && path.endsWith(suffix)) output.push(path);
			else if (metadata.isDirectory()) await visit(path, depth + 1);
			if (output.length > MAXIMUM_CANDIDATES) return;
		}
	}
	await visit(root, 0);
	return Object.freeze(output);
}

async function exactFileGrant(path: string, expected: Readonly<HelperFileIdentity>) {
	const metadata = await lstat(path, { bigint: true });
	const identity = nativeChildFileIdentityFromStat(metadata);
	if (metadata.isSymbolicLink() || !metadata.isFile()
		|| Number(BigInt.asUintN(64, metadata.dev)) !== expected.dev
		|| Number(BigInt.asUintN(64, metadata.ino)) !== expected.ino
		|| await realpath(path) !== path) throw new Error('The Vamp library changed before isolated launch.');
	return Object.freeze({ path, kind: 'file' as const, identity });
}

function loaderArguments(value: readonly string[]): readonly string[] {
	if (!professionalPeerLoaderArgumentsValid(value)) {
		throw new TypeError('The professional Vamp peer loader arguments are invalid.');
	}
	return Object.freeze([...value]);
}

function sampleRateValue(value: number): number {
	if (!Number.isSafeInteger(value) || value < 8_000 || value > 768_000) {
		throw new RangeError('The Vamp peer sample rate is invalid.');
	}
	return value;
}

function liveInstance(value: ProfessionalVampPeerInstance): MutableVampPeerInstance {
	if (!value || typeof value !== 'object' || !instances.has(value)) {
		throw new TypeError('A live exact Vamp peer instance is required.');
	}
	return value as MutableVampPeerInstance;
}
