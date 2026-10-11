/* SPDX-License-Identifier: AGPL-3.0-only */
import { isAbsolute, join, normalize } from 'node:path';

/** Test harness configuration only. Neither main nor preload imports these paths. */
export function resolveMotionQualificationPaths(root: string, product: 'motionscaper' | 'framescaper-successor', arch: string, env: NodeJS.ProcessEnv = process.env) {
	if (arch !== 'x64' && arch !== 'arm64') throw new Error('Unsupported qualification architecture.');
	const prefix = product === 'motionscaper' ? 'MOTIONSCAPER' : 'FRAMESCAPER_SUCCESSOR';
	const directory = `linux${arch === 'x64' ? '' : '-arm64'}-unpacked`;
	const stage = path(env[`${prefix}_QUALIFICATION_STAGE`] ?? join(root, '.desktop-build', ...(product === 'motionscaper' ? [] : ['framescaper-successor'])));
	const packaged = path(env[`${prefix}_QUALIFICATION_PACKAGE`] ?? join(root, 'release', ...(product === 'motionscaper' ? ['desktop-nightly-products', 'motionscaper'] : ['framescaper-successor']), directory));
	return Object.freeze({ stage, package: packaged, executable: join(packaged, product) });
}
function path(value: string): string {
	if (!value || value.length > 8192 || value.includes('\0') || !isAbsolute(value) || normalize(value) !== value) throw new TypeError('Qualification path must be bounded, absolute and normalized.');
	return value;
}
