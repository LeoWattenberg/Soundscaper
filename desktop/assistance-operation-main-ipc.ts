/* SPDX-License-Identifier: AGPL-3.0-only */

/** Trusted main IPC registration for the pathless local-assistance operation bridge. */

import {
	validateAssistanceOperationRequest,
	type AssistanceOperationProgress,
	type AssistanceOperationRequest,
} from './assistance-operation-contract.ts';
import type { createAssistanceOperationService } from './assistance-operation-service.ts';
import { AssistanceOperationTransfers } from './assistance-operation-transfers.ts';
import type { HelperDataPlaneIoPort } from './helper-data-plane-io.ts';

export const ASSISTANCE_OPERATION_IPC_CHANNELS = Object.freeze({
	models: 'soundscaper:v1:assistance:operation:models',
	create: 'soundscaper:v1:assistance:operation:create',
	stage: 'soundscaper:v1:assistance:operation:stage',
	inputPort: 'soundscaper:v1:assistance:operation:input-port',
	reserve: 'soundscaper:v1:assistance:operation:reserve',
	run: 'soundscaper:v1:assistance:operation:run',
	cancel: 'soundscaper:v1:assistance:operation:cancel',
	readOutput: 'soundscaper:v1:assistance:operation:read-output',
	outputPort: 'soundscaper:v1:assistance:operation:output-port',
	release: 'soundscaper:v1:assistance:operation:release',
	progress: 'soundscaper:v1:event:assistance-operation-progress',
} as const);

type AssistanceOperations = ReturnType<typeof createAssistanceOperationService>;
type AssistanceOperationChannelSet = Readonly<typeof ASSISTANCE_OPERATION_IPC_CHANNELS>;
type Handler = (event: unknown, value?: unknown) => unknown;
type Listener = (event: unknown, value?: unknown) => void;

export interface AssistanceOperationIpcOptions {
	readonly channels: AssistanceOperationChannelSet;
	readonly handle: (channel: string, handler: Handler) => void;
	readonly on: (channel: string, listener: Listener) => void;
	readonly sendToRenderer: (channel: string, payload: unknown) => void;
	readonly createOperations: (
		onProgress: (progress: AssistanceOperationProgress) => void,
	) => AssistanceOperations;
	readonly createTransfers?: (operations: AssistanceOperations) => AssistanceOperationTransfers;
	/** Trusted native confirmation for this exact validated selection and operation. */
	readonly confirmOperation: (request: AssistanceOperationRequest) => PromiseLike<boolean>;
}

