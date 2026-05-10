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
import {
  createCheckout,
  DashboardSummary,
  fetchDashboard,
  fetchMe,
  fetchSurahs,
  identifyRecitation,
  identifyText,
  IdentifyResponse,
  login,
  logout,
  MatchCandidate,
  PublicUser,
  RecognitionMode,
  saveCorrection,
  saveMemorization,
  signup,
  SurahOption
} from "./src/api";

type Status = "idle" | "recording" | "processing" | "results" | "error";
type Section = "recognize" | "coach" | "pricing" | "privacy" | "terms";

const popularSurahs = new Set([1, 2, 18, 36, 55, 67, 78, 87, 93, 94, 95, 96, 97, 99, 100, 103, 108, 109, 112, 113, 114]);

function isHostedWeb() {
  return Platform.OS === "web" && typeof window !== "undefined" && window.location.hostname !== "localhost";
}

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
  const [section, setSection] = useState<Section>("recognize");
  const [user, setUser] = useState<PublicUser | null>(null);
  const [usage, setUsage] = useState<IdentifyResponse["usage"]>();
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [typedQuery, setTypedQuery] = useState("");
  const [savingMatchKey, setSavingMatchKey] = useState<string | null>(null);
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
  const localWhisperAvailable = !isHostedWeb();

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
      : !localWhisperAvailable
        ? "Local Whisper is disabled on free hosted web; use OpenAI Hybrid"
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
        : localWhisperAvailable
          ? "Transcribing locally with Whisper, then comparing against Quran text."
          : "Switching to OpenAI Hybrid because Local Whisper is disabled on hosted web.";
    }
    if (result?.lowConfidence) {
      return "Possible matches. Try a clearer or longer recording if these feel off.";
    }
    return "Choose recognition mode, optionally narrow the search, then record 5-30 seconds.";
  }, [duration, recognitionMode, result?.lowConfidence, status]);

  useEffect(() => {
    if (!localWhisperAvailable && recognitionMode === "local_whisper") {
      setRecognitionMode("openai_hybrid");
    }
  }, [localWhisperAvailable, recognitionMode]);

  useEffect(() => {
    fetchMe()
      .then((payload) => {
        setUser(payload.user);
        setUsage(payload.usage);
      })
      .catch(() => undefined);

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

  useEffect(() => {
    if (section === "coach" && user) {
      refreshDashboard().catch(() => undefined);
    }
  }, [section, user]);

  async function refreshDashboard() {
    const summary = await fetchDashboard();
    setDashboard(summary);
    setUsage(summary.usage);
  }

  async function submitAuth() {
    setAuthMessage("");
    try {
      const payload = authMode === "signup" ? await signup(email, password) : await login(email, password);
      setUser(payload.user);
      setUsage(payload.usage);
      setEmail("");
      setPassword("");
      setAuthMessage(authMode === "signup" ? "Account created. You can now save memorization progress." : "Signed in.");
    } catch (caught) {
      setAuthMessage(caught instanceof Error ? caught.message : "Authentication failed.");
    }
  }

  async function signOut() {
    await logout();
    setUser(null);
    setDashboard(null);
    setAuthMessage("Signed out.");
    const payload = await fetchMe().catch(() => null);
    setUsage(payload?.usage);
  }

  async function runTextSearch() {
    if (!typedQuery.trim()) {
      return;
    }
    setStatus("processing");
    setError("");
    try {
      const identified = await identifyText(typedQuery, selectedSurahs);
      setResult(identified);
      setUsage(identified.usage);
      setStatus("results");
      if (user) {
        refreshDashboard().catch(() => undefined);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to search this text.");
      setStatus("error");
    }
  }

  async function startCheckout(interval: "month" | "year") {
    if (!user) {
      setAuthMessage("Create a free account first, then choose Pro.");
      setSection("pricing");
      return;
    }
    try {
      const url = await createCheckout(interval);
      if (Platform.OS === "web") {
        window.location.href = url;
      }
    } catch (caught) {
      setAuthMessage(caught instanceof Error ? caught.message : "Stripe checkout is not configured yet.");
    }
  }

  async function saveMatch(match: MatchCandidate) {
    if (!user) {
      setAuthMessage("Create a free account to save this to your memorization coach.");
      return;
    }
    const key = `${match.surahNumber}-${match.ayahStart}-${match.ayahEnd}`;
    setSavingMatchKey(key);
    try {
      await saveMemorization(match, match.confidence < 0.45 ? "low_confidence" : "needs_review");
      await saveCorrection({ transcript: result?.transcript, verdict: "correct", actual: match });
      await refreshDashboard();
      setAuthMessage("Saved to your memorization coach.");
    } catch (caught) {
      setAuthMessage(caught instanceof Error ? caught.message : "Could not save this ayah.");
    } finally {
      setSavingMatchKey(null);
    }
  }

  async function reportWrong(match: MatchCandidate) {
    await saveCorrection({ transcript: result?.transcript, verdict: "wrong", actual: match }).catch(() => undefined);
    setAuthMessage("Thanks. That correction was saved to improve ranking later.");
  }

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

        const identified = await identifyRecitation(recordingBlob, selectedSurahs, localWhisperAvailable ? recognitionMode : "openai_hybrid");
        setResult(identified);
        setUsage(identified.usage);
        setStatus("results");
        if (user) {
          refreshDashboard().catch(() => undefined);
        }
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

      const identified = await identifyRecitation(uri, selectedSurahs, localWhisperAvailable ? recognitionMode : "openai_hybrid");
      setResult(identified);
      setUsage(identified.usage);
      setStatus("results");
      if (user) {
        refreshDashboard().catch(() => undefined);
      }
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
        <View style={styles.topNav}>
          <Text style={styles.brand}>Ayah Finder</Text>
          <View style={styles.navLinks}>
            {(["recognize", "coach", "pricing", "privacy", "terms"] as Section[]).map((item) => (
              <Pressable key={item} onPress={() => setSection(item)} style={[styles.navButton, section === item && styles.activeNavButton]}>
                <Text style={[styles.navButtonText, section === item && styles.activeNavButtonText]}>
                  {item === "recognize" ? "Recognize" : item === "coach" ? "Coach" : item === "pricing" ? "Pricing" : item === "privacy" ? "Privacy" : "Terms"}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.accountPanel}>
          <View style={styles.accountSummary}>
            <Text style={styles.accountTitle}>{user ? `Signed in as ${user.email}` : "Free Quran recognition"}</Text>
            <Text style={styles.accountMeta}>
              {usage
                ? `${usage.remaining} of ${usage.limit} ${usage.period === "day" ? "daily" : "monthly"} recognitions remaining (${usage.plan.replace("_", " ")})`
                : "Create an account to save history and memorization progress."}
            </Text>
          </View>
          {user ? (
            <Pressable style={styles.secondaryButton} onPress={signOut}>
              <Text style={styles.secondaryButtonText}>Sign out</Text>
            </Pressable>
          ) : (
            <View style={styles.authForm}>
              <TextInput value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor="#7d8884" style={styles.authInput} autoCapitalize="none" />
              <TextInput value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor="#7d8884" style={styles.authInput} secureTextEntry />
              <Pressable style={styles.primarySmallButton} onPress={submitAuth}>
                <Text style={styles.primarySmallButtonText}>{authMode === "signup" ? "Create account" : "Sign in"}</Text>
              </Pressable>
              <Pressable onPress={() => setAuthMode(authMode === "signup" ? "login" : "signup")}>
                <Text style={styles.linkText}>{authMode === "signup" ? "I already have an account" : "Create a new account"}</Text>
              </Pressable>
            </View>
          )}
        </View>
        {authMessage ? <Text style={styles.noticeText}>{authMessage}</Text> : null}

        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>Quran Recognition</Text>
            <Text style={styles.title}>Find the surah and ayah from recitation</Text>
          </View>
          <Text style={styles.subtitle}>{guidance}</Text>
        </View>

        {section === "pricing" ? (
          <View style={styles.pricingGrid}>
            <View style={styles.pricingCard}>
              <Text style={styles.matchTitle}>Free</Text>
              <Text style={styles.priceText}>$0</Text>
              <Text style={styles.translation}>Limited daily recognition, Quran text matches, translations, and playback.</Text>
              <Pressable style={styles.secondaryButton} onPress={() => setSection("recognize")}>
                <Text style={styles.secondaryButtonText}>Start free</Text>
              </Pressable>
            </View>
            <View style={[styles.pricingCard, styles.featuredPricingCard]}>
              <Text style={styles.matchTitle}>Support + Pro</Text>
              <Text style={styles.priceText}>$2.99/mo</Text>
              <Text style={styles.translation}>Higher limits, saved history, memorization coach, weak ayah tracking, and progress dashboard.</Text>
              <Pressable style={styles.playButton} onPress={() => startCheckout("month")}>
                <Text style={styles.playButtonText}>Upgrade monthly</Text>
              </Pressable>
            </View>
            <View style={styles.pricingCard}>
              <Text style={styles.matchTitle}>Annual Pro</Text>
              <Text style={styles.priceText}>$24.99/yr</Text>
              <Text style={styles.translation}>Best value for steady memorization practice and supporting continued development.</Text>
              <Pressable style={styles.playButton} onPress={() => startCheckout("year")}>
                <Text style={styles.playButtonText}>Upgrade yearly</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {section === "coach" ? (
          <View style={styles.results}>
            <Text style={styles.sectionTitle}>Memorization Coach</Text>
            {!user ? <Text style={styles.emptyText}>Create a free account to save ayahs, track weak spots, and build a review list.</Text> : null}
            {user ? (
              <View style={styles.statsGrid}>
                <View style={styles.statBox}>
                  <Text style={styles.confidence}>{dashboard?.stats.totalRecognitions || 0}</Text>
                  <Text style={styles.matchMeta}>Saved sessions</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.confidence}>{dashboard?.stats.dueReviews || 0}</Text>
                  <Text style={styles.matchMeta}>Due reviews</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.confidence}>{dashboard?.stats.weakAyahs || 0}</Text>
                  <Text style={styles.matchMeta}>Weak ayahs</Text>
                </View>
              </View>
            ) : null}
            {dashboard?.memorization.map((item) => (
              <View key={item.id} style={styles.matchCard}>
                <Text style={styles.matchTitle}>{item.surahName}</Text>
                <Text style={styles.matchMeta}>{item.surahNumber}:{item.ayahStart === item.ayahEnd ? item.ayahStart : `${item.ayahStart}-${item.ayahEnd}`} - {item.status.replace("_", " ")}</Text>
              </View>
            ))}
            {user && dashboard?.memorization.length === 0 ? <Text style={styles.emptyText}>Save an ayah from a recognition result to start your review list.</Text> : null}
          </View>
        ) : null}

        {section === "privacy" ? (
          <View style={styles.legalPanel}>
            <Text style={styles.sectionTitle}>Privacy</Text>
            <Text style={styles.translation}>Recordings are uploaded only for recognition and deleted after processing. If you create an account, we store your email, plan, usage, saved history, memorization items, and correction feedback. OpenAI may process audio in OpenAI Hybrid mode. DeepSeek may process text if transcript cleanup is enabled.</Text>
          </View>
        ) : null}

        {section === "terms" ? (
          <View style={styles.legalPanel}>
            <Text style={styles.sectionTitle}>Terms</Text>
            <Text style={styles.translation}>This service provides ranked possible Quran matches and memorization tools. Results may be inaccurate and should not be treated as religious authority. Do not abuse the service, overload the API, or represent its output as guaranteed.</Text>
          </View>
        ) : null}

        {section === "recognize" ? (
          <>
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
                style={[styles.modeButton, recognitionMode === "local_whisper" && styles.selectedModeButton, !localWhisperAvailable && styles.disabledModeButton]}
                onPress={() => localWhisperAvailable && setRecognitionMode("local_whisper")}
                disabled={status === "recording" || status === "processing" || !localWhisperAvailable}
              >
                <Text style={[styles.modeButtonText, recognitionMode === "local_whisper" && styles.selectedModeButtonText, !localWhisperAvailable && styles.disabledModeButtonText]}>
                  {localWhisperAvailable ? "Local Whisper" : "Local Whisper (local)"}
                </Text>
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

        <View style={styles.textSearchPanel}>
          <Text style={styles.panelTitle}>Typed Arabic Search</Text>
          <Text style={styles.helperText}>Paste Arabic words you remember and search the same Quran matcher without recording.</Text>
          <TextInput
            value={typedQuery}
            onChangeText={setTypedQuery}
            placeholder="اكتب كلمات من الآية هنا"
            placeholderTextColor="#7d8884"
            style={[styles.searchInput, styles.textArea]}
            multiline
          />
          <Pressable style={styles.playButton} onPress={runTextSearch}>
            <Text style={styles.playButtonText}>Search text</Text>
          </Pressable>
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
                <View style={styles.resultActions}>
                  <Pressable style={styles.secondaryButton} onPress={() => saveMatch(match)}>
                    <Text style={styles.secondaryButtonText}>{savingMatchKey === `${match.surahNumber}-${match.ayahStart}-${match.ayahEnd}` ? "Saving..." : "Save to coach"}</Text>
                  </Pressable>
                  <Pressable style={styles.secondaryButton} onPress={() => reportWrong(match)}>
                    <Text style={styles.secondaryButtonText}>Wrong match</Text>
                  </Pressable>
                </View>
              </View>
            ))}
            {result.matches.length === 0 ? (
              <Text style={styles.emptyText}>No confident matches. Try a clearer 15-30 second recording, or select the likely surahs before recording.</Text>
            ) : null}
          </View>
        ) : null}
          </>
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
  topNav: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 12,
    paddingTop: 14
  },
  brand: {
    color: "#0f766e",
    fontSize: 20,
    fontWeight: "900"
  },
  navLinks: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  navButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd3c3",
    paddingHorizontal: 11,
    paddingVertical: 8,
    backgroundColor: "#fffdf8"
  },
  activeNavButton: {
    borderColor: "#0f766e",
    backgroundColor: "#0f766e"
  },
  navButtonText: {
    color: "#17211f",
    fontSize: 13,
    fontWeight: "800"
  },
  activeNavButtonText: {
    color: "#fff"
  },
  accountPanel: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 12,
    backgroundColor: "#fffdf8",
    borderWidth: 1,
    borderColor: "#ddd3c3",
    borderRadius: 8,
    padding: 14
  },
  accountSummary: {
    flexShrink: 1,
    gap: 4
  },
  accountTitle: {
    color: "#17211f",
    fontSize: 16,
    fontWeight: "900"
  },
  accountMeta: {
    color: "#64736f",
    fontSize: 13,
    fontWeight: "700"
  },
  authForm: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  authInput: {
    minHeight: 40,
    minWidth: 170,
    borderWidth: 1,
    borderColor: "#cfc5b5",
    borderRadius: 8,
    paddingHorizontal: 10,
    color: "#17211f",
    backgroundColor: "#fff",
    fontSize: 14
  },
  primarySmallButton: {
    borderRadius: 8,
    backgroundColor: "#0f766e",
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  primarySmallButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "900"
  },
  linkText: {
    color: "#0f766e",
    fontSize: 13,
    fontWeight: "900"
  },
  noticeText: {
    color: "#0f766e",
    fontSize: 14,
    fontWeight: "800"
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
  textSearchPanel: {
    gap: 12,
    padding: 18,
    backgroundColor: "#fffdf8",
    borderWidth: 1,
    borderColor: "#ddd3c3",
    borderRadius: 8
  },
  textArea: {
    minHeight: 90,
    textAlignVertical: "top",
    writingDirection: "rtl"
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
  disabledModeButton: {
    opacity: 0.48
  },
  modeButtonText: {
    color: "#17211f",
    fontSize: 13,
    fontWeight: "900"
  },
  selectedModeButtonText: {
    color: "#fff"
  },
  disabledModeButtonText: {
    color: "#64736f"
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
  pricingGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14
  },
  pricingCard: {
    flexGrow: 1,
    flexBasis: 260,
    gap: 12,
    padding: 18,
    backgroundColor: "#fffdf8",
    borderWidth: 1,
    borderColor: "#ddd3c3",
    borderRadius: 8
  },
  featuredPricingCard: {
    borderColor: "#0f766e"
  },
  priceText: {
    color: "#0f766e",
    fontSize: 30,
    fontWeight: "900"
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12
  },
  statBox: {
    flexGrow: 1,
    flexBasis: 160,
    padding: 14,
    backgroundColor: "#fffdf8",
    borderWidth: 1,
    borderColor: "#ddd3c3",
    borderRadius: 8
  },
  legalPanel: {
    gap: 12,
    padding: 18,
    backgroundColor: "#fffdf8",
    borderWidth: 1,
    borderColor: "#ddd3c3",
    borderRadius: 8
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
  resultActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  emptyText: {
    color: "#64736f",
    fontSize: 16
  }
});
