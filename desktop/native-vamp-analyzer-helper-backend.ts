/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-side Vamp backend over one supervised persistent analyzer helper job. */

import { randomBytes } from 'node:crypto';

import type { HelperPluginAnalyzeJobGrant } from './helper-job-grant.ts';
import type { HelperJobRequest } from './helper-supervisor.ts';
import type { NativeMainMessageChannel, NativeMainMessagePort } from './native-audio-helper-adapter.ts';
import {
	admitVampAnalyzerConfiguration,
	admitVampAnalyzerFeatures,
	admitVampAnalyzerOutputs,
	admitVampAnalyzerPcmChunk,
	type VampAnalyzerConfiguration,
	type VampAnalyzerOutputDescriptor,
	type VampAnalyzerPcmChunk,
} from './vamp-analyzer-contract.ts';
import type { VampAnalyzerExecutionGrant } from './vamp-analyzer-registry.ts';
import type {
	VampAnalyzerBackendFactory,
	VampAnalyzerBackendInstance,
} from './vamp-analyzer-session.ts';

const PROTOCOL_VERSION = 1;
const MAXIMUM_MESSAGE_BYTES = 16 * 1_024 * 1_024;

export interface NativeVampAnalyzerSupervisor {
	runJob(request: HelperJobRequest<'plugin-analyze'>): Promise<unknown>;
	dispose(): void;
}

export interface NativeVampAnalyzerBackendOptions {
	readonly supervisorFor: (
		grant: Readonly<VampAnalyzerExecutionGrant>,
	) => NativeVampAnalyzerSupervisor;
	readonly createChannel: () => NativeMainMessageChannel;
	readonly mintStreamId?: () => string;
	readonly mintRequestId?: () => string;
}

export function createNativeVampAnalyzerBackendFactory(
	options: NativeVampAnalyzerBackendOptions,
): VampAnalyzerBackendFactory {
	if (typeof options?.supervisorFor !== 'function' || typeof options.createChannel !== 'function') {
		throw new TypeError('A Vamp analyzer backend requires supervisor and MessageChannel factories.');
	}
	return Object.freeze({
		open: async (grant: Readonly<VampAnalyzerExecutionGrant>) => {
			const streamId = (options.mintStreamId ?? (() => randomBytes(20).toString('hex')))();
			if (!/^[a-f\d]{40}$/u.test(streamId)) throw new Error('The Vamp analyzer stream ID is invalid.');
			const channel = options.createChannel();
			const abort = new AbortController();
			const helperGrant: HelperPluginAnalyzeJobGrant = Object.freeze({
				binaryPath: grant.libraryPath, binaryBytes: grant.libraryBytes,
				binarySha256: grant.librarySha256, format: 'vamp', stableId: grant.analyzerIdentifier,
				identity: grant.identity,
				persistentPort: Object.freeze({
					portContractVersion: 1, transport: 'message-port', purpose: 'plugin-analyzer-rpc',
					streamId, generation: 1, maximumMessageBytes: MAXIMUM_MESSAGE_BYTES,
					maximumInFlightMessages: 8,
				}),
			});
			let supervisor: NativeVampAnalyzerSupervisor;
			try { supervisor = options.supervisorFor(grant); }
			catch (error) {
				closePort(channel.port1); closePort(channel.port2); throw error;
			}
			let completion: Promise<unknown>;
			try {
				completion = supervisor.runJob({
					kind: 'plugin-analyze', grant: helperGrant, signal: abort.signal,
					dataPlaneTransfers: [{ streamId, port: channel.port1 }],
				});
			} catch (error) {
				supervisor.dispose();
				closePort(channel.port1); closePort(channel.port2); throw error;
			}
			const instance = new HelperVampAnalyzerInstance({
				grant, port: channel.port2, completion, abort, supervisor,
				mintRequestId: options.mintRequestId ?? (() => randomBytes(16).toString('hex')),
			});
			channel.port2.start?.();
			return instance;
		},
	});
}

