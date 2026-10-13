/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { boostClosureIncludeArguments } from './framescaper-boost-closure.js';
import { createPrivateNativeFixtureArtifact } from './native-fixture-compiler.ts';

/** Compile a fresh contract host once; each case keeps its own executable and scratch tree. */
export function createMediaContractHostFixture(repositoryRoot) {
	return createPrivateNativeFixtureArtifact({
		prefix: 'framescaper-media-adapters-build-', fileName: 'framescaper-media-host',
		build(executable) {
			const sourceRoot = join(repositoryRoot, 'native/framescaper-media-host/src');
			const files = [
				'media_host.cpp', 'image_sequence_pack.cpp', 'legacy_plan_semantics.cpp',
				'legacy_plan_v8_filter_semantics.cpp', 'media_file_grants.cpp',
				'media_host_arguments.cpp', 'media_plan.cpp', 'sha256.cpp', 'strict_json.cpp',
			].map((file) => join(sourceRoot, file));
			files.push(join(repositoryRoot, 'native/common/sha256.cpp'));
			const built = spawnSync('c++', [
				'-std=c++20', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
				'-DFRAMESCAPER_MEDIA_HOST_CONTRACT_ONLY=1', ...boostClosureIncludeArguments(), '-I', sourceRoot,
				...files, '-o', executable,
			], { encoding: 'utf8' });
			assert.equal(built.status, 0, built.stderr);
		},
	});
}
