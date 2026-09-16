/* SPDX-License-Identifier: AGPL-3.0-only */
import type { DesktopReadFetch } from './desktop-read-materialization.ts';
import { readDesktopLinkedOriginalRange, DESKTOP_LINKED_ORIGINAL_RANGE_MAXIMUM_BYTES } from './storage/desktop-linked-original-range-reader.ts';
import { registerDesktopReadCapability } from './desktop-read-capability-registry.ts';

interface AudioRangeDescriptor {
	readonly id: string; readonly url: string; readonly name: string;
	readonly size: number; readonly mimeType: string; readonly readProfile: string; readonly lastModified: number;
}
interface RangeLifetime { released: boolean; }
const lifetimes = new WeakMap<Blob, RangeLifetime>();

/** A selected PCM file reads bounded slices while the file service owns its capability. */
export function createDesktopAudioRangeBlob(descriptor: AudioRangeDescriptor,
	options: Readonly<{ fetch: DesktopReadFetch; signal?: AbortSignal }>,
): Blob {
	assertDesktopSelectedAudioReadProfile(descriptor);
	const url = new URL(descriptor.url);
	if (!/^[a-f0-9]{64}$/u.test(descriptor.id)
		|| !['soundscaper-app:', 'framescaper-app:'].includes(url.protocol) || url.host !== 'bundle'
		|| url.pathname !== `/_desktop/read/linked-audio-range-v1/${descriptor.id}/${encodeURIComponent(descriptor.name)}`
		|| url.search || url.hash || url.username || url.password) {
		throw new TypeError('A canonical desktop audio range capability URL is required.');
	}
	const lifetime: RangeLifetime = { released: false };
	const blob = new AudioRangeBlob(descriptor, options, lifetime, 0, descriptor.size, descriptor.mimeType);
	Object.defineProperties(blob, { name: { value: descriptor.name }, lastModified: { value: descriptor.lastModified } });
	registerDesktopReadCapability(blob, descriptor.id);
	lifetimes.set(blob, lifetime);
	return blob;
}

export function retireDesktopAudioRangeBlob(blob: Blob): void {
	const lifetime = lifetimes.get(blob);
	if (lifetime) lifetime.released = true;
}

class AudioRangeBlob extends Blob {
	readonly #descriptor: AudioRangeDescriptor;
	readonly #options: Readonly<{ fetch: DesktopReadFetch; signal?: AbortSignal }>;
	readonly #lifetime: RangeLifetime;
	readonly #offset: number;
	readonly #length: number;
	readonly #mimeType: string;
	constructor(descriptor: AudioRangeDescriptor, options: Readonly<{ fetch: DesktopReadFetch; signal?: AbortSignal }>,
		lifetime: RangeLifetime, offset: number, length: number, mimeType: string) {
		super(); this.#descriptor = descriptor; this.#options = options; this.#lifetime = lifetime;
		this.#offset = offset; this.#length = length; this.#mimeType = mimeType;
	}
	override get size(): number { return this.#length; }
	override get type(): string { return this.#mimeType; }
	override slice(start = 0, end = this.size, contentType = ''): Blob {
		const first = relative(start, this.size); const last = relative(end, this.size);
		return new AudioRangeBlob(this.#descriptor, this.#options, this.#lifetime,
			this.#offset + first, Math.max(0, last - first), contentType.toLowerCase());
	}
	override async arrayBuffer(): Promise<ArrayBuffer> {
		if (this.#lifetime.released) throw new Error('The desktop audio read scope was released.');
		if (this.#options.signal?.aborted) throw this.#options.signal.reason;
		if (this.size > DESKTOP_LINKED_ORIGINAL_RANGE_MAXIMUM_BYTES) {
			throw new RangeError('Desktop audio requires bounded slice reads, at most 4 MiB.');
		}
		if (!this.size) return new ArrayBuffer(0);
		const bytes = await readDesktopLinkedOriginalRange(this.#descriptor, {
			offset: this.#offset, length: this.size, ...(this.#options.signal ? { signal: this.#options.signal } : {}),
		}, this.#options.fetch, 'audio');
		return bytes.slice().buffer;
	}
	override async bytes(): Promise<Uint8Array<ArrayBuffer>> { return new Uint8Array(await this.arrayBuffer()); }
	override async text(): Promise<string> { return new TextDecoder().decode(await this.arrayBuffer()); }
	override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
		let offset = 0;
		return new ReadableStream({ pull: async (controller) => {
			if (offset >= this.size) { controller.close(); return; }
			const end = Math.min(this.size, offset + DESKTOP_LINKED_ORIGINAL_RANGE_MAXIMUM_BYTES);
			controller.enqueue(new Uint8Array(await this.slice(offset, end).arrayBuffer())); offset = end;
		} });
	}
}
function relative(value: number, size: number): number {
	const integer = Number.isNaN(value) ? 0 : Math.trunc(value);
	return integer < 0 ? Math.max(size + integer, 0) : Math.min(integer, size);
}

/** Ordinary selected compressed audio shares bounded range transport, without a linked locator. */
function assertDesktopSelectedAudioReadProfile(descriptor: AudioRangeDescriptor): void {
	const extensions: Readonly<Record<string, string>> = { wav: 'audio/wav', rf64: 'audio/rf64', aif: 'audio/aiff', aiff: 'audio/aiff',
		aac: 'audio/aac', flac: 'audio/flac', m4a: 'audio/mp4', mp2: 'audio/mpeg', mp3: 'audio/mpeg',
		oga: 'audio/ogg', ogg: 'audio/ogg', opus: 'audio/ogg; codecs=opus', wv: 'audio/x-wavpack' };
	const name = descriptor.name;
	const extension = typeof name === 'string' ? /\.([^.]+)$/u.exec(name)?.[1]?.toLowerCase() : null;
	if (descriptor.readProfile !== 'linked-audio-range-v1' || typeof name !== 'string' || name !== name.trim()
		|| name.length > 255 || name.includes('/') || name.includes('\\') || Array.from(name).some((character) => character.charCodeAt(0) < 32)
		|| !extension || !extensions[extension] || descriptor.mimeType !== extensions[extension]) {
		throw new TypeError('A canonical selected-audio desktop range profile is required.');
	}
	if (!Number.isSafeInteger(descriptor.size) || Number(descriptor.size) < 1 || Number(descriptor.size) > 1_000_000_000) {
		throw new RangeError('The selected-audio desktop range size exceeds its 1 GB bound.');
	}
}
