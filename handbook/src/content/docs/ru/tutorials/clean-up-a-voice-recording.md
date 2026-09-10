---
title: "Очистить голосовую запись"
description: "Удалить гул из записи, обрезать грохот, довести до громкости подкаста и экспортировать в формате MP3."
editUrl: false
sidebar:
  order: 2
head:
  - tag: script
    attrs:
      type: "application/ld+json"
    content: "{\"@context\":\"https://schema.org\",\"@type\":\"HowTo\",\"name\":\"Clean up a voice recording\",\"description\":\"Take the hum out of a take, cut the rumble, bring it to podcast loudness and export an MP3.\",\"tool\":[{\"@type\":\"HowToTool\",\"name\":\"Soundscaper\"}],\"step\":[{\"@type\":\"HowToStep\",\"position\":1,\"name\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\",\"text\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\"},{\"@type\":\"HowToStep\",\"position\":2,\"name\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\",\"text\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\"},{\"@type\":\"HowToStep\",\"position\":3,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. Half a second of hiss, then a steady tone standing in for a voice, with the hiss underneath it.\"},{\"@type\":\"HowToStep\",\"position\":4,\"name\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in.\",\"text\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in. The profile must contain nothing but the noise you want gone — no voice at all.\"},{\"@type\":\"HowToStep\",\"position\":5,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\"},{\"@type\":\"HowToStep\",\"position\":6,\"name\":\"Choose Select → Select all.\",\"text\":\"Choose Select → Select all. The profile is kept; now the effect needs to know what to clean.\"},{\"@type\":\"HowToStep\",\"position\":7,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection. Twelve decibels is a good first setting. More removes more noise but makes voices sound hollow. The lead-in is nearly flat and the tone is untouched.\"},{\"@type\":\"HowToStep\",\"position\":8,\"name\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection.\",\"text\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection. Everything below 100 Hz — traffic, handling, air conditioning — is rolled off. Speech lives well above it.\"},{\"@type\":\"HowToStep\",\"position\":9,\"name\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection.\",\"text\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection. −16 LUFS is the common target for stereo podcasts. Loudness measures how loud the whole take feels, not how tall its peaks are. The waveform is taller and the take plays at a comfortable level.\"},{\"@type\":\"HowToStep\",\"position\":10,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. A clean, level take with a quiet lead-in.\"},{\"@type\":\"HowToStep\",\"position\":11,\"name\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog.\",\"text\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog. The file is encoded in the browser; nothing leaves your computer.\"}]}"
---
<!-- docs-ai-provenance: {"factPacketSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","targetLocale":"ru"} -->

<!-- Generated by `node scripts/docs-reference.mjs`. Do not edit. -->

Большинство записей, сделанных дома, требуют трех одинаковых исправлений: постоянный фоновый шум, который нужно удалить, низкочастотный гул, который нужно отфильтровать, и уровень, который нужно довести до стандарта. В этом учебном пособии выполняются все три действия на примере трехсекундной записи, первая половина секунды которой представляет собой только шум помещения, а затем результат экспортируется в формате MP3.

