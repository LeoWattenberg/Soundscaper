/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperDesktopProjectLibraryExactGenerationPaths } from
	'./project-library-exact-generation-contract.ts';
import {
	framescaperDesktopExactMediaPath as mediaPath,
	type FramescaperDesktopExactBodyDescriptor,
} from './project-library-exact-generation-storage.ts';
import { verifyProjectLibraryNativeBody } from './project-library-native-body-materialization.ts';

export async function admitExactPublicationBodies(
	paths: Readonly<FramescaperDesktopProjectLibraryExactGenerationPaths>,
	bodies: readonly Readonly<FramescaperDesktopExactBodyDescriptor>[],
	publicationId: string,
	maximumChunkBytes: number,
): Promise<Readonly<{ offsets: number[]; admission: Readonly<Record<string, unknown>> }>> {
	const requiredBodyIndexes: number[] = [];
	const offsets: number[] = [];
	for (const [bodyIndex, body] of bodies.entries()) {
		try {
			await verifyProjectLibraryNativeBody(mediaPath(paths, body), body);
			offsets.push(body.byteLength);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			requiredBodyIndexes.push(bodyIndex);
			offsets.push(0);
		}
	}
	return Object.freeze({
		offsets,
		admission: Object.freeze({
			publicationId, maximumChunkBytes, bodyCount: bodies.length,
			requiredBodyIndexes: Object.freeze(requiredBodyIndexes),
		}),
	});
}
