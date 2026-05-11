import { Audio } from "expo-av";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
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
  evaluateTajweed,
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
  SurahOption,
  TajweedEvaluationResponse
} from "./src/api";

type Status = "idle" | "recording" | "processing" | "results" | "error";
type Section = "recognize" | "tajweed" | "rules" | "coach" | "pricing" | "privacy" | "terms";

const popularSurahs = new Set([1, 2, 18, 36, 55, 67, 78, 87, 93, 94, 95, 96, 97, 99, 100, 103, 108, 109, 112, 113, 114]);
const ruleDetails: Record<string, { short: string; detail: string; practice: string }> = {
  Madd: {
    short: "Lengthen a long vowel for its proper count.",
    detail: "Madd happens when a long-vowel letter or madd sign requires extension. The basic natural madd is usually two counts, while connected and required madd can be longer depending on the rule and recitation style.",
    practice: "Open the vowel cleanly, keep the sound steady, count with your fingers, and avoid changing pitch or adding a new vowel."
  },
  Ghunnah: {
    short: "A nasal sound, usually held for about two counts.",
    detail: "Ghunnah is the nasal resonance of noon and meem, especially when they have shaddah or appear in rules like ikhfa, idgham with ghunnah, and iqlab.",
    practice: "Close or place the mouth for the letter, let the sound resonate through the nose, and keep it smooth without humming too loudly."
  },
  Qalqalah: {
    short: "A light echo on ق ط ب ج د when sakin or stopped on.",
    detail: "Qalqalah prevents certain stopped consonants from becoming dead or swallowed. It is a bounce, not a full extra vowel.",
    practice: "Pronounce the consonant firmly, release it lightly, and stop before it turns into ba-a, da-a, or qa-a."
  },
  "Lam Shamsiyyah": {
    short: "The lam of ال is not pronounced before sun letters.",
    detail: "With sun letters, the lam in the definite article assimilates into the next letter, which carries shaddah.",
    practice: "Skip the lam sound and move directly into the doubled sun letter, like ash-shams rather than al-shams."
  },
  "Heavy Lam": {
    short: "The lam in Allah is heavy after fathah or dammah.",
    detail: "The word Allah has a special lam. It is heavy after a fatḥah or ḍammah and light after kasrah.",
    practice: "Raise the back of the tongue slightly for the heavy lam, but do not make it sound like a separate thick vowel."
  },
  Tafkheem: {
    short: "Heavy letters are pronounced with fullness.",
    detail: "Letters like خ ص ض غ ط ظ ق have tafkheem. They should not be flattened into their light-letter equivalents.",
    practice: "Lift the back of the tongue and keep the sound broad while preserving the exact letter."
  },
  Ikhfa: {
    short: "Hide noon sakin/tanween with nasalization.",
    detail: "Ikhfa occurs when noon sakin or tanween is followed by one of the ikhfa letters. The noon is neither fully clear nor fully merged.",
    practice: "Prepare for the next letter, keep a nasal sound for about two counts, then release into the next letter."
  },
  Idgham: {
    short: "Merge noon sakin/tanween into the next letter.",
    detail: "Idgham occurs before ي ر م ل و ن. Some forms have ghunnah and some do not, depending on the letter.",
    practice: "Do not pronounce a separate noon. Move into the next letter smoothly, adding ghunnah when required."
  },
  Iqlab: {
    short: "Turn noon/tanween toward meem before ب.",
    detail: "Iqlab happens when noon sakin or tanween comes before ba. The sound changes toward meem with nasalization.",
    practice: "Lightly close the lips for a hidden meem sound, hold the nasalization, then pronounce ba."
  },
  "Ikhfa Shafawi": {
    short: "Hide meem sakin before ب.",
    detail: "When meem sakin comes before ba, the meem is hidden with nasalization.",
    practice: "Bring the lips close without a hard closure, hold the nasal sound, then say ba."
  },
  "Idgham Shafawi": {
    short: "Merge meem sakin into another meem.",
    detail: "When meem sakin is followed by meem, the two merge with ghunnah.",
    practice: "Do not pronounce two separate meems. Hold the merged meem with nasal resonance."
  },
  "Hamzah clarity": {
    short: "Make hamzah distinct and clean.",
    detail: "Hamzah is a glottal stop and is often swallowed by beginners. It must be articulated clearly from the throat.",
    practice: "Pause the airflow gently at the throat and release without over-tightening."
  }
};

const ruleGuideContent: Record<
  string,
  { short: string; detail: string; practice: string; example: string; mouth: string; commonMistake: string; drill: string }
