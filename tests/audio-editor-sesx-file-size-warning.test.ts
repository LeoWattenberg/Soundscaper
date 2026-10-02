/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { registerDesktopReadCapability } from '../src/common/editor/desktop-read-capability-registry.ts';
import { SESX_XML_MAXIMUM_BYTES } from '../src/common/editor/sesx-format.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

for (const accept of [true, false]) test(`SESX file-size warning ${accept ? 'acceptance opens' : 'cancellation preserves'} the session`, async () => {
	const warnings: number[] = [];
	let reads = 0, releases = 0;
	const file = new File(['<sesx><session sampleRate="48000" audioChannelType="stereo"><tracks/></session></sesx>'], 'large.sesx');
	registerDesktopReadCapability(file, 'a'.repeat(64));
	Object.defineProperty(file, 'size', { value: SESX_XML_MAXIMUM_BYTES + 1 });
	const readText = file.text.bind(file);
	file.text = () => { reads += 1; return readText(); };
	const fixture = createFixture({ confirmFileSizeWarning: async (warning) => { warnings.push(warning.byteLength); return accept; } });
	const fileService = { ...fixture.runtime.fileService, isDesktop: true,
		resolveSesxMedia: async () => ({ status: 'missing' as const }),
		chooseSesxMediaFolder: async () => ({ status: 'cancelled' as const }),
		withReadDescriptors: async <Value>(_descriptors: readonly unknown[], _options: unknown,
			consume: (blobs: readonly Blob[]) => Value | PromiseLike<Value>): Promise<Value> => consume([]),
		releaseSesxSession: async () => { releases += 1; return true; },
	};
	const service = createNativeProjectService({ ...fixture.runtime, fileService });
	if (accept) await service.openSesx(file);
	else await assert.rejects(service.openSesx(file), { name: 'AbortError' });
	assert.deepEqual(warnings, [SESX_XML_MAXIMUM_BYTES + 1]);
	assert.equal(reads, accept ? 1 : 0);
	assert.equal(fixture.switched.length, accept ? 1 : 0);
	assert.equal(fixture.state.importing, false);
	assert.equal(releases, 1);
});
