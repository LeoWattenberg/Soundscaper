/* SPDX-License-Identifier: AGPL-3.0-only */

/** Small eager-safe registry for releasing disk-backed prepared audio after desktop custody. */

const RELEASES = new WeakMap<Blob, () => Promise<void>>();

export function bindLocalAssistancePreparedAudioWaveRelease(
	body: Blob,
	releaseValue: () => Promise<void>,
): void {
	let released = false;
	RELEASES.set(body, async () => {
		if (released) return;
		released = true;
		await releaseValue();
	});
}

export async function releaseLocalAssistancePreparedAudioWave(body: Blob): Promise<void> {
	if (!(body instanceof Blob)) return;
	await RELEASES.get(body)?.();
}