export function registerAssistanceOperationIpc(options: AssistanceOperationIpcOptions): Readonly<{
	dispose(): Promise<void>;
}> {
	let operations: AssistanceOperations | null = null;
	let transfers: AssistanceOperationTransfers | null = null;
	const resolve = (): Readonly<{ operations: AssistanceOperations; transfers: AssistanceOperationTransfers }> => {
		if (!operations) {
			operations = options.createOperations((progress) =>
				options.sendToRenderer(options.channels.progress, progress));
			transfers = options.createTransfers?.(operations) ?? new AssistanceOperationTransfers({ operations });
		}
		return { operations, transfers: transfers! };
	};

	options.handle(options.channels.models, () => pathless(
		() => resolve().operations.models(), 'Authenticated assistance models could not be listed.'));
	options.handle(options.channels.create, () => pathless(
		() => resolve().operations.createJob(), 'An assistance operation job could not be created.'));
	options.handle(options.channels.stage, (_event, value) => pathless(async () => {
		const request = stageRequest(value);
		if (request.operation === 'prepare') {
			const { operation: _operation, ...input } = request;
			return resolve().transfers.prepareInput(input);
		}
		const { operation: _operation, ...identity } = request;
		return resolve().transfers.awaitInput(identity);
	}, 'The assistance input could not be staged.'));
	options.handle(options.channels.reserve, (_event, value) => pathless(
		() => resolve().operations.reserveOutput(value as never),
		'The assistance output could not be reserved.'));
	options.handle(options.channels.run, (_event, value) => pathless(async () => {
		const request = validateAssistanceOperationRequest(value);
		if (!await options.confirmOperation(request)) {
			return Object.freeze({
				contractVersion: 1 as const,
				jobId: request.jobId,
				operation: request.operation,
				outcome: 'consent-declined' as const,
			});
		}
		return resolve().operations.run(request);
	}, 'The assistance operation could not be completed.'));
	options.handle(options.channels.cancel, (_event, value) => pathless(async () => {
		const jobId = opaqueId(value);
		await resolve().transfers.cancelJob(jobId);
		return resolve().operations.cancel(jobId);
	}, 'The assistance operation could not be cancelled.'));
	options.handle(options.channels.readOutput, (_event, value) => pathless(
		() => resolve().transfers.prepareOutput(value), 'The assistance output could not be read.'));
	options.handle(options.channels.release, (_event, value) => pathless(async () => {
		const jobId = opaqueId(value);
		await resolve().transfers.cancelJob(jobId);
		return resolve().operations.release(jobId);
	}, 'The assistance operation job could not be released.'));

	options.on(options.channels.inputPort, (event, value) => {
		const port = exactEventPort(event);
		if (!port) return;
		try { void resolve().transfers.acceptInputPort(value, port).catch(() => undefined); }
		catch { port.close(); }
	});
	options.on(options.channels.outputPort, (event, value) => {
		const port = exactEventPort(event);
		if (!port) return;
		try { void resolve().transfers.acceptOutputPort(value, port).catch(() => undefined); }
		catch { port.close(); }
	});

	return Object.freeze({ dispose: async () => { await transfers?.dispose(); await operations?.dispose(); } });
}

type StageRequest =
	| Readonly<{ operation: 'prepare'; jobId: unknown; role: unknown; mediaType: unknown;
		byteLength: unknown; sha256: unknown }>
	| Readonly<{ operation: 'await'; jobId: unknown; streamId: unknown }>;

function stageRequest(value: unknown): StageRequest {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError('An assistance input stage request must be a plain record.');
	}
	const record = value as Record<string, unknown>;
	const keys = record.operation === 'prepare'
		? ['operation', 'jobId', 'role', 'mediaType', 'byteLength', 'sha256']
		: record.operation === 'await' ? ['operation', 'jobId', 'streamId'] : [];
	if (keys.length === 0 || Object.keys(record).length !== keys.length
		|| Object.keys(record).some((key) => !keys.includes(key))) {
		throw new TypeError('An assistance input stage request carries unsupported fields.');
	}
	return record as StageRequest;
}

function exactEventPort(event: unknown): HelperDataPlaneIoPort | null {
	if (!event || typeof event !== 'object') return null;
	const portsValue = (event as Readonly<{ ports?: unknown }>).ports;
	if (!Array.isArray(portsValue)) return null;
	if (portsValue.length !== 1) {
		for (const candidate of portsValue) closePort(candidate);
		return null;
	}
	const port = portsValue[0] as Partial<HelperDataPlaneIoPort> | null;
	if (!port || typeof port.postMessage !== 'function' || typeof port.on !== 'function'
		|| typeof port.close !== 'function') { closePort(port); return null; }
	return port as HelperDataPlaneIoPort;
}

function closePort(value: unknown): void {
	if (value && typeof value === 'object' && typeof (value as { close?: unknown }).close === 'function') {
		try { (value as { close(): void }).close(); } catch { /* already closed */ }
	}
}

async function pathless<T>(operation: () => PromiseLike<T> | T, message: string): Promise<T> {
	try { return await operation(); }
	catch { throw new Error(message); }
}

function opaqueId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f\d]{40}$/u.test(value)) {
		throw new TypeError('The assistance operation job id is invalid.');
	}
	return value;
}
