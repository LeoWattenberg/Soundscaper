/* SPDX-License-Identifier: AGPL-3.0-only */

#include "os_audio_codec.h"
#include "os_aac_m4a_profile.h"

#include <AudioToolbox/AudioToolbox.h>
#include <CoreFoundation/CoreFoundation.h>

#include <algorithm>
#include <cerrno>
#include <cstdint>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <fstream>
#include <limits>
#include <sys/stat.h>
#include <unistd.h>
#include <vector>

namespace {

enum class ReviewedCodec {
	mp3,
	aacM4a,
};

enum class EncodedOutputInspection {
	exact,
	invalid,
	overLimit,
};

soundscaper_pro_os_mp3_decode_result answer(
	soundscaper_pro_os_codec_status status,
	bool nativeApiReached = false)
{
	soundscaper_pro_os_mp3_decode_result result{};
	result.status = status;
	result.native_api_reached = nativeApiReached ? 1u : 0u;
	return result;
}

soundscaper_pro_os_aac_m4a_encode_result encodeAnswer(
	soundscaper_pro_os_codec_status status,
	bool nativeApiReached = false)
{
	soundscaper_pro_os_aac_m4a_encode_result result{};
	result.status = status;
	result.native_api_reached = nativeApiReached ? 1u : 0u;
	return result;
}

bool requestShapeValues(
	const char *inputPath,
	const char *outputPath,
	uint64_t inputBytes,
	uint64_t maximumOutputBytes)
{
	return inputPath != nullptr && outputPath != nullptr && inputBytes > 0u
		&& maximumOutputBytes > 0u && std::strlen(inputPath) > 0u
		&& std::strlen(inputPath) <= 4096u && std::strlen(outputPath) > 0u
		&& std::strlen(outputPath) <= 4096u && std::strcmp(inputPath, outputPath) != 0;
}

bool requestShape(const soundscaper_pro_os_mp3_decode_request *request)
{
	return request != nullptr && requestShapeValues(
		request->input_path_utf8, request->output_path_utf8,
		request->input_bytes, request->maximum_output_bytes);
}

bool exactInputFile(const char *path, uint64_t expectedBytes)
{
	struct stat metadata{};
	return lstat(path, &metadata) == 0 && S_ISREG(metadata.st_mode)
		&& static_cast<uint64_t>(metadata.st_size) == expectedBytes;
}

bool exactEncodeRequest(const soundscaper_pro_os_aac_m4a_encode_request *request)
{
	return request != nullptr && requestShapeValues(
		request->input_path_utf8, request->output_path_utf8,
		request->input_bytes, request->maximum_output_bytes)
		&& request->input_bytes <= 32u * 1024u * 1024u
		&& request->maximum_output_bytes <= 128u * 1024u * 1024u
		&& request->input_bytes % (2u * sizeof(float)) == 0u
		&& request->sample_rate == 48000u && request->channel_count == 2u
		&& request->bitrate_kbps == 160u;
}

bool readAll(int descriptor, uint8_t *bytes, size_t length)
{
	size_t offset = 0u;
	while (offset < length) {
		const ssize_t count = read(descriptor, bytes + offset, length - offset);
		if (count < 0 && errno == EINTR) continue;
		if (count <= 0) return false;
		offset += static_cast<size_t>(count);
	}
	return true;
}

bool readExactFloatInput(
	const char *path,
	uint64_t expectedBytes,
	std::vector<float> &samples,
	uint64_t &frameCount)
{
	if (expectedBytes == 0u || expectedBytes > 32u * 1024u * 1024u
		|| expectedBytes > std::numeric_limits<size_t>::max()
		|| expectedBytes % (2u * sizeof(float)) != 0u) return false;
	const int descriptor = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
	if (descriptor < 0) return false;
	struct stat metadata{};
	std::vector<uint8_t> bytes(static_cast<size_t>(expectedBytes));
	const bool readInput = fstat(descriptor, &metadata) == 0 && S_ISREG(metadata.st_mode)
		&& static_cast<uint64_t>(metadata.st_size) == expectedBytes
		&& readAll(descriptor, bytes.data(), bytes.size());
	const bool closed = close(descriptor) == 0;
	if (!readInput || !closed) return false;
	samples.resize(bytes.size() / sizeof(float));
	for (size_t index = 0u; index < samples.size(); ++index) {
		const size_t offset = index * sizeof(float);
		const uint32_t bits = static_cast<uint32_t>(bytes[offset])
			| static_cast<uint32_t>(bytes[offset + 1u]) << 8u
			| static_cast<uint32_t>(bytes[offset + 2u]) << 16u
			| static_cast<uint32_t>(bytes[offset + 3u]) << 24u;
		std::memcpy(&samples[index], &bits, sizeof(float));
		if (!std::isfinite(samples[index])) return false;
	}
	frameCount = samples.size() / 2u;
	return frameCount > 0u;
}

EncodedOutputInspection inspectEncodedOutput(
	const char *path,
	uint64_t maximumBytes,
	uint64_t &outputBytes)
{
	const int descriptor = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
	if (descriptor < 0) return EncodedOutputInspection::invalid;
	struct stat metadata{};
	if (fstat(descriptor, &metadata) != 0 || !S_ISREG(metadata.st_mode)
		|| metadata.st_size <= 0) {
		close(descriptor);
		return EncodedOutputInspection::invalid;
	}
	const uint64_t bytes64 = static_cast<uint64_t>(metadata.st_size);
	if (bytes64 > maximumBytes) {
		close(descriptor);
		return EncodedOutputInspection::overLimit;
	}
	if (bytes64 > std::numeric_limits<size_t>::max()) {
		close(descriptor);
		return EncodedOutputInspection::invalid;
	}
	std::vector<uint8_t> bytes(static_cast<size_t>(bytes64));
	const bool readOutput = readAll(descriptor, bytes.data(), bytes.size());
	const bool closed = close(descriptor) == 0;
	if (!readOutput || !closed || !soundscaper::os_audio::exactAacLcM4a(bytes, 48000u, 2u)) {
		return EncodedOutputInspection::invalid;
	}
	outputBytes = bytes64;
	return EncodedOutputInspection::exact;
}

CFURLRef fileUrl(const char *path)
{
	return CFURLCreateFromFileSystemRepresentation(
		kCFAllocatorDefault,
		reinterpret_cast<const UInt8 *>(path),
		static_cast<CFIndex>(std::strlen(path)),
		false);
}

bool writeAll(int descriptor, const uint8_t *bytes, size_t length)
{
	size_t offset = 0u;
	while (offset < length) {
		const ssize_t written = write(descriptor, bytes + offset, length - offset);
		if (written < 0 && errno == EINTR) continue;
		if (written <= 0) return false;
		offset += static_cast<size_t>(written);
	}
	return true;
}

bool finiteSamples(const float *samples, size_t count)
{
	for (size_t index = 0u; index < count; ++index) {
		if (!std::isfinite(samples[index])) return false;
	}
	return true;
}

bool exactAacM4aContainer(ExtAudioFileRef input)
{
	AudioFileID audioFile = nullptr;
	UInt32 audioFileBytes = sizeof(audioFile);
	if (ExtAudioFileGetProperty(input, kExtAudioFileProperty_AudioFile,
		&audioFileBytes, &audioFile) != noErr || audioFile == nullptr
		|| audioFileBytes != sizeof(audioFile)) return false;
	AudioFileTypeID fileFormat = 0u;
	UInt32 fileFormatBytes = sizeof(fileFormat);
	return AudioFileGetProperty(audioFile, kAudioFilePropertyFileFormat,
		&fileFormatBytes, &fileFormat) == noErr
		&& fileFormatBytes == sizeof(fileFormat) && fileFormat == kAudioFileM4AType;
}

bool exactAacLcInput(
	const char *path,
	uint64_t expectedBytes,
	uint32_t sampleRate,
	uint32_t channelCount)
{
	if (expectedBytes == 0u || expectedBytes > 32u * 1024u * 1024u
		|| expectedBytes > std::numeric_limits<size_t>::max()
		|| expectedBytes > static_cast<uint64_t>(std::numeric_limits<std::streamsize>::max())) return false;
	std::ifstream file(path, std::ios::binary);
	std::vector<uint8_t> bytes(static_cast<size_t>(expectedBytes));
	if (!file.read(reinterpret_cast<char *>(bytes.data()), static_cast<std::streamsize>(bytes.size()))) {
		return false;
	}
	if (file.peek() != std::char_traits<char>::eof()) return false;
	return soundscaper::os_audio::exactAacLcM4a(bytes, sampleRate, channelCount);
}

soundscaper_pro_os_mp3_decode_result decodeOperatingSystemAudio(
	const soundscaper_pro_os_mp3_decode_request *request,
	ReviewedCodec codec)
{
	if (!requestShape(request)) return answer(SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST);
	if (!exactInputFile(request->input_path_utf8, request->input_bytes)) {
		return answer(SOUNDSCAPER_PRO_OS_CODEC_INPUT_CHANGED);
	}
	struct stat outputMetadata{};
	if (lstat(request->output_path_utf8, &outputMetadata) == 0 || errno != ENOENT) {
		return answer(SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST);
	}

	CFURLRef inputUrl = fileUrl(request->input_path_utf8);
	if (inputUrl == nullptr) return answer(SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST);
	ExtAudioFileRef input = nullptr;
	const OSStatus openStatus = ExtAudioFileOpenURL(inputUrl, &input);
	CFRelease(inputUrl);
	if (openStatus != noErr || input == nullptr) {
		return answer(SOUNDSCAPER_PRO_OS_CODEC_DECODE_FAILED, true);
	}
	auto finish = [&](soundscaper_pro_os_mp3_decode_result result, int output) {
		ExtAudioFileDispose(input);
		if (output >= 0) close(output);
		if (result.status != SOUNDSCAPER_PRO_OS_CODEC_OK) std::remove(request->output_path_utf8);
		return result;
	};

	AudioStreamBasicDescription source{};
	UInt32 descriptionBytes = sizeof(source);
	if (ExtAudioFileGetProperty(input, kExtAudioFileProperty_FileDataFormat,
		&descriptionBytes, &source) != noErr || descriptionBytes != sizeof(source)
		|| source.mFormatID != (codec == ReviewedCodec::mp3
			? kAudioFormatMPEGLayer3 : kAudioFormatMPEG4AAC)
		|| codec == ReviewedCodec::aacM4a && !exactAacM4aContainer(input)) {
		return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED, true), -1);
	}
	const uint32_t maximumSampleRate = codec == ReviewedCodec::mp3 ? 192000u : 48000u;
	const uint32_t maximumChannelCount = codec == ReviewedCodec::mp3 ? 2u : 6u;
	if (!(source.mSampleRate >= 8000.0 && source.mSampleRate <= maximumSampleRate)
		|| source.mSampleRate != static_cast<uint32_t>(source.mSampleRate)
		|| source.mChannelsPerFrame < 1u || source.mChannelsPerFrame > maximumChannelCount) {
		return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED, true), -1);
	}
	const uint32_t sampleRate = static_cast<uint32_t>(source.mSampleRate);
	const uint32_t channelCount = source.mChannelsPerFrame;
	if (codec == ReviewedCodec::aacM4a && !exactAacLcInput(
		request->input_path_utf8, request->input_bytes, sampleRate, channelCount)) {
		return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED, true), -1);
	}
	AudioStreamBasicDescription client{};
	client.mSampleRate = source.mSampleRate;
	client.mFormatID = kAudioFormatLinearPCM;
	client.mFormatFlags = kAudioFormatFlagsNativeFloatPacked;
	client.mBytesPerPacket = channelCount * static_cast<uint32_t>(sizeof(float));
	client.mFramesPerPacket = 1u;
	client.mBytesPerFrame = client.mBytesPerPacket;
	client.mChannelsPerFrame = channelCount;
	client.mBitsPerChannel = 32u;
	if (ExtAudioFileSetProperty(input, kExtAudioFileProperty_ClientDataFormat,
		sizeof(client), &client) != noErr) {
		return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED, true), -1);
	}

	const int output = open(request->output_path_utf8,
		O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, S_IRUSR | S_IWUSR);
	if (output < 0) return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_IO_FAILED, true), -1);
	constexpr UInt32 blockFrames = 4096u;
	std::vector<float> samples(static_cast<size_t>(blockFrames) * channelCount);
	uint64_t outputBytes = 0u;
	uint64_t frameCount = 0u;
	for (;;) {
		UInt32 frames = blockFrames;
		AudioBufferList buffers{};
		buffers.mNumberBuffers = 1u;
		buffers.mBuffers[0].mNumberChannels = channelCount;
		buffers.mBuffers[0].mDataByteSize = static_cast<UInt32>(samples.size() * sizeof(float));
		buffers.mBuffers[0].mData = samples.data();
		if (ExtAudioFileRead(input, &frames, &buffers) != noErr) {
			return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_DECODE_FAILED, true), output);
		}
		if (frames == 0u) break;
		const uint64_t bytes = static_cast<uint64_t>(frames) * channelCount * sizeof(float);
		if (bytes > buffers.mBuffers[0].mDataByteSize || outputBytes > request->maximum_output_bytes
			|| bytes > request->maximum_output_bytes - outputBytes
			|| !finiteSamples(samples.data(), static_cast<size_t>(frames) * channelCount)) {
			return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_OUTPUT_LIMIT, true), output);
		}
		if (!writeAll(output, reinterpret_cast<const uint8_t *>(samples.data()), static_cast<size_t>(bytes))) {
			return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_IO_FAILED, true), output);
		}
		outputBytes += bytes;
		frameCount += frames;
	}
	if (outputBytes == 0u || frameCount == 0u || fsync(output) != 0) {
		return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_DECODE_FAILED, true), output);
	}
	if (close(output) != 0) {
		return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_IO_FAILED, true), -1);
	}
	soundscaper_pro_os_mp3_decode_result result = answer(SOUNDSCAPER_PRO_OS_CODEC_OK, true);
	result.exact_tuple_passed = 1u;
	result.output_bytes = outputBytes;
	result.frame_count = frameCount;
	result.sample_rate = sampleRate;
	result.channel_count = channelCount;
	return finish(result, -1);
}

