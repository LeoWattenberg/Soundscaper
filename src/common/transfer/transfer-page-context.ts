/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The two shapes both transfer documents are mounted with.
 *
 * They live in their own module because the sending and receiving mounts do:
 * `transfer-page-send.ts` and `transfer-page-entry.ts` both need them, and a
 * type imported from whichever of the two happened to declare it makes the pair
 * of modules refer to each other for no reason.
 */

import type { TransferOriginConfiguration } from './transfer-configuration.ts';
import type { TransferRuntime } from './transfer-session.ts';
import type { TransferView } from './transfer-page-view.ts';
import type { TransferStoreSource } from './transfer-archive-runtime.ts';

/**
 * The archive machinery, behind a seam.
 *
 * Both members are asked for on first use rather than at mount: `.scape` export
 * and import reach a large part of the editor's storage code, and the first
 * useful state of either page is a list of names.
 */
export interface TransferPageDependencies {
	loadRuntime(): Promise<TransferRuntime>;
	openStore(): Promise<TransferStoreSource>;
}

export interface TransferPageContext {
	readonly scope: Window & typeof globalThis;
	readonly configuration: TransferOriginConfiguration;
	readonly dependencies: TransferPageDependencies;
	readonly view: TransferView;
}
