/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The helper side of hosting one plug-in instance, offline.
 *
 * This is the out-of-process half of 5A-3's offline mode: instantiate the
 * binary, measure what it actually reports, run a deterministic block set
 * through it, and hand back a digest main can check. Real-time hosting rides
 * the transferred port instead — a job that returns one result cannot carry a
 * live stream, and pretending otherwise would put audio on the control channel.
 *
 * The binary is re-hashed here even though main already verified it. Main proves
 * the file it granted was the reviewed one; this proves the bytes about to be
 * dlopened still are. Between those two moments the file could have changed,
 * and the whole point of a digest-keyed registry is that it cannot.
 */

/** The deterministic probe signal; the same input always yields the same digest. */
export const HOST_PROBE_BLOCK_FRAMES = 256;
export const HOST_PROBE_BLOCKS = 8;

export function createNativePluginHostJobRunner({ loadAddon, addonPath, addonSha256, hashFile, hash }) {
	if (typeof loadAddon !== 'function') throw new TypeError('A native addon loader is required.');
	if (typeof hashFile !== 'function') throw new TypeError('A file digest function is required.');
	if (typeof hash !== 'function') throw new TypeError('A block digest function is required.');
	let addon = null;

	return ({ grant, onProgress }) => {
		let cancelled = false;
		let instance = null;
		const completion = (async () => {
			const digest = await hashFile(grant.binaryPath);
			if (digest.sha256 !== grant.binarySha256 || digest.byteLength !== grant.binaryBytes) {
				// Not an error to recover from: the reviewed bytes are gone, so
				// this digest has to be treated as an unreviewed installation.
				throw Object.assign(new Error('The plug-in binary changed after it was granted.'), {
					code: 'HELPER_PLUGIN_DIGEST_MISMATCH',
				});
			}
			addon ??= await loadAddon({ addonPath, addonSha256 });
			instance = addon.openPluginInstance(grant.binaryPath, 48_000, HOST_PROBE_BLOCK_FRAMES);
			const reportedLatency = addon.pluginLatencyFrames(instance);
			const channels = [new Float32Array(HOST_PROBE_BLOCK_FRAMES), new Float32Array(HOST_PROBE_BLOCK_FRAMES)];
			const input = [new Float32Array(HOST_PROBE_BLOCK_FRAMES), new Float32Array(HOST_PROBE_BLOCK_FRAMES)];
			const rendered = hash();
			const latencies = [reportedLatency];
			let blocks = 0;
			for (let block = 0; block < HOST_PROBE_BLOCKS; block += 1) {
				if (cancelled) break;
				for (const [channel, plane] of input.entries()) {
					for (let frame = 0; frame < HOST_PROBE_BLOCK_FRAMES; frame += 1) {
						// A ramp per channel: cheap, exactly representable, and
						// different enough per channel that a channel swap shows up.
						plane[frame] = ((block * HOST_PROBE_BLOCK_FRAMES + frame) % 128) / 128 + channel;
					}
				}
				addon.processPluginBlock(instance, HOST_PROBE_BLOCK_FRAMES, input, channels);
				for (const plane of channels) {
					rendered.update(Buffer.from(plane.buffer, plane.byteOffset, plane.byteLength));
				}
				blocks += 1;
				latencies.push(addon.pluginLatencyFrames(instance));
				onProgress(blocks / HOST_PROBE_BLOCKS);
				await new Promise((resolve) => { setTimeout(resolve, 0); });
			}
			let stateBytes = null;
			let stateRefusal = null;
			try {
				stateBytes = addon.savePluginState(instance).byteLength;
			} catch (error) {
				// An oversize or rejected state makes the instance ineligible; it
				// does not fail the job, and it never discards what was persisted.
				stateRefusal = error instanceof Error ? error.message : String(error);
			}
			return {
				format: grant.format,
				binarySha256: grant.binarySha256,
				reportedLatencyFrames: reportedLatency,
				// A plug-in whose latency never settles must be visible as such
				// rather than averaged into a single number that looks stable.
				latencyStable: latencies.every((value) => value === reportedLatency),
				blockFrames: HOST_PROBE_BLOCK_FRAMES,
				blocksRendered: blocks,
				renderedSha256: rendered.digest('hex'),
				stateBytes,
				stateRefusal,
			};
		})();
		return Object.freeze({
			completion,
			cancel: async () => {
				cancelled = true;
				await completion.catch(() => undefined);
			},
		});
	};
}
