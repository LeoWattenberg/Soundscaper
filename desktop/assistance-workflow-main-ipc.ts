/* SPDX-License-Identifier: AGPL-3.0-only */

/** Trusted main IPC registration for aggregate local-assistance workflows. */

import {
	assistanceWorkflowStageGraph,
	validateAssistanceWorkflow,
	type AssistanceWorkflowProgressV1,
	type AssistanceWorkflowStageSpec,
	type AssistanceWorkflowV1,
} from '../src/common/editor/assistance/workflow.ts';
import { createAssistanceWorkflowConsentAuthority } from './assistance-workflow-consent.ts';
import type { createAssistanceWorkflowService } from './assistance-workflow-service.ts';
import type { AssistanceWorkflowTransfers } from './assistance-workflow-transfers.ts';
import type { HelperDataPlaneIoPort } from './helper-data-plane-io.ts';

export const ASSISTANCE_WORKFLOW_IPC_CHANNELS = Object.freeze({
	create: 'soundscaper:v1:assistance:workflow:create',
	stage: 'soundscaper:v1:assistance:workflow:stage',
	inputPort: 'soundscaper:v1:assistance:workflow:input-port',
	reserve: 'soundscaper:v1:assistance:workflow:reserve',
	bindProducer: 'soundscaper:v1:assistance:workflow:bind-producer',
	run: 'soundscaper:v1:assistance:workflow:run',
	cancel: 'soundscaper:v1:assistance:workflow:cancel',
	readOutput: 'soundscaper:v1:assistance:workflow:read-output',
	outputPort: 'soundscaper:v1:assistance:workflow:output-port',
	release: 'soundscaper:v1:assistance:workflow:release',
	progress: 'soundscaper:v1:event:assistance-workflow-progress',
} as const);

type AssistanceWorkflows = ReturnType<typeof createAssistanceWorkflowService>;
type Handler = (event: unknown, value?: unknown) => unknown;
type Listener = (event: unknown, value?: unknown) => void;

export interface AssistanceWorkflowIpcOptions {
	readonly channels: Readonly<typeof ASSISTANCE_WORKFLOW_IPC_CHANNELS>;
	readonly handle: (channel: string, handler: Handler) => void;
	readonly on?: (channel: string, listener: Listener) => void;
	readonly sendToRenderer: (channel: string, payload: unknown) => void;
	readonly createWorkflows: (
		onProgress: (progress: AssistanceWorkflowProgressV1) => void,
	) => AssistanceWorkflows;
	readonly createTransfers?: (workflows: AssistanceWorkflows) => AssistanceWorkflowTransfers;
	readonly confirmWorkflow: (
		request: AssistanceWorkflowV1,
		stages: readonly AssistanceWorkflowStageSpec[],
	) => PromiseLike<boolean>;
	readonly consent?: ReturnType<typeof createAssistanceWorkflowConsentAuthority>;
}

export function registerAssistanceWorkflowIpc(options: AssistanceWorkflowIpcOptions): Readonly<{
	dispose(): Promise<void>;
}> {
	let workflows: AssistanceWorkflows | null = null;
	let transfers: AssistanceWorkflowTransfers | null = null;
	const consent = options.consent ?? createAssistanceWorkflowConsentAuthority();
	const fallbackOwner = Object.freeze({});
	const resolve = (): AssistanceWorkflows => {
		workflows ??= options.createWorkflows((progress) =>
			options.sendToRenderer(options.channels.progress, progress));
		return workflows;
	};
	const resolveTransfers = (): AssistanceWorkflowTransfers => {
		if (!options.createTransfers || !options.on) {
			throw new Error('Aggregate workflow transfer custody is unavailable.');
		}
		transfers ??= options.createTransfers(resolve());
		return transfers;
	};

	options.handle(options.channels.create, () => pathless(
		() => resolve().createJob(),
		'An assistance workflow job could not be created.',
	));
	options.handle(options.channels.run, (event, value) => pathless(async () => {
		const request = validateAssistanceWorkflow(value);
		const service = resolve();
		service.admitWorkflow(request);
		const selected = new Set(request.stageIds);
		const stages = Object.freeze(assistanceWorkflowStageGraph(request.workflowId)
			.filter(({ stageId }) => selected.has(stageId)));
		if (!await options.confirmWorkflow(request, stages)) {
			await service.cancel(request.jobId);
			return Object.freeze({
				contractVersion: 1 as const,
				jobId: request.jobId,
				workflowId: request.workflowId,
				outcome: 'consent-declined' as const,
			});
		}
		const owner = ownerReference(event) ?? fallbackOwner;
		const grant = consent.issue(owner, request);
		if (!consent.consume(owner, grant, request)) {
			throw new Error('The assistance workflow consent grant could not be consumed.');
		}
		return service.run(request);
	}, 'The assistance workflow could not be completed.'));
	options.handle(options.channels.cancel, (_event, value) => pathless(async () => {
		const jobId = opaqueId(value);
		await transfers?.cancelJob(jobId);
		return resolve().cancel(jobId);
	},
		'The assistance workflow could not be cancelled.',
	));

	if (options.createTransfers && options.on) {
		options.handle(options.channels.stage, (_event, value) => pathless(async () => {
			const request = stageRequest(value);
			if (request.operation === 'prepare') {
				const { operation: _operation, ...input } = request;
				return resolveTransfers().prepareInput(input);
			}
			const { operation: _operation, ...identity } = request;
			return resolveTransfers().awaitInput(identity);
		}, 'The assistance workflow input could not be staged.'));
		options.handle(options.channels.reserve, (_event, value) => pathless(
			() => resolve().reserveOutput(reservationRequest(value)),
			'The assistance workflow output could not be reserved.',
		));
		options.handle(options.channels.bindProducer, (_event, value) => pathless(
			() => resolve().bindProducer(producerRequest(value)),
			'The assistance workflow producer could not be bound.',
		));
		options.handle(options.channels.readOutput, (_event, value) => pathless(
			() => resolveTransfers().prepareOutput(outputReadRequest(value)),
			'The assistance workflow output could not be read.',
		));
		options.handle(options.channels.release, (_event, value) => pathless(async () => {
			const jobId = opaqueId(value);
			await resolveTransfers().cancelJob(jobId);
			return resolve().release(jobId);
		}, 'The assistance workflow could not be released.'));
		options.on(options.channels.inputPort, (event, value) => {
			const port = exactEventPort(event);
			if (!port) return;
			try { void resolveTransfers().acceptInputPort(value, port).catch(() => undefined); }
			catch { port.close(); }
		});
		options.on(options.channels.outputPort, (event, value) => {
			const port = exactEventPort(event);
			if (!port) return;
			try { void resolveTransfers().acceptOutputPort(value, port).catch(() => undefined); }
			catch { port.close(); }
		});
	}

	return Object.freeze({
		dispose: async () => {
			consent.dispose();
			await transfers?.dispose();
			await workflows?.dispose();
		},
	});
}