class HelperVampAnalyzerInstance implements VampAnalyzerBackendInstance {
	readonly #grant: Readonly<VampAnalyzerExecutionGrant>;
	readonly #port: NativeMainMessagePort;
	readonly #completion: Promise<unknown>;
	readonly #abort: AbortController;
	readonly #supervisor: NativeVampAnalyzerSupervisor;
	readonly #mintRequestId: () => string;
	#configuration: Readonly<VampAnalyzerConfiguration> | null = null;
	#outputs: readonly Readonly<VampAnalyzerOutputDescriptor>[] = Object.freeze([]);
	#nextFrame = 0;
	#tail = Promise.resolve();
	#pending: Readonly<{ resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }> | null = null;
	#helperFailure: Error | null = null;
	#closed = false;
	#closing = false;
	#supervisorDisposed = false;
	readonly #listener: (event: unknown) => void;

	constructor(options: Readonly<{
		grant: Readonly<VampAnalyzerExecutionGrant>;
		port: NativeMainMessagePort;
		completion: Promise<unknown>;
		abort: AbortController;
		supervisor: NativeVampAnalyzerSupervisor;
		mintRequestId: () => string;
	}>) {
		this.#grant = options.grant;
		this.#port = options.port;
		this.#completion = options.completion;
		this.#abort = options.abort;
		this.#supervisor = options.supervisor;
		this.#mintRequestId = options.mintRequestId;
		this.#listener = (event) => this.#receive(messageData(event));
		add(this.#port, this.#listener);
		void this.#completion.then(
			() => this.#helperSettled(new Error('The Vamp analyzer helper closed.')),
			(error: unknown) => this.#helperSettled(
				error instanceof Error ? error : new Error(String(error)),
			),
		);
	}

	async configure(configuration: Readonly<VampAnalyzerConfiguration>) {
		if (this.#configuration !== null) throw new Error('The Vamp analyzer backend is already configured.');
		const admitted = admitVampAnalyzerConfiguration(configuration, this.#grant.descriptor);
		const answer = await this.#request('configure', { configuration: admitted });
		if (answer.kind !== 'configured') throw new Error('The Vamp helper returned the wrong configure response.');
		const outputs = admitVampAnalyzerOutputs(answer.outputs);
		this.#configuration = admitted;
		this.#outputs = outputs;
		return Object.freeze({ outputs });
	}

	async process(chunk: Readonly<VampAnalyzerPcmChunk>) {
		if (this.#configuration === null) throw new Error('The Vamp analyzer backend is not configured.');
		const admitted = admitVampAnalyzerPcmChunk({
			startFrame: chunk.startFrame, channels: chunk.channels,
		}, this.#configuration, this.#nextFrame);
		if (chunk.frameCount !== admitted.frameCount) throw new RangeError('The Vamp PCM frame count is inconsistent.');
		const answer = await this.#request('process', { chunk: admitted },
			admitted.channels.map(({ buffer }) => buffer as ArrayBuffer));
		if (answer.kind !== 'features') throw new Error('The Vamp helper returned the wrong process response.');
		const features = admitVampAnalyzerFeatures(answer.features, this.#outputs);
		this.#nextFrame += admitted.frameCount;
		return features;
	}

	async finish() {
		if (this.#configuration === null || this.#nextFrame !== this.#configuration.frameCount) {
			throw new Error('The Vamp analyzer backend cannot finish an incomplete stream.');
		}
		const answer = await this.#request('finish');
		if (answer.kind !== 'finished') throw new Error('The Vamp helper returned the wrong finish response.');
		return admitVampAnalyzerFeatures(answer.features, this.#outputs);
	}

	async cancel(reason: string): Promise<void> {
		if (this.#closed) return;
		this.#closing = true;
		const error = Object.assign(
			new Error(`The Vamp analyzer backend was cancelled (${cancellationReason(reason)}).`),
			{ code: 'cancelled' },
		);
		this.#helperFailure = error;
		this.#pending?.reject(error);
		this.#pending = null;
		this.#terminate();
	}

	async close(): Promise<void> {
		if (this.#closed || this.#closing) return;
		this.#closing = true;
		try {
			if (this.#helperFailure === null) {
				this.#port.postMessage({ protocolVersion: PROTOCOL_VERSION, kind: 'close', reason: 'session-closed' });
				await this.#completion;
			}
		} finally {
			this.#terminate();
		}
	}

	#terminate(): void {
		this.#closed = true;
		this.#abort.abort();
		remove(this.#port, this.#listener);
		closePort(this.#port);
		if (!this.#supervisorDisposed) {
			this.#supervisorDisposed = true;
			this.#supervisor.dispose();
		}
	}

	#request(
		kind: 'configure' | 'process' | 'finish' | 'cancel',
		fields: Readonly<Record<string, unknown>> = {},
		transfer: readonly ArrayBuffer[] = [],
	): Promise<Record<string, unknown>> {
		const perform = async () => {
			if (this.#closed || this.#closing) throw new Error('The Vamp analyzer backend is closed.');
			if (this.#helperFailure) throw this.#helperFailure;
			if (this.#pending) throw new Error('The Vamp analyzer backend request window is occupied.');
			const requestId = this.#requestId();
			const response = new Promise<Record<string, unknown>>((resolve, reject) => {
				this.#pending = Object.freeze({ resolve, reject });
			});
			try {
				this.#port.postMessage({ protocolVersion: PROTOCOL_VERSION, kind, requestId, ...fields }, transfer);
			} catch (error) {
				this.#pending = null;
				throw error;
			}
			const answer = await response;
			if (answer.requestId !== requestId) throw new Error('The Vamp helper response is misbound.');
			return answer;
		};
		const result = this.#tail.then(perform);
		this.#tail = result.then(() => undefined, () => undefined);
		return result;
	}

	#requestId(): string {
		const value = this.#mintRequestId();
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
			throw new Error('The Vamp analyzer request ID factory returned an invalid ID.');
		}
		return value;
	}

	#receive(value: unknown): void {
		let message: Record<string, unknown>;
		try { message = plainRecord(value); }
		catch (error) {
			this.#pending?.reject(error instanceof Error ? error : new Error(String(error)));
			this.#pending = null;
			return;
		}
		if (message.protocolVersion !== PROTOCOL_VERSION) {
			this.#pending?.reject(new Error('The Vamp helper response has the wrong protocol version.'));
			this.#pending = null;
			return;
		}
		const pending = this.#pending;
		this.#pending = null;
		if (!pending) return;
		if (message.kind === 'fault') pending.reject(Object.assign(
			new Error(String(message.detail ?? message.code ?? 'Vamp analyzer helper fault').slice(0, 2_048)),
			{ code: String(message.code ?? 'analyzer-fault') },
		));
		else pending.resolve(message);
	}

	#helperSettled(error: Error): void {
		if (!this.#closing && !this.#closed) this.#helperFailure = error;
		this.#pending?.reject(error);
		this.#pending = null;
	}
}

function plainRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError('The Vamp helper response must be a plain record.');
	}
	return value as Record<string, unknown>;
}

function cancellationReason(value: unknown): string {
	return typeof value === 'string' && /^[a-z][a-z-]{0,63}$/u.test(value) ? value : 'user-cancelled';
}

function messageData(value: unknown): unknown {
	return value && typeof value === 'object' && 'data' in value ? (value as { data: unknown }).data : value;
}

function add(port: NativeMainMessagePort, listener: (event: unknown) => void): void {
	if (port.on) port.on('message', listener);
	else port.onmessage = (event) => listener(event);
}

function remove(port: NativeMainMessagePort, listener: (event: unknown) => void): void {
	if (port.off) port.off('message', listener);
	else port.onmessage = null;
}

function closePort(port: NativeMainMessagePort): void {
	try { port.close(); } catch { /* already transferred or closed */ }
}
