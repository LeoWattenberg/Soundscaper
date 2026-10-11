/* SPDX-License-Identifier: AGPL-3.0-only */
import { FRAMESCAPER_SUCCESSOR_DELIVERY_PROFILE } from '../src/framescaper/editor-successor-native-delivery-contract.ts';
import { FRAMESCAPER_SUCCESSOR_DESKTOP, framescaperSuccessorDesktopEnvironment } from './framescaper-successor-contract.ts';
export function assertFramescaperSuccessorSmoke(output: string, expected: Readonly<{ version: string; platform: string; arch: string; nativeDelivery?: boolean }>): unknown {
	const marker = 'FRAMESCAPER_SUCCESSOR_SHELL_SMOKE ', lines = output.split(/\r?\n/u).filter(line => line.startsWith(marker));
	if (lines.length !== 1) throw new Error('Successor packaged smoke must emit one result.');
	const value: unknown = JSON.parse(lines[0]!.slice(marker.length));
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid successor smoke evidence.'); const evidence = value as Record<string, unknown>;
	if (evidence.origin !== FRAMESCAPER_SUCCESSOR_DESKTOP.origin || evidence.arch !== expected.arch || evidence.foreignBridge !== false || evidence.fileBridge !== true
		|| JSON.stringify(evidence.bridgeMethods) !== JSON.stringify(['getEnvironment']) || typeof evidence.rejection !== 'string' || !evidence.rejection.includes('Unknown Motion saved-file renderer owner.')
		|| JSON.stringify(evidence.environment) !== JSON.stringify(framescaperSuccessorDesktopEnvironment(expected.version, expected.platform, expected.nativeDelivery))
		|| JSON.stringify(evidence.deliveryProfile) !== JSON.stringify(expected.nativeDelivery ? FRAMESCAPER_SUCCESSOR_DELIVERY_PROFILE : null)
		|| !Array.isArray(evidence.databases) || !evidence.databases.includes('kw-media-framescaper-editor-v2') || !evidence.databases.includes('kw-media-framescaper-editor-v2-media')
		|| evidence.databases.includes('kw-media-framescaper-editor-v1') || evidence.databases.includes('kw-media-editor-v1') || evidence.databases.some(name => typeof name !== 'string')) throw new Error('Successor packaged smoke evidence does not match isolated renderer-owned authority.');
	return value;
}
