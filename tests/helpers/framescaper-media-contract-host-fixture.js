/* SPDX-License-Identifier: AGPL-3.0-only */

import { compileNativeTestFixture } from '../../scripts/lib/node-native-test-fixtures.ts';
import { mediaContractFixtureKind } from '../../scripts/lib/node-native-test-fixture-recipes.ts';
import { createPrivateNativeFixtureArtifact } from './native-fixture-compiler.ts';

/** Fresh compilation is shared only within one runner; every case owns its copied executable. */
export function createMediaContractHostFixture(repositoryRoot, { closure = true } = {}) {
	return createPrivateNativeFixtureArtifact({
		prefix: 'framescaper-media-contract-build-', fileName: 'framescaper-media-host',
		build: outputPath => compileNativeTestFixture({
			repositoryRoot, outputPath, kind: closure ? mediaContractFixtureKind() : 'media-contract',
		}),
	});
}
