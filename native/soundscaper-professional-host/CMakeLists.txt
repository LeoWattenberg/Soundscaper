# SPDX-License-Identifier: AGPL-3.0-only

cmake_minimum_required(VERSION 3.25)
project(soundscaper_professional_host VERSION 1.0.0 LANGUAGES C CXX)

if(MSVC)
	set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

if(NOT DEFINED SOUNDSCAPER_NATIVE_TARGET)
	message(FATAL_ERROR "SOUNDSCAPER_NATIVE_TARGET is required")
endif()
if(APPLE)
	enable_language(OBJCXX)
	if(NOT SOUNDSCAPER_NATIVE_TARGET STREQUAL "mac-arm64"
		OR NOT CMAKE_OSX_ARCHITECTURES STREQUAL "arm64")
		message(FATAL_ERROR "Soundscaper supports only arm64 professional builds on macOS")
	endif()
elseif(WIN32)
	if(SOUNDSCAPER_NATIVE_TARGET STREQUAL "win-x64")
		if(NOT CMAKE_GENERATOR_PLATFORM STREQUAL "x64")
			message(FATAL_ERROR "The professional host is not configuring for Windows x64")
		endif()
	elseif(SOUNDSCAPER_NATIVE_TARGET STREQUAL "win-arm64")
		if(NOT CMAKE_GENERATOR_PLATFORM STREQUAL "ARM64")
			message(FATAL_ERROR "The professional host is not configuring for Windows ARM64")
		endif()
	else()
		message(FATAL_ERROR "The professional host target is not a supported Windows target")
	endif()
elseif(CMAKE_SYSTEM_NAME STREQUAL "Linux")
	if(NOT SOUNDSCAPER_NATIVE_TARGET STREQUAL "linux-x64"
		AND NOT SOUNDSCAPER_NATIVE_TARGET STREQUAL "linux-arm64")
		message(FATAL_ERROR "The professional host target is not a supported Linux target")
	endif()
endif()

foreach(required SOUNDSCAPER_JUCE_ROOT SOUNDSCAPER_CLAP_ROOT SOUNDSCAPER_VAMP_ROOT SOUNDSCAPER_VST3_PROVENANCE_COMMIT)
	if(NOT DEFINED ${required} OR "${${required}}" STREQUAL "")
		message(FATAL_ERROR "${required} is required by the authenticated build recipe")
	endif()
endforeach()
if(NOT DEFINED SOUNDSCAPER_NODE_API_INCLUDE OR NOT EXISTS "${SOUNDSCAPER_NODE_API_INCLUDE}/node_api.h")
	message(FATAL_ERROR "SOUNDSCAPER_NODE_API_INCLUDE must name the authenticated Electron Node-API headers")
endif()
if(NOT EXISTS "${SOUNDSCAPER_JUCE_ROOT}/CMakeLists.txt")
	message(FATAL_ERROR "SOUNDSCAPER_JUCE_ROOT is not an extracted JUCE source tree")
endif()
if(NOT EXISTS "${SOUNDSCAPER_JUCE_ROOT}/modules/juce_audio_processors_headless/format_types/VST3_SDK")
	message(FATAL_ERROR "JUCE's embedded VST3 SDK closure is absent")
endif()
file(READ
	"${SOUNDSCAPER_JUCE_ROOT}/modules/juce_audio_processors_headless/format_types/VST3_SDK/pluginterfaces/vst/vsttypes.h"
	SOUNDSCAPER_VST3_VERSION_HEADER)
if(NOT SOUNDSCAPER_VST3_VERSION_HEADER MATCHES
	"#define[ \t]+kVstVersionString[ \t]+\"VST 3\\.8\\.0\"")
	message(FATAL_ERROR "JUCE's embedded VST3 SDK is not exact API version 3.8.0")
endif()
if(NOT EXISTS "${SOUNDSCAPER_CLAP_ROOT}/include/clap/clap.h")
	message(FATAL_ERROR "SOUNDSCAPER_CLAP_ROOT is not the direct CLAP ABI tree")
