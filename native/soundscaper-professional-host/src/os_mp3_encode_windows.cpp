/* SPDX-License-Identifier: AGPL-3.0-only */

#include "os_audio_codec.h"
#include "os_mp3_profile.h"

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <mmreg.h>
#include <wrl/client.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <string>
#include <vector>

namespace {

using Microsoft::WRL::ComPtr;

enum class OutputInspection {
	exact,
	invalid,
	overLimit,
};

soundscaper_pro_os_mp3_encode_result answer(
	soundscaper_pro_os_codec_status status,
	bool nativeApiReached = false)
{
	soundscaper_pro_os_mp3_encode_result result{};
	result.status = status;
	result.native_api_reached = nativeApiReached ? 1u : 0u;
	return result;
}

bool exactRequest(const soundscaper_pro_os_mp3_encode_request *request)
{
	return request != nullptr && request->input_path_utf8 != nullptr
		&& request->output_path_utf8 != nullptr && request->input_bytes > 0u
		&& request->input_bytes <= 32u * 1024u * 1024u
		&& request->maximum_output_bytes > 0u
		&& request->maximum_output_bytes <= 128u * 1024u * 1024u
		&& request->input_bytes % (2u * sizeof(float)) == 0u
		&& std::strlen(request->input_path_utf8) > 0u
		&& std::strlen(request->input_path_utf8) <= 4096u
		&& std::strlen(request->output_path_utf8) > 0u
		&& std::strlen(request->output_path_utf8) <= 4096u
		&& std::strcmp(request->input_path_utf8, request->output_path_utf8) != 0
		&& request->sample_rate == 48000u && request->channel_count == 2u
		&& request->bitrate_kbps == 192u;
}

bool widePath(const char *value, std::wstring &result)
{
	const int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value, -1, nullptr, 0);
	if (length <= 1 || length > 32768) return false;
	result.resize(static_cast<size_t>(length));
	if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value, -1,
		result.data(), length) != length) return false;
	result.pop_back();
	return true;
}

bool readAll(HANDLE input, BYTE *bytes, size_t length)
{
	size_t offset = 0u;
	while (offset < length) {
		const DWORD requested = static_cast<DWORD>(std::min<size_t>(
			length - offset, std::numeric_limits<DWORD>::max()));
		DWORD readBytes = 0u;
		if (!ReadFile(input, bytes + offset, requested, &readBytes, nullptr) || readBytes == 0u) return false;
		offset += readBytes;
	}
	return true;
}

