/* SPDX-License-Identifier: AGPL-3.0-only */

/** Lazy workflow projection kept separate from the primitive-operation bridge. */

import type { LocalAssistanceWorkflowBridge } from './local-assistance-workflow-bridge.ts';

export function lazyAssistanceWorkflowBridge(value: unknown): LocalAssistanceWorkflowBridge | null {
	if (!isRecord(value)) return null;
	const methods = ['createJob', 'run', 'cancel', 'onProgress'] as const;
	const keys = Object.keys(value);
	if ((keys.length !== methods.length && keys.length !== methods.length + 1)
		|| keys.some((key) => key !== 'custody' && !methods.includes(
			key as typeof methods[number],
		)) || methods.some((method) => typeof value[method] !== 'function')) return null;
	const custodyMethods = ['stageInput', 'reserveOutput', 'bindProducer', 'release'] as const;
	const hasCustody = value.custody !== undefined;
	const rawCustody = isRecord(value.custody) ? value.custody : null;
	if (hasCustody && (!rawCustody
		|| Object.keys(rawCustody).length !== custodyMethods.length
		|| Object.keys(rawCustody).some((key) => !custodyMethods.includes(
			key as typeof custodyMethods[number],
		)) || custodyMethods.some((method) => typeof rawCustody[method] !== 'function'))) return null;
	let loaded: Promise<LocalAssistanceWorkflowBridge> | null = null;
	const resolve = (): Promise<LocalAssistanceWorkflowBridge> => {
		loaded ??= import('./local-assistance-workflow-bridge.ts').then((module) => {
			const bridge = module.resolveLocalAssistanceWorkflowBridge(value);
			if (!bridge) throw new TypeError('The assistance workflow bridge is invalid.');
			return bridge;
		});
		return loaded;
	};
	return Object.freeze({
		...(hasCustody ? { custody: Object.freeze({
			stageInput: async (...args: Parameters<NonNullable<LocalAssistanceWorkflowBridge['custody']>['stageInput']>) => {
				const bridge = await resolve();
				if (!bridge.custody) throw new TypeError('The workflow custody bridge is unavailable.');
				return bridge.custody.stageInput(...args);
			},
			reserveOutput: async (...args: Parameters<NonNullable<LocalAssistanceWorkflowBridge['custody']>['reserveOutput']>) => {
				const bridge = await resolve();
				if (!bridge.custody) throw new TypeError('The workflow custody bridge is unavailable.');
				return bridge.custody.reserveOutput(...args);
			},
			bindProducer: async (...args: Parameters<NonNullable<LocalAssistanceWorkflowBridge['custody']>['bindProducer']>) => {
				const bridge = await resolve();
				if (!bridge.custody) throw new TypeError('The workflow custody bridge is unavailable.');
				return bridge.custody.bindProducer(...args);
			},
			release: async (...args: Parameters<NonNullable<LocalAssistanceWorkflowBridge['custody']>['release']>) => {
				const bridge = await resolve();
				if (!bridge.custody) throw new TypeError('The workflow custody bridge is unavailable.');
				return bridge.custody.release(...args);
			},
		}) } : {}),
		createJob: async () => (await resolve()).createJob(),
		run: async (request: Parameters<LocalAssistanceWorkflowBridge['run']>[0]) =>
			(await resolve()).run(request),
		cancel: async (jobIdValue: string) => (await resolve()).cancel(jobIdValue),
		onProgress(listener: Parameters<LocalAssistanceWorkflowBridge['onProgress']>[0]) {
			let disposed = false;
			let unsubscribe: (() => void) | null = null;
			void resolve().then((bridge) => {
				if (!disposed) unsubscribe = bridge.onProgress(listener);
			}).catch(() => undefined);
			return () => { disposed = true; unsubscribe?.(); };
		},
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object'
		&& !Array.isArray(value) && !ArrayBuffer.isView(value);
}