type StageRequest = Readonly<{ operation: 'prepare'; jobId: unknown; workflowId: unknown;
	stageId: unknown; slotId: unknown; mediaType: unknown; byteLength: unknown; sha256: unknown }>
	| Readonly<{ operation: 'await'; jobId: unknown; streamId: unknown }>;

function stageRequest(value: unknown): StageRequest {
	const row = plainRecord(value, 'workflow stage request');
	const keys = row.operation === 'prepare'
		? ['operation', 'jobId', 'workflowId', 'stageId', 'slotId', 'mediaType', 'byteLength', 'sha256']
		: row.operation === 'await' ? ['operation', 'jobId', 'streamId'] : [];
	assertExactKeys(row, keys, 'workflow stage request');
	return row as StageRequest;
}

function reservationRequest(value: unknown) {
	const row = plainRecord(value, 'workflow output reservation');
	assertExactKeys(row, [
		'jobId', 'workflowId', 'stageId', 'slotId', 'maximumByteLength',
	], 'workflow output reservation');
	return row as unknown as Parameters<AssistanceWorkflows['reserveOutput']>[0];
}

function producerRequest(value: unknown) {
	const row = plainRecord(value, 'workflow producer binding');
	assertExactKeys(row, [
		'jobId', 'workflowId', 'stageId', 'slotId',
		'producerStageId', 'producerSlotId', 'producerClaimId',
	], 'workflow producer binding');
	return row as unknown as Parameters<AssistanceWorkflows['bindProducer']>[0];
}

function outputReadRequest(value: unknown) {
	const row = plainRecord(value, 'workflow output read request');
	assertExactKeys(row, ['jobId', 'workflowId', 'claim'], 'workflow output read request');
	const claim = plainRecord(row.claim, 'workflow output claim');
	assertExactKeys(claim,
		['claimVersion', 'direction', 'claimId', 'jobId', 'stageId', 'slotId'],
		'workflow output claim');
	return row;
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}

function assertExactKeys(row: Record<string, unknown>, keys: readonly string[], label: string): void {
	if (keys.length === 0 || Object.keys(row).length !== keys.length
		|| Object.keys(row).some((key) => !keys.includes(key))) {
		throw new TypeError(`The ${label} carries unsupported fields.`);
	}
}

function exactEventPort(event: unknown): HelperDataPlaneIoPort | null {
	if (!event || typeof event !== 'object') return null;
	const ports = (event as Readonly<{ ports?: unknown }>).ports;
	if (!Array.isArray(ports) || ports.length !== 1) {
		if (Array.isArray(ports)) for (const port of ports) closePort(port);
		return null;
	}
	const port = ports[0] as Partial<HelperDataPlaneIoPort> | null;
	if (!port || typeof port.postMessage !== 'function' || typeof port.on !== 'function'
		|| typeof port.close !== 'function') { closePort(port); return null; }
	return port as HelperDataPlaneIoPort;
}

function closePort(value: unknown): void {
	if (value && typeof value === 'object' && typeof (value as { close?: unknown }).close === 'function') {
		try { (value as { close(): void }).close(); } catch { /* already closed */ }
	}
}

function ownerReference(value: unknown): object | null {
	return value && (typeof value === 'object' || typeof value === 'function') ? value : null;
}

async function pathless<T>(operation: () => PromiseLike<T> | T, message: string): Promise<T> {
	try { return await operation(); }
	catch { throw new Error(message); }
}

function opaqueId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f\d]{40}$/u.test(value)) {
		throw new TypeError('The assistance workflow job ID is invalid.');
	}
	return value;
}