endif()
if(NOT EXISTS "${SOUNDSCAPER_VAMP_ROOT}/vamp/vamp.h"
	OR NOT EXISTS "${SOUNDSCAPER_VAMP_ROOT}/vamp-hostsdk/PluginHostAdapter.h"
	OR NOT EXISTS "${SOUNDSCAPER_VAMP_ROOT}/src/vamp-hostsdk/PluginHostAdapter.cpp")
	message(FATAL_ERROR "SOUNDSCAPER_VAMP_ROOT is not the authenticated Vamp SDK 2.10 source tree")
endif()

add_subdirectory("${SOUNDSCAPER_JUCE_ROOT}" "${CMAKE_CURRENT_BINARY_DIR}/juce" EXCLUDE_FROM_ALL)

add_library(soundscaper_professional_audio STATIC
	src/juce_audio_adapter.cpp src/os_aac_m4a_profile.cpp src/os_mp3_profile.cpp
	src/professional_host.cpp
)
add_library(soundscaper_professional_plugin STATIC
	src/direct_clap_adapter.cpp src/juce_message_dispatcher.cpp
	src/juce_plugin_adapter.cpp src/ladspa_host_state.cpp src/professional_host.cpp
)
add_library(soundscaper_professional_vamp STATIC
	src/vamp_exact_library.cpp src/vamp_analyzer_adapter.cpp src/vamp_analyzer_peer.cpp
	"${SOUNDSCAPER_VAMP_ROOT}/src/vamp-hostsdk/PluginHostAdapter.cpp"
	"${SOUNDSCAPER_VAMP_ROOT}/src/vamp-hostsdk/PluginInputDomainAdapter.cpp"
	"${SOUNDSCAPER_VAMP_ROOT}/src/vamp-hostsdk/PluginWrapper.cpp"
	"${SOUNDSCAPER_VAMP_ROOT}/src/vamp-hostsdk/RealTime.cpp"
)
target_compile_features(soundscaper_professional_vamp PRIVATE cxx_std_20)
target_include_directories(soundscaper_professional_vamp PUBLIC
	"${CMAKE_CURRENT_SOURCE_DIR}/src"
	"${SOUNDSCAPER_VAMP_ROOT}"
)
target_link_libraries(soundscaper_professional_vamp PRIVATE ${CMAKE_DL_LIBS})
if(MSVC)
	target_compile_options(soundscaper_professional_vamp PRIVATE /Gy /Gw)
else()
	# PluginHostAdapter.cpp also defines the SDK's legacy getPluginPath helper.
	# We never link its ambient-search section: exact-path loading lives solely
	# in vamp_exact_library.cpp.
	target_compile_options(soundscaper_professional_vamp PRIVATE
		-ffunction-sections -fdata-sections)
