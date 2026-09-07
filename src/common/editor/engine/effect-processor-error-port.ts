/* SPDX-License-Identifier: AGPL-3.0-only */

// A worklet-borne effect reports a failure once, over its message port, and
// then emits silence for the rest of the session: a processor that cannot
// construct — or that throws inside `process()` — fills its output with zeros
// every quantum. The parametric EQ and the Audacity live effects both report
// that way, so one handler forwards `{ type: 'error' }` with the rack context
// that names the strip and the effect, and chains everything else on to the
// handler already installed on the port (the dynamics telemetry reader) rather
// than replacing it.

import type { UnknownRecord } from './types.ts';

export interface EffectProcessorErrorMessages {
	/** Reported when the processor named no failure of its own. */
	readonly fallbackMessage: string;
	/** Reported when the node itself raised `processorerror`. */
	readonly processorErrorMessage: string;
}

export interface EffectProcessorErrorContext extends EffectProcessorErrorMessages {
	readonly scope: string | null;
	readonly targetId: string | null;
	readonly effectId: string | null;
}

interface PortRegistration {
	readonly handler: (event: MessageEvent<unknown>) => void;
	readonly processorErrorHandler: () => void;
}

interface ProcessorEventHooks {
	addEventListener?(type: string, listener: () => void): void;
	removeEventListener?(type: string, listener: () => void): void;
	onprocessorerror?: (() => void) | null;
}

const registrations = new WeakMap<AudioWorkletNode, PortRegistration>();

/** Name the rack position a processor failure came from. */
export function effectProcessorErrorContext(
	target: { readonly scope?: unknown; readonly targetId?: unknown },
	effectId: unknown,
	messages: EffectProcessorErrorMessages,
): EffectProcessorErrorContext {
	const scope = typeof target.scope === 'string' ? target.scope : null;
	return {
		scope,
		targetId: scope === 'master' || target.targetId == null ? null : String(target.targetId),
		effectId: typeof effectId === 'string' && effectId ? effectId : null,
		...messages,
	};
}

export function attachEffectProcessorErrorPort(
	processor: AudioWorkletNode,
	report: (error: Readonly<UnknownRecord>) => void,
	context: EffectProcessorErrorContext,
): void {
	const port = processor.port;
	if (!port || registrations.has(processor)) return;
	const chained = port.onmessage;
	const handler = (event: MessageEvent<unknown>): void => {
		const data = event.data;
		if (!data || typeof data !== 'object' || (data as UnknownRecord).type !== 'error') {
			chained?.call(port, event);
			return;
		}
		const details = data as UnknownRecord;
		report(Object.freeze({
			...details,
			type: 'error',
			message: typeof details.message === 'string' && details.message
				? details.message
				: context.fallbackMessage,
			scope: context.scope,
			targetId: context.targetId,
			effectId: context.effectId,
		}));
	};
	const processorErrorHandler = (): void => handler(new MessageEvent('message', {
		data: { type: 'error', message: context.processorErrorMessage },
	}));
	port.onmessage = handler;
	port.start?.();
	const hooks = processor as unknown as ProcessorEventHooks;
	if (typeof hooks.addEventListener === 'function') {
		hooks.addEventListener('processorerror', processorErrorHandler);
	} else hooks.onprocessorerror = processorErrorHandler;
	registrations.set(processor, { handler, processorErrorHandler });
}

export function releaseEffectProcessorErrorPort(node: AudioNode): void {
	const processor = node as AudioWorkletNode;
	const registration = registrations.get(processor);
	if (!registration) return;
	if (processor.port?.onmessage === registration.handler) processor.port.onmessage = null;
	const hooks = processor as unknown as ProcessorEventHooks;
	if (typeof hooks.removeEventListener === 'function') {
		hooks.removeEventListener('processorerror', registration.processorErrorHandler);
	} else if (hooks.onprocessorerror === registration.processorErrorHandler) hooks.onprocessorerror = null;
	registrations.delete(processor);
}