bool readFloatInput(
	const std::wstring &path,
	uint64_t expectedBytes,
	std::vector<int16_t> &pcm,
	uint64_t &frameCount)
{
	if (expectedBytes > std::numeric_limits<DWORD>::max()) return false;
	HANDLE input = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
		FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
	if (input == INVALID_HANDLE_VALUE) return false;
	BY_HANDLE_FILE_INFORMATION information{};
	ULARGE_INTEGER size{};
	const bool metadata = GetFileInformationByHandle(input, &information) != 0;
	size.HighPart = information.nFileSizeHigh;
	size.LowPart = information.nFileSizeLow;
	std::vector<BYTE> bytes(static_cast<size_t>(expectedBytes));
	const bool read = metadata && (information.dwFileAttributes
		& (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) == 0u
		&& size.QuadPart == expectedBytes && readAll(input, bytes.data(), bytes.size());
	const bool closed = CloseHandle(input) != 0;
	if (!read || !closed) return false;
	pcm.resize(bytes.size() / sizeof(float));
	for (size_t index = 0u; index < pcm.size(); ++index) {
		const size_t offset = index * sizeof(float);
		const uint32_t bits = static_cast<uint32_t>(bytes[offset])
			| static_cast<uint32_t>(bytes[offset + 1u]) << 8u
			| static_cast<uint32_t>(bytes[offset + 2u]) << 16u
			| static_cast<uint32_t>(bytes[offset + 3u]) << 24u;
		float sample = 0.0f;
		std::memcpy(&sample, &bits, sizeof(sample));
		if (!std::isfinite(sample)) return false;
		pcm[index] = sample <= -1.0f ? std::numeric_limits<int16_t>::min()
			: sample >= 1.0f ? std::numeric_limits<int16_t>::max()
				: static_cast<int16_t>(std::lround(sample * 32767.0f));
	}
	frameCount = pcm.size() / 2u;
	return frameCount > 0u;
}

OutputInspection inspectOutput(
	const std::wstring &path,
	uint64_t maximumBytes,
	uint64_t &outputBytes)
{
	HANDLE input = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
		FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
	if (input == INVALID_HANDLE_VALUE) return OutputInspection::invalid;
	BY_HANDLE_FILE_INFORMATION information{};
	ULARGE_INTEGER size{};
	const bool metadata = GetFileInformationByHandle(input, &information) != 0;
	size.HighPart = information.nFileSizeHigh;
	size.LowPart = information.nFileSizeLow;
	if (!metadata || (information.dwFileAttributes
		& (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0u
		|| size.QuadPart == 0u || size.QuadPart > std::numeric_limits<DWORD>::max()) {
		CloseHandle(input);
		return OutputInspection::invalid;
	}
	if (size.QuadPart > maximumBytes) {
		CloseHandle(input);
		return OutputInspection::overLimit;
	}
	std::vector<uint8_t> bytes(static_cast<size_t>(size.QuadPart));
	const bool read = readAll(input, bytes.data(), bytes.size());
	const bool closed = CloseHandle(input) != 0;
	if (!read || !closed || !soundscaper::os_audio::exactMp3(bytes, 48000u, 2u, 192u)) {
		return OutputInspection::invalid;
	}
	outputBytes = size.QuadPart;
	return OutputInspection::exact;
}

soundscaper_pro_os_mp3_encode_result encode(
	const soundscaper_pro_os_mp3_encode_request *request)
{
	if (!exactRequest(request)) return answer(SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST);
	std::wstring inputPath;
	std::wstring outputPath;
	if (!widePath(request->input_path_utf8, inputPath) || !widePath(request->output_path_utf8, outputPath)) {
		return answer(SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST);
	}
	if (GetFileAttributesW(outputPath.c_str()) != INVALID_FILE_ATTRIBUTES) {
		return answer(SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST);
	}
	std::vector<int16_t> pcm;
	uint64_t frameCount = 0u;
	if (!readFloatInput(inputPath, request->input_bytes, pcm, frameCount)) {
		return answer(SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST);
	}

	const HRESULT comStatus = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
	const bool uninitializeCom = SUCCEEDED(comStatus);
	if (FAILED(comStatus) && comStatus != RPC_E_CHANGED_MODE) {
		return answer(SOUNDSCAPER_PRO_OS_CODEC_API_UNAVAILABLE);
	}
	if (FAILED(MFStartup(MF_VERSION, MFSTARTUP_FULL))) {
		if (uninitializeCom) CoUninitialize();
		return answer(SOUNDSCAPER_PRO_OS_CODEC_API_UNAVAILABLE);
	}
	bool keepOutput = false;
	ComPtr<IMFSinkWriter> writer;
	auto finish = [&](soundscaper_pro_os_mp3_encode_result result) {
		writer.Reset();
		if (!keepOutput) DeleteFileW(outputPath.c_str());
		MFShutdown();
		if (uninitializeCom) CoUninitialize();
		return result;
	};
	if (FAILED(MFCreateSinkWriterFromURL(outputPath.c_str(), nullptr, nullptr, &writer))) {
		return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_ENCODE_FAILED, true));
	}

	MPEGLAYER3WAVEFORMAT wave{};
	wave.wfx.wFormatTag = WAVE_FORMAT_MPEGLAYER3;
	wave.wfx.nChannels = 2u;
	wave.wfx.nSamplesPerSec = 48000u;
	wave.wfx.nAvgBytesPerSec = 192000u / 8u;
	wave.wfx.nBlockAlign = 1u;
	wave.wfx.wBitsPerSample = 0u;
	wave.wfx.cbSize = MPEGLAYER3_WFX_EXTRA_BYTES;
	wave.wID = MPEGLAYER3_ID_MPEG;
	wave.fdwFlags = MPEGLAYER3_FLAG_PADDING_ISO;
	wave.nBlockSize = 576u;
	wave.nFramesPerBlock = 1u;
	wave.nCodecDelay = 0u;
	ComPtr<IMFMediaType> outputType;
	DWORD streamIndex = 0u;
	if (FAILED(MFCreateMediaType(&outputType))
		|| FAILED(MFInitMediaTypeFromWaveFormatEx(
			outputType.Get(), &wave.wfx, static_cast<UINT32>(sizeof(wave))))
		|| FAILED(writer->AddStream(outputType.Get(), &streamIndex))) {
		return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED, true));
	}
	ComPtr<IMFMediaType> inputType;
	constexpr UINT32 pcmBlockAlignment = 2u * sizeof(int16_t);
	if (FAILED(MFCreateMediaType(&inputType))
		|| FAILED(inputType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio))
		|| FAILED(inputType->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_PCM))
		|| FAILED(inputType->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, 16u))
		|| FAILED(inputType->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, 48000u))
		|| FAILED(inputType->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, 2u))
		|| FAILED(inputType->SetUINT32(MF_MT_AUDIO_BLOCK_ALIGNMENT, pcmBlockAlignment))
		|| FAILED(inputType->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, 48000u * pcmBlockAlignment))
		|| FAILED(writer->SetInputMediaType(streamIndex, inputType.Get(), nullptr))) {
		return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED, true));
	}
	if (FAILED(writer->BeginWriting())) {
		return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_ENCODE_FAILED, true));
	}
	constexpr uint64_t blockFrames = 1152u;
	for (uint64_t frameOffset = 0u; frameOffset < frameCount;) {
		const uint64_t frames = std::min(blockFrames, frameCount - frameOffset);
		const DWORD bufferBytes = static_cast<DWORD>(frames * pcmBlockAlignment);
		ComPtr<IMFMediaBuffer> buffer;
		BYTE *destination = nullptr;
		DWORD capacity = 0u;
		DWORD current = 0u;
		if (FAILED(MFCreateMemoryBuffer(bufferBytes, &buffer))
			|| FAILED(buffer->Lock(&destination, &capacity, &current))) {
			return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_ENCODE_FAILED, true));
		}
		if (capacity < bufferBytes) {
			(void)buffer->Unlock();
			return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_ENCODE_FAILED, true));
		}
		std::memcpy(destination, pcm.data() + frameOffset * 2u, bufferBytes);
		if (FAILED(buffer->Unlock()) || FAILED(buffer->SetCurrentLength(bufferBytes))) {
			return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_ENCODE_FAILED, true));
		}
		ComPtr<IMFSample> sample;
		const LONGLONG sampleTime = static_cast<LONGLONG>(frameOffset * 10000000u / 48000u);
		const LONGLONG nextTime = static_cast<LONGLONG>((frameOffset + frames) * 10000000u / 48000u);
		if (nextTime <= sampleTime || FAILED(MFCreateSample(&sample))
			|| FAILED(sample->AddBuffer(buffer.Get()))
			|| FAILED(sample->SetSampleTime(sampleTime))
			|| FAILED(sample->SetSampleDuration(nextTime - sampleTime))
			|| FAILED(writer->WriteSample(streamIndex, sample.Get()))) {
			return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_ENCODE_FAILED, true));
		}
		frameOffset += frames;
	}
	if (FAILED(writer->Finalize())) {
		return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_ENCODE_FAILED, true));
	}
	writer.Reset();
	uint64_t outputBytes = 0u;
	const auto inspected = inspectOutput(outputPath, request->maximum_output_bytes, outputBytes);
	if (inspected != OutputInspection::exact) {
		return finish(answer(inspected == OutputInspection::overLimit
			? SOUNDSCAPER_PRO_OS_CODEC_OUTPUT_LIMIT
			: SOUNDSCAPER_PRO_OS_CODEC_ENCODE_FAILED, true));
	}
	soundscaper_pro_os_mp3_encode_result result = answer(SOUNDSCAPER_PRO_OS_CODEC_OK, true);
	result.exact_tuple_passed = 1u;
	result.output_bytes = outputBytes;
	result.frame_count = frameCount;
	result.sample_rate = 48000u;
	result.channel_count = 2u;
	result.bitrate_kbps = 192u;
	keepOutput = true;
	return finish(result);
}

} // namespace

extern "C" soundscaper_pro_os_mp3_encode_result soundscaper_pro_os_mp3_encode(
	const soundscaper_pro_os_mp3_encode_request *request)
{
	return encode(request);
}
