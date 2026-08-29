/* SPDX-License-Identifier: AGPL-3.0-only */

/** How long a download's blob URL is kept alive after the click that starts it. */
export const OBJECT_URL_REVOKE_DELAY_MS = 30_000;

export interface DownloadObjectUrlPorts {
	readonly revoke?: ((url: string) => void) | null;
	readonly setTimer?: ((callback: () => void, delay: number) => unknown) | null;
}

/**
 * Release a download's blob URL once the browser has had time to read it.
 *
 * `anchor.click()` starts a save the browser completes on a later turn, so
 * revoking the URL inside that same turn can cancel the save outright and lose
 * the file. Every anchor download therefore releases its URL on a timer, and
 * immediately only where no timer exists - a host that never started a browser
 * download in the first place, and so has nothing left to lose.
 */
export function releaseDownloadObjectUrl(url: string, ports: DownloadObjectUrlPorts): void {
	const revoke = ports.revoke;
	if (typeof revoke !== 'function') return;
	const setTimer = ports.setTimer;
	if (typeof setTimer !== 'function') {
		revoke(url);
		return;
	}
	setTimer(() => revoke(url), OBJECT_URL_REVOKE_DELAY_MS);
}
