/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact durable manifest/claim validation for selected-V20 V7/V8 input stages. */

import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { NativeQueueRecordV2 } from '../src/common/editor/native-queue-record.ts';
import type { HelperNativeFileIdentity } from './helper-native-job-contract.ts';
import {
	nativeRenderInputClosedRecord,
	nativeRenderInputDeclaredBytes,
	nativeRenderInputDigest,
	nativeRenderInputDigestValue,
	nativeRenderInputFingerprints,
	nativeRenderInputIdentifier,
	nativeRenderInputNonNegative,
	nativeRenderInputPositive,
	nativeRenderInputStageBindingDigest,
	nativeRenderInputStageIdentityDigest,
	nativeRenderInputStageId,
	type FramescaperNativeRenderInputStageIdentity,
} from './native-services-render-input-contract.ts';
import type { NativeRenderInputOwnedStage } from './native-services-render-input-durable-store.ts';
import type {
	FramescaperNativeRenderInputDescriptorV1,
} from './native-services-render-input-validation.ts';

export interface NativeRenderInputStagedFile extends FramescaperNativeRenderInputDescriptorV1 {
	readonly name: string;
	readonly identity: HelperNativeFileIdentity;
}

export interface NativeRenderInputStageManifest extends FramescaperNativeRenderInputStageIdentity {
	readonly stageVersion: 1;
	readonly stageId: string;
	readonly planVersion: 7 | 8;
	readonly files: readonly NativeRenderInputStagedFile[];
}

export async function assertNativeRenderInputLiveOwnedStage(
	owned: NativeRenderInputOwnedStage,
	record: NativeQueueRecordV2,
): Promise<NativeRenderInputStageManifest> {
	if ((record.planVersion !== 7 && record.planVersion !== 8)
		|| record.jobId !== owned.ownership.stageId
		|| !owned.directoryPresent || !owned.claimedMarkerPresent) {
		throw new Error('A durable selected-V20 stage does not match one exact live queue record.');
	}
	const manifest = await readNativeRenderInputStageManifest(owned.directory);
	assertRecordIdentity(manifest, record);
	await requireNativeRenderInputStageClaim(owned.directory, record.jobId);
	const identity = Object.freeze({
		planFingerprint: manifest.planFingerprint,
		projectId: manifest.projectId,
		projectRevision: manifest.projectRevision,
		inputFingerprints: manifest.inputFingerprints,
	});
	if (owned.ownership.identityDigest !== nativeRenderInputStageIdentityDigest(identity)
		|| owned.ownership.declaredByteLength !== nativeRenderInputDeclaredBytes(manifest.files)
		|| owned.ownership.bindingDigest !== nativeRenderInputStageBindingDigest(Object.freeze({
			...identity,
		}), Object.freeze(manifest.files.map(({ role, byteLength, sha256 }) => Object.freeze({
			role, byteLength, sha256,
		}))))) {
		throw new Error('The durable native render-input ownership binding changed identity.');
	}
	return manifest;
}

export async function readNativeRenderInputStageManifest(
	directory: string,
): Promise<NativeRenderInputStageManifest> {
	const path = join(directory, 'manifest.json');
	await requireRegularFile(path);
	await requireRegularFile(join(directory, 'manifest.sha256'));
	const payload = await readFile(path, 'utf8');
	const expected = (await readFile(join(directory, 'manifest.sha256'), 'utf8')).trim();
	if (nativeRenderInputDigestValue(expected, 'manifest') !== nativeRenderInputDigest(payload)) {
		throw new Error('The durable native render-input manifest changed digest.');
	}
	let value: unknown;
	try { value = JSON.parse(payload) as unknown; }
	catch { throw new Error('The render-input manifest is not JSON.'); }
	const row = nativeRenderInputClosedRecord(value, [
		'stageVersion', 'stageId', 'planVersion', 'planFingerprint', 'projectId',
		'projectRevision', 'inputFingerprints', 'files',
	], 'render-input manifest');
	if (row.stageVersion !== 1 || (row.planVersion !== 7 && row.planVersion !== 8)) {
		throw new Error('The render-input manifest version is unsupported.');
	}
	const manifest: NativeRenderInputStageManifest = Object.freeze({
		stageVersion: 1,
		stageId: nativeRenderInputStageId(row.stageId),
		planVersion: row.planVersion,
		planFingerprint: nativeRenderInputDigestValue(row.planFingerprint, 'manifest plan'),
		projectId: nativeRenderInputIdentifier(row.projectId, 'manifest project'),
		projectRevision: nativeRenderInputNonNegative(row.projectRevision, 'manifest project revision'),
		inputFingerprints: nativeRenderInputFingerprints(row.inputFingerprints),
		files: manifestFiles(row.files),
	});
	if (JSON.stringify(manifest) !== payload) {
		throw new Error('The durable render-input manifest is not canonical.');
	}
	return manifest;
}

