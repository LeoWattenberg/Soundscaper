/* SPDX-License-Identifier: AGPL-3.0-only */

/** Published Kokoro v1.0 voice IDs, grouped by the model's nine language codes. */

export const KOKORO_VOICES_BY_LANGUAGE = Object.freeze({
	a: Object.freeze([
		'af_alloy', 'af_aoede', 'af_bella', 'af_heart', 'af_jessica', 'af_kore',
		'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky', 'am_adam',
		'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx',
		'am_puck', 'am_santa',
	]),
	b: Object.freeze([
		'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily',
		'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis',
	]),
	e: Object.freeze(['ef_dora', 'em_alex', 'em_santa']),
	f: Object.freeze(['ff_siwis']),
	h: Object.freeze(['hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi']),
	i: Object.freeze(['if_sara', 'im_nicola']),
	j: Object.freeze(['jf_alpha', 'jf_gongitsune', 'jf_nezumi', 'jf_tebukuro', 'jm_kumo']),
	p: Object.freeze(['pf_dora', 'pm_alex', 'pm_santa']),
	z: Object.freeze([
		'zf_xiaobei', 'zf_xiaoni', 'zf_xiaoxiao', 'zf_xiaoyi',
		'zm_yunjian', 'zm_yunxi', 'zm_yunxia', 'zm_yunyang',
	]),
} as const);

export type KokoroLanguage = keyof typeof KOKORO_VOICES_BY_LANGUAGE;
export type KokoroVoice = typeof KOKORO_VOICES_BY_LANGUAGE[KokoroLanguage][number];

export function isKokoroLanguage(value: unknown): value is KokoroLanguage {
	return typeof value === 'string' && Object.hasOwn(KOKORO_VOICES_BY_LANGUAGE, value);
}

export function isKokoroVoiceForLanguage(
	language: KokoroLanguage,
	value: unknown,
): value is KokoroVoice {
	return typeof value === 'string'
		&& (KOKORO_VOICES_BY_LANGUAGE[language] as readonly string[]).includes(value);
}
