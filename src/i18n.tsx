import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { cn } from './lib/utils';

export type Locale = 'mixed' | 'en' | 'ko';

const STORAGE_KEY = 'mb_locale';
const TRANSLATE_PREFIX = 'mb_tr_v1_';
const HANGUL_RE = /[\uAC00-\uD7A3]/;

function hasHangul(value?: string | null) {
  return typeof value === 'string' && HANGUL_RE.test(value);
}

function hashText(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0;
  return String(hash);
}

function extractByLocale(text: string, locale: 'en' | 'ko') {
  const lines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
  if (locale === 'en') {
    return lines.map((line) => {
      if (!hasHangul(line)) return line;
      const parts = line.match(/[A-Za-z][A-Za-z0-9'.-]*/g);
      return parts ? parts.join(' ') : '';
    }).filter(Boolean).join('\n');
  }
  return lines.map((line) => {
    if (!hasHangul(line)) return '';
    return line
      .replace(/[A-Za-z][A-Za-z0-9'. -]{2,}/g, ' ')
      .replace(/\(\s*\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }).filter(Boolean).join('\n');
}

function needsTranslation(text: string, locale: 'en' | 'ko') {
  if (!text.trim()) return false;
  if (locale === 'en') return hasHangul(text);
  return /[A-Za-z]{4,}/.test(text) && !hasHangul(text);
}

export type RecipientCopy = {
  name: string;
  situation: string;
  other: string;
  nationality: string;
};

let translateChain: Promise<void> = Promise.resolve();

function readCachedTranslation(text: string, locale: 'en' | 'ko') {
  try {
    return window.localStorage.getItem(`${TRANSLATE_PREFIX}${locale}_${hashText(text)}`) || '';
  } catch {
    return '';
  }
}

function writeCachedTranslation(text: string, locale: 'en' | 'ko', translated: string) {
  try {
    window.localStorage.setItem(`${TRANSLATE_PREFIX}${locale}_${hashText(text)}`, translated);
  } catch {
    // Ignore quota errors
  }
}

async function translateFallback(text: string, locale: 'en' | 'ko') {
  const langpair = locale === 'en' ? 'ko|en' : 'en|ko';
  const chunks: string[] = [];
  const parts = text.split(/\n+/);
  let current = '';
  for (const part of parts) {
    if ((current + '\n' + part).length > 450) {
      if (current) chunks.push(current);
      current = part;
    } else {
      current = current ? `${current}\n${part}` : part;
    }
  }
  if (current) chunks.push(current);
  const translated: string[] = [];
  for (const chunk of chunks) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${langpair}`;
    const response = await fetch(url);
    if (!response.ok) continue;
    const data = await response.json();
    const next = typeof data?.responseData?.translatedText === 'string' ? data.responseData.translatedText.trim() : '';
    const cleaned = next.replace(/\s*MYMEMORY WARNING:.*$/i, '').trim();
    if (cleaned) translated.push(cleaned);
  }
  return translated.join('\n');
}

async function translateWithGemini(text: string, locale: 'en' | 'ko') {
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey && apiKey !== 'MY_GEMINI_API_KEY') {
    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey });
      const target = locale === 'en' ? 'English' : 'Korean';
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Translate this mission recipient text into ${target}. Keep personal names recognizable. Return only the translation, with no quotes or extra commentary.\n\n${text}`,
      });
      const fromText = typeof response.text === 'string' ? response.text.trim() : '';
      if (fromText) return fromText;
      const parts = response.candidates?.[0]?.content?.parts || [];
      const joined = parts.map((part: { text?: string }) => part.text || '').join('').trim();
      if (joined) return joined;
    } catch {
      // Fall through to the public translator.
    }
  }
  return translateFallback(text, locale);
}

async function localizeOneField(text: string, locale: 'en' | 'ko') {
  const trimmed = (text || '').trim();
  if (!trimmed) return '';
  const extracted = extractByLocale(trimmed, locale);
  if (!needsTranslation(trimmed, locale)) return extracted || trimmed;
  if (extracted && extracted.length / trimmed.length >= 0.45) return extracted;
  const cached = readCachedTranslation(trimmed, locale);
  if (cached) return cached;
  try {
    const translated = await translateWithGemini(trimmed, locale);
    const result = translated || extracted || trimmed;
    if (translated && !needsTranslation(translated, locale)) writeCachedTranslation(trimmed, locale, translated);
    return result;
  } catch {
    return extracted || trimmed;
  }
}

export async function localizeRecipientCopy(fields: RecipientCopy, locale: Locale): Promise<RecipientCopy> {
  if (locale === 'mixed') return fields;
  const run = async () => {
    const [name, situation, other, nationality] = await Promise.all([
      localizeOneField(fields.name, locale),
      localizeOneField(fields.situation, locale),
      localizeOneField(fields.other, locale),
      localizeOneField(fields.nationality, locale),
    ]);
    return { name, situation, other, nationality };
  };
  const pending = translateChain.then(run, run);
  translateChain = pending.then(() => undefined, () => undefined);
  return pending;
}

export function useLocalizedText(text: string) {
  const { locale } = useI18n();
  const [value, setValue] = useState(text);

  useEffect(() => {
    let cancelled = false;
    if (locale === 'mixed') {
      setValue(text);
      return;
    }
    localizeOneField(text, locale).then((next) => {
      if (!cancelled) setValue(next);
    });
    return () => {
      cancelled = true;
    };
  }, [text, locale]);

  return value;
}

export function LocalizedText({
  text,
  as: Tag = 'p',
  className,
}: {
  text: string;
  as?: 'p' | 'h3' | 'h4' | 'span';
  className?: string;
}) {
  const localized = useLocalizedText(text);
  return <Tag className={className}>{localized}</Tag>;
}

const messages = {
  adminLogin: { mixed: 'Admin Login', en: 'Admin Login', ko: '관리자 로그인' },
  signingIn: { mixed: 'Signing In...', en: 'Signing In...', ko: '로그인 중...' },
  director: { mixed: 'Director', en: 'Director', ko: '디렉터' },
  guestPartner: { mixed: 'Guest Partner', en: 'Guest Partner', ko: '게스트' },
  outreachFoundation: { mixed: 'Outreach Foundation', en: 'Outreach Foundation', ko: '아웃리치 재단' },
  loadingJoy: { mixed: '기쁨을 불러오는 중...', en: 'Loading joy...', ko: '기쁨을 불러오는 중...' },
  loadingJoySub: { mixed: 'Loading Eternal Joy', en: 'Loading Eternal Joy', ko: '영원한 기쁨을 준비하는 중' },
  spreadingJoy: { mixed: 'Spreading Joy • Sharing Hope', en: 'Spreading Joy • Sharing Hope', ko: '기쁨을 전하고 소망을 나눕니다' },
  heroTitle1: { mixed: 'Connecting Hearts', en: 'Connecting Hearts', ko: '국경을 넘어' },
  heroTitle2: { mixed: 'Across Borders', en: 'Across Borders', ko: '마음을 잇다' },
  verseKo: { mixed: '땅 끝에서 오게하라', en: '', ko: '땅 끝에서 오게하라' },
  verseEn: { mixed: 'Bring them from the ends of the earth', en: 'Bring them from the ends of the earth', ko: '' },
  verseRef: { mixed: 'ISAIAH 43:6', en: 'ISAIAH 43:6', ko: '이사야 43:6' },
  tabCharity: { mixed: 'Charity & Mission', en: 'Charity & Mission', ko: '선교' },
  tabWord: { mixed: 'Word of Blessings', en: 'Word of Blessings', ko: '말씀' },
  tabPrayer: { mixed: 'Prayer Room', en: 'Prayer Room', ko: '중보기도' },
  tabSupport: { mixed: 'Support', en: 'Support', ko: '후원' },
  adminPanel: { mixed: 'Admin Panel', en: 'Admin Panel', ko: '관리자' },
  cambodia: { mixed: 'Cambodia', en: 'Cambodia', ko: '캄보디아' },
  mexico: { mixed: 'Mexico', en: 'Mexico', ko: '멕시코' },
  usa: { mixed: 'USA', en: 'USA', ko: '미국' },
  otherNations: { mixed: 'Other Nations', en: 'Other Nations', ko: '다른 나라' },
  footerBlurb: {
    mixed: 'A California Religious Nonprofit (EIN: 41-4018824) dedicated to spreading joy and hope through transparent mission support.',
    en: 'A California Religious Nonprofit (EIN: 41-4018824) dedicated to spreading joy and hope through transparent mission support.',
    ko: '기쁨과 소망을 전하는 캘리포니아 종교 비영리 단체입니다 (EIN: 41-4018824).',
  },
  allRights: { mixed: 'All Rights Reserved.', en: 'All Rights Reserved.', ko: '모든 권리 보유.' },
  missionTracking: { mixed: 'Mission Data Tracking (Excel View)', en: 'Mission Data Tracking', ko: '선교 데이터' },
  exportList: { mixed: 'Export List', en: 'Export List', ko: '목록 보내기' },
  addRecipient: { mixed: 'Add Recipient', en: 'Add Recipient', ko: '수혜자 추가' },
  addActivity: { mixed: 'Add Activity', en: 'Add Activity', ko: '활동 추가' },
  sortByName: { mixed: '수혜자 이름순', en: 'Sort by name', ko: '수혜자 이름순' },
  noRecipients: { mixed: '수혜자 데이터가 없습니다.', en: 'No recipient data yet.', ko: '수혜자 데이터가 없습니다.' },
  noRecipientsAdmin: {
    mixed: '수혜자를 추가하거나 Sync 버튼으로 명단을 채울 수 있습니다.',
    en: 'Add recipients or use Sync to fill this list.',
    ko: '수혜자를 추가하거나 Sync 버튼으로 명단을 채울 수 있습니다.',
  },
  noRecipientsGuest: {
    mixed: '디렉터가 미션 데이터를 준비하고 있습니다.',
    en: 'The director is preparing this mission data.',
    ko: '디렉터가 미션 데이터를 준비하고 있습니다.',
  },
  recipientName: { mixed: '수혜자 이름', en: 'Recipient', ko: '수혜자 이름' },
  nationality: { mixed: '국적', en: 'Nationality', ko: '국적' },
  situationPrayer: { mixed: '현재상황 및 기도제목', en: 'Situation & Prayer', ko: '현재상황 및 기도제목' },
  other: { mixed: '기타', en: 'Notes', ko: '기타' },
  photos: { mixed: '사진', en: 'Photos', ko: '사진' },
  photosHint: { mixed: '업로드 또는 붙여넣기 · 최대 4장', en: 'Upload or paste · up to 4', ko: '업로드 또는 붙여넣기 · 최대 4장' },
  upload: { mixed: '업로드', en: 'Upload', ko: '업로드' },
  paste: { mixed: '붙여넣기', en: 'Paste', ko: '붙여넣기' },
  unnamed: { mixed: '이름 없음', en: 'Unnamed', ko: '이름 없음' },
  deleteRecipient: { mixed: '이 수혜자를 삭제할까요?', en: 'Delete this recipient?', ko: '이 수혜자를 삭제할까요?' },
  delete: { mixed: '삭제', en: 'Delete', ko: '삭제' },
  addRecipientTitle: { mixed: '수혜자 추가', en: 'Add Recipient', ko: '수혜자 추가' },
  cancel: { mixed: '취소', en: 'Cancel', ko: '취소' },
  add: { mixed: '추가', en: 'Add', ko: '추가' },
  namePlaceholder: { mixed: '이름', en: 'Name', ko: '이름' },
  situationPlaceholder: { mixed: '현재 상황과 기도제목을 적어 주세요', en: 'Current situation and prayer requests', ko: '현재 상황과 기도제목을 적어 주세요' },
  otherPlaceholder: { mixed: '기타 메모', en: 'Additional notes', ko: '기타 메모' },
  supportTitle: { mixed: 'Support Our Mission', en: 'Support Our Mission', ko: '선교를 후원해 주세요' },
  writeChecks: { mixed: 'Write and Send Checks', en: 'Write and Send Checks', ko: '수표 보내기' },
  scanToDonate: { mixed: 'Scan to Donate', en: 'Scan to Donate', ko: 'QR로 후원' },
  scanBlurb: {
    mixed: 'Secure Zelle donation for Mission Blessings Outreach Foundation.',
    en: 'Secure Zelle donation for Mission Blessings Outreach Foundation.',
    ko: 'Mission Blessings Outreach Foundation Zelle 후원입니다.',
  },
  bankTransfer: { mixed: 'Bank Transfer', en: 'Bank Transfer', ko: '계좌 이체' },
  bankName: { mixed: 'Bank Name', en: 'Bank Name', ko: '은행' },
  accountName: { mixed: 'Account Name', en: 'Account Name', ko: '예금주' },
  taxDeductibleEn: { mixed: 'ALL DONATIONS ARE TAX DEDUCTIBLE', en: 'ALL DONATIONS ARE TAX DEDUCTIBLE', ko: '' },
  taxDeductibleKo: { mixed: '모든 후원금은 세금 공제 혜택을 받을 수 있습니다', en: '', ko: '모든 후원금은 세금 공제 혜택을 받을 수 있습니다' },
  yourGift: { mixed: 'Your Gift Matters', en: 'Your Gift Matters', ko: '여러분의 후원이 소중합니다' },
  yourGiftBody: {
    mixed: 'Every donation goes directly to supporting our mission fields and bringing hope to those in need.',
    en: 'Every donation goes directly to supporting our mission fields and bringing hope to those in need.',
    ko: '모든 후원금은 선교지와 도움이 필요한 이들에게 직접 전달됩니다.',
  },
  prayerTitle: { mixed: 'Prayer Room', en: 'Prayer Room', ko: '중보기도' },
  prayerBlurb: {
    mixed: 'Share your prayer requests and thanksgiving with our community. We believe in the power of prayer and the joy of gratitude.',
    en: 'Share your prayer requests and thanksgiving with our community. We believe in the power of prayer and the joy of gratitude.',
    ko: '기도 제목과 감사 제목을 함께 나눠 주세요. 기도와 감사의 기쁨을 믿습니다.',
  },
  yourNameOptional: { mixed: 'Your Name (Optional)', en: 'Your Name (Optional)', ko: '이름 (선택)' },
  anonymous: { mixed: 'Anonymous', en: 'Anonymous', ko: '익명' },
  prayerRequest: { mixed: 'Prayer Request', en: 'Prayer Request', ko: '기도 제목' },
  thanksgiving: { mixed: 'Thanksgiving', en: 'Thanksgiving', ko: '감사' },
  communityWall: { mixed: 'Community Prayer Wall', en: 'Community Prayer Wall', ko: '함께 기도하는 공간' },
  communityWallSub: {
    mixed: 'A collection of our shared journey in faith.',
    en: 'A collection of our shared journey in faith.',
    ko: '함께 걷는 믿음의 여정입니다.',
  },
  all: { mixed: 'All', en: 'All', ko: '전체' },
  langMixed: { mixed: '한·EN', en: '한·EN', ko: '한·EN' },
  langEn: { mixed: 'EN', en: 'EN', ko: 'EN' },
  langKo: { mixed: '한', en: '한', ko: '한' },
} as const;

export type MessageKey = keyof typeof messages;

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function readStoredLocale(): Locale {
  if (typeof window === 'undefined') return 'mixed';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'ko' || stored === 'mixed') return stored;
  return 'mixed';
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale === 'en' ? 'en' : 'ko';
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale: setLocaleState,
    t: (key) => messages[key][locale] || messages[key].mixed,
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within LanguageProvider');
  return ctx;
}

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const options: { id: Locale; label: string }[] = [
    { id: 'mixed', label: t('langMixed') },
    { id: 'en', label: t('langEn') },
    { id: 'ko', label: t('langKo') },
  ];

  return (
    <div className="flex shrink-0 rounded-full border border-slate-200 bg-white p-0.5" role="group" aria-label="Language">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => setLocale(option.id)}
          className={cn(
            'px-2 sm:px-2.5 py-1 rounded-full text-[10px] font-black tracking-wide transition-all',
            locale === option.id ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-800'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
