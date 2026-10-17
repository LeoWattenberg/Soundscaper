/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopBatchRequestV1, PhotoLibraryDevelopBatchReceiptV1, PhotoLibraryDevelopBatchOutcomeV1,
	PhotoLibraryDevelopSettingsPortV1 } from '../../common/editor/photo-library-develop-settings-port-v1.ts';
import { readPhotoStackSignalOptionsV1 } from '../catalog/photo-stack-repository-v1.ts';
import { array, field, id, integer, name, oneOf, record, utcTimestamp } from '../catalog/value-validation.ts';
import type { PhotoCommandOwnerV1 } from './photo-command-owner.ts';
import { adjustPhotoDevelopSettingsV1, checkPhotoDevelopSettingsBytesV1, copyPhotoDevelopSettingsV1,
	mergePhotoDevelopSettingsV1, normalizePhotoDevelopRelativeActionV1, normalizePhotoDevelopSettingsPacketV1 } from './photo-develop-settings-v1.ts';

export interface PhotoLibraryDevelopSettingsSessionHostV1 {
	readonly mutate: <Result>(run: (catalogId: string, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
	readonly withPhoto: <Result>(catalogId: string, photoId: string, signal: AbortSignal,
		run: (owner: PhotoCommandOwnerV1, signal: AbortSignal) => Promise<Result>) => Promise<Result>;
}
const nativeAbort = AbortSignal.prototype.throwIfAborted;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;

export function createPhotoLibraryDevelopSettingsSessionV1(host: PhotoLibraryDevelopSettingsSessionHostV1): Readonly<PhotoLibraryDevelopSettingsPortV1> {
	return Object.freeze({ copy: copyPhotoDevelopSettingsV1, merge: mergePhotoDevelopSettingsV1, adjust: adjustPhotoDevelopSettingsV1,
		async applyBatch(value, options = {}) {
			const request = normalizePhotoLibraryDevelopBatchV1(value);
			const { signal } = readPhotoStackSignalOptionsV1(options);
			return applyBatch(host, request, signal);
		} } satisfies PhotoLibraryDevelopSettingsPortV1);
}

/** Snap every target and the single shared action before any initialization, lease or await. */
export function normalizePhotoLibraryDevelopBatchV1(value: unknown): PhotoLibraryDevelopBatchRequestV1 {
	const input = record(value, 'Develop batch', ['schemaVersion', 'catalogId', 'targets', 'action', 'label', 'createdAt']);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported Develop batch version.');
	const seen = new Set<string>();
	const targets = array(field(input, 'targets'), 'Develop batch targets', 1, 64).map(value => {
		const target = record(value, 'Develop batch target', ['photoId', 'versionId', 'expectedRevision']);
		const photoId = id(field(target, 'photoId'), 'Develop target photo ID');
		if (seen.has(photoId)) throw new RangeError('Develop batch has duplicate photo identities.');
		seen.add(photoId);
		return Object.freeze({ photoId, versionId: id(field(target, 'versionId'), 'Develop target version ID'),
			expectedRevision: integer(field(target, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'Develop target revision') });
	});
	const actionInput = record(field(input, 'action'), 'Develop batch action', ['kind', 'settings', 'effectType', 'changes'], ['kind']);
	const kind = oneOf(field(actionInput, 'kind'), ['paste', 'relative'] as const, 'Develop batch action kind');
	let action: PhotoLibraryDevelopBatchRequestV1['action'];
	if (kind === 'paste') {
		record(actionInput, 'Develop batch paste', ['kind', 'settings']);
		action = Object.freeze({ kind, settings: normalizePhotoDevelopSettingsPacketV1(field(actionInput, 'settings')) });
	} else {
		record(actionInput, 'Develop batch relative', ['kind', 'effectType', 'changes']);
		action = Object.freeze({ kind, ...normalizePhotoDevelopRelativeActionV1({ effectType: field(actionInput, 'effectType'), changes: field(actionInput, 'changes') }) });
	}
	const request: PhotoLibraryDevelopBatchRequestV1 = Object.freeze({ schemaVersion: 1, catalogId: id(field(input, 'catalogId'), 'Develop batch catalog ID'),
		targets: Object.freeze(targets), action, label: name(field(input, 'label'), 'Develop batch history label'), createdAt: utcTimestamp(field(input, 'createdAt'), 'Develop batch history time') });
	checkPhotoDevelopSettingsBytesV1(request); return request;
}

async function applyBatch(host: PhotoLibraryDevelopSettingsSessionHostV1, request: PhotoLibraryDevelopBatchRequestV1,
	outerSignal?: AbortSignal): Promise<PhotoLibraryDevelopBatchReceiptV1> {
	const outcomes: PhotoLibraryDevelopBatchOutcomeV1[] = request.targets.map((target, index) => ({
		index, photoId: target.photoId, versionId: target.versionId, status: 'not-attempted', revision: null, historyCursor: null, code: null,
	}));
	let started = false, activeSignal: AbortSignal | undefined;
	let completion: PhotoLibraryDevelopBatchReceiptV1['completion'] = 'finished';
	const notices: 'cleanup-failed'[] = [];
	try {
		await host.mutate(async (catalogId, signal) => {
			if (catalogId !== request.catalogId) throw new RangeError('Develop batch belongs to another catalog.');
			started = true; activeSignal = signal;
			for (let index = 0; index < request.targets.length; index++) {
				const target = request.targets[index]!, slot = outcomes[index]!;
				try {
					nativeAbort.call(signal);
					await host.withPhoto(catalogId, target.photoId, signal, async (owner, admitted) => {
						const before = owner.history.present;
						if (before.revision !== target.expectedRevision) {
							outcomes[index] = { ...slot, status: 'conflict', code: 'revision-conflict' }; return;
						}
						const version = before.versions.find(version => version.id === target.versionId);
						if (!version) { outcomes[index] = { ...slot, status: 'failed', code: 'version-missing' }; return; }
						const develop = request.action.kind === 'paste'
							? mergePhotoDevelopSettingsV1({ schemaVersion: 1, target: version.develop, settings: request.action.settings })
							: adjustPhotoDevelopSettingsV1({ schemaVersion: 1, target: version.develop, effectType: request.action.effectType, changes: request.action.changes });
						if (JSON.stringify(develop) === JSON.stringify(version.develop)) {
							outcomes[index] = { ...slot, status: 'unchanged', revision: before.revision, historyCursor: version.workspace?.cursor ?? 0 }; return;
						}
						const saved = await owner.execute({ type: 'record-develop', versionId: target.versionId, develop,
							label: request.label, createdAt: request.createdAt }, { signal: admitted });
						// Capture the durable ACK before surrounding cleanup or cancellation can fail.
						outcomes[index] = { ...slot, status: 'applied', revision: saved.revision,
							historyCursor: saved.versions.find(version => version.id === target.versionId)!.workspace!.cursor };
					});
				} catch (error) {
					if (aborted(signal) || outcomes[index]!.status !== 'not-attempted') throw error;
					const conflict = revisionConflict(error);
					outcomes[index] = { ...slot, status: conflict ? 'conflict' : 'failed', code: conflict ? 'revision-conflict' : 'operation-failed' };
				}
				if (index + 1 < request.targets.length) await new Promise<void>(resolve => { setTimeout(resolve, 0); });
			}
		}, outerSignal);
	} catch (error) {
		if (!started) throw error;
		const pending = outcomes.some(outcome => outcome.status === 'not-attempted');
		const cancelled = aborted(activeSignal) && pending && error === Reflect.apply(nativeReason, activeSignal, []);
		completion = cancelled ? 'cancelled' : 'interrupted';
		if (completion === 'interrupted') notices.push('cleanup-failed');
	}
	const receipt: PhotoLibraryDevelopBatchReceiptV1 = Object.freeze({ schemaVersion: 1, catalogId: request.catalogId, completion,
		outcomes: Object.freeze(outcomes.map(outcome => Object.freeze(outcome))), notices: Object.freeze(notices) });
	// 64 scalar outcomes fit comfortably; no settings/document/media inventory is returned.
	if (new TextEncoder().encode(JSON.stringify(receipt)).byteLength > 65_536) throw new RangeError('Develop batch receipt exceeded its scalar bound.');
	return receipt;
}

function aborted(signal?: AbortSignal): boolean { return signal !== undefined && Reflect.apply(nativeAborted, signal, []) === true; }
function revisionConflict(error: unknown): boolean {
	try {
		if (!error || typeof error !== 'object') return false;
		const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
		return descriptor !== undefined && Object.hasOwn(descriptor, 'value') && descriptor.value === 'PHOTO_REVISION_CONFLICT';
	} catch { return false; }
}
