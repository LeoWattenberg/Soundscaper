/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	framescaperCaptureRecoveryPresent,
	type FramescaperCaptureRecoveryPresencePort,
} from '../src/common/editor/storage/framescaper-capture-recovery-presence.ts';

function repository(options: Readonly<{
	readonly creations?: number;
	readonly manifests?: Readonly<Record<string, number>>;
}>) {
	const reads: string[] = [];
	const port: FramescaperCaptureRecoveryPresencePort = {
		async listCreations() {
			reads.push('creations');
			return Object.freeze(Array.from({ length: options.creations ?? 0 }, () => ({}))) as never;
		},
		async listProject(projectId: string) {
			reads.push(`project:${projectId}`);
			return Object.freeze(Array.from({ length: options.manifests?.[projectId] ?? 0 }, () => ({}))) as never;
		},
	};
	return { port, reads };
}

test('an empty store has nothing to recover and reads each project once', async () => {
	const { port, reads } = repository({});
	assert.equal(await framescaperCaptureRecoveryPresent(port, 'p1', ['p2', 'p1', 'p3']), false);
	assert.deepEqual(reads, ['creations', 'project:p1', 'project:p2', 'project:p3']);
});

test('any creation journal is presence, before a single project is read', async () => {
	const { port, reads } = repository({ creations: 1 });
	assert.equal(await framescaperCaptureRecoveryPresent(port, 'p1', ['p2']), true);
	assert.deepEqual(reads, ['creations']);
});

test('a manifest for the current project or for an inventoried project is presence', async () => {
	assert.equal(await framescaperCaptureRecoveryPresent(repository({ manifests: { p1: 1 } }).port, 'p1', []), true);
	assert.equal(await framescaperCaptureRecoveryPresent(repository({ manifests: { p7: 2 } }).port, 'p1', ['p7']), true);
	assert.equal(await framescaperCaptureRecoveryPresent(repository({ manifests: { p7: 2 } }).port, null, ['p7']), true);
	assert.equal(await framescaperCaptureRecoveryPresent(repository({ manifests: { p9: 2 } }).port, 'p1', ['p7']), false);
});

test('an inventory the recovery scan would refuse is refused here too', async () => {
	const { port } = repository({});
	await assert.rejects(
		framescaperCaptureRecoveryPresent(port, null, Array.from({ length: 4_097 }, (_, index) => `p${index}`)),
		RangeError,
	);
	await assert.rejects(framescaperCaptureRecoveryPresent(port, null, ['']), TypeError);
});
