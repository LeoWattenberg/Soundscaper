/* SPDX-License-Identifier: AGPL-3.0-only */

import { createScapeDigest, scapeHex } from '../scape-archive-media.ts';
import { packPlanarFloat32 } from '../wavpack/pcm.js';

export const TAKE_CYCLE_CAPTURE_MAXIMUM_CHUNK_BYTES = 8 * 1024 * 1024;

export interface TakeCyclePcmEvidence {
	readonly byteLength: number;
	readonly sha256: string;
}

export class PcmEvidenceAccumulator {
	readonly #buffers: Float32Array[];
	readonly #chunkFrames: number;
	readonly #digest = createScapeDigest();
	#bufferedFrames = 0;
	#byteLength = 0;
	#closed = false;

	constructor(channelCount: number, chunkFrames: number) {
		this.#buffers = Array.from({ length: channelCount }, () => new Float32Array(chunkFrames));
		this.#chunkFrames = chunkFrames;
	}

	write(channels: readonly Float32Array[]): void {
		if (this.#closed) throw new Error('Take cycle PCM evidence is closed.');
		let offset = 0;
		const frames = channels[0]?.length ?? 0;
		while (offset < frames) {
			const count = Math.min(frames - offset, this.#chunkFrames - this.#bufferedFrames);
			for (let channel = 0; channel < this.#buffers.length; channel += 1) {
				this.#buffers[channel]!.set(channels[channel]!.subarray(offset, offset + count), this.#bufferedFrames);
			}
			this.#bufferedFrames += count;
			offset += count;
			if (this.#bufferedFrames === this.#chunkFrames) this.#flush();
		}
	}

	finish(): TakeCyclePcmEvidence {
		if (this.#closed) throw new Error('Take cycle PCM evidence was already closed.');
		if (this.#bufferedFrames) this.#flush();
		this.#closed = true;
		return Object.freeze({ byteLength: this.#byteLength, sha256: scapeHex(this.#digest.digest()) });
	}

	#flush(): void {
		const channels = this.#buffers.map((channel) => channel.subarray(0, this.#bufferedFrames));
		const header = new Uint8Array(4);
		new DataView(header.buffer).setUint32(0, this.#bufferedFrames, true);
		const payload = new Uint8Array(packPlanarFloat32(channels));
		for (const bytes of [header, payload]) {
			this.#digest.update(bytes);
			this.#byteLength += bytes.byteLength;
		}
		this.#bufferedFrames = 0;
	}
}
