import { Audio } from "expo-av";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { fetchSurahs, identifyRecitation, IdentifyResponse, MatchCandidate, RecognitionMode, SurahOption } from "./src/api";

type Status = "idle" | "recording" | "processing" | "results" | "error";

const popularSurahs = new Set([1, 2, 18, 36, 55, 67, 78, 87, 93, 94, 95, 96, 97, 99, 100, 103, 108, 109, 112, 113, 114]);

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function ayahLabel(match: MatchCandidate) {
  return match.ayahStart === match.ayahEnd ? `${match.surahNumber}:${match.ayahStart}` : `${match.surahNumber}:${match.ayahStart}-${match.ayahEnd}`;
}

function matchMethodLabel(method?: MatchCandidate["matchMethod"]) {
  if (method === "audio") {
    return "Audio match";
  }
  if (method === "hybrid") {
    return "Audio + text match";
  }
  return "Text match";
}

function formatBytes(bytes?: number) {
  if (!bytes) {
    return "0 KB";
  }
  return `${Math.round(bytes / 1024)} KB`;
}

export default function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [duration, setDuration] = useState(0);
  const [result, setResult] = useState<IdentifyResponse | null>(null);
  const [error, setError] = useState("");
  const [surahs, setSurahs] = useState<SurahOption[]>([]);
  const [selectedSurahs, setSelectedSurahs] = useState<number[]>([]);
  const [surahQuery, setSurahQuery] = useState("");
  const [recordingLevel, setRecordingLevel] = useState(0);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [recognitionMode, setRecognitionMode] = useState<RecognitionMode>("openai_hybrid");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentSoundRef = useRef<Audio.Sound | null>(null);
  const stoppingRef = useRef(false);

  const filteredSurahs = useMemo(() => {
    const query = surahQuery.trim().toLowerCase();
    const base = query.length > 0 ? surahs : surahs.filter((surah) => popularSurahs.has(surah.number));
    return base.filter((surah) => {
      return query.length === 0 || surah.name.toLowerCase().includes(query) || String(surah.number) === query;
    });
  }, [surahQuery, surahs]);

  const selectedLabel =
    recognitionMode === "openai_hybrid"
      ? selectedSurahs.length === 0
        ? "OpenAI transcript searches all surahs; audio verifies likely candidates"
        : `OpenAI + audio search ${selectedSurahs.length} selected surah${selectedSurahs.length === 1 ? "" : "s"}`
      : selectedSurahs.length === 0
        ? "Local Whisper searches Quran text without OpenAI"
        : `Local Whisper + audio search ${selectedSurahs.length} selected surah${selectedSurahs.length === 1 ? "" : "s"}`;

  const guidance = useMemo(() => {
    if (status === "recording") {
      return duration < 5 ? "You can stop anytime, but five seconds or more works better." : "Tap Stop when ready. Recording auto-stops at thirty seconds.";
    }
    if (status === "processing") {
      return recognitionMode === "openai_hybrid"
        ? "Transcribing with OpenAI, then comparing text and audio."
        : "Transcribing locally with Whisper, then comparing against Quran text.";
    }
    if (result?.lowConfidence) {
      return "Possible matches. Try a clearer or longer recording if these feel off.";
    }
    return "Choose recognition mode, optionally narrow the search, then record 5-30 seconds.";
  }, [duration, recognitionMode, result?.lowConfidence, status]);

  useEffect(() => {
    fetchSurahs()
      .then(setSurahs)
      .catch(() => {
        setSurahs([
          { number: 1, name: "Al-Fatihah" },
          { number: 2, name: "Al-Baqarah" },
          { number: 18, name: "Al-Kahf" },
          { number: 36, name: "Ya-Sin" },
          { number: 112, name: "Al-Ikhlas" },
          { number: 113, name: "Al-Falaq" },
          { number: 114, name: "An-Nas" }
        ]);
      });

    return () => {
      clearTimer();
      stopLevelMeter();
      stopPlayback().catch(() => undefined);
      recordingRef.current?.stopAndUnloadAsync().catch(() => undefined);
      mediaRecorderRef.current?.state === "recording" && mediaRecorderRef.current.stop();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function stopLevelMeter() {
    if (levelTimerRef.current) {
      clearInterval(levelTimerRef.current);
      levelTimerRef.current = null;
    }
    audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    setRecordingLevel(0);
  }

  function startLevelMeter(stream: MediaStream) {
    stopLevelMeter();
    const AudioContextConstructor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) {
      return;
    }

    const context = new AudioContextConstructor();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    audioContextRef.current = context;
    levelTimerRef.current = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const sample of data) {
        const normalized = (sample - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / data.length);
      setRecordingLevel(Math.min(1, rms * 8));
    }, 120);
  }

  function startTimer() {
    clearTimer();
    startedAtRef.current = Date.now();
    setDuration(0);
    timerRef.current = setInterval(() => {
      const startedAt = startedAtRef.current;
      if (!startedAt) {
        return;
      }

      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setDuration(elapsed);
      if (elapsed >= 30) {
        stopRecording().catch(() => undefined);
      }
    }, 250);
  }

  function toggleSurah(number: number) {
    setSelectedSurahs((current) => {
      if (current.includes(number)) {
        return current.filter((item) => item !== number);
      }
      return [...current, number].sort((a, b) => a - b);
    });
  }

  async function startRecording() {
    if (status === "processing") {
      return;
    }

    setError("");
    setResult(null);
    stoppingRef.current = false;

    try {
      if (Platform.OS === "web") {
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
          throw new Error("This browser does not support audio recording.");
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false,
            channelCount: 1
          }
        });
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : "";
        const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        mediaChunksRef.current = [];
        mediaStreamRef.current = stream;
        mediaRecorderRef.current = mediaRecorder;
        startLevelMeter(stream);
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            mediaChunksRef.current.push(event.data);
          }
        };
        mediaRecorder.start(500);
        setStatus("recording");
        startTimer();
        return;
      }

      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        setError("Microphone permission is required to identify recitation.");
        setStatus("error");
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true
      });

      const created = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = created.recording;
      setStatus("recording");
      startTimer();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start recording.");
      setStatus("error");
    }
  }

  async function stopRecording() {
    if (Platform.OS === "web" && mediaRecorderRef.current) {
      const mediaRecorder = mediaRecorderRef.current;
      if (stoppingRef.current || mediaRecorder.state === "inactive") {
        return;
      }

      stoppingRef.current = true;
      clearTimer();
      const startedAt = startedAtRef.current;
      if (startedAt) {
        setDuration(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)));
      }
      setStatus("processing");
      stopLevelMeter();

      try {
        const recordingBlob = await new Promise<Blob>((resolve, reject) => {
          mediaRecorder.onerror = () => reject(new Error("Browser recording failed."));
          mediaRecorder.onstop = () => {
            const type = mediaRecorder.mimeType || "audio/webm";
            resolve(new Blob(mediaChunksRef.current, { type }));
          };
          mediaRecorder.requestData();
          setTimeout(() => mediaRecorder.stop(), 100);
        });

        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        startedAtRef.current = null;

        if (recordingBlob.size <= 0) {
          throw new Error("Recording was empty. Please try again.");
        }
        if (duration >= 5 && recordingBlob.size < 12_000) {
          throw new Error("The browser captured almost no audio. Check the microphone input, use a real mic source, or play the recitation from another device near the mic.");
        }

        const identified = await identifyRecitation(recordingBlob, selectedSurahs, recognitionMode);
        setResult(identified);
        setStatus("results");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to identify this recitation.");
        setStatus("error");
      } finally {
        stoppingRef.current = false;
        mediaChunksRef.current = [];
      }
      return;
    }

    const activeRecording = recordingRef.current;
    if (!activeRecording || stoppingRef.current) {
      return;
    }

    stoppingRef.current = true;
    clearTimer();
    const startedAt = startedAtRef.current;
    if (startedAt) {
      setDuration(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)));
    }

    setStatus("processing");

    try {
      await activeRecording.stopAndUnloadAsync();
      const uri = activeRecording.getURI();
      recordingRef.current = null;
      startedAtRef.current = null;

      if (!uri) {
        throw new Error("Recording could not be saved.");
      }

      const identified = await identifyRecitation(uri, selectedSurahs, recognitionMode);
      setResult(identified);
      setStatus("results");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to identify this recitation.");
      setStatus("error");
    } finally {
      stoppingRef.current = false;
    }
  }

  async function stopPlayback() {
    const sound = currentSoundRef.current;
    currentSoundRef.current = null;
    setPlayingKey(null);
    if (sound) {
      await sound.stopAsync().catch(() => undefined);
      await sound.unloadAsync().catch(() => undefined);
    }
  }

  async function playAudio(url: string | undefined, key: string) {
    if (!url) {
      return;
    }
    if (playingKey === key) {
      await stopPlayback();
      return;
    }
    await stopPlayback();
    const sound = new Audio.Sound();
    currentSoundRef.current = sound;
    setPlayingKey(key);
    sound.setOnPlaybackStatusUpdate((playbackStatus) => {
      if (playbackStatus.isLoaded && playbackStatus.didJustFinish) {
        stopPlayback().catch(() => undefined);
      }
    });
    await sound.loadAsync({ uri: url });
    await sound.playAsync();
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>Quran Recognition</Text>
            <Text style={styles.title}>Find the surah and ayah from recitation</Text>
          </View>
          <Text style={styles.subtitle}>{guidance}</Text>
        </View>

        <View style={styles.layout}>
          <View style={styles.recorderPanel}>
            <Text style={styles.panelTitle}>Recorder</Text>
            <View style={styles.modeSwitch}>
              <Pressable
                style={[styles.modeButton, recognitionMode === "openai_hybrid" && styles.selectedModeButton]}
                onPress={() => setRecognitionMode("openai_hybrid")}
                disabled={status === "recording" || status === "processing"}
              >
                <Text style={[styles.modeButtonText, recognitionMode === "openai_hybrid" && styles.selectedModeButtonText]}>OpenAI Hybrid</Text>
              </Pressable>
              <Pressable
                style={[styles.modeButton, recognitionMode === "local_whisper" && styles.selectedModeButton]}
                onPress={() => setRecognitionMode("local_whisper")}
                disabled={status === "recording" || status === "processing"}
              >
                <Text style={[styles.modeButtonText, recognitionMode === "local_whisper" && styles.selectedModeButtonText]}>Local Whisper</Text>
              </Pressable>
            </View>
            <Text style={styles.duration}>{formatDuration(duration)}</Text>
            <Text style={styles.statusText}>{selectedLabel}</Text>
            {status === "recording" && Platform.OS === "web" ? (
              <View style={styles.levelWrap}>
                <View style={styles.levelTrack}>
                  <View style={[styles.levelFill, { width: `${Math.round(recordingLevel * 100)}%` }]} />
                </View>
                <Text style={styles.levelText}>{recordingLevel < 0.04 ? "Mic input is very low" : "Mic input detected"}</Text>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={status === "processing"}
              onPress={status === "recording" ? stopRecording : startRecording}
              style={({ pressed }) => [
                styles.recordButton,
                status === "recording" && styles.stopButton,
                (pressed || status === "processing") && styles.pressedButton
              ]}
            >
              {status === "processing" ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.recordButtonText}>{status === "recording" ? "Stop" : "Record"}</Text>
              )}
            </Pressable>
            <View style={styles.quickActions}>
              <Pressable style={styles.secondaryButton} onPress={() => setDuration(0)} disabled={status === "recording" || status === "processing"}>
                <Text style={styles.secondaryButtonText}>Reset</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => setSelectedSurahs([])} disabled={status === "processing"}>
                <Text style={styles.secondaryButtonText}>Search all</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.filterPanel}>
            <View style={styles.panelHeader}>
              <View>
                <Text style={styles.panelTitle}>Surah Filter</Text>
                <Text style={styles.helperText}>Leave empty for Quran-wide text search, or select surahs for focused audio matching.</Text>
              </View>
              {selectedSurahs.length > 0 ? <Text style={styles.filterCount}>{selectedSurahs.length}</Text> : null}
            </View>
            <TextInput
              value={surahQuery}
              onChangeText={setSurahQuery}
              placeholder="Search surah name or number"
              placeholderTextColor="#7d8884"
              style={styles.searchInput}
            />
            <View style={styles.surahGrid}>
              {filteredSurahs.map((surah) => {
                const selected = selectedSurahs.includes(surah.number);
                return (
                  <Pressable
                    key={surah.number}
                    onPress={() => toggleSurah(surah.number)}
                    style={[styles.surahChip, selected && styles.selectedSurahChip]}
                  >
                    <Text style={[styles.surahNumber, selected && styles.selectedSurahText]}>{surah.number}</Text>
                    <Text style={[styles.surahName, selected && styles.selectedSurahText]} numberOfLines={1}>
                      {surah.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        {status === "error" ? <Text style={styles.errorText}>{error}</Text> : null}

        {result ? (
          <View style={styles.results}>
            <View style={styles.resultsHeader}>
              <Text style={styles.sectionTitle}>{result.lowConfidence ? "Possible Matches" : "Top Matches"}</Text>
              <Text style={styles.transcriptText}>
                Mode: {result.recognitionMode === "local_whisper" ? "Local Whisper, no OpenAI" : "OpenAI hybrid"}
              </Text>
              <Text style={styles.transcriptText}>Transcript: {result.transcript || "No transcript returned"}</Text>
              {result.diagnostics ? (
                <View style={styles.diagnostics}>
                  <Text style={styles.diagnosticText}>
                    Audio: {formatBytes(result.diagnostics.audioFile?.bytes)} {result.diagnostics.audioFile?.mimetype || "unknown"} {result.diagnostics.audioFile?.storedExtension || ""}
                  </Text>
                  <Text style={styles.diagnosticText}>
                    Audio matcher: {result.diagnostics.audioMatcher?.queryFrames || 0} frames, {result.diagnostics.audioMatcher?.candidateCount || 0} candidates
                    {` (${result.diagnostics.audioMatcher?.successfulCandidates || 0} ok, ${result.diagnostics.audioMatcher?.failedCandidates || 0} failed)`}
                    {result.diagnostics.audioMatcher?.error ? ` - ${result.diagnostics.audioMatcher.error}` : ""}
                  </Text>
                  <Text style={styles.diagnosticText}>
                    Transcription: {result.diagnostics.transcription?.tokenCount || 0} tokens
                    {result.diagnostics.transcription?.error ? ` - ${result.diagnostics.transcription.error}` : ""}
                  </Text>
                </View>
              ) : null}
            </View>
            {result.matches.map((match) => (
              <View key={`${match.surahNumber}-${match.ayahStart}-${match.ayahEnd}`} style={styles.matchCard}>
                <View style={styles.matchHeader}>
                  <View>
                    <Text style={styles.matchTitle}>{match.surahName}</Text>
                    <Text style={styles.matchMeta}>
                      {ayahLabel(match)} - {matchMethodLabel(match.matchMethod)}
                    </Text>
                  </View>
                  <Text style={styles.confidence}>{Math.round(match.confidence * 100)}%</Text>
                </View>
                <Text style={styles.arabic}>{match.arabicText}</Text>
                <Text style={styles.translation}>{match.englishTranslation}</Text>
                <Pressable
                  style={[styles.playButton, playingKey === `${match.surahNumber}-${match.ayahStart}-${match.ayahEnd}` && styles.stopPlaybackButton]}
                  onPress={() => playAudio(match.audioUrl, `${match.surahNumber}-${match.ayahStart}-${match.ayahEnd}`)}
                >
                  <Text style={styles.playButtonText}>
                    {playingKey === `${match.surahNumber}-${match.ayahStart}-${match.ayahEnd}` ? "Stop recitation" : "Play recitation"}
                  </Text>
                </Pressable>
              </View>
            ))}
            {result.matches.length === 0 ? (
              <Text style={styles.emptyText}>No confident matches. Try a clearer 15-30 second recording, or select the likely surahs before recording.</Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f4f0e8"
  },
  content: {
    width: "100%",
    maxWidth: 1120,
    alignSelf: "center",
    padding: 24,
    gap: 22
  },
  header: {
    gap: 10,
    paddingTop: 24
  },
  kicker: {
    color: "#0f766e",
    fontSize: 14,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  title: {
    color: "#17211f",
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 40
  },
  subtitle: {
    color: "#51615d",
    fontSize: 17,
    lineHeight: 25
  },
  layout: {
    alignItems: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 18
  },
  recorderPanel: {
    flexGrow: 1,
    flexBasis: 320,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 22,
    backgroundColor: "#fffdf8",
    borderWidth: 1,
    borderColor: "#ddd3c3",
    borderRadius: 8
  },
  filterPanel: {
    flexGrow: 2,
    flexBasis: 420,
    gap: 14,
    padding: 18,
    backgroundColor: "#fffdf8",
    borderWidth: 1,
    borderColor: "#ddd3c3",
    borderRadius: 8
  },
  panelHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12
  },
  panelTitle: {
    color: "#17211f",
    fontSize: 18,
    fontWeight: "900"
  },
  helperText: {
    color: "#687773",
    fontSize: 14,
    marginTop: 3
  },
  filterCount: {
    minWidth: 32,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#0f766e",
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center"
  },
  duration: {
    color: "#17211f",
    fontSize: 58,
    fontVariant: ["tabular-nums"],
    fontWeight: "900"
  },
  statusText: {
    color: "#51615d",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center"
  },
  modeSwitch: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center"
  },
  modeButton: {
    borderWidth: 1,
    borderColor: "#cfc5b5",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: "#f8f4eb"
  },
  selectedModeButton: {
    borderColor: "#0f766e",
    backgroundColor: "#0f766e"
  },
  modeButtonText: {
    color: "#17211f",
    fontSize: 13,
    fontWeight: "900"
  },
  selectedModeButtonText: {
    color: "#fff"
  },
  levelWrap: {
    alignSelf: "stretch",
    gap: 6,
    maxWidth: 260
  },
  levelTrack: {
    height: 10,
    borderRadius: 5,
    overflow: "hidden",
    backgroundColor: "#e4dccf"
  },
  levelFill: {
    height: "100%",
    minWidth: 2,
    backgroundColor: "#0f766e"
  },
  levelText: {
    color: "#64736f",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center"
  },
  recordButton: {
    width: 150,
    height: 150,
    borderRadius: 75,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f766e",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 }
  },
  stopButton: {
    backgroundColor: "#be123c"
  },
  pressedButton: {
    opacity: 0.78
  },
  recordButtonText: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "900"
  },
  quickActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "center"
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: "#cfc5b5",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#f8f4eb"
  },
  secondaryButtonText: {
    color: "#17211f",
    fontSize: 14,
    fontWeight: "800"
  },
  searchInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: "#cfc5b5",
    borderRadius: 8,
    paddingHorizontal: 12,
    color: "#17211f",
    backgroundColor: "#fff",
    fontSize: 16
  },
  surahGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  surahChip: {
    maxWidth: 170,
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#cfc5b5",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#f8f4eb"
  },
  selectedSurahChip: {
    borderColor: "#0f766e",
    backgroundColor: "#0f766e"
  },
  surahNumber: {
    color: "#0f766e",
    fontSize: 13,
    fontWeight: "900"
  },
  surahName: {
    color: "#17211f",
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "800"
  },
  selectedSurahText: {
    color: "#fff"
  },
  errorText: {
    color: "#be123c",
    fontSize: 16,
    fontWeight: "800"
  },
  results: {
    gap: 14
  },
  resultsHeader: {
    gap: 6
  },
  sectionTitle: {
    color: "#17211f",
    fontSize: 22,
    fontWeight: "900"
  },
  transcriptText: {
    color: "#51615d",
    fontSize: 14,
    lineHeight: 20
  },
  diagnostics: {
    gap: 3,
    paddingTop: 6
  },
  diagnosticText: {
    color: "#687773",
    fontSize: 12,
    lineHeight: 17
  },
  matchCard: {
    backgroundColor: "#fffdf8",
    borderColor: "#ddd3c3",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 16
  },
  matchHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12
  },
  matchTitle: {
    color: "#17211f",
    fontSize: 20,
    fontWeight: "900"
  },
  matchMeta: {
    color: "#64736f",
    fontSize: 14,
    fontWeight: "800"
  },
  confidence: {
    color: "#0f766e",
    fontSize: 18,
    fontWeight: "900"
  },
  arabic: {
    color: "#111827",
    fontSize: 26,
    lineHeight: 46,
    textAlign: "right",
    writingDirection: "rtl"
  },
  translation: {
    color: "#42514d",
    fontSize: 16,
    lineHeight: 24
  },
  playButton: {
    alignSelf: "flex-start",
    backgroundColor: "#17211f",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  stopPlaybackButton: {
    backgroundColor: "#be123c"
  },
  playButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900"
  },
  emptyText: {
    color: "#64736f",
    fontSize: 16
  }
});
