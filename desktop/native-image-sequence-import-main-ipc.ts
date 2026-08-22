/* SPDX-License-Identifier: AGPL-3.0-only */

/** Optional candidate-only control and MessagePort ingress for image-sequence publication. */

import type { HelperDataPlaneIoPort } from './helper-data-plane-io.ts';
import type { FramescaperNativeImageSequenceImportAuthority } from './native-image-sequence-import-authority.ts';
import {
	assertFramescaperNativeImageSequenceImportPortRequest,
	assertFramescaperNativeImageSequenceImportRequest,
} from './native-image-sequence-import-contract.ts';

export const FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_IMPORT_CHANNELS = Object.freeze({
	control: 'framescaper:v1:native-services:image-sequence:import',
	port: 'framescaper:v1:native-services:image-sequence:import-port',
} as const);

type Handler = (event: unknown, value?: unknown) => unknown;
type Listener = (event: unknown, value?: unknown) => void;

export interface FramescaperNativeImageSequenceImportMainIpcOptions {
	readonly handle: (channel: string, handler: Handler) => void;
	readonly removeHandler: (channel: string) => void;
	readonly on: (channel: string, listener: Listener) => void;
	readonly removeListener: (channel: string, listener: Listener) => void;
	readonly authorizeOwner: (event: unknown) => object | null;
	readonly authority: Pick<FramescaperNativeImageSequenceImportAuthority,
		'request' | 'receiveChunk' | 'revokeOwner'>;
}

export function registerFramescaperNativeImageSequenceImportMainIpc(
	options: FramescaperNativeImageSequenceImportMainIpcOptions,
): Readonly<{ dispose: () => Promise<void> }> {
	const owners = new Set<object>();
	const active = new Set<HelperDataPlaneIoPort>();
	let disposed = false;
	const owner = (event: unknown): object => {
		if (disposed) throw new Error('Image-sequence import IPC is disposed.');
		const authorization = options.authorizeOwner(event);
		if (!authorization || typeof authorization !== 'object') {
			throw new Error('The Framescaper renderer is not authorized to import an image sequence.');
		}
		owners.add(authorization);
		return authorization;
	};
	options.handle(FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_IMPORT_CHANNELS.control,
		(event, value) => {
			assertFramescaperNativeImageSequenceImportRequest(value, {
				allowDirectWrite: false, controlEnvelope: true,
			});
			return options.authority.request(owner(event), value as never);
		});
	const listener: Listener = (event, value) => {
		const port = eventPort(event);
		if (!port) return;
		try {
			assertFramescaperNativeImageSequenceImportPortRequest(value);
			const renderer = owner(event);
			active.add(port);
			void options.authority.receiveChunk(renderer, value as never, port)
				.catch(() => undefined).finally(() => active.delete(port));
		} catch { port.close(); }
	};
	options.on(FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_IMPORT_CHANNELS.port, listener);
	return Object.freeze({
		dispose: async () => {
			if (disposed) return;
			disposed = true;
			options.removeHandler(FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_IMPORT_CHANNELS.control);
			options.removeListener(FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_IMPORT_CHANNELS.port, listener);
			for (const port of active) port.close();
			active.clear();
			await Promise.all([...owners].map((renderer) => options.authority.revokeOwner(renderer)));
			owners.clear();
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
