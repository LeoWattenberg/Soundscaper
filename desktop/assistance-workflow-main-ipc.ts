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

export const ASSISTANCE_WORKFLOW_IPC_CHANNELS = Object.freeze({
	create: 'soundscaper:v1:assistance:workflow:create',
	run: 'soundscaper:v1:assistance:workflow:run',
	cancel: 'soundscaper:v1:assistance:workflow:cancel',
	progress: 'soundscaper:v1:event:assistance-workflow-progress',
} as const);

type AssistanceWorkflows = ReturnType<typeof createAssistanceWorkflowService>;
type Handler = (event: unknown, value?: unknown) => unknown;

export interface AssistanceWorkflowIpcOptions {
	readonly channels: Readonly<typeof ASSISTANCE_WORKFLOW_IPC_CHANNELS>;
	readonly handle: (channel: string, handler: Handler) => void;
	readonly sendToRenderer: (channel: string, payload: unknown) => void;
	readonly createWorkflows: (
		onProgress: (progress: AssistanceWorkflowProgressV1) => void,
	) => AssistanceWorkflows;
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
	const consent = options.consent ?? createAssistanceWorkflowConsentAuthority();
	const fallbackOwner = Object.freeze({});
	const resolve = (): AssistanceWorkflows => {
		workflows ??= options.createWorkflows((progress) =>
			options.sendToRenderer(options.channels.progress, progress));
		return workflows;
	};

	options.handle(options.channels.create, () => pathless(
		() => resolve().createJob(),
		'An assistance workflow job could not be created.',
	));
	options.handle(options.channels.run, (event, value) => pathless(async () => {
		const request = validateAssistanceWorkflow(value);
		const service = resolve();
		service.assertJob(request.jobId);
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
	options.handle(options.channels.cancel, (_event, value) => pathless(
		() => resolve().cancel(opaqueId(value)),
		'The assistance workflow could not be cancelled.',
	));

	return Object.freeze({
		dispose: async () => {
			consent.dispose();
			await workflows?.dispose();
		},
	});
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
