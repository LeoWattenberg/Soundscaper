/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareText, page, reviewedLabel, table } from './markdown.mjs';

const BROWSER_LABELS = Object.freeze({
	chromium: 'Chromium (Chrome, Edge)',
	firefox: 'Firefox',
	webkit: 'WebKit (Safari)',
});

const OPERATING_SYSTEM_LABELS = Object.freeze({
	windows: 'Windows',
	macos: 'macOS',
	linux: 'Linux',
});

const ARCHITECTURE_LABELS = Object.freeze({
	x64: 'x64',
	arm64: 'arm64',
});

const PACKAGE_GATE_LABELS = Object.freeze({
	'smoke-tested': 'Packaged and started in an automated smoke test',
});

const PACKAGE_LABELS = Object.freeze({
	nsis: 'Installer',
	zip: 'Zip archive',
	dmg: 'Disk image',
	AppImage: 'AppImage',
	deb: 'Debian package',
});

/**
 * How each platform tier is presented to a reader.
 *
 * The tier IDs describe where a capability can run, and the runtime register
 * that owns them is written for engineering evidence rather than for readers,
 * so the sentence a reader gets is reviewed here.
 */
const TIER_DESCRIPTIONS = Object.freeze({
	'web-core': 'Works in every supported browser, with no optional platform feature required.',
	'web-enhanced': 'Works in a browser that provides the newer storage and media features the capability needs.',
	'electron-enhanced': 'Works in the browser, and the desktop application does more with it.',
	'electron-only': 'Needs the desktop application, because a browser cannot reach what the capability uses.',
});

const OPERATING_SYSTEM_PACKAGE_KEYS = Object.freeze({
	windows: 'win',
	macos: 'mac',
	linux: 'linux',
});

function packageNames(operatingSystem, packageTargets) {
	const key = reviewedLabel(OPERATING_SYSTEM_PACKAGE_KEYS, operatingSystem, 'packaged operating system');
	const targets = packageTargets[key];
	if (!Array.isArray(targets) || targets.length === 0) {
		throw new Error(`The desktop packaging configuration declares no targets for ${operatingSystem}.`);
	}
	return targets.map((target) => reviewedLabel(PACKAGE_LABELS, target, 'desktop package format')).join('; ');
}

export function renderPlatformReference({ capabilities, packageTargets }) {
	if (!capabilities?.browserTargets || !Array.isArray(capabilities.desktopTargets)) {
		throw new TypeError('The production capability register is required.');
	}
	if (!Array.isArray(capabilities.platformTiers) || capabilities.platformTiers.length === 0) {
		throw new TypeError('The platform tier list is required.');
	}
	if (!packageTargets || typeof packageTargets !== 'object') throw new TypeError('The desktop packaging configuration is required.');

	const browserRows = Object.entries(capabilities.browserTargets)
		.map(([id, target]) => ({
			label: reviewedLabel(BROWSER_LABELS, id, 'browser target'),
			automated: target.automated === true,
		}))
		.sort((left, right) => compareText(left.label, right.label))
		.map((browser) => [browser.label, browser.automated ? 'Yes' : 'No']);

	const desktopRows = capabilities.desktopTargets
		.map((target) => ({
			operatingSystem: reviewedLabel(OPERATING_SYSTEM_LABELS, target.os, 'desktop operating system'),
			architecture: reviewedLabel(ARCHITECTURE_LABELS, target.architecture, 'desktop architecture'),
			packages: packageNames(target.os, packageTargets),
			gate: reviewedLabel(PACKAGE_GATE_LABELS, target.packageGate, 'desktop packaging check'),
		}))
		.sort((left, right) => (
			compareText(left.operatingSystem, right.operatingSystem)
			|| compareText(left.architecture, right.architecture)
		))
		.map((target) => [target.operatingSystem, target.architecture, target.packages, target.gate]);

	const tierRows = capabilities.platformTiers.map((tier) => [
		`\`${tier}\``,
		reviewedLabel(TIER_DESCRIPTIONS, tier, 'platform tier'),
	]);

	const body = [
		'The editor runs in a browser and as a desktop application. This page lists what is built and tested, not every environment the code might happen to work in.',
		'',
		'## Browsers',
		'',
		'“Tested automatically” means the browser suite runs against this engine on every pull request. An engine that is not listed is not tested and is not claimed to work.',
		'',
		table(['Browser engine', 'Tested automatically'], browserRows),
		'',
		'## Desktop packages',
		'',
		table(['Operating system', 'Architecture', 'Packages', 'Packaging check'], desktopRows),
		'',
		'## Where a capability can run',
		'',
		'Capabilities are grouped by what they need from the platform. See [Product capabilities](/reference/generated/product-capabilities/) for which capabilities each product enables.',
		'',
		table(['Tier', 'What it means'], tierRows),
	].join('\n');
	return page({
		title: 'Platforms and packages',
		description: 'Tested browser engines, desktop package formats per operating system, and what each platform tier means.',
		order: 11,
		body,
	});
}
