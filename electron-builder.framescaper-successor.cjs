// @ts-check
/* SPDX-License-Identifier: AGPL-3.0-only */
if (process.env.SCAPE_PRODUCT !== 'framescaper' || process.env.SCAPE_FRAMESCAPER_LINE !== 'successor'
	|| process.env.SCAPE_FRAMESCAPER_DESKTOP_PROFILE !== 'framescaper-successor-v2') throw new Error('Explicit Framescaper successor desktop profile is required.');
const base = require('./electron-builder.config.cjs');
const resources = '.desktop-build/framescaper-successor';
/** @type {import('electron-builder').Configuration} */
module.exports = {
	...base, appId: 'org.framescaper.successor.desktop', productName: 'Framescaper Development', publish: null, fileAssociations: [],
	beforePack: './scripts/framescaper-successor-before-pack.mjs', afterPack: './scripts/framescaper-successor-after-pack.mjs',
	directories: { app: `${resources}/app`, buildResources: `${resources}/icons`, output: 'release/framescaper-successor' },
	files: ['desktop/main.mjs', 'desktop/preload.cjs', 'desktop/product.json', 'package.json', '!node_modules/**/*'],
	extraResources: [{ from: `${resources}/renderer`, to: 'renderer' }, { from: `${resources}/runtime`, to: 'runtime' },
		{ from: 'LICENSE', to: 'licenses/Framescaper-AGPL-3.0.txt' }, { from: `${resources}/licenses`, to: 'licenses' }, { from: 'LICENSES', to: 'licenses/LICENSES' }],
	win: { ...base.win, icon: `${resources}/icons/icon.png` },
	mac: { ...base.mac, icon: `${resources}/icons/icon.png`, entitlements: 'desktop/framescaper-successor-entitlements.mac.plist',
		entitlementsInherit: 'desktop/framescaper-successor-entitlements.mac.plist', signIgnore: undefined, extendInfo: {} },
	linux: { ...base.linux, icon: `${resources}/icons/icon.png`, executableName: 'framescaper-successor', synopsis: 'Framescaper 1.1 development', description: 'Development editor with renderer-owned successor projects and linked motion compositions.' },
};
