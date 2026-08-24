/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperNativeImageSequenceDecodeAuthority } from './native-image-sequence-decode-authority.ts';
import { assertFramescaperNativeImageSequenceDecodeRequest } from './native-image-sequence-decode-contract.ts';

export const FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_DECODE_CHANNEL =
	'framescaper:v1:native-services:image-sequence:decode';

export function registerFramescaperNativeImageSequenceDecodeMainIpc(options: Readonly<{
	readonly handle: (channel: string, handler: (event: unknown, request?: unknown) => unknown) => void;
	readonly removeHandler: (channel: string) => void;
	readonly authorizeOwner: (event: unknown) => object | null;
	readonly authority: Pick<FramescaperNativeImageSequenceDecodeAuthority, 'request' | 'revokeOwner'>;
}>): Readonly<{ dispose: () => Promise<void> }> {
	const owners = new Set<object>();
	let disposed = false;
	options.handle(FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_DECODE_CHANNEL, (event, request) => {
		if (disposed) throw new Error('Image-sequence decode IPC is disposed.');
		const owner = options.authorizeOwner(event);
		if (!owner || typeof owner !== 'object') {
			throw new Error('The Framescaper renderer is not authorized to decode an image sequence.');
		}
		assertFramescaperNativeImageSequenceDecodeRequest(request);
		owners.add(owner);
		return options.authority.request(owner, request);
	});
	return Object.freeze({
		async dispose() {
			if (disposed) return;
			disposed = true;
			options.removeHandler(FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_DECODE_CHANNEL);
			await Promise.all([...owners].map((owner) => options.authority.revokeOwner(owner)));
			owners.clear();
		},
	});
}