soundscaper_pro_os_aac_m4a_encode_result encodeOperatingSystemAacM4a(
	const soundscaper_pro_os_aac_m4a_encode_request *request)
{
	if (!exactEncodeRequest(request)) return encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST);
	if (!exactInputFile(request->input_path_utf8, request->input_bytes)) {
		return encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_INPUT_CHANGED);
	}
	struct stat outputMetadata{};
	if (lstat(request->output_path_utf8, &outputMetadata) == 0 || errno != ENOENT) {
		return encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST);
	}
	std::vector<float> samples;
	uint64_t frameCount = 0u;
	if (!readExactFloatInput(request->input_path_utf8, request->input_bytes, samples, frameCount)) {
		return encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST);
	}

	AudioStreamBasicDescription fileFormat{};
	fileFormat.mSampleRate = request->sample_rate;
	fileFormat.mFormatID = kAudioFormatMPEG4AAC;
	/* kAudioFormatMPEG4AAC is Apple's distinct Low Complexity AAC format ID;
	 * unlike linear PCM it has no ASBD flags. The completed magic cookie is
	 * parsed below as an independent profile witness. */
	fileFormat.mFormatFlags = 0u;
	fileFormat.mChannelsPerFrame = request->channel_count;
	UInt32 formatBytes = sizeof(fileFormat);
	if (AudioFormatGetProperty(kAudioFormatProperty_FormatInfo, 0u, nullptr,
		&formatBytes, &fileFormat) != noErr || formatBytes != sizeof(fileFormat)
		|| fileFormat.mFormatID != kAudioFormatMPEG4AAC
		|| fileFormat.mFormatFlags != 0u
		|| fileFormat.mSampleRate != request->sample_rate
		|| fileFormat.mChannelsPerFrame != request->channel_count) {
		return encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED, true);
	}
	CFURLRef outputUrl = fileUrl(request->output_path_utf8);
	if (outputUrl == nullptr) return encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST);
	ExtAudioFileRef output = nullptr;
	const OSStatus createStatus = ExtAudioFileCreateWithURL(
		outputUrl, kAudioFileM4AType, &fileFormat, nullptr, 0u, &output);
	CFRelease(outputUrl);
	if (createStatus != noErr || output == nullptr) {
		std::remove(request->output_path_utf8);
		return encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_ENCODE_FAILED, true);
	}
	bool keepOutput = false;
	auto finish = [&](soundscaper_pro_os_aac_m4a_encode_result result) {
		if (output != nullptr) ExtAudioFileDispose(output);
		if (!keepOutput) std::remove(request->output_path_utf8);
		return result;
	};

	AudioStreamBasicDescription client{};
	client.mSampleRate = request->sample_rate;
	client.mFormatID = kAudioFormatLinearPCM;
	client.mFormatFlags = kAudioFormatFlagsNativeFloatPacked;
	client.mBytesPerPacket = request->channel_count * static_cast<uint32_t>(sizeof(float));
	client.mFramesPerPacket = 1u;
	client.mBytesPerFrame = client.mBytesPerPacket;
	client.mChannelsPerFrame = request->channel_count;
	client.mBitsPerChannel = 32u;
	if (ExtAudioFileSetProperty(output, kExtAudioFileProperty_ClientDataFormat,
		sizeof(client), &client) != noErr) {
		return finish(encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED, true));
	}
	AudioConverterRef converter = nullptr;
	UInt32 converterBytes = sizeof(converter);
	UInt32 bitRate = request->bitrate_kbps * 1000u;
	if (ExtAudioFileGetProperty(output, kExtAudioFileProperty_AudioConverter,
		&converterBytes, &converter) != noErr || converterBytes != sizeof(converter)
		|| converter == nullptr
		|| AudioConverterSetProperty(converter, kAudioConverterEncodeBitRate,
			sizeof(bitRate), &bitRate) != noErr) {
		return finish(encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED, true));
	}
	CFArrayRef converterConfig = nullptr;
	if (ExtAudioFileSetProperty(output, kExtAudioFileProperty_ConverterConfig,
		sizeof(converterConfig), &converterConfig) != noErr) {
		return finish(encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED, true));
	}
	/* Synchronizing the ExtAudioFile configuration may replace its converter.
	 * Never retain or qualify the pre-synchronization borrowed reference. */
	converter = nullptr;
	converterBytes = sizeof(converter);
	if (ExtAudioFileGetProperty(output, kExtAudioFileProperty_AudioConverter,
		&converterBytes, &converter) != noErr || converterBytes != sizeof(converter)
		|| converter == nullptr) {
		return finish(encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED, true));
	}
	UInt32 actualBitRate = 0u;
	UInt32 actualBitRateBytes = sizeof(actualBitRate);
	AudioStreamBasicDescription actualOutput{};
	UInt32 actualOutputBytes = sizeof(actualOutput);
	if (AudioConverterGetProperty(converter, kAudioConverterEncodeBitRate,
		&actualBitRateBytes, &actualBitRate) != noErr
		|| actualBitRateBytes != sizeof(actualBitRate) || actualBitRate != bitRate
		|| AudioConverterGetProperty(converter, kAudioConverterCurrentOutputStreamDescription,
			&actualOutputBytes, &actualOutput) != noErr
		|| actualOutputBytes != sizeof(actualOutput)
		|| actualOutput.mFormatID != kAudioFormatMPEG4AAC
		|| actualOutput.mFormatFlags != 0u
		|| actualOutput.mSampleRate != request->sample_rate
		|| actualOutput.mChannelsPerFrame != request->channel_count) {
		return finish(encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED, true));
	}

	constexpr uint64_t blockFrames = 4096u;
	for (uint64_t frameOffset = 0u; frameOffset < frameCount;) {
		const UInt32 frames = static_cast<UInt32>(std::min(blockFrames, frameCount - frameOffset));
		AudioBufferList buffers{};
		buffers.mNumberBuffers = 1u;
		buffers.mBuffers[0].mNumberChannels = request->channel_count;
		buffers.mBuffers[0].mDataByteSize = frames * request->channel_count * sizeof(float);
		buffers.mBuffers[0].mData = samples.data() + frameOffset * request->channel_count;
		if (ExtAudioFileWrite(output, frames, &buffers) != noErr) {
			return finish(encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_ENCODE_FAILED, true));
		}
		frameOffset += frames;
		struct stat partial{};
		if (lstat(request->output_path_utf8, &partial) != 0 || !S_ISREG(partial.st_mode)) {
			return finish(encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_IO_FAILED, true));
		}
		if (static_cast<uint64_t>(partial.st_size) > request->maximum_output_bytes) {
			return finish(encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_OUTPUT_LIMIT, true));
		}
	}
	const OSStatus disposeStatus = ExtAudioFileDispose(output);
	output = nullptr;
	if (disposeStatus != noErr) {
		return finish(encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_ENCODE_FAILED, true));
	}
	uint64_t outputBytes = 0u;
	const auto inspected = inspectEncodedOutput(
		request->output_path_utf8, request->maximum_output_bytes, outputBytes);
	if (inspected != EncodedOutputInspection::exact) {
		return finish(encodeAnswer(inspected == EncodedOutputInspection::overLimit
			? SOUNDSCAPER_PRO_OS_CODEC_OUTPUT_LIMIT
			: SOUNDSCAPER_PRO_OS_CODEC_ENCODE_FAILED, true));
	}
	soundscaper_pro_os_aac_m4a_encode_result result = encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_OK, true);
	result.exact_tuple_passed = 1u;
	result.output_bytes = outputBytes;
	result.frame_count = frameCount;
	result.sample_rate = request->sample_rate;
	result.channel_count = request->channel_count;
	result.bitrate_kbps = request->bitrate_kbps;
	keepOutput = true;
	return finish(result);
}

} // namespace

extern "C" soundscaper_pro_os_mp3_decode_result soundscaper_pro_os_mp3_decode(
	const soundscaper_pro_os_mp3_decode_request *request)
{
	return decodeOperatingSystemAudio(request, ReviewedCodec::mp3);
}

extern "C" soundscaper_pro_os_mp3_decode_result soundscaper_pro_os_aac_m4a_decode(
	const soundscaper_pro_os_mp3_decode_request *request)
{
	return decodeOperatingSystemAudio(request, ReviewedCodec::aacM4a);
}

extern "C" soundscaper_pro_os_aac_m4a_encode_result soundscaper_pro_os_aac_m4a_encode(
	const soundscaper_pro_os_aac_m4a_encode_request *request)
{
	return encodeOperatingSystemAacM4a(request);
}

/* Apple documents MP3 as decode-only in the system Core Audio codec set. */
extern "C" soundscaper_pro_os_mp3_encode_result soundscaper_pro_os_mp3_encode(
	const soundscaper_pro_os_mp3_encode_request *request)
{
	soundscaper_pro_os_mp3_encode_result result{};
	result.status = request == nullptr
		? SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST
		: SOUNDSCAPER_PRO_OS_CODEC_API_UNAVAILABLE;
	return result;
}
