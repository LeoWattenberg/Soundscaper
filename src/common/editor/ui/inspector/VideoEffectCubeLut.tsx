/* SPDX-License-Identifier: AGPL-3.0-only */
import { useMemo } from 'react';
import { normalizeCubeLutProfileEffectV1 } from '../../video-cube-lut-profile-v1.ts';
import type { CubeLutEffectPortV1 } from '../../controller/clip-video/cube-lut-effect-port-v1.ts';
import VideoCubeLutControl from './VideoCubeLutControl.tsx';

export default function VideoEffectCubeLut(props: Readonly<{ clipId: string; effect: unknown; effects: readonly unknown[];
	port: CubeLutEffectPortV1; copy: Readonly<Record<string, string>>; disabled: boolean }>) {
	const effect = normalizeCubeLutProfileEffectV1(props.effect);
	const bound = useMemo(() => {
		const port = props.port, binding = port.capture(props.clipId, effect.id, props.effects);
		const current = port.isCurrent, importFile = port.importFile, clear = port.clear;
		return { binding, isCurrent: () => binding !== null && Reflect.apply(current, port, [binding]) === true,
			onImport: async (file: File) => { if (binding) await Reflect.apply(importFile, port, [binding, file]); },
			onClear: async () => { if (binding) await Reflect.apply(clear, port, [binding]); } };
	}, [props.port, props.clipId, effect.id, props.effects]);
	return <VideoCubeLutControl reference={effect.params.lut} copy={props.copy} disabled={props.disabled || bound.binding === null}
		isCurrent={bound.isCurrent} onImport={bound.onImport} onClear={bound.onClear} />;
}