> = {
  Madd: {
    short: "Lengthen a long vowel for its proper count.",
    detail:
      "Madd is elongation. It appears when a long-vowel letter or madd sign requires the sound to be held. Natural madd is usually two counts, while connected, separated, necessary, and stop-based madd can be longer depending on the recitation style.",
    practice: "Open the vowel cleanly, keep the sound steady, count with your fingers, and avoid changing pitch or adding a new vowel.",
    example: "مَالِكِ، الضَّالِّينَ",
    mouth: "Keep the vowel open and stable. Do not squeeze the throat or pulse the voice during the held sound.",
    commonMistake: "Clipping the long vowel too short, or turning one held vowel into two separate sounds.",
    drill: "Say مَا for two calm counts, then مَالِكِ, then the full phrase without changing speed."
  },
  Ghunnah: {
    short: "A nasal sound, usually held for about two counts.",
    detail:
      "Ghunnah is nasal resonance carried by noon and meem. It is strongest on noon or meem with shaddah, and also appears in ikhfa, idgham with ghunnah, iqlab, ikhfa shafawi, and idgham shafawi.",
    practice: "Close or place the mouth for the letter, let the sound resonate through the nose, and keep it smooth without humming too loudly.",
    example: "إِنَّ، ثُمَّ، مَنْ يَقُولُ",
    mouth: "Let the air resonate through the nose while the tongue or lips prepare for the next letter.",
    commonMistake: "Making it too short, making it theatrical and too loud, or adding a vowel after it.",
    drill: "Hold نّ for two counts, then مّ for two counts, then recite إِنَّ and ثُمَّ slowly."
  },
  Qalqalah: {
    short: "A light echo on ق ط ب ج د when sakin or stopped on.",
    detail:
      "Qalqalah is a controlled bounce on ق ط ب ج د when the letter is sakin or when you stop on it. The goal is to make the consonant clear without adding a full vowel after it.",
    practice: "Pronounce the consonant firmly, release it lightly, and stop before it turns into ba-a, da-a, or qa-a.",
    example: "أَحَدْ، يَجْعَلْ، قَدْ",
    mouth: "Make the letter's makhraj firmly, then release a small echo from the same place.",
    commonMistake: "Turning the echo into a new vowel, or swallowing the letter with no bounce.",
    drill: "Practice أَدْ، أَبْ، أَقْ with a tiny release, then use the real Quran word."
  },
  "Lam Shamsiyyah": {
    short: "The lam of ال is not pronounced before sun letters.",
    detail: "With sun letters, the lam in the definite article assimilates into the next letter, which carries shaddah.",
    practice: "Skip the lam sound and move directly into the doubled sun letter, like ash-shams rather than al-shams.",
    example: "الشَّمْس، الرَّحْمَٰن، الصِّرَاط",
    mouth: "Move from the vowel before ال straight into the doubled sun letter.",
    commonMistake: "Pronouncing a clear lam before the sun letter.",
    drill: "Say أَشْ, then الشَّمْس. Feel that the lam disappears into the ش."
  },
  "Heavy Lam": {
    short: "The lam in Allah is heavy after fathah or dammah.",
    detail: "The word Allah has a special lam. It is heavy after a fathah or dammah and light after kasrah.",
    practice: "Raise the back of the tongue slightly for the heavy lam, but do not make it sound like a separate thick vowel.",
    example: "قَالَ اللَّهُ، رَسُولُ اللَّهِ، بِاللَّهِ",
    mouth: "The tongue tip still touches for lam, while the back of the tongue lifts slightly for heaviness.",
    commonMistake: "Making every Allah lam heavy, even after kasrah, or making it sound like a different letter.",
    drill: "Alternate بِاللَّهِ and قَالَ اللَّهُ to feel light lam versus heavy lam."
  },
  Tafkheem: {
    short: "Heavy letters are pronounced with fullness.",
    detail: "Letters like خ ص ض غ ط ظ ق have tafkheem. They should not be flattened into their light-letter equivalents.",
    practice: "Lift the back of the tongue and keep the sound broad while preserving the exact letter.",
    example: "صِرَاط، ضَالِّين، قُلْ",
    mouth: "Keep the back of the tongue raised and the sound full, while the exact articulation point stays correct.",
    commonMistake: "Making ص sound like س, ط like ت, or ق like ك.",
    drill: "Compare سَ / صَ and تَ / طَ slowly, then recite the Quran word."
  },
  Ikhfa: {
    short: "Hide noon sakin/tanween with nasalization.",
    detail: "Ikhfa occurs when noon sakin or tanween is followed by one of the ikhfa letters. The noon is neither fully clear nor fully merged.",
    practice: "Prepare for the next letter, keep a nasal sound for about two counts, then release into the next letter.",
    example: "مِنْ قَبْل، أَنْ صَدُّوكُمْ",
    mouth: "Shape toward the next letter while keeping nasal sound through the nose.",
    commonMistake: "Saying a full clear noon, or deleting the nasal sound completely.",
    drill: "Hold the nasal sound before ق or ص, then release gently into the next letter."
  },
  Idgham: {
    short: "Merge noon sakin/tanween into the next letter.",
    detail: "Idgham occurs before ي ر م ل و ن. Some forms have ghunnah and some do not, depending on the letter.",
    practice: "Do not pronounce a separate noon. Move into the next letter smoothly, adding ghunnah when required.",
    example: "مَنْ يَقُولُ، هُدًى لِّلْمُتَّقِينَ",
    mouth: "Let the noon/tanween disappear into the next letter instead of striking a separate ن.",
    commonMistake: "Pronouncing an extra noon before the merged letter.",
    drill: "Say مَي rather than مَنْ يَ for idgham with ي, while preserving ghunnah."
  },
  Iqlab: {
    short: "Turn noon/tanween toward meem before ب.",
    detail: "Iqlab happens when noon sakin or tanween comes before ba. The sound changes toward meem with nasalization.",
    practice: "Lightly close the lips for a hidden meem sound, hold the nasalization, then pronounce ba.",
    example: "مِنْ بَعْدِ، سَمِيعٌ بَصِير",
    mouth: "Bring the lips together lightly for the hidden meem, then open into ب.",
    commonMistake: "Leaving a clear ن before ب, or closing the lips too hard.",
    drill: "Say مِمْ بَعْدِ softly, then smooth it into مِنْ بَعْدِ."
  },
  "Ikhfa Shafawi": {
    short: "Hide meem sakin before ب.",
    detail: "When meem sakin comes before ba, the meem is hidden with nasalization.",
    practice: "Bring the lips close without a hard closure, hold the nasal sound, then say ba.",
    example: "تَرْمِيهِمْ بِحِجَارَة",
    mouth: "The lips come close with softness, nasal sound continues, then ب is pronounced.",
    commonMistake: "Snapping the lips shut too hard or skipping the nasal hold.",
    drill: "Practice هُمْ بِ slowly, then place it back in the ayah."
  },
  "Idgham Shafawi": {
    short: "Merge meem sakin into another meem.",
    detail: "When meem sakin is followed by meem, the two merge with ghunnah.",
    practice: "Do not pronounce two separate meems. Hold the merged meem with nasal resonance.",
    example: "لَهُمْ مَّا",
    mouth: "Close the lips for one held meem with nasal resonance.",
    commonMistake: "Separating the two meems or dropping the ghunnah.",
    drill: "Hold مّ for two counts, then recite لَهُمْ مَّا."
  },
  "Hamzah clarity": {
    short: "Make hamzah distinct and clean.",
    detail: "Hamzah is a glottal stop and is often swallowed by beginners. It must be articulated clearly from the throat.",
    practice: "Pause the airflow gently at the throat and release without over-tightening.",
    example: "أَنْعَمْتَ، إِيَّاكَ، السَّمَاء",
    mouth: "The sound starts with a clean throat closure and release, not from the tongue or lips.",
    commonMistake: "Smoothing hamzah until it disappears, especially at the start of words.",
    drill: "Practice أَ، إِ، أُ as clean starts, then recite the full word."
  }
};

