/* SPDX-License-Identifier: AGPL-3.0-only */

#include "os_audio_codec.h"

extern "C" soundscaper_pro_os_mp3_decode_result soundscaper_pro_os_mp3_decode(
	const soundscaper_pro_os_mp3_decode_request *request)
{
	soundscaper_pro_os_mp3_decode_result result{};
	result.status = request == nullptr
		? SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST
		: SOUNDSCAPER_PRO_OS_CODEC_API_UNAVAILABLE;
	return result;
}

extern "C" soundscaper_pro_os_mp3_decode_result soundscaper_pro_os_aac_m4a_decode(
	const soundscaper_pro_os_mp3_decode_request *request)
{
	return soundscaper_pro_os_mp3_decode(request);
}

extern "C" soundscaper_pro_os_aac_m4a_encode_result soundscaper_pro_os_aac_m4a_encode(
	const soundscaper_pro_os_aac_m4a_encode_request *request)
{
	soundscaper_pro_os_aac_m4a_encode_result result{};
	result.status = request == nullptr
		? SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST
		: SOUNDSCAPER_PRO_OS_CODEC_API_UNAVAILABLE;
	return result;
}

extern "C" soundscaper_pro_os_mp3_encode_result soundscaper_pro_os_mp3_encode(
	const soundscaper_pro_os_mp3_encode_request *request)
{
	soundscaper_pro_os_mp3_encode_result result{};
	result.status = request == nullptr
		? SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST
		: SOUNDSCAPER_PRO_OS_CODEC_API_UNAVAILABLE;
	return result;
}
