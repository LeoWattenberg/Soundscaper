/* SPDX-License-Identifier: AGPL-3.0-only */

import { HelperContractViolationError } from './helper-wire-admission.ts';

interface VendorWindowProcess {
	openVendorUi(request: Readonly<{ instanceId: string; windowHandleId: string }>): string;
}

/** Exchange a raw main ID for one helper-authenticated, renderer-opaque window capability. */
export function openHelperOwnedVendorWindow(options: Readonly<{
	process: VendorWindowProcess;
	rawWindowId: string;
	instanceId: string;
	hostId: string;
	ownerGeneration: number;
}>): Readonly<{
	windowHandleId: string;
	instanceId: string;
	hostId: string;
	ownerGeneration: number;
	surface: 'helper-owned-top-level';
}> {
	const windowHandleId = vendorWindowCapability(options.process.openVendorUi(Object.freeze({
		instanceId: options.instanceId,
		windowHandleId: options.rawWindowId,
	})));
	return Object.freeze({
		windowHandleId,
		instanceId: options.instanceId,
		hostId: options.hostId,
		ownerGeneration: options.ownerGeneration,
		surface: 'helper-owned-top-level' as const,
	});
}

function vendorWindowCapability(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
		throw new HelperContractViolationError('unsafe-grant',
			'The plug-in helper returned no bounded vendor-window capability.');
	}
	return value;
}
