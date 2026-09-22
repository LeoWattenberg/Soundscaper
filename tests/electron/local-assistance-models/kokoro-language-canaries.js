/* SPDX-License-Identifier: AGPL-3.0-only */

/** One short, native-script speech canary per Kokoro v1.0 language variant. */
export const KOKORO_LANGUAGE_CANARIES = Object.freeze([
	Object.freeze({ language: 'a', voice: 'af_heart', script: 'Hello from Soundscaper. This is a local speech test.', speed: 1 }),
	Object.freeze({ language: 'b', voice: 'bf_emma', script: 'Good morning. This is a local speech test.', speed: 1 }),
	Object.freeze({ language: 'e', voice: 'ef_dora', script: 'Hola. Esta es una prueba de voz rápida.', speed: 1 }),
	Object.freeze({ language: 'f', voice: 'ff_siwis', script: 'Bonjour. Ceci est une voix française.', speed: 1 }),
	Object.freeze({ language: 'h', voice: 'hf_alpha', script: 'नमस्ते। यह आवाज़ की जाँच है।', speed: 1 }),
	Object.freeze({ language: 'i', voice: 'if_sara', script: 'Ciao. Questa è una prova della voce locale.', speed: 1 }),
	Object.freeze({ language: 'j', voice: 'jf_alpha', script: 'こんにちは。これは音声のテストです。', speed: 1 }),
	Object.freeze({ language: 'p', voice: 'pf_dora', script: 'Olá. Este é um teste de voz local.', speed: 1 }),
	Object.freeze({ language: 'z', voice: 'zf_xiaobei', script: '你好。这是一段本地语音测试。', speed: 1 }),
]);
