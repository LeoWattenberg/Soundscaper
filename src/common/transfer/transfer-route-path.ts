/* SPDX-License-Identifier: AGPL-3.0-only */
/** Route admission is needed before editor loading; transfer-document copy is loaded only by those documents. */
export const TRANSFER_ROUTE_PREFIX = '/transfer/';
export const TRANSFER_ROUTE_PATHS = Object.freeze({ send: `${TRANSFER_ROUTE_PREFIX}send/`, receive: `${TRANSFER_ROUTE_PREFIX}receive/` });
export function isTransferRoutePath(pathname: unknown): boolean {
	if (typeof pathname !== 'string') return false;
	const path = pathname.endsWith('/') ? pathname : `${pathname}/`;
	return path === TRANSFER_ROUTE_PATHS.send || path === TRANSFER_ROUTE_PATHS.receive;
}
