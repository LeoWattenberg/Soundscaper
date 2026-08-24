/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperNativeOpenFxBridge } from './framescaper-native-openfx-bridge.ts';
import {
	createFramescaperOpenFxFramePortClient,
	type FramescaperOpenFxFramePortClient,
	type FramescaperOpenFxFramePortOfferV1,
	type FramescaperOpenFxRendererMessagePort,
} from './framescaper-native-openfx-frame-client.ts';

/** Adapt the preload's one-port offers without exposing native paths or RGBA on control IPC. */
export function createFramescaperNativeOpenFxFrameRuntimeV28(
	bridge: FramescaperNativeOpenFxBridge | null,
	scope: Pick<Window, 'addEventListener' | 'removeEventListener'> & { readonly window?: Window } = globalThis.window,
): FramescaperOpenFxFramePortClient | null {
	if (typeof bridge?.openOpenFxFrameSession !== 'function') return null;
	if (!scope || typeof scope.addEventListener !== 'function' || typeof scope.removeEventListener !== 'function') {
		throw new TypeError('Selected V28 OpenFX frame execution requires a renderer window.');
	}
	return createFramescaperOpenFxFramePortClient({
		openSession: (request) => bridge.openOpenFxFrameSession!.call(bridge, request),
		subscribeOffers(listener) {
			const receive = (event: MessageEvent<unknown>): void => {
				if (event.source !== (scope.window ?? globalThis.window)) return;
				try {
					const envelope = exactEnvelope(event.data);
					if (envelope === null) return;
					if (event.ports.length !== 1) throw new TypeError('OpenFX frame offer requires one port.');
					listener(exactOffer(envelope.offer), event.ports[0] as unknown as FramescaperOpenFxRendererMessagePort);
				} catch { for (const offered of event.ports) offered.close(); }
			};
			scope.addEventListener('message', receive as EventListener);
			return () => scope.removeEventListener('message', receive as EventListener);
		},
	});
}

function exactEnvelope(value: unknown): Readonly<{ readonly offer: unknown }> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const type = Object.getOwnPropertyDescriptor(value, 'type');
	if (!type) return null;
	if (!type.enumerable || !Object.hasOwn(type, 'value')) throw new TypeError('OpenFX offer type is not data.');
	if (type.value !== 'framescaper-openfx-frame-port-v1') return null;
	const offer = Object.getOwnPropertyDescriptor(value, 'offer');
	if (Reflect.ownKeys(value).length !== 2 || !offer?.enumerable || !Object.hasOwn(offer, 'value')) {
		throw new TypeError('OpenFX offer envelope is not closed.');
	}
	return Object.freeze({ offer: offer.value });
}

function exactOffer(value: unknown): FramescaperOpenFxFramePortOfferV1 {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Reflect.ownKeys(value).length !== 3
		|| (value as Record<string, unknown>).protocolVersion !== 1
		|| typeof (value as Record<string, unknown>).sessionId !== 'string'
		|| !/^[a-f\d]{40}$/u.test((value as Record<string, unknown>).sessionId as string)
		|| typeof (value as Record<string, unknown>).requestNonce !== 'string'
		|| !/^[a-f\d]{40}$/u.test((value as Record<string, unknown>).requestNonce as string)) {
		throw new TypeError('Selected V28 OpenFX frame-port offer is invalid.');
	}
	return value as FramescaperOpenFxFramePortOfferV1;
}
