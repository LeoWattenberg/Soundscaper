/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeMediaCapabilitySnapshotV1 } from '../src/common/editor/native-media-capability-snapshot.ts';
import type { FramescaperNativeServicesBridge } from '../src/common/editor/ui/framescaper-native-services-bridge.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperNativeProResProxyGenerator } from '../src/framescaper/editor-native-prores-proxy-generator.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

test('native proxy approval uses claim metadata before range reads and releases the claim on decline', async () => {
	const project = createFramescaperProjectNativeMedia(PROFILE, framescaperV20Options());
	const byteLength = 512 * 1024 ** 2 + 1;
	const row = { schemaFamily: 'framescaper', schemaVersion: 1, jobId: 'ab'.repeat(20), taskKind: 'proxy-generation',
		projectId: project.id, relativeDestination: '.framescaper-native-proxies/proxy.mov', state: 'completed',
		position: 0, progress: null, attempt: 0, lastFailureCode: null };
	for (const accept of [true, false]) {
		let warnings = 0; let reads = 0; let releases = 0;
		const sentinel = new Error('the approved native body was reached');
		const bridge = {
			snapshot: async () => ({ snapshotVersion: 1, runtimeAvailable: true, nativeMediaEnabled: true, roots: [], watchRules: [], queue: [row] }),
			capabilities: async () => createNativeMediaCapabilitySnapshotV1({ masterEnabled: true, entries: [{
				domain: 'codec', id: 'encode-mov-prores-proxy', buildSupported: true, probeSucceeded: true, selfTestPassed: true, userEnabled: true }] }),
			preferences: async () => ({ nativeMediaEnabled: true, hardwareDecodeEnabled: false, hardwareEncodeEnabled: false, ofxConsentEnabled: false }),
			selectRoot: async () => ({ grantId: 'ef'.repeat(8), displayName: 'Proxies', revoked: false }),
			revalidateRoot: async () => true, enqueue: async () => row,
			claimProxyOutput: async () => ({ claimId: 'cd'.repeat(20), byteLength, mimeType: 'video/quicktime', sha256: 'a'.repeat(64) }),
			readProxyOutput: () => { reads++; throw sentinel; },
			releaseProxyOutput: async () => { releases++; return true; },
		} as unknown as FramescaperNativeServicesBridge;
		const generator = createFramescaperNativeProResProxyGenerator({ profile: PROFILE, getProject: () => project, bridge,
			async confirmFileSizeWarning(warning) {
				warnings++; assert.equal(reads, 0); assert.equal(warning.byteLength, byteLength); return accept;
			},
		});
		const generating = generator.generate(new Blob(['original'], { type: 'video/mp4' }), {
			authority: 'owned', projectId: String(project.id), sourceId: 'video-source', storageKey: 'video-source',
			mimeType: 'video/mp4', byteLength: 8, sha256: '12'.repeat(32), generationToken: 'generation-1',
		}, { id: 'framescaper-native-prores-proxy-mov-v1', version: 1 }, { assertCurrent() {} });
		await assert.rejects(Promise.resolve(generating), accept ? sentinel : { name: 'AbortError' });
		assert.equal(warnings, 1); assert.equal(reads, accept ? 1 : 0); assert.equal(releases, 1);
	}
});
