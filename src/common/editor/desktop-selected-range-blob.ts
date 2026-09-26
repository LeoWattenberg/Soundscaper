/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DesktopReadFetch } from './desktop-read-materialization.ts';
import { DESKTOP_READ_PROFILE_SELECTED_RANGE } from './desktop-read-profile.ts';
import { readDesktopLinkedOriginalRange, DESKTOP_LINKED_ORIGINAL_RANGE_MAXIMUM_BYTES } from './storage/desktop-linked-original-range-reader.ts';
import { registerDesktopReadCapability } from './desktop-read-capability-registry.ts';

export interface DesktopSelectedRangeDescriptor {
	readonly id: string; readonly url: string; readonly name: string;
	readonly size: number; readonly mimeType: string; readonly readProfile: string; readonly lastModified: number;
}

interface Lifetime { released: boolean; }
const selections = new WeakMap<Blob, DesktopSelectedRangeDescriptor>();
const lifetimes = new WeakMap<Blob, Lifetime>();

export function assertDesktopSelectedRangeDescriptor(descriptor: DesktopSelectedRangeDescriptor): void {
	if (descriptor?.readProfile !== DESKTOP_READ_PROFILE_SELECTED_RANGE
		|| !/^[a-f0-9]{64}$/u.test(descriptor.id)
		|| typeof descriptor.name !== 'string' || !descriptor.name
		|| descriptor.name.length > 255 || descriptor.name === '.' || descriptor.name === '..'
		|| descriptor.name.includes('/') || descriptor.name.includes('\\')
		|| Array.from(descriptor.name).some((character) => character.charCodeAt(0) < 32)
		|| /\.(?:sscape|fscape|liscape|scape)$/iu.test(descriptor.name)
		|| typeof descriptor.mimeType !== 'string' || !descriptor.mimeType
		|| descriptor.mimeType === 'application/vnd.soundscaper.scape+zip'
		|| !Number.isSafeInteger(descriptor.size) || descriptor.size < 0
		|| !Number.isSafeInteger(descriptor.lastModified) || descriptor.lastModified < 0) {
		throw new TypeError('A canonical selected desktop range descriptor is required.');
	}
	const url = new URL(descriptor.url);
	if (!['soundscaper-app:', 'framescaper-app:'].includes(url.protocol) || url.host !== 'bundle'
		|| url.pathname !== `/_desktop/read/${DESKTOP_READ_PROFILE_SELECTED_RANGE}/${descriptor.id}/${encodeURIComponent(descriptor.name)}`
		|| url.search || url.hash || url.username || url.password) {
		throw new TypeError('A canonical selected desktop range capability URL is required.');
	}
}

export function createDesktopSelectedRangeBlob(descriptor: DesktopSelectedRangeDescriptor,
	options: Readonly<{ fetch: DesktopReadFetch; signal?: AbortSignal }>): Blob {
	assertDesktopSelectedRangeDescriptor(descriptor);
	const retained = Object.freeze({ ...descriptor });
	const lifetime: Lifetime = { released: false };
	const blob = new SelectedRangeBlob(retained, options, lifetime, 0, retained.size, retained.mimeType);
	Object.defineProperties(blob, { name: { value: retained.name }, lastModified: { value: retained.lastModified } });
	registerDesktopReadCapability(blob, retained.id);
	selections.set(blob, retained);
	lifetimes.set(blob, lifetime);
	return blob;
}

export function selectedRangeDescriptorForBlob(blob: Blob): DesktopSelectedRangeDescriptor | null {
	return selections.get(blob) ?? null;
}

export function retireDesktopSelectedRangeBlob(blob: Blob): void {
	const lifetime = lifetimes.get(blob);
	if (lifetime) lifetime.released = true;
}

class SelectedRangeBlob extends Blob {
	readonly #descriptor: DesktopSelectedRangeDescriptor;
	readonly #options: Readonly<{ fetch: DesktopReadFetch; signal?: AbortSignal }>;
	readonly #lifetime: Lifetime;
	readonly #offset: number;
	readonly #length: number;
	readonly #mimeType: string;
	constructor(descriptor: DesktopSelectedRangeDescriptor, options: Readonly<{ fetch: DesktopReadFetch; signal?: AbortSignal }>,
		lifetime: Lifetime, offset: number, length: number, mimeType: string) {
		super(); this.#descriptor = descriptor; this.#options = options; this.#lifetime = lifetime;
		this.#offset = offset; this.#length = length; this.#mimeType = mimeType;
	}
	override get size(): number { return this.#length; }
	override get type(): string { return this.#mimeType; }
	override slice(start = 0, end = this.size, contentType = ''): Blob {
		const first = relative(start, this.size); const last = relative(end, this.size);
		return new SelectedRangeBlob(this.#descriptor, this.#options, this.#lifetime,
			this.#offset + first, Math.max(0, last - first), contentType.toLowerCase());
	}
	override async arrayBuffer(): Promise<ArrayBuffer> {
		const bytes = new Uint8Array(this.size);
		let offset = 0;
		for await (const part of this.stream()) { bytes.set(part, offset); offset += part.byteLength; }
		return bytes.buffer;
	}
	override async bytes(): Promise<Uint8Array<ArrayBuffer>> { return new Uint8Array(await this.arrayBuffer()); }
	override async text(): Promise<string> {
		const decoder = new TextDecoder(); let result = '';
		for await (const part of this.stream()) result += decoder.decode(part, { stream: true });
		return result + decoder.decode();
	}
	override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
		let offset = 0;
		return new ReadableStream({ pull: async (controller) => {
			if (this.#lifetime.released) throw new Error('The selected desktop read scope was released.');
			if (this.#options.signal?.aborted) throw this.#options.signal.reason;
			if (offset >= this.size) { controller.close(); return; }
			const length = Math.min(this.size - offset, DESKTOP_LINKED_ORIGINAL_RANGE_MAXIMUM_BYTES);
			const bytes = await readDesktopLinkedOriginalRange(this.#descriptor, {
				offset: this.#offset + offset, length,
				...(this.#options.signal ? { signal: this.#options.signal } : {}),
			}, this.#options.fetch, 'selected');
			offset += bytes.byteLength; controller.enqueue(bytes.slice());
		} });
	}
}

function relative(value: number, size: number): number {
	const integer = Number.isNaN(value) ? 0 : Math.trunc(value);
	return integer < 0 ? Math.max(size + integer, 0) : Math.min(integer, size);
}
