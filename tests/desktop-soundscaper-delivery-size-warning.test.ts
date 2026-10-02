/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { DesktopSaveSizeWarning } from '../desktop/save-size-warning-dialog.ts';
import type { SoundscaperDeliveryFilesystemAuthority } from '../desktop/soundscaper-delivery-filesystem-authority.ts';
import { SoundscaperDeliveryWrite } from '../desktop/soundscaper-delivery-root.ts';
import { SoundscaperDeliveryService } from '../desktop/soundscaper-delivery-service.ts';
import { createSoundscaperDeliveryDescriptionV1 } from '../src/common/editor/soundscaper-delivery-contract-v1.ts';
import { createSoundscaperPersistentAudioDeliveryPlanV1 } from '../src/common/editor/soundscaper-persistent-delivery-plan-v1.ts';
import { PROJECT } from './helpers/soundscaper-delivery-adapter-fixtures.ts';

const THRESHOLD = 65 * 1024 ** 3;
const ROOT = Object.freeze({
	grantId: '1'.repeat(48), rootPath: '/authorized/output',
	volumeIdentity: 'volume-1', directoryIdentity: 'directory-1',
	authorizedAtMs: 1, revokedAtMs: null,
});
const DECLARATION = Object.freeze({
	claimId: '2'.repeat(48), jobId: '3'.repeat(48), fileName: 'master.rf64', size: THRESHOLD + 1,
});

test('persistent delivery approves the actual file bound before opening native staging', async () => {
	const filesystem = createFilesystem();
	const warnings: DesktopSaveSizeWarning[] = [];
	const write = await SoundscaperDeliveryWrite.open(filesystem.authority, ROOT, {
		...DECLARATION,
		confirmFileSizeWarning: async (warning: DesktopSaveSizeWarning) => {
			assert.equal(filesystem.opened.length, 0);
			warnings.push(warning);
			return true;
		},
	});
	assert.deepEqual(warnings, [{ fileName: 'master.rf64', byteLength: THRESHOLD + 1, thresholdBytes: THRESHOLD }]);
	assert.equal(filesystem.opened[0]?.maximumBytes, THRESHOLD + 1);
	assert.equal(await write.write(0, new Uint8Array([1])), 1);
	await assert.rejects(write.finish(), /declared|exact/u);
	await assert.rejects(write.write(1, new Uint8Array(4 * 1024 ** 2 + 1)), /4 MiB/u);
	await write.abandon();
});

test('persistent delivery refuses absent, declined or truthy non-boolean approval before staging', async () => {
	for (const accepted of [undefined, false, 'yes'] as const) {
		const filesystem = createFilesystem();
		const confirmFileSizeWarning = accepted === undefined ? undefined
			: async () => accepted as unknown as boolean;
		await assert.rejects(SoundscaperDeliveryWrite.open(filesystem.authority, ROOT, {
			...DECLARATION, ...(confirmFileSizeWarning ? { confirmFileSizeWarning } : {}),
		}), accepted === undefined ? { code: 'FILE_SIZE_WARNING' } : { name: 'AbortError', code: 'ABORTED' });
		assert.equal(filesystem.opened.length, 0);
	}
});

test('persistent delivery never overrides invalid sizes or a stale owner while approval is pending', async () => {
	const filesystem = createFilesystem();
	let prompted = false;
	await assert.rejects(SoundscaperDeliveryWrite.open(filesystem.authority, ROOT, {
		...DECLARATION, size: Number.MAX_SAFE_INTEGER + 1,
		confirmFileSizeWarning: async () => { prompted = true; return true; },
	}), /size.*invalid/u);
	assert.equal(prompted, false);
	let current = true;
	await assert.rejects(SoundscaperDeliveryWrite.open(filesystem.authority, ROOT, {
		...DECLARATION,
		assertFence: () => { if (!current) throw new Error('stale writer'); },
		confirmFileSizeWarning: async () => { current = false; return true; },
	}), /stale writer/u);
	assert.equal(filesystem.opened.length, 0);
});

test('the delivery service passes native approval and fences cancellation and root revocation', async (context) => {
	for (const action of ['accept', 'cancel', 'revoke-root'] as const) {
		const root = await mkdtemp(join(tmpdir(), 'soundscaper-delivery-size-warning-'));
		const outputRoot = join(root, 'output');
		await mkdir(outputRoot);
		const filesystem = createFilesystem();
		let prompts = 0;
		let jobId = '';
		let grantId = '';
		const service = await SoundscaperDeliveryService.start({
			databasePath: join(root, 'queue.sqlite'), filesystem: filesystem.authority,
			readProjectIdentity: () => PROJECT,
			observeRoot: async (path) => ({
				canonicalPath: String(path), volumeIdentity: ROOT.volumeIdentity, directoryIdentity: ROOT.directoryIdentity,
			}),
			confirmFileSizeWarning: async () => {
				prompts += 1;
				assert.equal(filesystem.opened.length, 0);
				if (action === 'cancel') await service.cancel(jobId);
				if (action === 'revoke-root') await service.revokeRoot(grantId);
				return true;
			},
		});
		context.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
		grantId = (await service.authorizeRoot(outputRoot)).grantId;
		const description = createSoundscaperDeliveryDescriptionV1({
			label: 'Large master', projectIdentity: PROJECT, destinationGrantId: grantId,
			plan: createSoundscaperPersistentAudioDeliveryPlanV1({
				settings: { format: 'wav' }, exportPlan: { format: 'wav', range: 'project' },
			}),
		});
		jobId = (await service.enqueue(description, null, {
			projectIdentity: PROJECT, planFingerprints: [description.planFingerprint],
			saved: true, clean: true, named: true,
		})).jobId;
		const claim = await service.claimNext({ projectIdentity: PROJECT, planFingerprint: description.planFingerprint });
		assert.ok(claim);
		const pending = service.beginWrite({ claimId: claim.claimId, fileName: 'large.rf64', size: THRESHOLD + 1 });
		if (action === 'accept') {
			const opened = await pending;
			await service.writeChunk({ writeId: opened.writeId, offset: 0, bytes: new Uint8Array([1]) });
			assert.equal(filesystem.opened[0]?.maximumBytes, THRESHOLD + 1);
			await service.cancel(jobId);
		} else {
			await assert.rejects(pending, /stale|authorization|revoked/u);
			assert.equal(filesystem.opened.length, 0);
		}
		assert.equal(prompts, 1);
		await service.close();
	}
});

function createFilesystem() {
	const opened: Parameters<SoundscaperDeliveryFilesystemAuthority['open']>[0][] = [];
	const authority: SoundscaperDeliveryFilesystemAuthority = {
		open: async (value) => {
			opened.push(value);
			return {
				reference: value.reference, recoveryToken: 'native-recovery-token',
				volumeIdentity: value.root.volumeIdentity, fileIdentity: 'native-file', settled: false,
				write: async (_offset, bytes) => bytes.byteLength,
				patch: async (_offset, bytes) => bytes.byteLength,
				seal: async () => { throw new Error('unexpected seal'); },
				inspect: async () => { throw new Error('unexpected inspection'); },
				publish: async () => { throw new Error('unexpected publication'); },
				abort: async () => 'removed', abandon: async () => undefined,
			};
		},
		removeRecovered: async () => 'removed', inspectFinal: async () => null,
	};
	return { authority, opened };
}
