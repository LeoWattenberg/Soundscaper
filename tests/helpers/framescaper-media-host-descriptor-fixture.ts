/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperMediaHostDescriptor } from '../../desktop/framescaper-media-host-payload.ts';

export function framescaperMediaHostDescriptorFixture(
	base: Omit<FramescaperMediaHostDescriptor, 'isolation'>,
): FramescaperMediaHostDescriptor {
	const artifact = (name: string, byte: string, ino: number) => Object.freeze({
		path: `/synthetic/media-isolation/${name}`,
		byteLength: 1,
		sha256: byte.repeat(32),
		identity: Object.freeze({ dev: 1, ino }),
	});
	return Object.freeze({
		...base,
		isolation: Object.freeze({
			launcher: artifact('launcher', '11', 31),
			sandboxProfile: artifact('profile.json', '22', 32),
			brokerPolicy: artifact('broker.json', '33', 33),
			runtimeLibraries: Object.freeze([]),
		}),
	});
}
