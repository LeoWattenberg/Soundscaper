/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeExchange, MotionAeProperty } from '../../src/common/editor/motion-ae-exchange-types.ts';
import type { MotionAeFontBinding } from '../../src/common/editor/motion-ae-text-fonts.ts';
export const motionAeTextFont: MotionAeFontBinding = { postScriptName: 'ExactFace-Regular', asset: { kind: 'font', id: 'retained-font', name: 'Original face.otf', family: 'Exact Face', style: 'Regular',
	mimeType: 'font/otf', byteLength: 4, sha256: 'a'.repeat(64), storageKey: `motion-sha256:${'a'.repeat(64)}` } };
export const motionAeTextOptions = { layoutPolicy: 'review-reflow', colorSpace: 'srgb', lineHeight: 1.2 } as const;
export function motionAeTextFixture(font = motionAeTextFont.postScriptName): MotionAeExchange {
	const text: MotionAeProperty = { kind: 'text', name: 'Source Text', matchName: 'ADBE Text Document', keys: [], expression: null, value: {
		text: 'Retained\rtext', font, fontSize: 40, fillColor: [0.5, 0.25, 1], applyFill: true, applyStroke: false,
		strokeColor: [0, 0, 0], strokeWidth: 0, tracking: 50, leading: 48, autoLeading: false, justification: 'left', styleScope: 'uniform', styleSupport: 'basic',
		layout: { kind: 'box', orientation: 'horizontal', size: [200, 100], position: [-10, -30] },
	} };
	const numeric = (matchName: string, value: readonly number[]): MotionAeProperty => ({ kind: 'numeric', matchName, name: matchName, spatial: false, value, keys: [], expression: null });
	return { format: 'org.motionscaper.ae-exchange', version: 1, transferId: 'text-transfer', producer: { application: 'after-effects', version: 'unqualified', bridgeVersion: '0.1.0' },
		source: { name: 'Original text.aep', revisionDigest: null }, color: { workingSpace: 'sRGB IEC61966-2.1', linearBlending: true, bitsPerChannel: 32 }, footage: [], report: [],
		compositions: [{ id: 'source-comp', name: 'Text scene', width: 320, height: 240, pixelAspect: 1, frameRate: 24, duration: 2, displayStartTime: 0, background: [0, 0, 0], layers: [{
			id: 'source-text', name: 'Original editable text', kind: 'text', sourceId: null, parentId: null, matte: null, startTime: 0, inPoint: 0, outPoint: 2, stretch: 100, enabled: true, threeD: false, adjustment: false, blendMode: 'normal', properties: [
				{ kind: 'group', matchName: 'ADBE Transform Group', name: 'Transform', children: [numeric('ADBE Anchor Point', [5, 6]), numeric('ADBE Position', [100, 120]), numeric('ADBE Scale', [150, 80]), numeric('ADBE Rotate Z', [30])] },
				{ kind: 'group', matchName: 'ADBE Text Properties', name: 'Text', children: [text] },
			],
		}] }],
	};
}