:::tip[Что вам понадобится]
- Скачайте [`guide-noisy-take.wav`](https://assets.soundscaper.org/guides/examples/guide-noisy-take.wav) — короткую запись, первая половина секунды которой представляет собой шум помещения до начала голоса.

Каждый шаг ниже работает с этими файлами точно так, как описано в учебном пособии, поэтому то, что вы видите, должно соответствовать тому, что говорится в учебнике. Soundscaper работает в браузере; ничего не нужно устанавливать.
:::

## Что вы узнаете

- Почему для уменьшения шума требуется профиль и как его создать.
- Что удаляет фильтр верхних частот и где установить его для речи.
- Разница между пиковым уровнем и громкостью, а также как достичь целевой громкости.
- Как экспортировать MP3.

## Шаги

1. Откройте Soundscaper. Новая пустая проект открывается сразу после загрузки редактора.
2. Выберите **Файл → Импортировать аудио** и выберите `guide-noisy-take.wav` — короткую запись, первая половина секунды которой представляет собой шум помещения до начала голоса. Файл загружается как клип на отдельной дорожке.
3. Нажмите **Воспроизвести**, чтобы прослушать, затем **Стоп**.
   *Вы должны увидеть:* Полсекунды шума, затем постоянный тон, имитирующий голос, с шумом на его фоне.
4. Перетащите линейку над клипом от начала до отметки 15%, чтобы выделить ввод с шумом. Профили должен содержать только шум, который вы хотите удалить — без голоса.
5. Выберите **Эффект → Удаление и восстановление шума → Уменьшение шума** и нажмите **Получить профиль шума**. Статусная строка сообщает, что профиль готов. Нажмите **Закрыть**, чтобы пока покинуть диалоговое окно.
6. Выберите **Выделить → Выделить все**. Профили сохраняется; теперь эффект должен знать, что нужно очистить.
7. Выберите **Эффект → Удаление и восстановление шума → Уменьшение шума**. В диалоговом окне **Уменьшение шума** установите **Уменьшение шума** на `12`, затем нажмите **Применить к выделенному**. Двенадцать децибел — хорошее начальное значение. Больше удаляет больше шума, но делает голоса пустыми.
   *Вы должны увидеть:* Ввод становится почти плоским, а тон остается неизменным.
8. Выберите **Эффект → Легаси эффекты → Классические фильтры**. В диалоговом окне **Классические фильтры** выберите **Верхний пропуск** в качестве **Типа фильтра** и установите **Частоту среза** на `100`, затем нажмите **Применить к выделенному**. Все ниже 100 Гц — транспорт, обработка, кондиционирование воздуха — срезается. Речь хорошо слышна выше этого диапазона.
9. Выберите **Эффект → Регулировка громкости и сжатие → Нормализация громкости**. В диалоговом окне **Нормализация громкости** установите **Целевую громкость** на `-16`, затем нажмите **Применить к выделенному**. −16 LUFS — это распространенная цель для стереоподкастов. Громкость измеряет, насколько громким кажется весь трек, а не как высоки его пики.
   *Вы должны увидеть:* Волновая форма становится выше, и трек воспроизводится на комфортном уровне.
10. Нажмите **Воспроизвести**, чтобы прослушать, затем **Стоп**.
   *Вы должны увидеть:* Чистый, ровный трек с тихим вводом.
11. Выберите **Файл → Экспорт аудио**, установите **Формат** на **MP3** и нажмите **Экспорт**. Файл загружается сразу после завершения рендеринга, и ссылка на него остается в диалоговом окне. Файл кодируется в браузере; ничего не покидает ваш компьютер.

## Дальнейшие шаги

- Примените эти шаги к своей собственной записи с помощью руководств: [Удаление фонового шума](/guides/cleaning-up/remove-background-noise/), [Удаление низкочастотного гула](/guides/cleaning-up/remove-low-rumble/) и [Нормализация громкости для подкаста](/guides/volume/normalize-loudness-for-podcasts/).
- Проверьте результат так, как это делает платформа: [Измерьте громкость вашего микса](/guides/analysis/measure-loudness/).

## Другие учебные пособия

[Ваш первый проект в Soundscaper](/tutorials/your-first-project/) — Импортируйте запись, прослушайте ее, разделите, сделайте выцветание, экспортируйте файл и сохраните проект.
[Поставьте музыку под голос](/tutorials/put-music-under-a-voice/) — Сложите два трека, автоматически опустите один под другой, смешайте их и экспортируйте.

## Ссылки

- [Каждый параметр используемых здесь эффектов, с его значением по умолчанию и диапазоном, указан в справочнике аудиоэффектов.](/reference/generated/audio-effects/#parameters)
- [Экспортные форматы, их контейнеры и пределы каналов указаны в справочнике экспортных форматов.](/reference/generated/formats/)
- [Каждая команда меню и ее сочетание клавиш указаны в справочнике команд и сочетаний клавиш.](/reference/generated/commands/)

## Об этом учебном пособии

Это учебное пособие шаг за шагом воспроизводится на этих самых файлах при каждой сборке Soundscaper браузерной сборкой (`tests/browser/soundscaper-tutorials.spec.js`). Если какой-либо шаг перестает работать, сборка терпит неудачу, пока учебник не будет исправлен, поэтому то, что вы читаете, соответствует тому, что делает редактор.