export function nativeRenderInputManifestFileName(
	index: number,
	role: FramescaperNativeRenderInputDescriptorV1['role'],
): string {
	return `input-${String(index).padStart(2, '0')}${role === 'staged-audio-mix' ? '.wav' : '.frames'}`;
}

function manifestFiles(value: unknown): readonly NativeRenderInputStagedFile[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > 2
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError('A render-input manifest has an invalid file inventory.');
	}
	const files = Object.freeze(value.map((entry, index) => {
		const row = nativeRenderInputClosedRecord(entry,
			['role', 'byteLength', 'sha256', 'name', 'identity'], 'manifest input');
		if (row.role !== 'evaluated-rgba-frame-pack' && row.role !== 'staged-audio-mix') {
			throw new TypeError('A render-input manifest has an unsupported role.');
		}
		const descriptor = Object.freeze({
			role: row.role,
			byteLength: nativeRenderInputPositive(row.byteLength, 'manifest input byte length'),
			sha256: nativeRenderInputDigestValue(row.sha256, 'manifest input'),
		});
		if (row.name !== nativeRenderInputManifestFileName(index, descriptor.role)) {
			throw new Error('A manifest input name is non-canonical.');
		}
		return Object.freeze({
			...descriptor,
			name: row.name,
			identity: fileIdentity(row.identity),
		});
	}));
	if (files[0]?.role !== 'evaluated-rgba-frame-pack'
		|| (files.length === 2 && files[1]?.role !== 'staged-audio-mix')) {
		throw new TypeError('A render-input manifest has non-canonical role order.');
	}
	return files;
}

async function requireNativeRenderInputStageClaim(directory: string, id: string): Promise<void> {
	const path = join(directory, 'claimed.json');
	await requireRegularFile(path);
	const payload = await readFile(path, 'utf8');
	if (payload !== JSON.stringify({ stageVersion: 1, jobId: id })) {
		throw new Error('The durable native render-input claim changed identity.');
	}
}

function assertRecordIdentity(
	manifest: NativeRenderInputStageManifest,
	record: NativeQueueRecordV2,
): void {
	if (manifest.stageId !== record.jobId || manifest.planFingerprint !== record.planFingerprint
		|| manifest.planVersion !== record.planVersion
		|| manifest.projectId !== record.projectId || manifest.projectRevision !== record.projectRevision
		|| JSON.stringify(manifest.inputFingerprints) !== JSON.stringify(record.inputFingerprints)) {
		throw new Error('The durable native render-input identity disagrees with its queue record.');
	}
}

async function requireRegularFile(path: string): Promise<void> {
	const details = await lstat(path);
	if (!details.isFile() || details.isSymbolicLink()) {
		throw new Error('A durable render-input record is not regular.');
	}
}

function fileIdentity(value: unknown): HelperNativeFileIdentity {
	const row = nativeRenderInputClosedRecord(value, ['dev', 'ino'], 'file identity');
	return Object.freeze({
		dev: nativeRenderInputNonNegative(row.dev, 'file device'),
		ino: nativeRenderInputNonNegative(row.ino, 'file inode'),
	});
}