function ruleInfo(rule: string) {
  return ruleGuideContent[rule] || {
    short: ruleDetails[rule]?.short || "Review this tajweed rule with a qualified teacher.",
    detail: ruleDetails[rule]?.detail || "This rule was detected near one of the highlighted words.",
    practice: ruleDetails[rule]?.practice || "Practice slowly, then record the same ayah again.",
    example: "",
    mouth: "Focus on the letter's correct articulation point and timing.",
    commonMistake: "Rushing the word or changing the letter while trying to apply the rule.",
    drill: "Repeat the marked word alone, then repeat it inside the full ayah."
  };
}

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

function normalizeSurahSearch(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/surah|sura|sorat|surat|chapter/g, "")
    .replace(/['`’‘ʿ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function squeezeVowels(value: string) {
  return value.replace(/aa+/g, "a").replace(/ee+/g, "i").replace(/ii+/g, "i").replace(/oo+/g, "u").replace(/uu+/g, "u");
}

const surahAliases: Record<number, string[]> = {
  1: ["fatiha", "fatihah", "faatihah", "alhamd"],
  2: ["baqara", "baqarah", "bakara", "bakarah"],
  3: ["imran", "aalimran", "alimran"],
  4: ["nisa", "nisaa", "women"],
  5: ["maidah", "maida", "mayidah"],
  6: ["anam", "anaam"],
  7: ["araf", "araaf"],
  8: ["anfal"],
  9: ["tawbah", "taubah", "baraah"],
  10: ["yunus", "younus"],
  11: ["hud", "hood"],
  12: ["yusuf", "yousuf", "yoosuf"],
  13: ["rad", "raad"],
  14: ["ibrahim", "ebraheem"],
  15: ["hijr"],
  16: ["nahl"],
  17: ["isra", "israa", "baniisrail"],
  18: ["kahf"],
  19: ["maryam", "mariam"],
  20: ["taha", "ta ha"],
  21: ["anbiya", "anbiyaa"],
  22: ["hajj", "haj"],
  23: ["muminoon", "muminun"],
  24: ["nur", "noor"],
  25: ["furqan"],
  26: ["shuara", "shuaraa"],
  27: ["naml"],
  28: ["qasas", "kasas"],
  29: ["ankabut", "ankaboot"],
  30: ["rum", "room"],
  31: ["luqman", "lukman"],
  32: ["sajdah", "sajda"],
  33: ["ahzab"],
  34: ["saba"],
  35: ["fatir", "faatir"],
  36: ["yasin", "ya seen", "yaa seen"],
  37: ["saffat", "saaffat"],
  38: ["sad", "saad"],
  39: ["zumar"],
  40: ["ghafir", "mumin"],
  41: ["fussilat", "fusilat"],
  42: ["shura", "shoora"],
  43: ["zukhruf"],
  44: ["dukhan", "dukhon"],
  45: ["jathiyah", "jathiya"],
  46: ["ahqaf"],
  47: ["muhammad", "mohammad"],
  48: ["fath", "fat-h"],
  49: ["hujurat"],
  50: ["qaf", "qaaf"],
  51: ["dhariyat", "zariyat"],
  52: ["tur", "toor"],
  53: ["najm"],
  54: ["qamar", "kamar"],
  55: ["rahman", "rahmaan"],
  56: ["waqiah", "waqia"],
  57: ["hadid", "hadeed"],
  58: ["mujadilah", "mujadila"],
  59: ["hashr"],
  60: ["mumtahina", "mumtahanah"],
  61: ["saff", "saf"],
  62: ["jumuah", "jumua"],
  63: ["munafiqun", "munafiqoon"],
  64: ["taghabun", "taghaboon"],
  65: ["talaq", "talak"],
  66: ["tahrim"],
  67: ["mulk"],
  68: ["qalam", "kalam"],
  69: ["haqqah", "haaqqa"],
  70: ["maarij", "ma'arij"],
  71: ["nuh", "nooh"],
  72: ["jinn"],
  73: ["muzzammil"],
  74: ["muddathir"],
  75: ["qiyamah", "qiyama"],
  76: ["insan", "dahr"],
  77: ["mursalat"],
  78: ["naba", "nabaa"],
  79: ["naziat", "naaziat"],
  80: ["abasa"],
  81: ["takwir"],
  82: ["infitar"],
  83: ["mutaffifin"],
  84: ["inshiqaq"],
  85: ["buruj", "burooj"],
  86: ["tariq", "taariq"],
  87: ["ala", "a'la", "alaa"],
  88: ["ghashiyah", "ghashiya"],
  89: ["fajr"],
  90: ["balad"],
  91: ["shams"],
  92: ["layl", "lail"],
  93: ["duha", "dhuha"],
  94: ["sharh", "inshirah"],
  95: ["tin", "teen"],
  96: ["alaq"],
  97: ["qadr", "kadr"],
  98: ["bayyinah", "bayyina"],
  99: ["zalzalah", "zilzal"],
  100: ["adiyat", "aadiyat"],
  101: ["qariah", "qaria"],
  102: ["takathur"],
  103: ["asr"],
  104: ["humazah"],
  105: ["fil", "feel"],
  106: ["quraysh", "quraish"],
  107: ["maun", "maoon"],
  108: ["kawthar", "kauthar"],
  109: ["kafirun", "kafiroon"],
  110: ["nasr"],
  111: ["masad", "lahab"],
  112: ["ikhlas", "ikhlaas"],
  113: ["falaq", "falak"],
  114: ["nas", "naas"]
};

function surahMatchesQuery(surah: SurahOption, query: string) {
  const raw = query.trim();
  if (!raw) {
    return true;
  }
  if (String(surah.number) === raw) {
    return true;
  }
  const queryForms = new Set([normalizeSurahSearch(raw), squeezeVowels(normalizeSurahSearch(raw))]);
  const names = [surah.name, ...(surahAliases[surah.number] || [])];
  const candidateForms = new Set<string>();
  for (const name of names) {
    const normalized = normalizeSurahSearch(name);
    const withoutArticle = normalized.replace(/^(al|el|ar|as|ash|an|at|az|ad|ath|adh)/, "");
    candidateForms.add(normalized);
    candidateForms.add(withoutArticle);
    candidateForms.add(squeezeVowels(normalized));
    candidateForms.add(squeezeVowels(withoutArticle));
    candidateForms.add(normalized.replace(/q/g, "k"));
    candidateForms.add(normalized.replace(/kh/g, "x"));
  }
  return [...queryForms].some((queryForm) =>
    [...candidateForms].some((candidate) => candidate.includes(queryForm) || (queryForm.length >= 4 && queryForm.includes(candidate)))
  );
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [tajweedResult, setTajweedResult] = useState<TajweedEvaluationResponse | null>(null);
  const [tajweedSurah, setTajweedSurah] = useState("1");
  const [tajweedAyahStart, setTajweedAyahStart] = useState("1");
  const [tajweedAyahEnd, setTajweedAyahEnd] = useState("");
  const [ruleTooltip, setRuleTooltip] = useState<{ rule: string; text: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ruleHoverRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    const query = surahQuery.trim();
    const base = query.length > 0 ? surahs : surahs.filter((surah) => popularSurahs.has(surah.number));
    return base.filter((surah) => surahMatchesQuery(surah, query));
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
    return "Record 15-30 seconds. If you know the surah, pick it first to make unclear recitation easier to identify.";
  }, [duration, recognitionMode, result?.lowConfidence, status]);

  const tajweedInfographicUri = useMemo(() => {
    if (!tajweedResult?.infographicSvg) {
      return undefined;
    }
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(tajweedResult.infographicSvg)}`;
  }, [tajweedResult?.infographicSvg]);

  const tajweedTargetLabel = useMemo(() => {
    const surahNumber = Number(tajweedSurah);
    const surah = surahs.find((item) => item.number === surahNumber);
    const start = Number(tajweedAyahStart) || 1;
    const hasEnd = tajweedAyahEnd.trim().length > 0;
    const end = hasEnd ? Number(tajweedAyahEnd) || start : start;
    const ayahRange = hasEnd ? (start === end ? String(start) : `${start}-${end}`) : `${start}+`;
    return `${surah?.name || `Surah ${surahNumber || 1}`} ${ayahRange}`;
  }, [surahs, tajweedAyahEnd, tajweedAyahStart, tajweedSurah]);

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
    if ((section === "coach" || section === "tajweed") && user) {
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

  function setTajweedSurahFromChip(number: number) {
    setTajweedSurah(String(number));
    setSelectedSurahs([number]);
    setSurahQuery("");
  }

  function showRuleTooltip(rule: string) {
    if (ruleHoverRef.current) {
      clearTimeout(ruleHoverRef.current);
    }
    ruleHoverRef.current = setTimeout(() => {
      const info = ruleInfo(rule);
      setRuleTooltip({ rule, text: `${info.short} ${info.practice}` });
    }, 1000);
  }

  function hideRuleTooltip() {
    if (ruleHoverRef.current) {
      clearTimeout(ruleHoverRef.current);
      ruleHoverRef.current = null;
    }
    setRuleTooltip(null);
  }

  function tajweedTarget() {
    const surahNumber = Number(tajweedSurah);
    const ayahStart = Number(tajweedAyahStart);
    const ayahEnd = tajweedAyahEnd.trim().length > 0 ? Number(tajweedAyahEnd) : undefined;
    if (!Number.isInteger(surahNumber) || surahNumber < 1 || surahNumber > 114) {
      throw new Error("Choose a valid surah number for Tajweed Practice.");
    }
    if (!Number.isInteger(ayahStart) || ayahStart < 1 || (ayahEnd !== undefined && (!Number.isInteger(ayahEnd) || ayahEnd < ayahStart))) {
      throw new Error("Choose a valid ayah range for Tajweed Practice.");
    }
    return { surahNumber, ayahStart, ayahEnd };
  }

  async function processRecording(recording: Blob | string) {
    if (section === "tajweed") {
      const evaluated = await evaluateTajweed(recording, tajweedTarget(), localWhisperAvailable ? recognitionMode : "openai_hybrid");
      setTajweedResult(evaluated);
      setResult(null);
      setUsage(evaluated.usage);
      setStatus("results");
      if (user) {
        refreshDashboard().catch(() => undefined);
      }
      return;
    }

    const identified = await identifyRecitation(recording, selectedSurahs, localWhisperAvailable ? recognitionMode : "openai_hybrid");
    setResult(identified);
    setTajweedResult(null);
    setUsage(identified.usage);
    setStatus("results");
    if (user) {
      refreshDashboard().catch(() => undefined);
    }
  }

  async function startRecording() {
    if (status === "processing") {
      return;
    }

    setError("");
    setResult(null);
    setTajweedResult(null);
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

        await processRecording(recordingBlob);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : section === "tajweed" ? "Unable to evaluate this practice recording." : "Unable to identify this recitation.");
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

      await processRecording(uri);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : section === "tajweed" ? "Unable to evaluate this practice recording." : "Unable to identify this recitation.");
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
            {(["recognize", "tajweed", "rules", "coach", "pricing", "privacy", "terms"] as Section[]).map((item) => (
              <Pressable key={item} onPress={() => setSection(item)} style={[styles.navButton, section === item && styles.activeNavButton]}>
                <Text style={[styles.navButtonText, section === item && styles.activeNavButtonText]}>
                  {item === "recognize"
                    ? "Recognize"
                    : item === "tajweed"
                      ? "Tajweed"
                      : item === "rules"
                        ? "Rules"
                        : item === "coach"
                          ? "Coach"
                          : item === "pricing"
                            ? "Pricing"
                            : item === "privacy"
                              ? "Privacy"
                              : "Terms"}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.accountPanel}>
          <View style={styles.accountSummary}>
            <Text style={styles.accountTitle}>{user ? `Signed in as ${user.email}` : "Free Quran recognition"}</Text>
            <Text style={styles.accountMeta}>
              {user?.isAdmin || usage?.isUnlimited
                ? `Admin mode: unlimited recognitions${usage ? ` (${usage.used} used this ${usage.period})` : ""}`
                : usage
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
            <Text style={styles.title}>Recite, humbly narrow it down, and find the ayah</Text>
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

        {section === "rules" ? (
          <View style={styles.rulesPage}>
            <View style={styles.legalPanel}>
              <Text style={styles.kicker}>Tajweed Guide</Text>
              <Text style={styles.sectionTitle}>Rules, pronunciation, and practice drills</Text>
              <Text style={styles.translation}>
                This guide explains the rules the checker can highlight. Use it as a study aid beside a teacher: the app can spot likely word, timing, and rule issues, but a qualified teacher is still the best source for exact makhraj and tajweed correction.
              </Text>
            </View>
            {Object.entries(ruleGuideContent).map(([rule, info]) => (
              <View key={rule} style={styles.ruleGuideCard}>
                <View style={styles.ruleGuideHeader}>
                  <View style={styles.visualPanel}>
                    <View style={styles.mouthDiagram}>
                      <View style={styles.mouthArc} />
                      <View style={styles.tongueShape} />
                      <View style={styles.airPath} />
                    </View>
                    <Text style={styles.visualCaption}>{info.mouth}</Text>
                  </View>
                  <View style={styles.ruleGuideCopy}>
                    <Text style={styles.matchTitle}>{rule}</Text>
                    <Text style={styles.ruleShort}>{info.short}</Text>
                    <Text style={styles.arabicExample}>{info.example}</Text>
                  </View>
                </View>
                <Text style={styles.translation}>{info.detail}</Text>
                <View style={styles.ruleLessonGrid}>
                  <View style={styles.ruleLessonBox}>
                    <Text style={styles.fieldLabel}>How to pronounce</Text>
                    <Text style={styles.wordNote}>{info.practice}</Text>
                  </View>
                  <View style={styles.ruleLessonBox}>
                    <Text style={styles.fieldLabel}>Common mistake</Text>
                    <Text style={styles.wordNote}>{info.commonMistake}</Text>
                  </View>
                  <View style={styles.ruleLessonBox}>
                    <Text style={styles.fieldLabel}>Practice drill</Text>
                    <Text style={styles.wordNote}>{info.drill}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {section === "tajweed" ? (
          <>
            <View style={styles.layout}>
              <View style={styles.recorderPanel}>
                <Text style={styles.panelTitle}>1. Record your selected ayahs</Text>
                <Text style={styles.helperTextCenter}>Pick the exact range first. The report grades word accuracy and highlights what to review.</Text>
                {showAdvanced ? (
                  <View style={styles.modeSwitch}>
                    <Pressable
                      style={[styles.modeButton, recognitionMode === "openai_hybrid" && styles.selectedModeButton]}
                      onPress={() => setRecognitionMode("openai_hybrid")}
                      disabled={status === "recording" || status === "processing"}
                    >
                      <Text style={[styles.modeButtonText, recognitionMode === "openai_hybrid" && styles.selectedModeButtonText]}>Best transcript</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.modeButton, recognitionMode === "local_whisper" && styles.selectedModeButton, !localWhisperAvailable && styles.disabledModeButton]}
                      onPress={() => localWhisperAvailable && setRecognitionMode("local_whisper")}
                      disabled={status === "recording" || status === "processing" || !localWhisperAvailable}
                    >
                      <Text style={[styles.modeButtonText, recognitionMode === "local_whisper" && styles.selectedModeButtonText, !localWhisperAvailable && styles.disabledModeButtonText]}>
                        {localWhisperAvailable ? "Local only" : "Local only (desktop)"}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
                <Text style={styles.targetText}>{tajweedTargetLabel}</Text>
                <Text style={styles.duration}>{formatDuration(duration)}</Text>
                <Text style={styles.statusText}>Tajweed Practice compares your recording with this selected ayah range</Text>
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
                  {status === "processing" ? <ActivityIndicator color="#fff" /> : <Text style={styles.recordButtonText}>{status === "recording" ? "Stop" : "Record"}</Text>}
                </Pressable>
                <View style={styles.quickActions}>
                  <Pressable style={styles.secondaryButton} onPress={() => setDuration(0)} disabled={status === "recording" || status === "processing"}>
                    <Text style={styles.secondaryButtonText}>Reset</Text>
                  </Pressable>
                  <Pressable style={styles.secondaryButton} onPress={() => setShowAdvanced((current) => !current)} disabled={status === "processing"}>
                    <Text style={styles.secondaryButtonText}>{showAdvanced ? "Hide options" : "Options"}</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.filterPanel}>
                <Text style={styles.panelTitle}>2. Choose what you will recite</Text>
                <Text style={styles.helperText}>Tajweed Practice needs the exact surah and ayah range so it can mark mistakes in the right location.</Text>
                <View style={styles.selectedSurahBox}>
                  <Text style={styles.fieldLabel}>Selected surah</Text>
                  <Text style={styles.selectedSurahLabel}>{tajweedTargetLabel.split(" ").slice(0, -1).join(" ") || "Choose a surah"}</Text>
                </View>
                <TextInput
                  value={surahQuery}
                  onChangeText={setSurahQuery}
                  placeholder="Search and select a surah name or number"
                  placeholderTextColor="#7d8884"
                  style={styles.searchInput}
                />
                <View style={styles.targetGrid}>
                  <View style={styles.targetField}>
                    <Text style={styles.fieldLabel}>Start ayah</Text>
                    <TextInput value={tajweedAyahStart} onChangeText={setTajweedAyahStart} keyboardType="number-pad" style={styles.targetInput} />
                  </View>
                  <View style={styles.targetField}>
                    <Text style={styles.fieldLabel}>End ayah optional</Text>
                    <TextInput value={tajweedAyahEnd} onChangeText={setTajweedAyahEnd} keyboardType="number-pad" placeholder="Same as start" placeholderTextColor="#7d8884" style={styles.targetInput} />
                  </View>
                </View>
                <View style={[styles.surahGrid, styles.dropdownList]}>
                  {filteredSurahs.map((surah) => {
                    const selected = Number(tajweedSurah) === surah.number;
                    return (
                      <Pressable key={surah.number} onPress={() => setTajweedSurahFromChip(surah.number)} style={[styles.surahChip, selected && styles.selectedSurahChip]}>
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

            {tajweedResult ? (
              <View style={styles.results}>
                <View style={styles.resultsHeader}>
                  <Text style={styles.sectionTitle}>Tajweed Practice Report</Text>
                  <Text style={styles.transcriptText}>
                    {tajweedResult.surahName} {tajweedResult.ayahStart === tajweedResult.ayahEnd ? tajweedResult.ayahStart : `${tajweedResult.ayahStart}-${tajweedResult.ayahEnd}`}
                  </Text>
                  <Text style={styles.transcriptText}>Transcript: {tajweedResult.transcript || "No transcript returned"}</Text>
                </View>
                <View style={styles.scorePanel}>
                  <Text style={styles.bigScore}>{tajweedResult.score}%</Text>
                  <View style={styles.scoreCopy}>
                    <Text style={styles.matchTitle}>{tajweedResult.summary}</Text>
                    <Text style={styles.transcriptText}>Word accuracy plus expected tajweed-rule guidance. Timing and makhraj still need deeper audio analysis.</Text>
                    {tajweedResult.advice.map((item) => (
                      <Text key={item} style={styles.translation}>- {item}</Text>
                    ))}
                  </View>
                </View>
                {tajweedResult.ruleSummary && tajweedResult.ruleSummary.length > 0 ? (
                  <View style={styles.rulePanel}>
                    <Text style={styles.panelTitle}>Tajweed Focus</Text>
                    <Text style={styles.helperText}>Hover a rule for one second, or tap it, to see what it means.</Text>
                    <View style={styles.ruleGrid}>
                      {tajweedResult.ruleSummary.map((item) => (
                        <Pressable
                          key={item.rule}
                          style={styles.rulePill}
                          onHoverIn={() => showRuleTooltip(item.rule)}
                          onHoverOut={hideRuleTooltip}
                          onPress={() => {
                            const info = ruleInfo(item.rule);
                            setRuleTooltip({ rule: item.rule, text: `${info.short} ${info.practice}` });
                          }}
                        >
                          <Text style={styles.ruleText}>{item.rule}</Text>
                          <Text style={styles.ruleCount}>{item.count}</Text>
                        </Pressable>
                      ))}
                    </View>
                    {ruleTooltip ? (
                      <View style={styles.ruleTooltip}>
                        <Text style={styles.ruleTooltipTitle}>{ruleTooltip.rule}</Text>
                        <Text style={styles.ruleTooltipText}>{ruleTooltip.text}</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
                {tajweedInfographicUri ? <Image source={{ uri: tajweedInfographicUri }} style={styles.infographic} resizeMode="contain" /> : null}
                <View style={styles.wordGrid}>
                  {tajweedResult.words.slice(0, 80).map((word) => (
                    <View key={`${word.position}-${word.expected || word.heard}`} style={[styles.wordChip, styles[`${word.status}Word` as keyof typeof styles] as object]}>
                      <Text style={styles.wordArabic}>{word.expected || word.heard}</Text>
                      <Text style={styles.wordNote}>{word.note}</Text>
                      {word.rules && word.rules.length > 0 ? (
                        <View style={styles.miniRuleRow}>
                          {word.rules.slice(0, 3).map((rule) => (
                            <Pressable
                              key={rule}
                              onHoverIn={() => showRuleTooltip(rule)}
                              onHoverOut={hideRuleTooltip}
                              onPress={() => {
                                const info = ruleInfo(rule);
                                setRuleTooltip({ rule, text: `${info.short} ${info.practice}` });
                              }}
                            >
                              <Text style={styles.miniRule}>{rule}</Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : null}
                      {word.improvement ? <Text style={styles.wordImprove}>{word.improvement}</Text> : null}
                      {word.timingNote ? <Text style={styles.wordImprove}>{word.timingNote}</Text> : null}
                    </View>
                  ))}
                </View>
                {tajweedResult.history && tajweedResult.history.length > 0 ? (
                  <View style={styles.progressPanel}>
                    <Text style={styles.panelTitle}>Improvement for {tajweedTargetLabel}</Text>
                    <View style={styles.progressBars}>
                      {tajweedResult.history.slice().reverse().map((attempt) => (
                        <View key={attempt.id} style={styles.progressBarSlot}>
                          <View style={[styles.progressBar, { height: `${Math.max(8, attempt.score)}%` }]} />
                          <Text style={styles.progressLabel}>{attempt.score}</Text>
                        </View>
                      ))}
                    </View>
                    <View style={styles.historyList}>
                      {tajweedResult.history.slice(0, 6).map((attempt) => (
                        <View key={`row-${attempt.id}`} style={styles.historyRow}>
                          <Text style={styles.historyScore}>{attempt.score}%</Text>
                          <Text style={styles.historyMeta}>{new Date(attempt.createdAt).toLocaleString()}</Text>
                          <Text style={styles.historyMeta} numberOfLines={1}>
                            {(attempt.transcript || "No transcript").slice(0, 80)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : (
                  <Text style={styles.emptyText}>Sign in and practice this range multiple times to see your scores improve here.</Text>
                )}
              </View>
            ) : null}
          </>
        ) : null}

        {section === "recognize" ? (
          <>
        <View style={styles.layout}>
          <View style={styles.recorderPanel}>
            <Text style={styles.panelTitle}>1. Recite clearly for a short clip</Text>
            <Text style={styles.helperTextCenter}>For best results, record 15-30 seconds. A little background noise is okay.</Text>
            {showAdvanced ? (
              <View style={styles.modeSwitch}>
                <Pressable
                  style={[styles.modeButton, recognitionMode === "openai_hybrid" && styles.selectedModeButton]}
                  onPress={() => setRecognitionMode("openai_hybrid")}
                  disabled={status === "recording" || status === "processing"}
                >
                  <Text style={[styles.modeButtonText, recognitionMode === "openai_hybrid" && styles.selectedModeButtonText]}>Best accuracy</Text>
                </Pressable>
                <Pressable
                  style={[styles.modeButton, recognitionMode === "local_whisper" && styles.selectedModeButton, !localWhisperAvailable && styles.disabledModeButton]}
                  onPress={() => localWhisperAvailable && setRecognitionMode("local_whisper")}
                  disabled={status === "recording" || status === "processing" || !localWhisperAvailable}
                >
                  <Text style={[styles.modeButtonText, recognitionMode === "local_whisper" && styles.selectedModeButtonText, !localWhisperAvailable && styles.disabledModeButtonText]}>
                    {localWhisperAvailable ? "Local only" : "Local only (desktop)"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
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
              <Pressable style={styles.secondaryButton} onPress={() => setShowAdvanced((current) => !current)} disabled={status === "processing"}>
                <Text style={styles.secondaryButtonText}>{showAdvanced ? "Hide options" : "Options"}</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.filterPanel}>
            <View style={styles.panelHeader}>
              <View>
                <Text style={styles.panelTitle}>2. Help us narrow it down</Text>
                <Text style={styles.helperText}>Optional, but powerful for unclear recitation. Pick one or more likely surahs, or leave empty if you do not know.</Text>
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
  helperTextCenter: {
    color: "#687773",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 3,
    textAlign: "center"
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
  targetText: {
    color: "#0f766e",
    fontSize: 16,
    fontWeight: "900",
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
  targetGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  targetField: {
    flexGrow: 1,
    flexBasis: 120,
    gap: 5
  },
  fieldLabel: {
    color: "#51615d",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  targetInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: "#cfc5b5",
    borderRadius: 8,
    paddingHorizontal: 12,
    color: "#17211f",
    backgroundColor: "#fff",
    fontSize: 16,
    fontWeight: "800"
  },
  selectedSurahBox: {
    gap: 5,
    borderWidth: 1,
    borderColor: "#ddd3c3",
    borderRadius: 8,
    padding: 12,
    backgroundColor: "#f8f4eb"
  },
  selectedSurahLabel: {
    color: "#17211f",
    fontSize: 18,
    fontWeight: "900"
  },
  dropdownList: {
    maxHeight: 220,
    overflow: "hidden"
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
  scorePanel: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 18,
    padding: 18,
    backgroundColor: "#fffdf8",
    borderWidth: 1,
    borderColor: "#ddd3c3",
    borderRadius: 8
  },
  bigScore: {
    color: "#0f766e",
    fontSize: 56,
    fontWeight: "900"
  },
  scoreCopy: {
    flex: 1,
    minWidth: 260,
    gap: 8
  },
  infographic: {
    width: "100%",
    minHeight: 360,
    backgroundColor: "#fffdf8",
    borderWidth: 1,
    borderColor: "#ddd3c3",
    borderRadius: 8
  },
  rulePanel: {
    gap: 10,
    padding: 16,
    backgroundColor: "#fffdf8",
    borderWidth: 1,
    borderColor: "#ddd3c3",
    borderRadius: 8
  },
  ruleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  rulePill: {
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
  ruleText: {
    color: "#17211f",
    fontSize: 13,
    fontWeight: "900"
  },
  ruleCount: {
    color: "#0f766e",
    fontSize: 13,
    fontWeight: "900"
  },
  ruleTooltip: {
    gap: 4,
    borderWidth: 1,
    borderColor: "#0f766e",
    borderRadius: 8,
    padding: 12,
    backgroundColor: "#ecfdf5"
  },
  ruleTooltipTitle: {
    color: "#0f766e",
    fontSize: 15,
    fontWeight: "900"
  },
  ruleTooltipText: {
    color: "#17211f",
    fontSize: 14,
    lineHeight: 20
  },
  rulesPage: {
    gap: 14
  },
  ruleGuideCard: {
    gap: 14,
    padding: 18,
    backgroundColor: "#fffdf8",
    borderWidth: 1,
    borderColor: "#ddd3c3",
    borderRadius: 8
  },
  ruleGuideHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    alignItems: "stretch"
  },
  visualPanel: {
    flexBasis: 220,
    flexGrow: 1,
    gap: 10,
    borderWidth: 1,
    borderColor: "#ddd3c3",
    borderRadius: 8,
    padding: 14,
    backgroundColor: "#f8f4eb"
  },
  mouthDiagram: {
    height: 118,
    borderRadius: 8,
    backgroundColor: "#fff7ed",
    overflow: "hidden",
    position: "relative"
  },
  mouthArc: {
    position: "absolute",
    left: 28,
    right: 28,
    top: 24,
    height: 58,
    borderTopWidth: 8,
    borderColor: "#92400e",
    borderRadius: 70
  },
  tongueShape: {
    position: "absolute",
    left: 54,
    right: 54,
    bottom: 20,
    height: 34,
    borderRadius: 24,
    backgroundColor: "#fdba74"
  },
  airPath: {
    position: "absolute",
    left: 110,
    top: 14,
    width: 12,
    height: 92,
    borderRadius: 6,
    backgroundColor: "#5eead4"
  },
  visualCaption: {
    color: "#42514d",
    fontSize: 13,
    lineHeight: 19
  },
  ruleGuideCopy: {
    flexBasis: 320,
    flexGrow: 2,
    gap: 8
  },
  ruleShort: {
    color: "#0f766e",
    fontSize: 16,
    fontWeight: "900"
  },
  arabicExample: {
    color: "#111827",
    fontSize: 30,
    lineHeight: 44,
    textAlign: "right",
    writingDirection: "rtl"
  },
  ruleLessonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  ruleLessonBox: {
    flexBasis: 220,
    flexGrow: 1,
    gap: 6,
    borderWidth: 1,
    borderColor: "#ddd3c3",
    borderRadius: 8,
    padding: 12,
    backgroundColor: "#f8f4eb"
  },
  wordGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  wordChip: {
    flexBasis: 190,
    flexGrow: 1,
    gap: 4,
    borderWidth: 1,
    borderColor: "#ddd3c3",
    borderRadius: 8,
    padding: 10,
    backgroundColor: "#fffdf8"
  },
  correctWord: {
    backgroundColor: "#dcfce7",
    borderColor: "#86efac"
  },
  closeWord: {
    backgroundColor: "#fef9c3",
    borderColor: "#fde047"
  },
  changedWord: {
    backgroundColor: "#ffedd5",
    borderColor: "#fb923c"
  },
  missingWord: {
    backgroundColor: "#fee2e2",
    borderColor: "#f87171"
  },
  extraWord: {
    backgroundColor: "#e0e7ff",
    borderColor: "#818cf8"
  },
  wordArabic: {
    color: "#111827",
    fontSize: 22,
    lineHeight: 32,
    textAlign: "right",
    writingDirection: "rtl"
  },
  wordNote: {
    color: "#42514d",
    fontSize: 12,
    lineHeight: 17
  },
  miniRuleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5
  },
  miniRule: {
    alignSelf: "flex-start",
    backgroundColor: "#fffdf8",
    borderRadius: 6,
    color: "#0f766e",
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: "900"
  },
  wordImprove: {
    color: "#64736f",
    fontSize: 12,
    lineHeight: 17
  },
  progressPanel: {
    gap: 10,
    padding: 16,
    backgroundColor: "#fffdf8",
    borderWidth: 1,
    borderColor: "#ddd3c3",
    borderRadius: 8
  },
  progressBars: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 8,
    height: 120
  },
  progressBarSlot: {
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 5,
    width: 38,
    height: "100%"
  },
  progressBar: {
    width: 24,
    borderRadius: 6,
    backgroundColor: "#0f766e"
  },
  progressLabel: {
    color: "#51615d",
    fontSize: 12,
    fontWeight: "800"
  },
  historyList: {
    gap: 8
  },
  historyRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#eee3d3",
    paddingTop: 8
  },
  historyScore: {
    color: "#0f766e",
    fontSize: 15,
    fontWeight: "900"
  },
  historyMeta: {
    color: "#51615d",
    fontSize: 13,
    flexShrink: 1
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