endif()
set_target_properties(soundscaper_professional_vamp PROPERTIES
	POSITION_INDEPENDENT_CODE YES
	CXX_VISIBILITY_PRESET hidden
	VISIBILITY_INLINES_HIDDEN YES
)
foreach(core soundscaper_professional_audio soundscaper_professional_plugin)
	target_compile_features(${core} PRIVATE cxx_std_20)
	target_include_directories(${core} PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src")
	target_compile_definitions(${core} PRIVATE
		SOUNDSCAPER_PRO_BUILD=1
		JUCE_DISPLAY_SPLASH_SCREEN=0
		JUCE_REPORT_APP_USAGE=0
		JUCE_MODAL_LOOPS_PERMITTED=0
		# A plug-in host has no business embedding a browser or an HTTP client,
		# and leaving them on made juce_gui_extra a hard build dependency on
		# GTK and WebKit that no target here has any use for.
		JUCE_WEB_BROWSER=0
		JUCE_USE_CURL=0
	)
	target_link_libraries(${core} PRIVATE
		juce::juce_recommended_config_flags
		juce::juce_recommended_lto_flags
		juce::juce_recommended_warning_flags
	)
	set_target_properties(${core} PROPERTIES
		POSITION_INDEPENDENT_CODE YES
		CXX_VISIBILITY_PRESET hidden
		VISIBILITY_INLINES_HIDDEN YES
		WINDOWS_EXPORT_ALL_SYMBOLS YES
	)
endforeach()
target_compile_definitions(soundscaper_professional_audio PUBLIC SOUNDSCAPER_PRO_STATIC=1)
target_compile_definitions(soundscaper_professional_plugin PUBLIC SOUNDSCAPER_PRO_STATIC=1)
target_compile_definitions(soundscaper_professional_audio PRIVATE SOUNDSCAPER_PRO_AUDIO_ONLY=1)
target_link_libraries(soundscaper_professional_audio PRIVATE juce::juce_audio_devices)
target_include_directories(soundscaper_professional_plugin PRIVATE "${SOUNDSCAPER_CLAP_ROOT}/include")
target_compile_definitions(soundscaper_professional_plugin PRIVATE
	SOUNDSCAPER_PRO_PLUGIN_ONLY=1
	JUCE_PLUGINHOST_VST3=1
	SOUNDSCAPER_VST3_PROVENANCE_COMMIT="${SOUNDSCAPER_VST3_PROVENANCE_COMMIT}"
)
target_link_libraries(soundscaper_professional_plugin PRIVATE
	juce::juce_audio_processors juce::juce_gui_extra
)

if(APPLE)
	target_sources(soundscaper_professional_audio PRIVATE src/os_audio_codec_mac.mm)
	target_sources(soundscaper_professional_plugin PRIVATE src/juce_message_dispatcher_mac.mm)
	target_link_libraries(soundscaper_professional_audio PRIVATE
		"-framework AudioToolbox" "-framework CoreFoundation")
	target_link_libraries(soundscaper_professional_plugin PRIVATE "-framework CoreAudioKit")
	target_link_libraries(soundscaper_professional_plugin PRIVATE "-framework CoreFoundation")
	set_target_properties(soundscaper_professional_plugin PROPERTIES
		OBJCXX_STANDARD 20
		OBJCXX_STANDARD_REQUIRED YES
		OBJCXX_EXTENSIONS NO)
	target_compile_definitions(soundscaper_professional_audio PRIVATE
		JUCE_ASIO=0 SOUNDSCAPER_COREAUDIO_STREAMING=1)
	target_compile_definitions(soundscaper_professional_plugin PRIVATE
		JUCE_PLUGINHOST_AU=1 JUCE_PLUGINHOST_LADSPA=0 JUCE_PLUGINHOST_LV2=0 JUCE_ASIO=0)
elseif(WIN32)
	target_sources(soundscaper_professional_audio PRIVATE
		src/os_audio_codec_windows.cpp src/os_mp3_encode_windows.cpp)
	target_link_libraries(soundscaper_professional_audio PRIVATE
		mfplat mfreadwrite mfuuid ole32)
	if(NOT DEFINED SOUNDSCAPER_ASIO_ROOT OR NOT EXISTS "${SOUNDSCAPER_ASIO_ROOT}/common/asio.h")
		message(FATAL_ERROR "Windows builds require the authenticated ASIO SDK 2.3.4 tree")
	endif()
	target_include_directories(soundscaper_professional_audio PRIVATE
		"${SOUNDSCAPER_ASIO_ROOT}/common"
		"${SOUNDSCAPER_ASIO_ROOT}/host"
	)
	target_compile_definitions(soundscaper_professional_audio PRIVATE
		JUCE_ASIO=1 SOUNDSCAPER_WASAPI_STREAMING=1 SOUNDSCAPER_ASIO_STREAMING=1)
	target_compile_definitions(soundscaper_professional_plugin PRIVATE
		JUCE_PLUGINHOST_AU=0 JUCE_PLUGINHOST_LADSPA=0 JUCE_PLUGINHOST_LV2=0 JUCE_ASIO=0)
else()
	target_sources(soundscaper_professional_audio PRIVATE src/os_audio_codec_unavailable.cpp)
	if(NOT DEFINED SOUNDSCAPER_LV2_ROOT OR NOT EXISTS "${SOUNDSCAPER_LV2_ROOT}/lv2/core/lv2.h")
		message(FATAL_ERROR "Linux builds require the authenticated LV2 1.18.10 headers")
	endif()
	if(NOT DEFINED SOUNDSCAPER_LADSPA_ROOT OR NOT EXISTS "${SOUNDSCAPER_LADSPA_ROOT}/src/ladspa.h")
		message(FATAL_ERROR "Linux builds require the authenticated LADSPA SDK headers")
	endif()
	target_sources(soundscaper_professional_plugin PRIVATE src/ladspa_plugin_metadata.cpp)
	target_include_directories(soundscaper_professional_plugin PRIVATE
		"${SOUNDSCAPER_LADSPA_ROOT}/src"
		"${SOUNDSCAPER_LV2_ROOT}")
	target_compile_definitions(soundscaper_professional_plugin PRIVATE
		JUCE_PLUGINHOST_AU=0 JUCE_PLUGINHOST_LADSPA=1 JUCE_PLUGINHOST_LV2=1 JUCE_ASIO=0)
	target_compile_definitions(soundscaper_professional_audio PRIVATE
		JUCE_ASIO=0 SOUNDSCAPER_ALSA_STREAMING=1
		SOUNDSCAPER_PIPEWIRE_SYSTEM_ABI_ADAPTER=1 SOUNDSCAPER_JACK_DISCOVERY_ONLY=1)
	target_link_libraries(soundscaper_professional_plugin PRIVATE ${CMAKE_DL_LIBS})
	target_sources(soundscaper_professional_audio PRIVATE
		../soundscaper-helper-addon/src/audio_backends.c
		../soundscaper-helper-addon/src/audio_device.c
		../soundscaper-helper-addon/src/audio_ring.c
		../soundscaper-helper-addon/src/audio_session.c
		../soundscaper-helper-addon/src/pipewire_session.c
	)
	target_include_directories(soundscaper_professional_audio PRIVATE
		../soundscaper-helper-addon/src
		../../vendor/pipewire-headers/pipewire-0.3
		../../vendor/pipewire-headers/spa-0.2
	)
endif()

include(CTest)
if(BUILD_TESTING)
	add_executable(soundscaper_os_mp3_profile_self_test
		src/os_mp3_profile.cpp tests/os_mp3_profile_self_test.cpp)
	target_compile_features(soundscaper_os_mp3_profile_self_test PRIVATE cxx_std_20)
	target_include_directories(soundscaper_os_mp3_profile_self_test PRIVATE
		"${CMAKE_CURRENT_SOURCE_DIR}/src")
	add_test(NAME soundscaper_os_mp3_profile_self_test
		COMMAND soundscaper_os_mp3_profile_self_test)
endif()
if(BUILD_TESTING AND (APPLE OR WIN32))
	add_executable(soundscaper_os_audio_codec_self_test tests/os_audio_codec_self_test.cpp)
	target_compile_features(soundscaper_os_audio_codec_self_test PRIVATE cxx_std_20)
	target_include_directories(soundscaper_os_audio_codec_self_test PRIVATE
		"${CMAKE_CURRENT_SOURCE_DIR}/src")
	target_link_libraries(soundscaper_os_audio_codec_self_test PRIVATE
		soundscaper_professional_audio)
	add_test(NAME soundscaper_os_audio_codec_self_test
		COMMAND soundscaper_os_audio_codec_self_test)
endif()
if(BUILD_TESTING AND APPLE)
	add_executable(soundscaper_juce_message_dispatcher_mac_self_test
		tests/juce_message_dispatcher_mac_self_test.cpp)
	target_compile_features(soundscaper_juce_message_dispatcher_mac_self_test PRIVATE cxx_std_20)
	target_include_directories(soundscaper_juce_message_dispatcher_mac_self_test PRIVATE
		"${CMAKE_CURRENT_SOURCE_DIR}/src")
	target_link_libraries(soundscaper_juce_message_dispatcher_mac_self_test PRIVATE
		soundscaper_professional_plugin)
	add_test(NAME soundscaper_juce_message_dispatcher_mac_self_test
		COMMAND soundscaper_juce_message_dispatcher_mac_self_test)
	set_tests_properties(soundscaper_juce_message_dispatcher_mac_self_test PROPERTIES TIMEOUT 15)
endif()
if(BUILD_TESTING)
	add_library(soundscaper_professional_clap_fixture MODULE
		tests/professional_clap_fixture.cpp)
	target_compile_features(soundscaper_professional_clap_fixture PRIVATE cxx_std_20)
	target_include_directories(soundscaper_professional_clap_fixture PRIVATE
		"${SOUNDSCAPER_CLAP_ROOT}/include")
	set_target_properties(soundscaper_professional_clap_fixture PROPERTIES
		PREFIX ""
		OUTPUT_NAME "soundscaper_professional_fixture"
		SUFFIX ".clap"
		CXX_VISIBILITY_PRESET hidden
		VISIBILITY_INLINES_HIDDEN YES
	)
	install(TARGETS soundscaper_professional_clap_fixture
		LIBRARY DESTINATION self-test
		RUNTIME DESTINATION self-test)
endif()
if(BUILD_TESTING AND CMAKE_SYSTEM_NAME STREQUAL "Linux")
	add_library(soundscaper_professional_ladspa_fixture MODULE
		tests/professional_ladspa_fixture.c)
	target_include_directories(soundscaper_professional_ladspa_fixture PRIVATE
		"${SOUNDSCAPER_LADSPA_ROOT}/src")
	set_target_properties(soundscaper_professional_ladspa_fixture PROPERTIES
		PREFIX ""
		OUTPUT_NAME "soundscaper_professional_ladspa_fixture"
		SUFFIX ".so"
		C_VISIBILITY_PRESET hidden
	)
	add_executable(soundscaper_ladspa_host_self_test tests/ladspa_host_self_test.cpp)
	target_compile_features(soundscaper_ladspa_host_self_test PRIVATE cxx_std_20)
	target_include_directories(soundscaper_ladspa_host_self_test PRIVATE
		"${CMAKE_CURRENT_SOURCE_DIR}/src")
	target_link_libraries(soundscaper_ladspa_host_self_test PRIVATE
		soundscaper_professional_plugin)
	add_dependencies(soundscaper_ladspa_host_self_test
		soundscaper_professional_ladspa_fixture)
	add_test(NAME soundscaper_ladspa_host_self_test
		COMMAND soundscaper_ladspa_host_self_test
			$<TARGET_FILE:soundscaper_professional_ladspa_fixture>)
	set_tests_properties(soundscaper_ladspa_host_self_test PROPERTIES TIMEOUT 15)
	install(TARGETS soundscaper_professional_ladspa_fixture
		LIBRARY DESTINATION self-test)
endif()
if(BUILD_TESTING)
	add_library(soundscaper_professional_vamp_fixture MODULE
		tests/professional_vamp_fixture.cpp)
	target_compile_features(soundscaper_professional_vamp_fixture PRIVATE cxx_std_20)
	target_include_directories(soundscaper_professional_vamp_fixture PRIVATE
		"${SOUNDSCAPER_VAMP_ROOT}")
	set_target_properties(soundscaper_professional_vamp_fixture PROPERTIES
		PREFIX ""
		OUTPUT_NAME "soundscaper_professional_vamp_fixture"
		CXX_VISIBILITY_PRESET hidden
		VISIBILITY_INLINES_HIDDEN YES
	)
	add_executable(soundscaper_vamp_analyzer_self_test
		tests/vamp_analyzer_self_test.cpp)
	target_compile_features(soundscaper_vamp_analyzer_self_test PRIVATE cxx_std_20)
	target_link_libraries(soundscaper_vamp_analyzer_self_test PRIVATE
		soundscaper_professional_vamp)
	if(MSVC)
		target_link_options(soundscaper_vamp_analyzer_self_test PRIVATE /OPT:REF)
	elseif(APPLE)
		target_link_options(soundscaper_vamp_analyzer_self_test PRIVATE "LINKER:-dead_strip")
	else()
		target_link_options(soundscaper_vamp_analyzer_self_test PRIVATE "LINKER:--gc-sections")
	endif()
	add_dependencies(soundscaper_vamp_analyzer_self_test
		soundscaper_professional_vamp_fixture)
	add_test(NAME soundscaper_vamp_analyzer_self_test
		COMMAND soundscaper_vamp_analyzer_self_test
			$<TARGET_FILE:soundscaper_professional_vamp_fixture>)
	set_tests_properties(soundscaper_vamp_analyzer_self_test PROPERTIES TIMEOUT 15)
endif()

# The utility process loads only this trusted-audio Node-API module. It cannot
# link, scan, instantiate, or execute third-party plug-in code.
add_library(soundscaper_professional_node MODULE src/node_api_bridge.cpp)
target_compile_features(soundscaper_professional_node PRIVATE cxx_std_20)
target_include_directories(soundscaper_professional_node PRIVATE
	"${SOUNDSCAPER_NODE_API_INCLUDE}"
	"${CMAKE_CURRENT_SOURCE_DIR}/src"
)
target_compile_definitions(soundscaper_professional_node PRIVATE NAPI_VERSION=8)
target_link_libraries(soundscaper_professional_node PRIVATE soundscaper_professional_audio)
if(APPLE)
	target_link_options(soundscaper_professional_node PRIVATE
		"LINKER:-undefined,dynamic_lookup")
endif()
set_target_properties(soundscaper_professional_node PROPERTIES
	PREFIX ""
	OUTPUT_NAME "soundscaper_professional"
	SUFFIX ".node"
)
install(TARGETS soundscaper_professional_node
	LIBRARY DESTINATION .
	RUNTIME DESTINATION .
)

# Third-party plug-ins are never loaded by the Electron utility-process addon.
# The reviewed launcher executes this persistent framed peer as the exact
# third-party-native child and the utility only proxies bounded RPC frames.
add_executable(soundscaper_professional_peer
	src/professional_host_containment_probe.cpp src/professional_host_peer.cpp)
target_compile_features(soundscaper_professional_peer PRIVATE cxx_std_20)
target_link_libraries(soundscaper_professional_peer PRIVATE
	soundscaper_professional_plugin soundscaper_professional_vamp)
if(MSVC)
	target_link_options(soundscaper_professional_peer PRIVATE /OPT:REF)
elseif(APPLE)
	target_link_options(soundscaper_professional_peer PRIVATE "LINKER:-dead_strip")
else()
	target_link_options(soundscaper_professional_peer PRIVATE "LINKER:--gc-sections")
endif()
if(WIN32)
	target_link_libraries(soundscaper_professional_peer PRIVATE ws2_32)
endif()
if(APPLE)
	target_sources(soundscaper_professional_peer PRIVATE
		src/professional_host_macos_bootstrap.mm)
	target_link_libraries(soundscaper_professional_peer PRIVATE "-lsandbox")
	set_target_properties(soundscaper_professional_peer PROPERTIES
		OBJCXX_STANDARD 20
		OBJCXX_STANDARD_REQUIRED YES
		OBJCXX_EXTENSIONS NO
		BUILD_RPATH "@loader_path/runtime"
		INSTALL_RPATH "@loader_path/runtime"
	)
elseif(UNIX)
	set_target_properties(soundscaper_professional_peer PROPERTIES
		BUILD_RPATH "\$ORIGIN/runtime"
		INSTALL_RPATH "\$ORIGIN/runtime"
	)
endif()
set_target_properties(soundscaper_professional_peer PROPERTIES
	OUTPUT_NAME "soundscaper_professional_peer"
)
install(TARGETS soundscaper_professional_peer RUNTIME DESTINATION .)
if(APPLE AND BUILD_TESTING)
	# Both executables close over the Release JUCE archive. Keep their final LTO
	# links serial on the authenticated Ninja candidate runner instead of making
	# them contend for the same four cores and memory.
	set_property(GLOBAL APPEND PROPERTY JOB_POOLS soundscaper_apple_juce_lto_link=1)
	set_property(TARGET
		soundscaper_professional_peer
		soundscaper_juce_message_dispatcher_mac_self_test
		PROPERTY JOB_POOL_LINK soundscaper_apple_juce_lto_link)
endif()

# Persistent delivery runs in the Electron main process but keeps filesystem
# paths and publication handles inside this one-session framed native peer.
# It deliberately shares no renderer, plug-in-host, or professional-addon ABI.
set(SOUNDSCAPER_DELIVERY_FS_SOURCES
	src/delivery_fs_main.cpp
	src/delivery_fs_protocol.cpp
	src/delivery_fs_sha256.cpp
	${CMAKE_CURRENT_SOURCE_DIR}/../common/sha256.cpp
)
if(APPLE)
	list(APPEND SOUNDSCAPER_DELIVERY_FS_SOURCES src/delivery_fs_macos.mm)
elseif(WIN32)
	list(APPEND SOUNDSCAPER_DELIVERY_FS_SOURCES src/delivery_fs_windows.cpp)
else()
	list(APPEND SOUNDSCAPER_DELIVERY_FS_SOURCES src/delivery_fs_linux.cpp)
endif()
add_executable(soundscaper_delivery_fs ${SOUNDSCAPER_DELIVERY_FS_SOURCES})
target_compile_features(soundscaper_delivery_fs PRIVATE cxx_std_20)
target_include_directories(soundscaper_delivery_fs PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")
if(APPLE)
	target_link_libraries(soundscaper_delivery_fs PRIVATE "-framework Foundation")
elseif(WIN32)
	target_compile_definitions(soundscaper_delivery_fs PRIVATE
		NOMINMAX WIN32_LEAN_AND_MEAN _WIN32_WINNT=0x0A00)
endif()
set_target_properties(soundscaper_delivery_fs PROPERTIES OUTPUT_NAME "soundscaper_delivery_fs")
install(TARGETS soundscaper_delivery_fs RUNTIME DESTINATION .)
file(GENERATE
	OUTPUT "${CMAKE_BINARY_DIR}/soundscaper-professional-toolchain.json"
	CONTENT "{\n\
\t\"cmakeVersion\":\"${CMAKE_VERSION}\",\n\
\t\"generator\":\"${CMAKE_GENERATOR}\",\n\
\t\"generatorPlatform\":\"${CMAKE_GENERATOR_PLATFORM}\",\n\
\t\"systemName\":\"${CMAKE_SYSTEM_NAME}\",\n\
\t\"systemProcessor\":\"${CMAKE_SYSTEM_PROCESSOR}\",\n\
\t\"osxArchitectures\":\"${CMAKE_OSX_ARCHITECTURES}\",\n\
\t\"cCompiler\":{\"id\":\"${CMAKE_C_COMPILER_ID}\",\"version\":\"${CMAKE_C_COMPILER_VERSION}\"},\n\
\t\"cxxCompiler\":{\"id\":\"${CMAKE_CXX_COMPILER_ID}\",\"version\":\"${CMAKE_CXX_COMPILER_VERSION}\"}\n\
}\n")
