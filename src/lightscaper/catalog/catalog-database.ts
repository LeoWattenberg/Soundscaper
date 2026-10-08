/* SPDX-License-Identifier: AGPL-3.0-only */

import { EditorStoreBlockedError } from '../../common/editor/storage/status.ts';
import { PHOTO_CATALOG_DATABASE_VERSION } from './repository-types.ts';
import { createPhotoCatalogStoresV1 } from './catalog-database-schema.ts';

/** Own versioned database; shared editor openDatabase would create timeline stores. */
export function openPhotoCatalogDatabaseV1(factory: IDBFactory, name: string, onVersionChange: () => void): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let upgradeError: unknown;
		const request = factory.open(name, PHOTO_CATALOG_DATABASE_VERSION);
		request.onupgradeneeded = (event) => {
			try {
				if (![0, 1, 2, 3, 4].includes(event.oldVersion)) throw new RangeError('Unsupported photo catalog database migration.');
				createPhotoCatalogStoresV1(request.result);
			} catch (error) {
				upgradeError = error;
				request.transaction?.abort();
			}
		};
		request.onsuccess = () => {
			const database = request.result;
			if (settled || upgradeError) {
				database.close();
				if (!settled) reject(upgradeError);
				settled = true;
				return;
			}
			settled = true;
			database.onversionchange = () => { database.close(); onVersionChange(); };
			resolve(database);
		};
		request.onerror = () => {
			if (settled) return;
			settled = true;
			reject(upgradeError ?? request.error ?? new Error('Could not open the photo catalog database.'));
		};
		request.onblocked = () => {
			if (settled) return;
			settled = true;
			reject(new EditorStoreBlockedError());
		};
	});
}
