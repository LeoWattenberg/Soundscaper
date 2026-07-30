/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeArchiveByteSource } from '../../scape-archive-byte-source.ts';
import {
	DESKTOP_READ_PROFILE_MATERIALIZED,
	DESKTOP_READ_PROFILE_SCAPE_RANGE,
} from '../../desktop-read-profile.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

export interface DesktopProjectReadDescriptor {
	readonly readProfile?: unknown;
	readonly name?: unknown;
	readonly mimeType?: unknown;
}

export interface DesktopProjectReadService<Value> {
	withReadDescriptors(
		descriptors: readonly DesktopProjectReadDescriptor[],
		request: Readonly<Record<string, never>>,
		consume: (files: readonly Blob[]) => Awaitable<Value>,
	): PromiseLike<Value>;
	withScapeReadDescriptor(
		descriptor: DesktopProjectReadDescriptor,
		request: Readonly<Record<string, never>>,
		consume: (source: ScapeArchiveByteSource) => Awaitable<Value>,
	): PromiseLike<Value>;
}

export interface DesktopProjectConsumers<Value> {
	readonly openMaterialized: (file: Blob) => Awaitable<Value>;
	readonly openScape: (source: ScapeArchiveByteSource) => Awaitable<Value>;
}

export async function withDesktopProjectReadDescriptor<Value>(
	fileService: DesktopProjectReadService<Value>,
	descriptor: DesktopProjectReadDescriptor,
	consumers: DesktopProjectConsumers<Value>,
): Promise<Value> {
	if (!fileService || typeof fileService !== 'object') {
		throw new TypeError('A desktop project file service is required.');
	}
	if (!consumers || typeof consumers.openMaterialized !== 'function'
		|| typeof consumers.openScape !== 'function') {
		throw new TypeError('Desktop project consumers are required.');
	}
	if (descriptor?.readProfile === DESKTOP_READ_PROFILE_SCAPE_RANGE) {
		return fileService.withScapeReadDescriptor(descriptor, {}, consumers.openScape);
	}
	if (descriptor?.readProfile !== DESKTOP_READ_PROFILE_MATERIALIZED) {
		return fileService.withReadDescriptors([descriptor], {}, () => {
			throw new TypeError('A supported desktop project read profile is required.');
		});
	}
	return fileService.withReadDescriptors([descriptor], {}, (files) => {
		if (files.length !== 1 || !(files[0] instanceof Blob)) {
			throw new Error('The desktop project descriptor did not produce one file.');
		}
		return consumers.openMaterialized(files[0]);
	});
}
