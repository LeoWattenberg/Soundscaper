/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomUUID } from 'node:crypto';

import {
	VAMP_ANALYZER_LIMITS,
	admitVampAnalyzerConfiguration,
	admitVampAnalyzerFeatures,
	admitVampAnalyzerOutputs,
	admitVampAnalyzerPcmChunk,
	type VampAnalyzerConfiguration,
	type VampAnalyzerFeature,
	type VampAnalyzerOutputDescriptor,
	type VampAnalyzerPcmChunk,
} from './vamp-analyzer-contract.ts';
import {
	type DesktopVampAnalyzerRegistry,
	type VampAnalyzerExecutionGrant,
	vampAnalyzerIdFor,
} from './vamp-analyzer-registry.ts';

export interface VampAnalyzerBackendInstance {
	configure(configuration: Readonly<VampAnalyzerConfiguration>): Promise<Readonly<{ outputs: unknown }>>;
	process(chunk: Readonly<VampAnalyzerPcmChunk>): Promise<unknown>;
	finish(): Promise<unknown>;
	cancel(reason: string): Promise<void>;
	close(): Promise<void>;
}

export interface VampAnalyzerBackendFactory {
	open(grant: Readonly<VampAnalyzerExecutionGrant>): Promise<VampAnalyzerBackendInstance>;
}

export type VampAnalyzerSessionState = 'created' | 'configured' | 'finished' | 'cancelled';

export interface VampAnalyzerSessionProjection {
	readonly kind: 'analyzer-session';
	readonly format: 'vamp';
	readonly sessionId: string;
	readonly analyzerId: string;
	readonly installationId: string;
	readonly binarySha256: string;
	readonly state: VampAnalyzerSessionState;
	readonly processedFrames: number;
	readonly totalFrames: number | null;
	readonly outputs: readonly Readonly<VampAnalyzerOutputDescriptor>[];
}

export interface VampAnalyzerFeatureBatchProjection {
	readonly session: Readonly<VampAnalyzerSessionProjection>;
	readonly features: readonly Readonly<VampAnalyzerFeature>[];
}

export interface DesktopVampAnalyzerSessionsOptions {
	readonly registry: DesktopVampAnalyzerRegistry;
	readonly backend: VampAnalyzerBackendFactory;
	readonly mintSessionId?: () => string;
}

interface Session {
	readonly owner: object;
	readonly installationId: string;
	readonly grant: Readonly<VampAnalyzerExecutionGrant>;
	readonly backend: VampAnalyzerBackendInstance;
	readonly sessionId: string;
	state: VampAnalyzerSessionState;
	operation: 'configure' | 'process' | 'finish' | null;
	configuration: Readonly<VampAnalyzerConfiguration> | null;
	outputs: readonly Readonly<VampAnalyzerOutputDescriptor>[];
	nextFrame: number;
	featureCount: number;
}

/** Main-owned, owner-scoped state machine for finite streaming Vamp analysis. */
export class DesktopVampAnalyzerSessions {
	readonly #registry: DesktopVampAnalyzerRegistry;
	readonly #backend: VampAnalyzerBackendFactory;
	readonly #mintSessionId: () => string;
	readonly #sessions = new Map<string, Session>();
	#disposed = false;

	constructor(options: DesktopVampAnalyzerSessionsOptions) {
		if (!options?.registry || typeof options.backend?.open !== 'function') {
			throw new TypeError('Vamp analyzer sessions require a registry and backend factory.');
		}
		this.#registry = options.registry;
		this.#backend = options.backend;
		this.#mintSessionId = options.mintSessionId ?? (() => `vamp_${randomUUID()}`);
	}

