---
title: "Soundscaper 比較"
description: "比較 Soundscaper Web 與 Desktop 和 Audacity 4、Adobe Audition 在錄音、編輯、混音、交付及專案交換方面的功能。"
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","targetLocale":"zh-TW"} -->

Soundscaper 在網頁上重新實作 Audacity 4，並加入製作流程。Adobe Audition 是兩者通常拿來比較的商業後製工具。本頁比較 Soundscaper Web、Soundscaper Desktop、Audacity 4 和 Audition，協助您了解哪個版本已能滿足工作需求。

## 如何閱讀本頁

每個儲存格都以彩色符號開頭，後面接著說明細節：

- <span class="verdict verdict--yes" role="img" aria-label="Supported">+</span> — 支援或適用
- <span class="verdict verdict--partial" role="img" aria-label="Limited">~</span> — 範圍有限、依平台而異，或需要替代作法
- <span class="verdict verdict--no" role="img" aria-label="Unavailable">/</span> — 無法使用或不適用

請搭配符號閱讀備註。安裝選用外掛、模型或編碼器本身不會限制 Desktop 已支援的功能；備註會指出需要安裝的項目。Web 和 Desktop 分列呈現，因此瀏覽器限制不會降低 Desktop 的評等。

列描述的是功能，而非選單指令。如需確切的指令清單，請參閱 [Commands and shortcuts](/reference/generated/commands/)；如需各產品啟用的功能，請參閱
[Product capabilities](/reference/generated/product-capabilities/)。

### 這些聲明的來源

- **Soundscaper** 的資料來自此儲存庫：產品功能設定檔、執行階段動作清單、匯出格式登錄，以及瀏覽器與桌面編碼器支援檢查。
  Desktop 原生目標套件由儲存庫 CI 或目標封裝流程產生。只有在準備並驗證完全相符的結果後，套件才會啟用功能；表格會指出何時仍需要目標套件。
