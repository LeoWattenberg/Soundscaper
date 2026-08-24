/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bind out-of-band MessagePorts to the exact stream identities in a native job grant. */

import type { HelperDataPlaneBinding } from './helper-data-plane.ts';
import type { HelperDataPlaneInputReservation } from './helper-data-plane-input-reservation.ts';
import type {
	AnyHelperJobGrant,
	HelperJobKind,
} from './helper-job-grant.ts';
import type {
	HelperMediaDecodeJobGrant,
	HelperMediaEncodeJobGrant,
	HelperMediaProxyJobGrant,
	HelperNativeInputGrant,
	HelperOfxScanJobGrant,
} from './helper-native-job-contract.ts';
import type { HelperOfxHostJobGrantV1OrV2 } from './helper-native-ofx-host-grant-v2.ts';
import { isHelperOfxInteractJobGrantV1 } from './helper-native-ofx-interact-grant.ts';
import { HelperContractViolationError } from './helper-wire-admission.ts';

export interface HelperDataPlaneTransferPort {
	postMessage(message: unknown, transfer?: readonly unknown[]): void;
	close(): void;
}

export interface HelperDataPlaneTransfer {
	readonly streamId: string;
	readonly port: HelperDataPlaneTransferPort;
}

/**
 * Return ports in canonical grant order. Native jobs must transfer every bound
 * stream exactly once; legacy control-only jobs must not carry a transfer list.
 */
export function admitHelperDataPlaneTransfers(
	kind: HelperJobKind,
	grant: AnyHelperJobGrant,
	value: unknown,
): readonly HelperDataPlaneTransferPort[] {
	const bindings = nativeBindings(kind, grant);
	if (bindings.length === 0) {
		if (value !== undefined) unsafe('A control-only helper job cannot transfer data-plane ports.');
		return Object.freeze([]);
	}
	if (!Array.isArray(value) || value.length !== bindings.length) {
		unsafe('A native helper job must transfer every exact data-plane port once.');
	}
	const byStream = new Map<string, HelperDataPlaneTransferPort>();
	for (const [index, candidate] of value.entries()) {
		const transfer = transferRecord(candidate, index);
		if (byStream.has(transfer.streamId)) {
			unsafe('A helper data-plane stream cannot transfer more than one port.');
		}
		byStream.set(transfer.streamId, transfer.port);
	}
	const bindingIds = new Set<string>();
	for (const binding of bindings) {
		if (bindingIds.has(binding.streamId)) {
			unsafe('A native helper grant reuses one data-plane stream identity.');
		}
		bindingIds.add(binding.streamId);
	}
	if ([...byStream.keys()].some((streamId) => !bindingIds.has(streamId))) {
		unsafe('A helper data-plane port does not belong to the admitted native grant.');
	}
	return Object.freeze(bindings.map(({ streamId }) => {
		const port = byStream.get(streamId);
		if (!port) unsafe('An admitted native data-plane stream has no transferred port.');
		return port;
	}));
}

/** Helper-side count check for ports delivered in canonical grant order. */
export function helperJobTransferredPortCount(
	kind: HelperJobKind,
	grant: AnyHelperJobGrant,
): number {
	return nativeBindings(kind, grant).length;
}

function nativeBindings(
	kind: HelperJobKind,
	grant: AnyHelperJobGrant,
): readonly Readonly<{ streamId: string }>[] {
	if (kind === 'audio-device' || kind === 'plugin-host') {
		const binding = (grant as { persistentPort?: Readonly<{ streamId: string }> }).persistentPort;
		return binding ? [binding] : [];
	}
	if (kind === 'media-decode') {
		const value = grant as HelperMediaDecodeJobGrant;
		return [value.plan, ...streamBindings(value.sources), value.output];
	}
	if (kind === 'media-encode' || kind === 'media-render') {
		const value = grant as HelperMediaEncodeJobGrant;
		return [value.plan, ...streamBindings(value.sources)];
	}
	if (kind === 'media-proxy') {
		const value = grant as HelperMediaProxyJobGrant;
		return [value.plan, ...streamBindings([value.source])];
	}
	if (kind === 'ofx-scan') return [(grant as HelperOfxScanJobGrant).descriptor];
	if (kind === 'ofx-host') {
		const value = grant as HelperOfxHostJobGrantV1OrV2;
		if (isHelperOfxInteractJobGrantV1(value)) return [];
		return [value.plan,
			...(value.videoTimingAssets ?? []).map(({ binding }) => binding),
			...value.inputs.map(({ frame }) => frame), value.output.frame];
	}
	return [];
}

function streamBindings(inputs: readonly HelperNativeInputGrant[]): readonly (
	HelperDataPlaneBinding | HelperDataPlaneInputReservation
)[] {
	return inputs.flatMap((input) => input.type === 'stream' ? [input.binding] : []);
}

function transferRecord(value: unknown, index: number): HelperDataPlaneTransfer {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		return unsafe(`Helper data-plane transfer ${String(index)} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== 2 || !keys.includes('streamId') || !keys.includes('port')) {
		return unsafe(`Helper data-plane transfer ${String(index)} has an invalid closed shape.`);
	}
	const record = value as Record<string, unknown>;
	const streamId = data(record, 'streamId', index);
	const port = data(record, 'port', index);
	if (typeof streamId !== 'string' || !/^[a-f\d]{40}$/u.test(streamId)) {
		return unsafe(`Helper data-plane transfer ${String(index)} has an invalid stream identity.`);
	}
	if (!port || typeof port !== 'object'
		|| typeof (port as Partial<HelperDataPlaneTransferPort>).postMessage !== 'function'
		|| typeof (port as Partial<HelperDataPlaneTransferPort>).close !== 'function') {
		return unsafe(`Helper data-plane transfer ${String(index)} requires one MessagePort.`);
	}
	return Object.freeze({ streamId, port: port as HelperDataPlaneTransferPort });
}

function data(record: Record<string, unknown>, key: string, index: number): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		return unsafe(`Helper data-plane transfer ${String(index)}.${key} must be a data field.`);
	}
	return descriptor.value;
}

function unsafe(message: string): never {
	throw new HelperContractViolationError('unsafe-grant', message);
}