	async start(owner: object, value: unknown): Promise<Readonly<VampAnalyzerSessionProjection>> {
		this.#assertLive();
		assertOwner(owner);
		const request = closedRecord(value, ['installationId', 'sessionId'], 'Vamp analyzer start request');
		const installationId = opaqueId(request.installationId, 'installation ID');
		const sessionId = request.sessionId === null
			? runtimeId(this.#mintSessionId(), 'session ID') : runtimeId(request.sessionId, 'session ID');
		if (this.#sessions.has(sessionId)) throw new Error('That Vamp analyzer session is already active.');
		if (this.#sessions.size >= VAMP_ANALYZER_LIMITS.maximumConcurrentSessions) {
			throw new Error('The Vamp analyzer session capacity is full.');
		}
		const grant = this.#registry.executionGrantFor(installationId);
		const backend = await this.#backend.open(grant);
		assertBackend(backend);
		let authorityChanged: boolean;
		try {
			const current = this.#registry.executionGrantFor(installationId);
			authorityChanged = current.librarySha256 !== grant.librarySha256
				|| current.libraryPath !== grant.libraryPath
				|| current.identity.dev !== grant.identity.dev || current.identity.ino !== grant.identity.ino;
		} catch {
			authorityChanged = true;
		}
		if (this.#disposed || this.#sessions.has(sessionId) || authorityChanged) {
			await closeBackend(backend, 'session-not-admitted');
			throw new Error('The Vamp analyzer session lost authority while its backend opened.');
		}
		const session: Session = {
			owner, installationId, grant, backend, sessionId, state: 'created', operation: null,
			configuration: null, outputs: Object.freeze([]), nextFrame: 0, featureCount: 0,
		};
		this.#sessions.set(sessionId, session);
		return project(session);
	}

	async configure(owner: object, value: unknown): Promise<Readonly<VampAnalyzerSessionProjection>> {
		this.#assertLive();
		const request = closedRecord(value, [
			'sessionId', 'sampleRate', 'channelCount', 'stepSize', 'blockSize', 'frameCount',
			'parameters', 'program',
		], 'Vamp analyzer configure request');
		const session = this.#owned(owner, request.sessionId);
		this.#available(session, 'created');
		const configuration = admitVampAnalyzerConfiguration({
			sampleRate: request.sampleRate, channelCount: request.channelCount,
			stepSize: request.stepSize, blockSize: request.blockSize, frameCount: request.frameCount,
			parameters: request.parameters, program: request.program,
		}, session.grant.descriptor);
		session.operation = 'configure';
		try {
			const result = await session.backend.configure(configuration);
			const admitted = closedRecord(result, ['outputs'], 'Vamp backend configuration result');
			const outputs = admitVampAnalyzerOutputs(admitted.outputs);
			this.#assertCurrent(session);
			session.configuration = configuration;
			session.outputs = outputs;
			session.state = 'configured';
			session.operation = null;
			return project(session);
		} catch (error) {
			try { await this.#fault(session); } catch {}
			throw error;
		}
	}

	async pushPcm(owner: object, value: unknown): Promise<Readonly<VampAnalyzerFeatureBatchProjection>> {
		this.#assertLive();
		const request = closedRecord(value, ['sessionId', 'startFrame', 'channels'], 'Vamp PCM request');
		const session = this.#owned(owner, request.sessionId);
		this.#available(session, 'configured');
		const configuration = session.configuration;
		if (configuration === null) throw new Error('The Vamp analyzer session is not configured.');
		const chunk = admitVampAnalyzerPcmChunk({
			startFrame: request.startFrame, channels: request.channels,
		}, configuration, session.nextFrame);
		session.operation = 'process';
		try {
			const result = await session.backend.process(chunk);
			const features = admitVampAnalyzerFeatures(result, session.outputs);
			this.#assertCurrent(session);
			this.#admitFeatureCount(session, features.length);
			session.nextFrame += chunk.frameCount;
			session.operation = null;
			return Object.freeze({ session: project(session), features });
		} catch (error) {
			try { await this.#fault(session); } catch {}
			throw error;
		}
	}

	async finish(owner: object, value: unknown): Promise<Readonly<VampAnalyzerFeatureBatchProjection>> {
		this.#assertLive();
		const request = closedRecord(value, ['sessionId'], 'Vamp analyzer finish request');
		const session = this.#owned(owner, request.sessionId);
		this.#available(session, 'configured');
		if (session.configuration === null || session.nextFrame !== session.configuration.frameCount) {
			throw new Error('All configured PCM must be supplied before finishing Vamp analysis.');
		}
		session.operation = 'finish';
		try {
			const result = await session.backend.finish();
			const features = admitVampAnalyzerFeatures(result, session.outputs);
			this.#assertCurrent(session);
			this.#admitFeatureCount(session, features.length);
			session.state = 'finished';
			session.operation = null;
			const projection = project(session);
			this.#sessions.delete(session.sessionId);
			await session.backend.close();
			return Object.freeze({ session: projection, features });
		} catch (error) {
			try { await this.#fault(session); } catch {}
			throw error;
		}
	}

	async cancel(owner: object, value: unknown): Promise<boolean> {
		const request = closedRecord(value, ['sessionId', 'reason'], 'Vamp analyzer cancel request');
		const sessionId = runtimeId(request.sessionId, 'session ID');
		const session = this.#sessions.get(sessionId);
		if (!session) return false;
		if (session.owner !== owner) throw new Error('That Vamp analyzer session is owned by another renderer.');
		await this.#cancel(session, reason(request.reason));
		return true;
	}

	async cancelOwner(owner: object, cancellationReason: string): Promise<number> {
		assertOwner(owner);
		const admittedReason = reason(cancellationReason);
		const owned = [...this.#sessions.values()].filter((session) => session.owner === owner);
		await Promise.all(owned.map((session) => this.#cancel(session, admittedReason)));
		return owned.length;
	}

	async dispose(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		const sessions = [...this.#sessions.values()];
		await Promise.all(sessions.map((session) => this.#cancel(session, 'service-disposed')));
	}

	#owned(owner: object, value: unknown): Session {
		assertOwner(owner);
		const session = this.#sessions.get(runtimeId(value, 'session ID'));
		if (!session) throw new Error('Unknown Vamp analyzer session.');
		if (session.owner !== owner) throw new Error('That Vamp analyzer session is owned by another renderer.');
		return session;
	}

	#available(session: Session, state: VampAnalyzerSessionState): void {
		if (session.operation !== null) throw new Error('That Vamp analyzer session is busy.');
		if (session.state !== state) throw new Error(`The Vamp analyzer session is not ${state}.`);
	}

	#assertCurrent(session: Session): void {
		if (this.#sessions.get(session.sessionId) !== session) {
			throw new Error('The Vamp analyzer session was cancelled during its operation.');
		}
	}

	#admitFeatureCount(session: Session, added: number): void {
		if (session.featureCount + added > VAMP_ANALYZER_LIMITS.maximumSessionFeatures) {
			throw new RangeError('The Vamp analyzer session exceeds its feature limit.');
		}
		session.featureCount += added;
	}

	async #fault(session: Session): Promise<void> {
		if (this.#sessions.get(session.sessionId) !== session) return;
		this.#sessions.delete(session.sessionId);
		session.state = 'cancelled';
		session.operation = null;
		await closeBackend(session.backend, 'backend-fault');
	}

	async #cancel(session: Session, cancellationReason: string): Promise<void> {
		if (this.#sessions.get(session.sessionId) !== session) return;
		this.#sessions.delete(session.sessionId);
		session.state = 'cancelled';
		session.operation = null;
		await closeBackend(session.backend, cancellationReason);
	}

	#assertLive(): void {
		if (this.#disposed) throw new Error('The Vamp analyzer session service is disposed.');
	}
}

function project(session: Session): Readonly<VampAnalyzerSessionProjection> {
	return Object.freeze({
		kind: 'analyzer-session', format: 'vamp', sessionId: session.sessionId,
		analyzerId: vampAnalyzerIdFor(session.grant.analyzerIdentifier),
		installationId: session.installationId, binarySha256: session.grant.librarySha256,
		state: session.state, processedFrames: session.nextFrame,
		totalFrames: session.configuration?.frameCount ?? null, outputs: session.outputs,
	});
}

async function closeBackend(backend: VampAnalyzerBackendInstance, cancellationReason: string): Promise<void> {
	let failure: unknown = null;
	try {
		await backend.cancel(cancellationReason);
	} catch (error) {
		failure = error;
	}
	try {
		await backend.close();
	} catch (error) {
		failure ??= error;
	}
	if (failure !== null) throw failure;
}

function assertBackend(value: unknown): asserts value is VampAnalyzerBackendInstance {
	if (value === null || typeof value !== 'object') throw new TypeError('The Vamp backend did not open an instance.');
	const record = value as Record<string, unknown>;
	for (const method of ['configure', 'process', 'finish', 'cancel', 'close']) {
		if (typeof record[method] !== 'function') throw new TypeError(`The Vamp backend lacks ${method}.`);
	}
}

function closedRecord<const Keys extends readonly string[]>(
	value: unknown, keys: Keys, label: string,
): Record<Keys[number], unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a record.`);
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain record.`);
	for (const property of Object.values(Object.getOwnPropertyDescriptors(value))) {
		if (property.get !== undefined || property.set !== undefined) throw new TypeError(`${label} may not contain accessors.`);
	}
	const record = value as Record<string, unknown>;
	const actual = Object.keys(record).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
		throw new TypeError(`${label} has invalid keys.`);
	}
	return record as Record<Keys[number], unknown>;
}

function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^vi[a-f\d]{30}$/u.test(value)) throw new TypeError(`Invalid Vamp ${label}.`);
	return value;
}

function runtimeId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
		throw new TypeError(`Invalid Vamp ${label}.`);
	}
	return value;
}

function reason(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(value)) {
		throw new TypeError('Invalid Vamp cancellation reason.');
	}
	return value;
}

function assertOwner(value: unknown): asserts value is object {
	if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
		throw new TypeError('Invalid Vamp analyzer owner.');
	}
}
