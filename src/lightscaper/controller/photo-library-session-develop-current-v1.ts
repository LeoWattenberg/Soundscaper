/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPhotoLibraryDevelopSessionCurrentV1, type PhotoLibraryDevelopSessionHostCurrentV1 } from './photo-library-develop-session-current-v1.ts';
import { createPhotoLibraryDevelopDerivedOriginalSessionCurrentV1 } from './photo-library-develop-derived-original-session-current-v1.ts';

/** Compose the active Develop child from the selected Session's existing
 * writer and operation. Every borrowed method retains its original receiver;
 * derived pixels add no independent lifetime, repository or Original owner. */
export function createPhotoLibrarySessionDevelopCurrentV1(host: PhotoLibraryDevelopSessionHostCurrentV1) {
	const repository = host.repository, load = repository.loadPhoto;
	const initialize = host.ready, operation = host.operation, edit = host.edit;
	if ([load, initialize, operation, edit].some(method => typeof method !== 'function')) throw new TypeError('Current Develop requires the selected Session capabilities.');
	const bound: PhotoLibraryDevelopSessionHostCurrentV1 = Object.freeze({
		repository: Object.freeze({ loadPhoto: (...args: Parameters<typeof load>) => Reflect.apply(load, repository, args) as ReturnType<typeof load> }),
		ready: () => Reflect.apply(initialize, host, []) as ReturnType<typeof initialize>,
		operation: <Result>(...args: Parameters<typeof operation<Result>>) => Reflect.apply(operation<Result>, host, args) as Promise<Result>,
		edit: <Result>(...args: Parameters<typeof edit<Result>>) => Reflect.apply(edit<Result>, host, args) as Promise<Result>,
		...(host.maskRasters ? { maskRasters: host.maskRasters } : {}),
		...(host.settingsCurrent ? { settingsCurrent: host.settingsCurrent } : {}),
		...(host.presetsCurrent ? { presetsCurrent: host.presetsCurrent } : {}),
	});
	const source = host.originalSource;
	if (!source) return createPhotoLibraryDevelopSessionCurrentV1(bound);
	const reader = source.loadOriginal, decoder = source.withFrame;
	if (typeof reader !== 'function' || (decoder !== undefined && typeof decoder !== 'function')) throw new TypeError('Current Develop requires complete Original capabilities.');
	const original = createPhotoLibraryDevelopDerivedOriginalSessionCurrentV1({ repository: bound.repository, ready: bound.ready,
		operation: bound.operation, loadOriginal: (...args) => Reflect.apply(reader, source, args) as ReturnType<typeof reader>,
		...(decoder ? { withFrame: <Result>(...args: Parameters<typeof decoder<Result>>) => Reflect.apply(decoder<Result>, source, args) as Promise<Result> } : {}),
	});
	return createPhotoLibraryDevelopSessionCurrentV1({ ...bound, original });
}
