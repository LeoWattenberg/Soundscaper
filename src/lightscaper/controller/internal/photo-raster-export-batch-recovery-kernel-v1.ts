/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../../common/editor/closed-domain-value.ts';
import { isPhotoRasterExportMemberCompleteV1, normalizePhotoRasterExportBindingV1, type PhotoRasterExportJournalMemberV1 } from '../../storage/photo-raster-export-journal-v1.ts';
import { normalizePhotoRasterExportJournalForProfileV1 } from '../../storage/internal/photo-raster-export-journal-kernel-v1.ts';
import type { PhotoRasterExportProfileV1 } from '../photo-raster-export-contract-v1.ts';

export interface PhotoRasterExportRecoveryEntryV1 {
	readonly member: Readonly<PhotoRasterExportJournalMemberV1>;
	readonly disposition: 'eligible' | 'needs-review' | 'already-committed' | 'stale';
	readonly currentMatches: boolean;
}
/** Pure reopening assessment, never scheduling or destination authorization.
 * Started work may already have downloaded: it requires explicit user retry.
 * Eligible scalars still require fresh authenticated resource borrowing and
 * exact final publication admission by the single-photo export owner. */
export function reconcilePhotoRasterExportBatchRecoveryForProfileV1(profile: PhotoRasterExportProfileV1, journalValue: unknown, currentValue: unknown): readonly Readonly<PhotoRasterExportRecoveryEntryV1>[] {
	const journal = normalizePhotoRasterExportJournalForProfileV1(profile, journalValue), current = record(currentValue, 'Photo export recovery', ['catalogId', 'members']);
	const catalogId = field(current, 'catalogId', 'recovery');
	if (typeof catalogId !== 'string') throw new TypeError('Photo export recovery requires a catalog identity.');
	const seen = new Set<string>(), members = new Map(array(field(current, 'members', 'recovery'), 'Photo export current bindings', 0, 256).map(value => {
		const member = record(value, 'Photo export current member', ['photoId', 'versionId', 'expectedRevision', 'binding']);
		const photoId = field(member, 'photoId', 'member'), versionId = field(member, 'versionId', 'member'), expectedRevision = field(member, 'expectedRevision', 'member');
		for (const id of [photoId, versionId]) if (typeof id !== 'string' || id.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(id)) throw new TypeError('Photo export recovery requires stable identities.');
		if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || Object.is(expectedRevision, -0) || expectedRevision < 0) throw new TypeError('Photo export recovery requires a current revision.');
		const key = JSON.stringify([photoId, versionId]); if (seen.has(key)) throw new TypeError('Photo export recovery repeats an identity.'); seen.add(key);
		return [key, Object.freeze({ expectedRevision, binding: normalizePhotoRasterExportBindingV1(field(member, 'binding', 'member')) })] as const;
	}));
	return Object.freeze(journal.members.map(member => {
		const current = members.get(JSON.stringify([member.photoId, member.versionId]));
		const matches = catalogId === journal.catalogId && current?.expectedRevision === member.expectedRevision && JSON.stringify(current.binding) === JSON.stringify(member.binding);
		const disposition = isPhotoRasterExportMemberCompleteV1(member) ? 'already-committed' : member.state === 'started' || member.sidecar?.state === 'started' ? 'needs-review' : !matches ? 'stale' : 'eligible';
		return Object.freeze({ member, disposition, currentMatches: matches });
	}));
}
