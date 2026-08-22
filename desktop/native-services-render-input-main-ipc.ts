/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact invoke/MessagePort ingress for durable selected-V20 V7/V8 inputs. */

import type { HelperDataPlaneIoPort } from './helper-data-plane-io.ts';
import type { FramescaperNativeRenderInputStaging } from './native-services-render-input-staging.ts';

export const FRAMESCAPER_NATIVE_RENDER_INPUT_MAIN_CHANNELS = Object.freeze({
	begin: 'framescaper:v1:native-services:render-inputs:begin',
	port: 'framescaper:v1:native-services:render-inputs:port',
	finalize: 'framescaper:v1:native-services:render-inputs:finalize',
	abandon: 'framescaper:v1:native-services:render-inputs:abandon',
} as const);

type Listener = (event: unknown, value?: unknown) => void;

export interface FramescaperNativeRenderInputMainIpcOptions {
	readonly handle: (channel: string, handler: (event: unknown, value?: unknown) => unknown) => void;
	readonly removeHandler: (channel: string) => void;
	readonly on: (channel: string, listener: Listener) => void;
	readonly removeListener: (channel: string, listener: Listener) => void;
	readonly authorizeOwner: (event: unknown) => boolean | object;
	readonly staging: Pick<
		FramescaperNativeRenderInputStaging, 'begin' | 'receive' | 'finalize' | 'abandon'
	>;
}

export function registerFramescaperNativeRenderInputMainIpc(
	options: FramescaperNativeRenderInputMainIpcOptions,
): Readonly<{ dispose: () => void }> {
	const active = new Set<HelperDataPlaneIoPort>();
	let disposed = false;
	const owner = (event: unknown): object => {
		if (disposed) throw new Error('Native render-input IPC is disposed.');
		const authorization = options.authorizeOwner(event);
		if (!authorization || (typeof authorization !== 'object' && typeof authorization !== 'function')) {
			throw new Error('The Framescaper renderer is not authorized to stage render inputs.');
		}
		return authorization;
	};
	options.handle(FRAMESCAPER_NATIVE_RENDER_INPUT_MAIN_CHANNELS.begin, (event, value) => (
		options.staging.begin(owner(event), value)
	));
	options.handle(FRAMESCAPER_NATIVE_RENDER_INPUT_MAIN_CHANNELS.finalize, (event, value) => (
		options.staging.finalize(owner(event), value)
	));
	options.handle(FRAMESCAPER_NATIVE_RENDER_INPUT_MAIN_CHANNELS.abandon, async (event, value) => {
		await options.staging.abandon(owner(event), value as Readonly<{ stageId: string }>);
		return true;
	});
	const listener: Listener = (event, value) => {
		const port = eventPort(event);
		if (port === null) return;
		try {
			const renderer = owner(event);
			active.add(port);
			void options.staging.receive(renderer, value, port)
				.catch(() => undefined).finally(() => active.delete(port));
		} catch {
			port.close();
		}
	};
	options.on(FRAMESCAPER_NATIVE_RENDER_INPUT_MAIN_CHANNELS.port, listener);
	return Object.freeze({
		dispose: () => {
			if (disposed) return;
			disposed = true;
			options.removeHandler(FRAMESCAPER_NATIVE_RENDER_INPUT_MAIN_CHANNELS.begin);
			options.removeHandler(FRAMESCAPER_NATIVE_RENDER_INPUT_MAIN_CHANNELS.finalize);
			options.removeHandler(FRAMESCAPER_NATIVE_RENDER_INPUT_MAIN_CHANNELS.abandon);
			options.removeListener(FRAMESCAPER_NATIVE_RENDER_INPUT_MAIN_CHANNELS.port, listener);
			for (const port of active) port.close();
			active.clear();
		},
	});
}

function eventPort(event: unknown): HelperDataPlaneIoPort | null {
	if (!event || typeof event !== 'object') return null;
	const ports = (event as Readonly<{ ports?: unknown }>).ports;
	if (!Array.isArray(ports) || ports.length !== 1) return null;
	const port = ports[0] as Partial<HelperDataPlaneIoPort> | null;
	return port && typeof port.postMessage === 'function' && typeof port.on === 'function'
		&& typeof port.close === 'function' ? port as HelperDataPlaneIoPort : null;
}
