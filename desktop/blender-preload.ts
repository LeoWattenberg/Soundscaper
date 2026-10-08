/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	BLENDER_CHANNELS, validateBlenderBegin, validateBlenderPublication,
	validateBlenderSelect, validateBlenderSession, validateBlenderWrite, type BlenderBridge,
} from '../src/common/editor/blender-contract.ts';

export function createBlenderPreloadBridge(options: {
	invoke(channel: string, value: unknown): Promise<unknown>;
}): BlenderBridge {
	return Object.freeze({
		async select(value) {
			const result = await options.invoke(BLENDER_CHANNELS.select, validateBlenderSelect(value));
			return result === null ? null : validateBlenderSession(result);
		},
		async begin(value) {
			const request = validateBlenderBegin(value);
			const result = response(await options.invoke(BLENDER_CHANNELS.begin, request), 'publicationId');
			return { publicationId: validateBlenderPublication({ sessionId: request.sessionId, publicationId: result }).publicationId };
		},
		async write(value) {
			await options.invoke(BLENDER_CHANNELS.write, validateBlenderWrite(value));
		},
		async commit(value) {
			const result = response(await options.invoke(BLENDER_CHANNELS.commit, validateBlenderPublication(value)), 'revision');
			if (!Number.isSafeInteger(result) || (result as number) <= 0) throw new TypeError('Invalid Blender publication revision');
			return { revision: result as number };
		},
		async abort(value) {
			await options.invoke(BLENDER_CHANNELS.abort, validateBlenderPublication(value));
		},
		async stop(value) {
			await options.invoke(BLENDER_CHANNELS.stop, validateBlenderSession(value));
		},
	} satisfies BlenderBridge);
}

function response(value: unknown, field: string): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
		|| Reflect.ownKeys(value).length !== 1) throw new TypeError('Invalid Blender desktop response');
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Invalid Blender desktop response');
	return descriptor.value;
}
