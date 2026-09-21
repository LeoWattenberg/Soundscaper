/* SPDX-License-Identifier: AGPL-3.0-only */

/** Dispatch a closed renderer request using the product's statically bundled operations. */
export function runDesktopRendererSmokeOperation(scope, request, operations) {
	if (!request || typeof request !== 'object' || Array.isArray(request)
		|| JSON.stringify(Object.keys(request).sort()) !== '["arguments","operation"]'
		|| !Array.isArray(request.arguments)) {
		throw new TypeError('Desktop renderer smoke request is invalid.');
	}
	const operation = Object.hasOwn(operations, request.operation)
		? operations[request.operation] : undefined;
	if (typeof operation !== 'function') {
		throw new TypeError('Desktop renderer smoke operation is unsupported.');
	}
	return operation(scope, ...request.arguments);
}

/** Keep error normalization in inventoried renderer code, not the launcher. */
export async function runDesktopRendererSmokeOperationEnvelope(scope, request, operations) {
	try {
		return { status: 'fulfilled', value: await runDesktopRendererSmokeOperation(scope, request, operations) };
	} catch (error) {
		const message = typeof error?.message === 'string' ? error.message : String(error);
		return { status: 'rejected', message: message.slice(0, 2_048) };
	}
}
