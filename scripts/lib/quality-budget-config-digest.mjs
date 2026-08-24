/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';

const CONFIG_URL = new URL('../../config/quality-budgets.json', import.meta.url);
const DEFAULT_CONFIG_BYTES = await readFile(CONFIG_URL);
const DEFAULT_CONFIG = JSON.parse(DEFAULT_CONFIG_BYTES.toString('utf8'));

export const DEFAULT_QUALITY_BUDGET_SHA256 = sha256(DEFAULT_CONFIG_BYTES);

/**
 * Bind an admitted quality configuration to its exact source bytes when those
 * bytes are available. Synthetic tests may omit them; historical qualification
 * must supply the bytes fetched from the evidence revision.
 */
export function qualityBudgetSha256(configValue = DEFAULT_CONFIG, exactBytesValue = null) {
	const config = snapshotStrictJsonData(configValue, 'quality config');
	if (exactBytesValue !== null) {
		if (!ArrayBuffer.isView(exactBytesValue)) {
			throw new TypeError('Quality budget exact bytes must be a byte view.');
		}
		const exactBytes = Buffer.from(
			exactBytesValue.buffer,
			exactBytesValue.byteOffset,
			exactBytesValue.byteLength,
		);
		let parsed;
		try {
			parsed = snapshotStrictJsonData(
				JSON.parse(exactBytes.toString('utf8')),
				'quality config exact bytes',
			);
		} catch (error) {
			throw new Error('Quality budget exact bytes are not valid strict JSON.', { cause: error });
		}
		if (!isDeepStrictEqual(config, parsed)) {
			throw new Error('Quality budget object does not match its exact bytes.');
		}
		return sha256(exactBytes);
	}
	if (isDeepStrictEqual(config, DEFAULT_CONFIG)) return DEFAULT_QUALITY_BUDGET_SHA256;
	return sha256(Buffer.from(JSON.stringify(config), 'utf8'));
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
