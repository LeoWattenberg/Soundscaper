/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import { assertPhotoStackQuerySignalV1 } from '../catalog/photo-stack-query-signal-v1.ts';
import { id } from '../catalog/value-validation.ts';
import { normalizePhotoImportIntentV1, photoImportIntentKeyV1 } from './import-intent-v1.ts';
import { checkManagedImportSignalV2 as check, settlePhotoImportRootsForProfileV1 } from './import-root-settlement-kernel-v2.ts';
import { capturePhotoManagedImportPortsCurrentV1, type PhotoManagedImportPortsCurrentV1 } from './managed-import-ports-current-v1.ts';

/** Root1 and Intent1 retain their native custody authority; full Current Photo
 * admission and selected body verification precede every promotion. */
export async function recoverManagedPhotoImportCurrentV1(catalogId: string, portsValue: PhotoManagedImportPortsCurrentV1,
	options: Readonly<{ signal?: AbortSignal }> = {}): Promise<void> {
	const input = readClosedDomainRecord(options, 'current import recovery options', ['signal'], []);
	const signal = Object.hasOwn(input, 'signal') ? readClosedDomainField(input, 'signal', 'current import recovery options') as AbortSignal | undefined : undefined;
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const catalog = id(catalogId, 'catalog ID'); check(signal);
	const ports = capturePhotoManagedImportPortsCurrentV1(portsValue); check(signal);
	await ports.exclusive!(catalog, async admitted => {
		check(admitted); const value = await ports.journal.get(photoImportIntentKeyV1(catalog)); check(admitted);
		if (value === undefined) return;
		const intent = normalizePhotoImportIntentV1(value, catalog); check(admitted);
		await settlePhotoImportRootsForProfileV1('current3', intent, ports, admitted); check(admitted);
		if (!await ports.journal.deleteIfCurrent(photoImportIntentKeyV1(catalog), intent)) throw new Error('The photo import intent changed before retirement.');
	}, signal);
}