- **Audacity 4** 的資料以此儲存庫固定的上游清單為基礎：`4.0.0`，commit `4c177d43`，並納入截至官方 [`4.0.1` 版本](https://github.com/audacity/audacity/blob/Audacity-4.0.1/CHANGELOG.txt)（commit `d82386ce`）的使用者可見變更。上游已登錄但停用，或透過註解從選單移除的功能會特別標示。若已稽核的清單和版本說明都沒有提到某項功能，便標示為在這些資料中未出現，而不代表永遠不存在。取樣繪製、片段增益包絡和舊專案匯入也記載於[官方 4.0 變更記錄](https://www.audacityteam.org/changelog/)和[片段增益手冊](https://www.audacityteam.org/manual/clips/clip-gain/)。
- **Audition** 的列來自 Adobe 針對當前發布版本發布的文檔。這些內容未針對運行中的構建進行驗證。

## 平台與術語

| 功能 | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| 授權 | + — AGPL-3.0-only | + — AGPL-3.0-only | + — GPL，開源 | / — 專有且封閉 |
| 成本 | + — 免費 | + — 免費 | + — 免費 | / — Creative Cloud 訂閱 |
| 在瀏覽器中運行 | + — Chromium、Firefox 和 WebKit | / — 桌面應用程式 | / — 僅限桌面 | / — 僅限桌面 |
| 桌面構建 | / — 使用瀏覽器版 | + — x64 和 ARM64 上的 Windows 和 Linux，ARM64 上的 macOS | + — Windows（安裝程式或可攜版）、macOS、Linux | ~ — Windows 和 macOS，無 Linux |
| 無需帳戶即可使用 | + — 不存在帳戶 | + — 不存在帳戶 | + — 僅 audio.com 需要登入 | / — 需要已登入的訂閱 |
| 雲端專案儲存 | / — 被本地優先設計排除 | / — 被本地優先設計排除 | + — 透過 audio.com 儲存和分享 | ~ — Creative Cloud 檔案，工作階段不同步 |
| 系統需求 | + — 在任何當前瀏覽器可運行的地方運行 | + — 在支援的桌面架構上執行 Windows、Linux 或 macOS | ~ — 相比 Audacity 3 有實質提升 | ~ — 專業工作站級別 |

## 專案與工作階段模型

| 功能 | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| 原生專案格式 | + — `.sscape`，一種無損可攜式封存檔 | + — `.sscape`，一種無損可攜式封存檔 | + — `.aup4` | + — `.sesx` |
| 開啟 Audacity 專案 | + — 匯入 AUP、AUP3 和 AUP4；匯出 AUP3 和 AUP4 | + — 匯入 AUP、AUP3 和 AUP4；匯出 AUP3 和 AUP4 | + — 匯入 AUP、AUP3 和 AUP4；匯出 AUP4，不支援匯出 AUP3 | / |
| 非破壞性片段時間軸 | + | + | + | + — 多軌編輯器 |
| 專用單檔編輯器 | + — Clip 屬性中的來源波形編輯器 | + — Clip 屬性中的來源波形編輯器 | ~ — 編輯直接套用至時間軸 | + — 波形編輯器 |
| 單軌上的單聲道與立體聲內容 | + — 軌道可持有其中一種 | + — 軌道可持有其中一種 | / — 軌道為單聲道或立體聲 | / — 通道格式依軌道固定 |
| 巢狀軌道資料夾 | + — 任意深度、可復原、含路由 | + — 任意深度、可復原、含路由 | / | ~ — 僅子混音匯流排，無資料夾軌道 |
| 專案儲存格 | + — 整理檔案並兼作剪貼簿 | + — 整理檔案並兼作剪貼簿 | / | ~ — 檔案面板列出開啟的檔案 |
| 自動儲存與崩潰恢復 | + — 自動儲存、鎖定與恢復封包 | + — 自動儲存、鎖定與恢復封包 | + | + |
| 標記與命名區域 | + — 一級功能，含導覽與漣漪行為 | + — 一級功能，含導覽與漣漪行為 | ~ — 標籤軌道 | + — 標記與範圍 |
| 速度與拍號地圖 | + — 依序解析、取樣精確的地圖 | + — 依序解析、取樣精確的地圖 | ~ — 單一專案速度與拍號 | ~ — 單一工作階段速度 |

## 錄音

| 功能 | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| 多軌錄音 | + — 同時錄製多個來源 | + — 同時錄製多個來源 | ~ — 一次一個輸入裝置 | + — 多輸入與多通道介面 |
| 麥克風與桌面音訊同時錄製 | ~ — 瀏覽器和作業系統提供螢幕音訊時即可內建使用 | + — Windows 上可同時使用麥克風和桌面迴路擷取；其他系統使用迴路輸入 | / | ~ — 需要作業系統迴圈裝置 |
| 定時錄音 | + | + | + | / |
| 聲音觸發錄音 | + — 可設定閾值 | + — 可設定閾值 | + — 可設定閾值 | / |
| 錄音前倒數 | + — 感知速度地圖，處理複合拍子 | + — 感知速度地圖，處理複合拍子 | ~ — 前導錄音 | ~ — 作為 Punch and Roll 的一部分的前滾 |
| Punch 錄音 | + — 單一交易，預設與路由擷取 | + — 單一交易，預設與路由擷取 | / | + — Punch and Roll |
| 循環錄音至 Take | + — 每次一車道，附加至同一群組 | + — 每次一車道，附加至同一群組 | / | ~ — 單一片段上的 Take，從清單中選擇 |
| Take 編排 | + — 試聽、提升、編輯編排區域、作為單一可復原編輯扁平化 | + — 試聽、提升、編輯編排區域、作為單一可復原編輯扁平化 | / | / — 無編排編輯器 |
| 輸入監聽與表頭 | + | + | + | + |

## 時間軸編輯

| 功能 | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| 漣漪編輯變體 | + — 針對單一剪輯、單一軌道及所有軌道，適用於剪下與刪除 | + — 針對單一剪輯、單一軌道及所有軌道，適用於剪下與刪除 | + — 相同的三種，適用於剪下與刪除 | ~ — 對選取範圍或間隙進行漣漪刪除 |
| 分割、合併及在靜音處分割 | + | + | + | ~ — 分割與修剪，無剪輯合併 |
| 剪輯群組 | + | + | + | + |
| 剪輯增益 | + | + | + | + |
| 單一剪輯音高與速度 | + — 調整、渲染或重設 | + — 調整、渲染或重設 | + — 調整、渲染或重設 | ~ — 拉伸保持可編輯，音高為效果 |
| 跟隨速度變化 | + — 當速度圖表移動時，剪輯會拉伸 | + — 當速度圖表移動時，剪輯會拉伸 | + | / |
| 節拍感知量化與律動 | + — 具有可調整律動強度的變形圖表 | + — 具有可調整律動強度的變形圖表 | / | / |
| 對齊至零交叉點 | + | + | + | + |
| 取樣層級繪製 | + | + | + — 放大至個別取樣時可用 | + — 在波形編輯器中 |
| 僅鍵盤編輯 | + — 每個編輯原語都有導航動作 | + — 每個編輯原語都有導航動作 | + — 編輯操作、時間軸和音軌垂直尺皆可用鍵盤操作 | ~ — 廣泛的快捷鍵，某些面板需要滑鼠 |

## 頻譜處理與修復

| 功能 | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| 頻譜圖檢視 | + — 具有單一軌道設定 | + — 具有單一軌道設定 | + — 具有單一軌道設定 | + — 頻率與音高顯示 |
| 頻率界限選取 | + | + | + | + — 選取框與套索 |
| 頻譜筆刷 | + | + | + | + — 畫筆與局部修復 |
| 刪除或增強頻譜區域 | + — 兩者皆為直接動作 | + — 兩者皆為直接動作 | + — 兩者皆為直接動作 | ~ — 對選取範圍套用效果 |
| 修復短損傷 | + — 修復 | + — 修復 | + — 修復 | + — 自動修復與局部修復筆刷 |
| 寬頻降噪 | + — 具有擷取檔案 | + — 具有擷取檔案 | + — 具有擷取檔案 | + — 降噪、自適應降噪、DeNoise |
| 去混響 | / — 僅限 Desktop 輔助功能 | + — 安裝選用模型和引擎後可使用 Reduce Reverb | / | + — DeReverb |
| 咔嗒聲、交流聲及齒音工具 | ~ — Click Removal 和 De-esser；沒有專用的電流聲移除工具 | ~ — Click Removal 和 De-esser；沒有專用的電流聲移除工具 | ~ — 僅咔嗒聲移除 | + — DeClicker、DeHummer、DeEsser、咔嗒聲/爆音消除器 |
| 診斷面板 | ~ — 偵測削波作為分析器 | ~ — 偵測削波作為分析器 | ~ — 偵測削波作為分析器 | + — 具有單一問題修復的診斷 |

## 效果與外掛

| 功能 | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| 內建效果套件 | + — 源自 Audacity 的效果、隨附的 Nyquist 外掛，以及 Bitcrusher 和 De-esser 等自製效果 | + — 源自 Audacity 的效果、隨附的 Nyquist 外掛，以及 Bitcrusher 和 De-esser 等自製效果 | + — 固定版本中有 30 種內建效果 | + — 約五十個，包括多頻段動態處理 |
| 每軌道即時效果架 | + — 比上游更廣泛的即時效果集 | + — 比上游更廣泛的即時效果集 | + | + — 每個片段、軌道和主輸出有十六個插槽 |
| 參數均衡器 | + — 新的參數均衡器，具有可自動化的頻段 | + — 新的參數均衡器，具有可自動化的頻段 | ~ — 濾波曲線和圖形均衡器 | + — 參數、圖形和 FFT 濾波器 |
| 效果預設 | + — 套用、儲存、匯入、匯出 | + — 套用、儲存、匯入、匯出 | + — 套用、儲存、匯入、匯出 | + |
| 巨集和批次鏈 | + — 具有範本的已儲存巨集庫 | + — 具有範本的已儲存巨集庫 | / — 固定版本將巨選單註解掉 | + — 收藏和批次處理 |
| 第三方外掛程式格式 | / — 原生外掛需要 Desktop | + — VST3、CLAP、AU、LV2、Linux LADSPA 和 Vamp；依平台而異，並需經授權與隔離 | + — VST3、AU、LV2 和 Nyquist，並具有外掛程式管理器 | ~ — VST3，以及 macOS 上的 AU，不支援 CLAP 或 LV2 |
| Nyquist 腳本 | + — 捆綁外掛程式和 Nyquist 提示 | + — 捆綁外掛程式和 Nyquist 提示 | + — 捆綁外掛程式和 Nyquist 提示 | / |
| 沙箱效果套件 | ~ — 經過審查的 WebAssembly 套件，有一個已發布，外部套件被隔離 | ~ — 經過審查的 WebAssembly 套件，有一個已發布，外部套件被隔離 | / | / |
| 虛擬樂器 | / | / | / | / |

## 混音、路由和自動化

| 功能 | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| 具有通道條的混音器 | + | + | ~ — 軌道控制和主軌道 | + |
| 匯流排和子混音 | + — 巢狀結構，具有循環驗證 | + — 巢狀結構，具有循環驗證 | / | + — 匯流排軌道 |
| 發送 | + — 推子前和推子後，多個指派 | + — 推子前和推子後，多個指派 | / | + — 推子前和推子後 |
| VCA 群組 | + | + | / | / |
| 側鏈輸入 | + | + | / | + — 透過發送 |
| 提示和控制室混音 | + | + | / | / |
| 外掛程式延遲補償 | + — 播放、監聽、匯流排、側鏈、渲染和凍結 | + — 播放、監聽、匯流排、側鏈、渲染和凍結 | ~ — 未在固定來源中公開 | + |
| 自動化軌道 | + — 增益、聲像、靜音、發送、匯流排和外掛程式參數 | + — 增益、聲像、靜音、發送、匯流排和外掛程式參數 | ~ — 片段增益包絡；沒有音軌或效果自動化軌道 | + — 音量、聲像和效果參數 |
| 自動化模式 | + — 讀取、修剪、觸碰、鎖存和寫入 | + — 讀取、修剪、觸碰、鎖存和寫入 | / | ~ — 讀取、寫入、鎖存和觸碰，沒有修剪 |
| 曲線形狀 | + — 直線、保持和曲線 | + — 直線、保持和曲線 | ~ — 僅支援片段增益包絡 | + — 線性和樣條曲線 |
| 軌道凍結 | + — 凍結、解凍和提交而不失去狀態 | + — 凍結、解凍和提交而不失去狀態 | / | ~ — 彈回至新軌道 |

## 計量和分析

| 功能 | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| 響度計 | + — EBU R 128 風格，附歷史記錄 | + — EBU R 128 風格，附歷史記錄 | / — 有響度正規化效果，但無計表 | + — 符合 ITU-R BS.1770 的響度雷達 |
| 相位與相關性計表 | + | + | / | + — 相位計表與分析 |
| 環繞聲計量 | + | + | / | ~ — 最高支援 5.1 |
| 頻譜圖 | + — 繪製頻譜 | + — 繪製頻譜 | ~ — 已註冊，但固定版本在「分析」選單中將其註解停用 | + — 頻率分析 |
| 波形中的削波與 RMS | + — 專案層級切換，並可個別覆寫音軌 RMS | + — 專案層級切換，並可個別覆寫音軌 RMS | + — 兩者皆有，可視專案切換 | ~ — 削波指示器，RMS 位於振幅統計中 |
| 語音清晰度對比 | + — 對比分析器 | + — 對比分析器 | ~ — 已註冊，但固定版本在「分析」選單中將其註解停用 | / |

在 Soundscaper 中，開啟音軌的 **Track visualization** 選單，即可切換 **Half-wave** 或 **Show RMS in waveform**。預設檢視、三頻段分音頻率和頻譜圖設定位於 **Edit → Preferences → Track display**。

## 通道與沉浸式音訊

| 功能 | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| 每檔通道數 | + — PCM 格式最高 32 通道 | + — PCM 格式最高 32 通道 | ~ — 單聲道與立體聲軌道 | + — 波形編輯器中最高 32 通道 |
| 環繞聲混音 | + — 床軌最高 7.1.4 | + — 床軌最高 7.1.4 | / | ~ — 最高 5.1 |
| 物件式音訊 | + — 物件與床軌並存 | + — 物件與床軌並存 | / | / |
| ADM 製作與直通 | + — 附合規檢查的 BW64/ADM | + — 附合規檢查的 BW64/ADM | / | / |
| 雙耳渲染 | + — 具名稱的雙耳模型 | + — 具名稱的雙耳模型 | / | ~ — 用於 Ambisonics 的雙耳化器 |
| Ambisonics | / | / | / | + — 一階，附 VR 聲像器 |

## 匯出與交付

| 功能 | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| 無損輸出 | + — 原生寫入 WAV、AIFF、BWF 和 BW64；透過專用編碼器處理 FLAC 和 WavPack | + — 原生寫入 WAV、AIFF、BWF 和 BW64；透過專用編碼器處理 FLAC 和 WavPack | + — WAV、AIFF 及 FLAC | + — WAV、AIFF、FLAC 及其他 |
| 有損輸出 | ~ — MP3、MP2、Opus 和 Ogg Vorbis；AAC 取決於瀏覽器 | + — 透過支援的編碼器提供者處理 MP3、MP2、Opus、Ogg Vorbis 和 AAC，包括已設定的 FFmpeg | + — MP3、Opus 和 Ogg Vorbis；其他格式可透過選用的 FFmpeg 處理 | ~ — MP2、MP3 和 Ogg Vorbis；其他格式可透過 Adobe Media Encoder，沒有通用 FFmpeg 目標 |
| 自訂編碼器設定 | ~ — 各格式有個別控制項；無法使用自訂 FFmpeg 參數 | ~ — 各格式有個別控制項；無法使用自訂 FFmpeg 參數 | + — 自訂 FFmpeg 目標 | + — 依格式的選項 |
| 匯出佇列 | + — 暫停、取消、重試及重新排序 | + — 暫停、取消、重試及重新排序 | / — Export Multiple 是單一循序作業，不是工作佇列 | ~ — 批次處理，無佇列控制 |
| 一次處理分軌與備選版本 | + — 與混音一起排隊 | + — 與混音一起排隊 | ~ — Export Multiple 會分別寫入各音軌，但不會將混音和替代算繪一併排入佇列 | ~ — 每條分軌一次混音下混 |
| 依區域交付 | + — 母帶處理序列，含依區域的元數據、間隙及淡入淡出 | + — 母帶處理序列，含依區域的元數據、間隙及淡入淡出 | + — Export Multiple 會將每個標記區域寫入個別檔案 | + — 匯出標記至獨立檔案 |
| 匯出時響度正規化 | + — 交付計畫的一部分 | + — 交付計畫的一部分 | ~ — 先執行效果 | + — 匹配響度 |
| 抖動與通道映射 | + — 明確控制項 | + — 明確控制項 | ~ — 偏好設定中的抖動 | + — 明確控制項 |
| 交付報告 | + — 依工作項目化 | + — 依工作項目化 | / | / |
| 渲染佇列在重啟後保留 | / — 持續性的算繪復原需要 Desktop | + — 使用當機日誌從位元組零重新啟動 | / | / |

Soundscaper Desktop 可使用已設定的 FFmpeg 處理支援的匯出格式；目前的編輯器不提供任意 FFmpeg 參數，也不支援所有 FFmpeg 編碼器。已登錄的目標請參閱[匯出格式](/reference/generated/formats/)。Audacity 的[匯出流程](https://www.audacityteam.org/manual/getting-started/export-your-audio/)可透過選用的 FFmpeg 安裝新增格式。Audition 提供固定的檔案寫入器，以及[交由 Adobe Media Encoder 處理](https://helpx.adobe.com/uk/audition/desktop/saving-and-exporting/saving-exporting-files1.html)的方式。

## 與其他工具的互換

| 功能 | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Audacity 專案 | + — 匯入 AUP、AUP3 和 AUP4；匯出 AUP3 和 AUP4，並附相容性報告 | + — 匯入 AUP、AUP3 和 AUP4；匯出 AUP3 和 AUP4，並附相容性報告 | + — 匯入 AUP、AUP3 和 AUP4；匯出 AUP4，不支援匯出 AUP3 | / |
| Audition 工作階段 | / — 匯入 SESX 需要 Desktop | ~ — 匯入 `.sesx` 音訊並提供省略項目報告；不支援匯出 | / — 固定版本不支援匯入 SESX | + — 原生 |
| EDL | ~ — CMX3600 等級的匯出，不支援匯入 | ~ — CMX3600 等級的匯出，不支援匯入 | / | / |
| OpenTimelineIO | ~ — 僅匯出 | ~ — 僅匯出 | / | / |
| FCPXML | ~ — 僅匯出 | ~ — 僅匯出 | / | + — 匯入與匯出 |
| DAWproject | + — 匯入與匯出，並附帶交換報告 | + — 匯入與匯出，並附帶交換報告 | / | / |
| OMF | / | / | / | ~ — 匯入與匯出 |
| 與影片編輯器的往返 | ~ — 將同一專案交給 Framescaper，無需複製媒體 | ~ — 將同一專案交給 Framescaper，無需複製媒體 | / | + — 與 Premiere Pro 動態連結 |
| 標籤與標記交換 | + — 匯入與匯出 | + — 匯入與匯出 | + — 匯入與匯出 | + — 標記清單 |

若要將 Audition 建立的 `.sesx` 檔案匯入 Soundscaper，請參閱[專案檔案](/projects-and-data/project-files/)，了解哪些音訊設定會移轉，以及報告會標示哪些項目遭到省略。

## 影片

| 功能 | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| 匯入影片作為參考 | + — 在時間軸上，並連結音訊 | + — 在時間軸上，並連結音訊 | / | ~ — 單一影片軌道，僅供預覽 |
| 影片時間軸編輯 | ~ — 基本編輯，完整功能在 Framescaper 中 | ~ — 基本編輯，完整功能在 Framescaper 中 | / | / |
| 影片匯出 | ~ — 瀏覽器 WebCodecs 支援必要編碼器時可使用 MP4 和 WebM | + — 透過已驗證的桌面編碼器提供者處理 MP4 和 WebM | / | / — 僅音訊 |
| 合成、調色與特效 | ~ — 在 Framescaper 中，使用同一專案 | ~ — 在 Framescaper 中，使用同一專案 | / | / |

## 機器輔助

安裝選用模型權重和相符的原生引擎後，即可使用 Desktop 輔助功能；Web 不提供這些工作流程。Model Manager 會安裝兩者。可用的工作流程和模型請參閱[本機輔助功能](/reference/generated/local-assistance/)。

| 功能 | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| 語音增強 | / — 僅限 Desktop 輔助功能 | + — 安裝選用模型和引擎後 | / | + — 增強語音 |
| 轉錄與說話人分離 | / — 僅限 Desktop 輔助功能 | + — 安裝選用模型和引擎後 | / | / — 轉錄內容位於 Premiere Pro 中 |
| 音源分離為分軌 | / — 僅限 Desktop 輔助功能 | + — 安裝選用模型和引擎後 | / | / |
| 自動閃避 | + — 自動閃避效果 | + — 自動閃避效果 | + — 自動閃避效果 | + — 必要音訊閃避 |
| 節拍與鏡頭偵測 | / — 節拍偵測需要 Desktop；鏡頭偵測在 Framescaper 中 | ~ — 使用選用模型偵測節拍；鏡頭偵測在 Framescaper 中 | / | ~ — Remix 自動重新定時音樂 |
| 完全在您的機器上運行 | + — 在瀏覽器本機處理；不執行模型推論 | + — 安裝模型後可本機處理並離線推論 | + — 完全沒有推論 | ~ — 某些功能在 Adobe 雲端處理 |
| 模型是可選且可移除的 | / — Web 不需要安裝模型 | + — 單獨下載、摘要固定、可刪除 | + — 無需安裝 | / — 與應用程式捆綁 |

## 差異的總和

Audacity 4 是單次處理的編輯器。固定版本沒有匯流排、傳送、音軌或效果自動化軌道，也沒有巨集。片段增益包絡可在片段內自動調整音量。Soundscaper 保留此編輯模式，並加入音軌與效果自動化、混音和交付，以及 Audacity 未涵蓋的錄音、影片和專案交換功能。

Audition 在修復深度、與 Premiere Pro 的專案往返交換，以及 Ambisonics 方面仍具優勢。Soundscaper 的強項是沉浸式音訊交付、專案處理，以及能在其他兩者不支援的硬體上透過瀏覽器執行。

如果您已使用 Audacity，請參閱[專案檔案與 Audacity 交換](/projects-and-data/project-files/)，了解如何移轉專案。
