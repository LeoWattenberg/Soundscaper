/* SPDX-License-Identifier: AGPL-3.0-only */

import { capturePhotoLibraryDevelopPortV3 as capture } from '../../controller/shared/photo-library-develop-command-v3.ts';
import type { PhotoLibraryDevelopPortV3 } from '../../photo-library-develop-port-v3.ts';
import { capturePhotoLibraryDevelopPortCurrentV1 as captureCurrent } from '../../controller/shared/photo-library-develop-command-current-v1.ts';
import type { PhotoLibraryDevelopPortCurrentV1 } from '../../photo-library-develop-port-current-v1.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;
export function capturePhotoLibraryDevelopPortV3(value: Readonly<PhotoLibraryDevelopPortV3>, signal?: AbortSignal): Readonly<PhotoLibraryDevelopPortV3> {
	const check = () => { if (signal) Reflect.apply(CHECK, signal, []); };
	check();
	try { const port = capture(value); check(); return port; } catch (error) { check(); throw error; }
}

export function capturePhotoLibraryDevelopPortCurrentV1(value: Readonly<PhotoLibraryDevelopPortCurrentV1>, signal?: AbortSignal): Readonly<PhotoLibraryDevelopPortCurrentV1> {
	const check = () => { if (signal) Reflect.apply(CHECK, signal, []); };
	check();
	try { const port = captureCurrent(value); check(); return port; } catch (error) { check(); throw error; }
}
