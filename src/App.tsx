/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  doc, 
  Timestamp,
  query,
  orderBy,
  updateDoc,
  where,
  deleteDoc,
  getDocs,
  setDoc
} from 'firebase/firestore';
import { 
  signInWithPopup,
  getRedirectResult,
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User,
  browserPopupRedirectResolver
} from 'firebase/auth';
import { db, auth } from './firebase';
import { GoogleGenAI } from "@google/genai";
import { 
  Heart, 
  Users, 
  Plus, 
  LogOut, 
  LogIn, 
  Clock,
  Camera,
  Home,
  ShieldCheck,
  Globe,
  MapPin,
  FileSpreadsheet,
  QrCode,
  Info,
  Sparkles,
  Loader2,
  ChevronUp,
  Filter,
  Calendar,
  ArrowUpDown,
  Youtube,
  ArrowUp,
  ArrowDown,
  ShieldAlert,
  Megaphone,
  Play,
  X,
  AlertCircle,
  ExternalLink,
  Trash2,
  Type,
  Settings,
  ImagePlus,
  ClipboardPaste
} from 'lucide-react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import QRCode from "react-qr-code";
import { cn } from './lib/utils';
import * as XLSX from 'xlsx';
import { LanguageSwitcher, LocalizedText, localizeRecipientCopy, useI18n } from './i18n';

// --- Types ---

interface MissionField {
  id: string;
  name: string;
  description: string;
  type: 'international' | 'domestic';
}

interface Supporter {
  id: string;
  nameEn: string;
  nameKh?: string;
  isPastor: boolean;
  churchAttendance: string;
  faithStatus: string;
  qrCodeData: string;
  missionFieldId: string;
  updatedAt: any;
  bio?: string;
  needs?: string;
  additionalNotes?: string;
  monthlyRate?: number;
  familySize?: number;
  nationality?: string;
  area?: string;
  situationPrayer?: string;
  otherNotes?: string;
  photoUrls?: string[];
}

const HANGUL_RE = /[\uAC00-\uD7A3]/;

function hasHangul(value?: string | null) {
  return typeof value === 'string' && HANGUL_RE.test(value);
}

function uniqueNonEmpty(values: (string | undefined | null)[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = (value || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function composeCambodiaFields(supporter: Supporter) {
  const name = hasHangul(supporter.nameEn)
    ? supporter.nameEn
    : (supporter.nameKh?.trim() || supporter.nameEn);

  const koreanParts = uniqueNonEmpty([
    supporter.faithStatus,
    supporter.area,
    supporter.needs,
    supporter.bio,
    supporter.additionalNotes,
    supporter.churchAttendance,
  ]).filter(hasHangul);

  const situation = typeof supporter.situationPrayer === 'string'
    ? supporter.situationPrayer
    : (koreanParts.length > 0
        ? koreanParts.join('\n')
        : uniqueNonEmpty([supporter.needs, supporter.bio]).join('\n'));

  const other = typeof supporter.otherNotes === 'string'
    ? supporter.otherNotes
    : (hasHangul(supporter.additionalNotes) ? '' : (supporter.additionalNotes || ''));

  return { name, situation, other };
}

function getRecipientNameForSort(supporter: Supporter) {
  return (composeCambodiaFields(supporter).name || supporter.nameEn || '').trim();
}

function isSimplifiedMissionField(name?: string) {
  return name === 'Cambodia' || name === 'Mexico' || name === 'Other Nations';
}

function ExpandingField({
  value,
  onChange,
  onBlur,
  readOnly,
  placeholder,
  className,
  minHeight = 48,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  readOnly: boolean;
  placeholder: string;
  className?: string;
  minHeight?: number;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, minHeight)}px`;
  }, [value, minHeight]);

  if (readOnly) {
    return (
      <p className={cn('text-[16px] leading-7 text-slate-800 whitespace-pre-wrap break-words', className)}>
        {value || <span className="text-slate-400">{placeholder}</span>}
      </p>
    );
  }

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      rows={1}
      className={cn(
        'w-full resize-none overflow-hidden outline-none px-3 py-2 rounded-lg text-[16px] leading-7 bg-slate-50 border border-slate-200 focus:border-slate-400 focus:bg-white',
        className
      )}
    />
  );
}

function isUnnamedRecipient(supporter: Supporter) {
  return !getRecipientNameForSort(supporter);
}

const MAX_RECIPIENT_PHOTOS = 4;

function compressImageFile(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const maxEdge = 800;
      let width = img.width;
      let height = img.height;
      if (width > maxEdge || height > maxEdge) {
        const scale = maxEdge / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Could not process image'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not read image'));
    };
    img.src = objectUrl;
  });
}

interface Donation {
  id: string;
  supporterId: string;
  donorId?: string;
  amount: number;
  date: any;
  acknowledgment: string;
  missionFieldId: string;
}

interface Donor {
  id: string;
  name: string;
  email: string;
  phone: string;
  communicationPreference: 'Email' | 'SMS' | 'None';
  createdAt: any;
}

interface Activity {
  id: string;
  missionFieldId: string;
  title: string;
  description: string;
  date: any;
  photoUrls: string[];
  type?: string;
}

interface PrayerRequest {
  id: string;
  userId: string;
  userName: string;
  type: 'Request' | 'Thanksgiving';
  content: string;
  createdAt: any;
}

interface GalleryVideo {
  id: string;
  title: string;
  lang: 'ko' | 'en';
  day: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri';
  updatedAt: any;
}

// --- Components ---

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  const [errorInfo, setErrorInfo] = useState<string | null>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (event.error?.message?.startsWith('{')) {
        setHasError(true);
        setErrorInfo(event.error.message);
      }
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="p-8 bg-red-50 border border-red-200 rounded-2xl m-4">
        <h2 className="text-xl font-bold text-red-800 mb-2">System Error</h2>
        <p className="text-red-600 mb-4">An error occurred while interacting with the database.</p>
        <pre className="bg-white p-4 rounded border text-xs overflow-auto max-h-40">
          {errorInfo}
        </pre>
        <button 
          onClick={() => window.location.reload()}
          className="mt-4 bg-red-800 text-white px-4 py-2 rounded-lg"
        >
          Reload Application
        </button>
      </div>
    );
  }

  return <>{children}</>;
};

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function authErrorMessage(error: any) {
  const code = error?.code || '';
  if (code === 'auth/unauthorized-domain') {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    const domainToAdd = host === '127.0.0.1' ? 'localhost' : host;
    return `이 주소(${origin})가 Firebase 허용 도메인에 없습니다. Authentication → Settings → Authorized domains에 "${domainToAdd}" 를 추가해 주세요. 프로토콜과 포트는 넣지 않습니다.`;
  }
  if (code === 'auth/popup-blocked') {
    return '브라우저가 로그인 창을 막았습니다. 팝업을 허용하거나, 다시 누르면 페이지 이동 방식으로 로그인합니다.';
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return '로그인 창이 닫혔습니다. 다시 시도해 주세요. 팝업이 바로 닫히면 브라우저 팝업 차단을 해제해 주세요.';
  }
  if (code === 'auth/network-request-failed') {
    return '네트워크 오류로 로그인하지 못했습니다. 인터넷 연결을 확인해 주세요.';
  }
  return '로그인 중 오류가 발생했습니다: ' + (error?.message || String(error));
}

let redirectResultHandled = false;
let googleLoginInProgress = false;

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email || undefined,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // We don't throw here to avoid crashing the whole app, but we log it clearly
}

const DEFAULT_MISSION_FIELDS: Omit<MissionField, 'id'>[] = [
  { name: 'Cambodia', type: 'international', description: 'Supporting local communities in Cambodia.' },
  { name: 'Mexico', type: 'international', description: 'Outreach programs in Mexico.' },
  { name: 'USA', type: 'domestic', description: 'Local community support in the USA.' },
  { name: 'Other Nations', type: 'international', description: 'Global mission outreach.' }
];

const MOCK_SUPPORTERS: Supporter[] = [
  { id: 'mock-1', nameEn: 'Channary', isPastor: false, churchAttendance: 'Weekly', faithStatus: 'Active', qrCodeData: 'mock-1', missionFieldId: 'temp-cambodia', updatedAt: new Date(), bio: '', needs: 'School supplies', monthlyRate: 30, familySize: 4 },
  { id: 'mock-2', nameEn: 'Sovann', isPastor: true, churchAttendance: 'Weekly', faithStatus: 'Active', qrCodeData: 'mock-2', missionFieldId: 'temp-cambodia', updatedAt: new Date(), bio: '', needs: 'Rice, Medicine', monthlyRate: 50, familySize: 5 },
  { id: 'mock-3', nameEn: 'Bopha', isPastor: false, churchAttendance: 'Weekly', faithStatus: 'Active', qrCodeData: 'mock-3', missionFieldId: 'temp-cambodia', updatedAt: new Date(), bio: '', needs: 'Clothing', monthlyRate: 30, familySize: 3 },
  { id: 'mock-4', nameEn: 'Sreyneang', isPastor: false, churchAttendance: 'Weekly', faithStatus: 'Active', qrCodeData: 'mock-4', missionFieldId: 'temp-cambodia', updatedAt: new Date(), bio: '', needs: 'Books', monthlyRate: 25, familySize: 5 },
  { id: 'mock-5', nameEn: 'Kaliyan', isPastor: false, churchAttendance: 'Weekly', faithStatus: 'Active', qrCodeData: 'mock-5', missionFieldId: 'temp-cambodia', updatedAt: new Date(), bio: '', needs: 'Medical support', monthlyRate: 35, familySize: 4 },
  { id: 'mock-6', nameEn: 'Rithy', isPastor: false, churchAttendance: 'Weekly', faithStatus: 'Active', qrCodeData: 'mock-6', missionFieldId: 'temp-cambodia', updatedAt: new Date(), bio: '', needs: 'Tools', monthlyRate: 40, familySize: 4 },
  { id: 'mock-7', nameEn: 'Vibol', isPastor: false, churchAttendance: 'Weekly', faithStatus: 'Active', qrCodeData: 'mock-7', missionFieldId: 'temp-cambodia', updatedAt: new Date(), bio: '', needs: 'Food', monthlyRate: 45, familySize: 5 },
  { id: 'mock-8', nameEn: 'Sareth', isPastor: false, churchAttendance: 'Weekly', faithStatus: 'Active', qrCodeData: 'mock-8', missionFieldId: 'temp-cambodia', updatedAt: new Date(), bio: '', needs: 'Education', monthlyRate: 35, familySize: 3 },
  { id: 'mock-9', nameEn: 'Dara', isPastor: false, churchAttendance: 'Weekly', faithStatus: 'Active', qrCodeData: 'mock-9', missionFieldId: 'temp-cambodia', updatedAt: new Date(), bio: '', needs: 'General support', monthlyRate: 30, familySize: 4 },
  { id: 'mock-10', nameEn: 'Sok', isPastor: false, churchAttendance: 'Weekly', faithStatus: 'Active', qrCodeData: 'mock-10', missionFieldId: 'temp-cambodia', updatedAt: new Date(), bio: '', needs: 'Health care', monthlyRate: 20, familySize: 5 },
  { id: 'mock-m1', nameEn: 'Alejandro', isPastor: false, churchAttendance: 'Weekly', faithStatus: 'Active', qrCodeData: 'mock-m1', missionFieldId: 'temp-mexico', updatedAt: new Date(), bio: '', needs: 'Water filter', monthlyRate: 50, familySize: 4 },
  { id: 'mock-m2', nameEn: 'Maria', isPastor: false, churchAttendance: 'Weekly', faithStatus: 'Active', qrCodeData: 'mock-m2', missionFieldId: 'temp-mexico', updatedAt: new Date(), bio: '', needs: 'Seeds', monthlyRate: 40, familySize: 5 },
  { id: 'mock-m3', nameEn: 'Carlos', isPastor: false, churchAttendance: 'Weekly', faithStatus: 'Active', qrCodeData: 'mock-m3', missionFieldId: 'temp-mexico', updatedAt: new Date(), bio: '', needs: 'Tools', monthlyRate: 45, familySize: 4 },
  { id: 'mock-m4', nameEn: 'Elena', isPastor: false, churchAttendance: 'Weekly', faithStatus: 'Active', qrCodeData: 'mock-m4', missionFieldId: 'temp-mexico', updatedAt: new Date(), bio: '', needs: 'Books', monthlyRate: 35, familySize: 3 },
  { id: 'mock-m5', nameEn: 'Luis', isPastor: false, churchAttendance: 'Weekly', faithStatus: 'Active', qrCodeData: 'mock-m5', missionFieldId: 'temp-mexico', updatedAt: new Date(), bio: '', needs: 'Sports gear', monthlyRate: 60, familySize: 5 },
  { id: 'mock-11', nameEn: 'David Lee', isPastor: false, churchAttendance: 'Weekly', faithStatus: 'Active', qrCodeData: 'mock-11', missionFieldId: 'temp-usa', updatedAt: new Date(), bio: '', needs: 'Books', monthlyRate: 40, familySize: 3 }
];

const MOCK_ACTIVITIES: Activity[] = [
  { id: 'mock-a1', missionFieldId: 'temp-cambodia', title: 'School Supplies Distribution', description: 'Distributed notebooks and pens to 200 students.', date: { toDate: () => new Date() }, type: 'Education', photoUrls: ['https://picsum.photos/seed/school/800/600'] },
  { id: 'mock-a2', missionFieldId: 'temp-usa', title: 'Community Food Bank', description: 'Helped serve 150 families this weekend.', date: { toDate: () => new Date() }, type: 'Outreach', photoUrls: ['https://picsum.photos/seed/food/800/600'] }
];

const MOCK_DONORS: Donor[] = [
  { id: 'mock-d1', name: 'Alice Johnson', email: 'alice@example.com', phone: '123-456-7890', communicationPreference: 'Email', createdAt: new Date() },
  { id: 'mock-d2', name: 'Bob Wilson', email: 'bob@example.com', phone: '098-765-4321', communicationPreference: 'SMS', createdAt: new Date() }
];

const MOCK_DONATIONS: Donation[] = [
  { id: 'mock-dn1', supporterId: 'mock-1', donorId: 'mock-d1', amount: 100, date: { toDate: () => new Date() }, acknowledgment: 'Thank you!', missionFieldId: 'temp-cambodia' },
  { id: 'mock-dn2', supporterId: 'mock-11', donorId: 'mock-d2', amount: 50, date: { toDate: () => new Date() }, acknowledgment: 'Grateful!', missionFieldId: 'temp-usa' }
];

export default function App() {
  const { t } = useI18n();
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [directSupportId, setDirectSupportId] = useState<string | null>(null);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [activeVideoPlaylistId, setActiveVideoPlaylistId] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<'charity' | 'support' | 'media' | 'donors' | 'prayer'>('charity');
  const [activeSubTab, setActiveSubTab] = useState<'cambodia' | 'mexico' | 'other' | 'usa'>('cambodia');
  const [missionFields, setMissionFields] = useState<MissionField[]>([]);
  const [supporters, setSupporters] = useState<Supporter[]>([]);
  const [donors, setDonors] = useState<Donor[]>([]);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [prayerRequests, setPrayerRequests] = useState<PrayerRequest[]>([]);
  const [dailyWords, setDailyWords] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const isAdmin = (user?.email || user?.providerData?.[0]?.email || '').toLowerCase() === 'pastoreom2@gmail.com';

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
      if (currentUser) {
        console.log("User is logged in:", currentUser.email);
      } else {
        console.log("User is logged out");
      }
    });

    if (!redirectResultHandled) {
      redirectResultHandled = true;
      getRedirectResult(auth)
        .then((result) => {
          sessionStorage.removeItem('mb_admin_login');
          if (result?.user) {
            const email = result.user.email || result.user.providerData?.[0]?.email || '';
            const adminGranted = email.toLowerCase() === 'pastoreom2@gmail.com';
            if (!adminGranted) {
              setLoginError(`로그인됨: ${email || result.user.displayName}. 관리자는 pastoreom2@gmail.com 계정으로 다시 로그인해 주세요.`);
            }
          }
        })
        .catch((error) => {
          sessionStorage.removeItem('mb_admin_login');
          setLoginError(authErrorMessage(error));
        });
    }

    return () => unsubscribe();
  }, []);

  const seedSupporters = async (fieldId: string, country: string) => {
    let data: { en: string, rate: number, bio: string, familySize: number }[] = [];
    
    if (country === 'Cambodia') {
      data = [
        { en: 'Channary', rate: 30, bio: '', familySize: 4 },
        { en: 'Bopha', rate: 30, bio: '', familySize: 3 },
        { en: 'Sreyneang', rate: 25, bio: '', familySize: 5 },
        { en: 'Kaliyan', rate: 35, bio: '', familySize: 4 },
        { en: 'Sovann', rate: 50, bio: '', familySize: 6 },
        { en: 'Rithy', rate: 40, bio: '', familySize: 4 },
        { en: 'Vibol', rate: 45, bio: '', familySize: 5 },
        { en: 'Sareth', rate: 35, bio: '', familySize: 3 },
        { en: 'Dara', rate: 30, bio: '', familySize: 4 },
        { en: 'Sok', rate: 20, bio: '', familySize: 5 },
        { en: 'Serey', rate: 30, bio: '', familySize: 4 },
        { en: 'Vanna', rate: 30, bio: '', familySize: 3 },
        { en: 'Chavy', rate: 30, bio: '', familySize: 4 },
        { en: 'Borey', rate: 30, bio: '', familySize: 4 },
        { en: 'Dara', rate: 30, bio: '', familySize: 4 },
        { en: 'Kalyan', rate: 30, bio: '', familySize: 4 },
        { en: 'Mony', rate: 30, bio: '', familySize: 4 },
        { en: 'Phala', rate: 30, bio: '', familySize: 4 },
        { en: 'Rithy', rate: 30, bio: '', familySize: 4 },
        { en: 'Sokha', rate: 30, bio: '', familySize: 4 },
        { en: 'Thyda', rate: 30, bio: '', familySize: 4 },
        { en: 'Veasna', rate: 30, bio: '', familySize: 4 },
        { en: 'Vibol', rate: 30, bio: '', familySize: 4 },
        { en: 'Arun', rate: 30, bio: '', familySize: 4 },
        { en: 'Chandra', rate: 30, bio: '', familySize: 4 },
        { en: 'Kannitha', rate: 30, bio: '', familySize: 4 },
        { en: 'Makara', rate: 30, bio: '', familySize: 4 },
        { en: 'Narith', rate: 30, bio: '', familySize: 4 },
        { en: 'Sovan', rate: 30, bio: '', familySize: 4 },
        { en: 'Vannak', rate: 30, bio: '', familySize: 4 }
      ];
    } else if (country === 'Mexico') {
      data = [
        { en: 'Alejandro', rate: 50, bio: '', familySize: 4 },
        { en: 'Maria', rate: 40, bio: '', familySize: 5 },
        { en: 'Carlos', rate: 45, bio: '', familySize: 4 },
        { en: 'Elena', rate: 35, bio: '', familySize: 3 },
        { en: 'Luis', rate: 60, bio: '', familySize: 5 }
      ];
    } else if (country === 'USA') {
      data = [
        { en: 'James', rate: 100, bio: 'Coordinating local food bank deliveries.', familySize: 3 },
        { en: 'Sarah', rate: 100, bio: 'Mentoring at-risk youth in urban areas.', familySize: 2 },
        { en: 'Robert', rate: 120, bio: 'Leading community health workshops.', familySize: 4 },
        { en: 'Linda', rate: 100, bio: 'Organizing neighborhood safety programs.', familySize: 3 },
        { en: 'Michael', rate: 150, bio: 'Developing affordable housing projects.', familySize: 5 },
        { en: 'Emily', rate: 100, bio: 'Teaching financial literacy classes.', familySize: 2 }
      ];
    } else if (country === 'Other Nations') {
      data = [
        { en: 'Chang', rate: 40, bio: '', familySize: 4 },
        { en: 'Swei', rate: 40, bio: '', familySize: 3 },
        { en: 'Ming', rate: 40, bio: '', familySize: 5 }
      ];
    }

    for (const d of data) {
      try {
        const docRef = await addDoc(collection(db, 'supporters'), { 
          nameEn: d.en, 
          isPastor: false, 
          churchAttendance: 'Weekly', 
          faithStatus: 'Baptized', 
          qrCodeData: '', 
          updatedAt: Timestamp.now(),
          missionFieldId: fieldId,
          monthlyRate: d.rate,
          bio: d.bio,
          familySize: d.familySize
        });

        if (Math.random() > 0.5) {
          await addDoc(collection(db, 'donations'), {
            supporterId: docRef.id,
            missionFieldId: fieldId,
            amount: d.rate,
            date: Timestamp.now(),
            acknowledgment: 'Initial sample donation'
          });
        }
      } catch (e) {
        handleFirestoreError(e, OperationType.WRITE, 'supporters');
      }
    }
  };

  const seedActivities = async (fieldId: string, country: string) => {
    let activitiesData: Omit<Activity, 'id'>[] = [];
    
    if (country === 'Cambodia') {
      activitiesData = [
        { missionFieldId: fieldId, title: 'New School Building Completion', description: 'We successfully finished the construction of the primary school.', date: Timestamp.now(), photoUrls: ['https://picsum.photos/seed/school/800/600'], type: 'Construction' },
        { missionFieldId: fieldId, title: 'Clean Water Well Installation', description: 'Three new wells were installed providing water to 50 families.', date: Timestamp.now(), photoUrls: ['https://picsum.photos/seed/water/800/600'], type: 'Infrastructure' }
      ];
    } else if (country === 'Mexico') {
      activitiesData = [
        { missionFieldId: fieldId, title: 'Mobile Medical Clinic', description: 'Provided checkups for over 100 residents in remote areas.', date: Timestamp.now(), photoUrls: ['https://picsum.photos/seed/medical/800/600'], type: 'Health' },
        { missionFieldId: fieldId, title: 'Community Garden Harvest', description: 'First harvest from the new community garden was distributed.', date: Timestamp.now(), photoUrls: ['https://picsum.photos/seed/garden/800/600'], type: 'Agriculture' }
      ];
    } else if (country === 'USA') {
      activitiesData = [
        { missionFieldId: fieldId, title: 'Annual Food Drive', description: 'Collected over 2,000 lbs of food for local families.', date: Timestamp.now(), photoUrls: ['https://picsum.photos/seed/food/800/600'], type: 'Outreach' },
        { missionFieldId: fieldId, title: 'Youth Mentorship Graduation', description: 'Celebrating 15 students completing our year-long program.', date: Timestamp.now(), photoUrls: ['https://picsum.photos/seed/youth/800/600'], type: 'Education' }
      ];
    }

    for (const a of activitiesData) {
      try {
        await addDoc(collection(db, 'activities'), a);
      } catch (e) {
        handleFirestoreError(e, OperationType.WRITE, 'activities');
      }
    }
  };

  const seedInitialData = async () => {
    console.log("Starting seedInitialData process...");
    const initialFields = [
      { name: 'Cambodia', type: 'international', description: 'Supporting local communities in Cambodia.' },
      { name: 'Mexico', type: 'international', description: 'Outreach programs in Mexico.' },
      { name: 'USA', type: 'domestic', description: 'Local community support in the USA.' },
      { name: 'Other Nations', type: 'international', description: 'Global mission outreach.' }
    ];
    
    for (const f of initialFields) {
      try {
        console.log(`Seeding mission field: ${f.name}`);
        const docRef = await addDoc(collection(db, 'missionFields'), f);
        console.log(`Mission field ${f.name} created with ID: ${docRef.id}. Seeding supporters and activities...`);
        await seedSupporters(docRef.id, f.name);
        await seedActivities(docRef.id, f.name);
      } catch (e) {
        console.error(`Failed to seed mission field ${f.name}:`, e);
        handleFirestoreError(e, OperationType.WRITE, 'missionFields');
      }
    }
    console.log("seedInitialData process completed.");
  };

  useEffect(() => {
    const unsubFields = onSnapshot(collection(db, 'missionFields'), (snapshot) => {
      console.log("Mission fields snapshot received. Size:", snapshot.size);
      const fields = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MissionField));
      setMissionFields(fields);
      setLoading(false);
    }, (error) => {
      console.error("Critical: Mission fields fetch error", error);
      handleFirestoreError(error, OperationType.LIST, 'missionFields');
      setLoading(false);
    });

    const unsubSupporters = onSnapshot(collection(db, 'supporters'), (snapshot) => {
      const allSupporters = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supporter));
      setSupporters(allSupporters);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'supporters'));

    const unsubDonations = onSnapshot(collection(db, 'donations'), (snapshot) => {
      setDonations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Donation)));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'donations'));

    const unsubActivities = onSnapshot(collection(db, 'activities'), (snapshot) => {
      setActivities(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Activity)));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'activities'));

    const unsubPrayer = onSnapshot(collection(db, 'prayerRequests'), (snapshot) => {
      setPrayerRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PrayerRequest)));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'prayerRequests'));

    const unsubDailyWord = onSnapshot(collection(db, 'daily_word'), (snapshot) => {
      const words: Record<string, string> = {};
      snapshot.docs.forEach(doc => {
        words[doc.id] = (doc.data() as any).videoId;
      });
      setDailyWords(words);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'daily_word'));

    return () => {
      unsubFields();
      unsubSupporters();
      unsubDonations();
      unsubActivities();
      unsubPrayer();
      unsubDailyWord();
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    const unsubDonors = onSnapshot(collection(db, 'donors'), (snapshot) => {
      const allDonors = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Donor));
      setDonors(allDonors);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'donors'));
    return () => unsubDonors();
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || loading || missionFields.length > 0) return;
    seedInitialData();
  }, [isAdmin, loading, missionFields.length]);

  const handleLogin = (event?: React.SyntheticEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (googleLoginInProgress || isLoggingIn) return;
    if (window.location.hostname === '127.0.0.1') {
      window.location.replace(window.location.href.replace('127.0.0.1', 'localhost'));
      return;
    }

    const provider = new GoogleAuthProvider();
    provider.addScope('email');
    provider.setCustomParameters({ prompt: 'select_account' });
    googleLoginInProgress = true;
    // Open Google's account picker in the same click, then show Signing In...
    const popup = signInWithPopup(auth, provider, browserPopupRedirectResolver);
    setIsLoggingIn(true);
    setLoginError(null);

    popup
      .then((result) => {
        const email = result.user.email || result.user.providerData?.[0]?.email || '';
        if (email.toLowerCase() !== 'pastoreom2@gmail.com') {
          setLoginError(`로그인됨: ${email || result.user.displayName}. 관리자는 pastoreom2@gmail.com 계정으로 다시 로그인해 주세요.`);
        } else {
          setLoginError(null);
        }
      })
      .catch((error: any) => {
        if (
          error?.code === 'auth/popup-closed-by-user' ||
          error?.code === 'auth/cancelled-popup-request' ||
          error?.code === 'auth/cancelled-by-user'
        ) {
          return;
        }
        console.error('Login failed', error);
        setLoginError(authErrorMessage(error));
      })
      .finally(() => {
        googleLoginInProgress = false;
        setIsLoggingIn(false);
      });
  };

  const handleLogout = () => {
    signOut(auth);
  };

  const handleResetData = async () => {
    if (!isAdmin) return;
    if (!window.confirm("CRITICAL: This will delete ALL mission fields and supporters and re-seed the system. Continue?")) return;

    setLoading(true);
    try {
      // Delete all mission fields
      const fieldsSnap = await getDocs(collection(db, 'missionFields'));
      for (const d of fieldsSnap.docs) {
        await deleteDoc(doc(db, 'missionFields', d.id));
      }

      // Delete all supporters
      const supportersSnap = await getDocs(collection(db, 'supporters'));
      for (const d of supportersSnap.docs) {
        await deleteDoc(doc(db, 'supporters', d.id));
      }

      // Delete all donations
      const donationsSnap = await getDocs(collection(db, 'donations'));
      for (const d of donationsSnap.docs) {
        await deleteDoc(doc(db, 'donations', d.id));
      }

      // Delete all activities
      const activitiesSnap = await getDocs(collection(db, 'activities'));
      for (const d of activitiesSnap.docs) {
        await deleteDoc(doc(db, 'activities', d.id));
      }

      window.location.reload();
    } catch (error) {
      console.error("Reset failed", error);
      alert("Reset failed. Check console.");
    } finally {
      setLoading(false);
    }
  };

  const exportToExcel = (fieldSupporters: Supporter[]) => {
    const isSimplifiedExport = activeSubTab === 'cambodia' || activeSubTab === 'mexico' || activeSubTab === 'other';
    const data = fieldSupporters.map(s => {
      if (isSimplifiedExport) {
        const row = composeCambodiaFields(s);
        return {
          '수혜자 이름': row.name,
          ...(activeSubTab === 'other' ? { '국적': s.nationality || '' } : {}),
          '현재상황 및 기도제목': row.situation,
          '기타': row.other,
        };
      }
      const sDonations = donations.filter(d => d.supporterId === s.id);
      return {
        'Recipient Name': s.nameEn,
        'FAMILY SIZE': s.familySize || 0,
        'Monthly Support ($)': s.monthlyRate || 0,
        'Faith Level': s.faithStatus,
        'Needs / Requests': s.needs || '',
        'Special Notes': s.bio || '',
        ...(s.missionFieldId.includes('other') ? { 'Nationality': s.nationality || '' } : {}),
        'Total Received': sDonations.reduce((sum, d) => sum + d.amount, 0),
        'Last Updated': s.updatedAt?.toDate ? format(s.updatedAt.toDate(), 'yyyy-MM-dd') : ''
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Recipients");
    XLSX.writeFile(wb, `Recipients_${activeSubTab}.xlsx`);
  };

  if (loading || !isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-emerald-600">
        <div className="flex flex-col items-center gap-4">
          <Heart className="w-16 h-16 text-white animate-pulse" />
          <div className="text-center">
            <p className="text-2xl font-bold text-white mb-1">{t('loadingJoy')}</p>
            <p className="text-xs text-emerald-200 uppercase tracking-widest font-bold">{t('loadingJoySub')}</p>
          </div>
          <button 
            onClick={() => setLoading(false)}
            className="mt-8 text-xs text-emerald-300 hover:text-white transition-colors"
          >
            Skip Loading
          </button>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen flex flex-col bg-slate-50">
        {/* Navigation */}
        <nav className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 min-h-16 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 cursor-pointer" onClick={() => { setMainTab('charity'); setActiveSubTab('cambodia'); }}>
              <div className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 bg-gradient-to-br from-cyan-400 to-cyan-600 rounded-xl flex items-center justify-center shadow-lg shadow-cyan-100">
                <Heart className="text-white w-5 h-5 sm:w-6 sm:h-6 fill-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl md:text-2xl font-black tracking-tight text-slate-900 leading-none truncate">Mission Blessings</h1>
                <p className="text-[11px] sm:text-[10px] uppercase tracking-[0.12em] sm:tracking-[0.2em] text-emerald-600 font-black mt-1 truncate">{t('outreachFoundation')}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
              <LanguageSwitcher />
              {user && isAdmin && (
                <div className="hidden md:flex items-center gap-2">
                  {missionFields.length === 0 && (
                    <button 
                      onClick={seedInitialData}
                      className="px-4 py-2 bg-slate-600 text-white rounded-lg text-xs font-bold hover:bg-slate-700 transition-all shadow-md shadow-slate-100"
                    >
                      Seed Data
                    </button>
                  )}
                  <button 
                    onClick={handleResetData}
                    className="flex items-center gap-2 px-4 py-2 bg-rose-50 text-rose-600 rounded-lg text-xs font-bold hover:bg-rose-100 transition-all border border-rose-100"
                  >
                    <ShieldAlert className="w-3 h-3" />
                    Reset System
                  </button>
                </div>
              )}
              {!isAdmin && (
                <button
                  type="button"
                  onClick={handleLogin}
                  disabled={isLoggingIn}
                  className="px-3 sm:px-4 py-2 bg-slate-800 text-white rounded-lg text-xs font-bold hover:bg-slate-700 transition-all flex items-center gap-2 shadow-sm disabled:opacity-60"
                >
                  {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                  <span>{isLoggingIn ? t('signingIn') : t('adminLogin')}</span>
                </button>
              )}
              {user && (
                <div className="flex items-center gap-2 sm:gap-4 sm:pl-4 sm:border-l border-slate-200">
                  <div className="text-right hidden sm:block">
                    <p className="text-xs font-bold text-slate-800">{user.displayName}</p>
                    <div className="flex items-center justify-end gap-1 mt-0.5">
                      {isAdmin ? (
                        <div className="flex items-center gap-1 bg-slate-600 text-white px-2 py-0.5 rounded-full">
                          <ShieldCheck className="w-3 h-3" />
                          <p className="text-[8px] uppercase tracking-wider font-black">
                            {t('director')}
                          </p>
                        </div>
                      ) : (
                        <p className="text-[9px] uppercase tracking-wider font-bold text-slate-600">
                          {t('guestPartner')}
                        </p>
                      )}
                    </div>
                  </div>
                  <button onClick={handleLogout} className="p-2.5 sm:p-2 hover:bg-slate-100 rounded-lg transition-all text-slate-400 hover:text-slate-600" title="Logout">
                    <LogOut className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </nav>
        {loginError && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-center">
            <p className="text-sm text-amber-800 font-medium">{loginError}</p>
            <p className="text-xs text-amber-700 mt-1">Chrome에서 http://localhost:3001/ 을 연 다음, pastoreom2@gmail.com 계정으로 선택해 주세요.</p>
          </div>
        )}

        <main className="flex-grow">
          {/* Hero Section */}
          <section className="relative h-[52vh] sm:h-[80vh] flex items-center justify-center overflow-hidden">
            <div className="absolute inset-0">
              <img 
                src="https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&q=80&w=1920" 
                alt="Sunrise Field" 
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-slate-900/40 via-transparent to-white/95" />
            </div>
            
            <div className="relative z-10 text-center px-4 max-w-6xl -mt-7 w-full">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 1 }}
                className="flex flex-col items-center"
              >
                <div className="mb-5 sm:mb-6 px-5 sm:px-10 py-2.5 sm:py-3 bg-white/5 backdrop-blur-sm border border-white/20 rounded-full max-w-full">
                  <span className="text-xs sm:text-[11px] md:text-[13px] font-bold uppercase tracking-[0.25em] sm:tracking-[0.5em] md:tracking-[1em] text-white/90">
                    {t('spreadingJoy')}
                  </span>
                </div>

                <h1 className="text-[2rem] sm:text-4xl md:text-7xl font-sans font-bold text-white mb-6 md:mb-10 tracking-tight leading-[1.1] drop-shadow-lg">
                  {t('heroTitle1')} <br/> {t('heroTitle2')}
                </h1>
                
                <div className="flex flex-col items-center gap-3 md:gap-4 px-2">
                  {t('verseKo') && (
                    <div className="text-xl sm:text-2xl md:text-4xl font-serif font-black italic text-white drop-shadow-lg">
                      "{t('verseKo')}"
                    </div>
                  )}
                  {t('verseEn') && (
                    <div className="text-sm sm:text-sm md:text-base font-display font-extrabold italic text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.85),0_2px_12px_rgba(0,0,0,0.55)]">
                      "{t('verseEn')}"
                    </div>
                  )}
                  <div className="text-[11px] sm:text-[10px] md:text-xs font-black tracking-[0.35em] sm:tracking-[0.6em] uppercase text-white drop-shadow-lg mt-3">
                    {t('verseRef')}
                  </div>
                </div>
              </motion.div>
            </div>
          </section>

          <div id="explore" className="max-w-7xl mx-auto px-3 sm:px-6 mt-4 relative z-20 pb-32 scroll-mt-24">
            {/* Main Tabs */}
            <div className="flex flex-col items-center gap-6 sm:gap-10 md:gap-12 w-full">
              <div className="grid grid-cols-2 gap-2 md:flex md:items-stretch bg-white p-2 sm:p-2.5 rounded-3xl md:rounded-[3rem] shadow-2xl shadow-slate-900/10 border border-slate-100 w-full max-w-4xl">
                <button
                  onClick={() => setMainTab('charity')}
                  className={cn(
                    "min-w-0 py-4 px-3 sm:py-4 sm:px-3 md:flex-1 md:py-5 md:px-4 rounded-2xl md:rounded-[2.5rem] transition-all font-black text-sm leading-snug sm:text-base md:text-lg flex flex-col md:flex-row items-center justify-center gap-1.5 sm:gap-2 md:gap-3 text-center group",
                    mainTab === 'charity' 
                      ? "bg-emerald-500 text-white shadow-xl shadow-emerald-200" 
                      : "text-slate-500 hover:bg-slate-50"
                  )}
                >
                  <Globe className={cn("w-5 h-5 sm:w-5 sm:h-5 md:w-6 md:h-6 shrink-0", mainTab === 'charity' ? "text-white/80" : "text-emerald-500")} />
                  <span className="break-words hyphens-auto">{t('tabCharity')}</span>
                </button>
                <button
                  onClick={() => setMainTab('media')}
                  className={cn(
                    "min-w-0 py-4 px-3 sm:py-4 sm:px-3 md:flex-1 md:py-5 md:px-4 rounded-2xl md:rounded-[2.5rem] transition-all font-black text-sm leading-snug sm:text-base md:text-lg flex flex-col md:flex-row items-center justify-center gap-1.5 sm:gap-2 md:gap-3 text-center group",
                    mainTab === 'media' 
                      ? "bg-emerald-500 text-white shadow-xl shadow-emerald-200" 
                      : "text-slate-500 hover:bg-slate-50"
                  )}
                >
                  <Youtube className={cn("w-5 h-5 sm:w-5 sm:h-5 md:w-6 md:h-6 shrink-0", mainTab === 'media' ? "text-white/80" : "text-emerald-500")} />
                  <span className="break-words hyphens-auto">{t('tabWord')}</span>
                </button>
                <button
                  onClick={() => setMainTab('prayer')}
                  className={cn(
                    "min-w-0 py-4 px-3 sm:py-4 sm:px-3 md:flex-1 md:py-5 md:px-4 rounded-2xl md:rounded-[2.5rem] transition-all font-black text-sm leading-snug sm:text-base md:text-lg flex flex-col md:flex-row items-center justify-center gap-1.5 sm:gap-2 md:gap-3 text-center group",
                    mainTab === 'prayer' 
                      ? "bg-emerald-500 text-white shadow-xl shadow-emerald-200" 
                      : "text-slate-500 hover:bg-slate-50"
                  )}
                >
                  <Sparkles className={cn("w-5 h-5 sm:w-5 sm:h-5 md:w-6 md:h-6 shrink-0", mainTab === 'prayer' ? "text-white/80" : "text-emerald-500")} />
                  <span className="break-words hyphens-auto">{t('tabPrayer')}</span>
                </button>
                <button
                  onClick={() => setMainTab('support')}
                  className={cn(
                    "min-w-0 py-4 px-3 sm:py-4 sm:px-3 md:flex-1 md:py-5 md:px-4 rounded-2xl md:rounded-[2.5rem] transition-all font-black text-sm leading-snug sm:text-base md:text-lg flex flex-col md:flex-row items-center justify-center gap-1.5 sm:gap-2 md:gap-3 text-center group",
                    mainTab === 'support' 
                      ? "bg-emerald-500 text-white shadow-xl shadow-emerald-200" 
                      : "text-slate-500 hover:bg-slate-50"
                  )}
                >
                  <Heart className={cn("w-5 h-5 sm:w-5 sm:h-5 md:w-6 md:h-6 shrink-0", mainTab === 'support' ? "text-white/80" : "text-emerald-500")} />
                  <span className="break-words hyphens-auto">{t('tabSupport')}</span>
                </button>
              </div>

              {/* Admin Panel as a secondary button below if needed */}
              {isAdmin && (
                <div className="flex gap-4">
                  <button
                    onClick={() => setMainTab('donors')}
                    className={cn(
                      "px-6 sm:px-8 py-3 rounded-full transition-all font-bold text-sm flex items-center gap-2",
                      mainTab === 'donors' 
                        ? "bg-slate-800 text-white shadow-lg shadow-slate-200" 
                        : "bg-white text-slate-500 border border-slate-200 hover:border-slate-300"
                    )}
                  >
                    <Users className="w-4 h-4" />
                    {t('adminPanel')}
                  </button>
                </div>
              )}

              {/* Sub Tabs for Charity & Mission */}
              {mainTab === 'charity' && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-wrap justify-center gap-2 sm:gap-2.5 w-full px-1"
                >
                  {[
                    { id: 'cambodia', label: t('cambodia') },
                    { id: 'mexico', label: t('mexico') },
                    { id: 'usa', label: t('usa') },
                    { id: 'other', label: t('otherNations') }
                  ].map((sub) => (
                    <button
                      key={sub.id}
                      onClick={() => setActiveSubTab(sub.id as any)}
                      className={cn(
                        "px-4 sm:px-6 py-2.5 sm:py-2 rounded-full font-bold text-sm sm:text-xs transition-all border-2",
                        activeSubTab === sub.id
                          ? "bg-orange-500 border-orange-500 text-white shadow-md shadow-orange-100"
                          : "bg-white border-slate-200 text-slate-500 hover:border-orange-200"
                      )}
                    >
                      {sub.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </div>

            <div className="mt-12">
              <AnimatePresence mode="wait">
                <motion.div
                  key={mainTab === 'charity' ? activeSubTab : mainTab}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.4 }}
                >
                  {mainTab === 'support' ? (
                    <DonationSection />
                  ) : mainTab === 'media' ? (
                    <div id="devotional">
                      <YouTubeGallerySection setActiveVideoId={setActiveVideoId} isAdmin={isAdmin} handleLogin={handleLogin} />
                    </div>
                  ) : mainTab === 'prayer' ? (
                    <PrayerRoomView prayerRequests={prayerRequests} user={user} isAdmin={isAdmin} />
                  ) : mainTab === 'donors' ? (
                    <DonorsView 
                      donors={donors.length > 0 ? donors : MOCK_DONORS} 
                      donations={donations.length > 0 ? donations : MOCK_DONATIONS} 
                      supporters={supporters.length > 0 ? supporters : MOCK_SUPPORTERS} 
                    />
                  ) : (
                    <MissionFieldView 
                      type={activeSubTab} 
                      isAdmin={isAdmin} 
                      supporters={(() => {
                        const fieldName = activeSubTab === 'other' ? 'Other Nations' : activeSubTab;
                        const field = missionFields.find(f => f.name.toLowerCase() === fieldName.toLowerCase());
                        const fallbackId = 'temp-' + fieldName;
                        const fieldId = field?.id || fallbackId;
                        if (supporters.length === 0) {
                          return field && !field.id.startsWith('temp-')
                            ? []
                            : MOCK_SUPPORTERS.filter(s => s.missionFieldId === fallbackId);
                        }
                        const matched = supporters.filter(s => s.missionFieldId === fieldId);
                        return matched.length > 0 ? matched : supporters.filter(s => s.missionFieldId === fallbackId);
                      })()}
                      donations={donations.length > 0 ? donations : MOCK_DONATIONS}
                      donors={donors.length > 0 ? donors : MOCK_DONORS}
                      activities={(() => {
                        const fieldName = activeSubTab === 'other' ? 'Other Nations' : activeSubTab;
                        const field = missionFields.find(f => f.name.toLowerCase() === fieldName.toLowerCase());
                        const fieldId = field?.id || 'temp-' + fieldName;
                        
                        const sourceActivities = activities.length > 0 ? activities : MOCK_ACTIVITIES;
                        return sourceActivities.filter(a => a.missionFieldId === fieldId);
                      })()}
                      onExport={() => {
                        const fieldName = activeSubTab === 'other' ? 'Other Nations' : activeSubTab;
                        const field = missionFields.find(f => f.name.toLowerCase() === fieldName.toLowerCase());
                        const fieldId = field?.id || 'temp-' + fieldName;
                        const sourceSupporters = supporters.length > 0 ? supporters : MOCK_SUPPORTERS;
                        exportToExcel(sourceSupporters.filter(s => s.missionFieldId === fieldId));
                      }}
                      missionField={(() => {
                        const fieldName = activeSubTab === 'other' ? 'Other Nations' : activeSubTab;
                        const found = missionFields.find(f => f.name.toLowerCase() === fieldName.toLowerCase());
                        if (found) return found;
                        
                        // Fallback to default structure for guests/initial loading
                        const defaultField = DEFAULT_MISSION_FIELDS.find(f => f.name.toLowerCase() === fieldName.toLowerCase());
                        if (defaultField) return { id: 'temp-' + fieldName, ...defaultField } as MissionField;
                        
                        return undefined;
                      })()}
                      user={user}
                      handleLogin={handleLogin}
                      isLoggingIn={isLoggingIn}
                      onSeed={seedInitialData}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </main>

        <AnimatePresence>
          {(activeVideoId || activeVideoPlaylistId) && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => { setActiveVideoId(null); setActiveVideoPlaylistId(null); }}
                className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="relative w-full max-w-5xl aspect-video bg-black rounded-[2rem] overflow-hidden shadow-2xl border border-white/10"
              >
                <button 
                  onClick={() => { setActiveVideoId(null); setActiveVideoPlaylistId(null); }}
                  className="absolute top-6 right-6 z-10 w-12 h-12 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center text-white transition-all group"
                >
                  <X className="w-6 h-6 group-hover:rotate-90 transition-transform duration-300" />
                </button>
                <iframe
                  key={activeVideoId || activeVideoPlaylistId}
                  src={activeVideoPlaylistId 
                    ? `https://www.youtube.com/embed/videoseries?list=${activeVideoPlaylistId}&autoplay=1&mute=1&enablejsapi=1`
                    : `https://www.youtube.com/embed/${activeVideoId}?autoplay=1&mute=1&enablejsapi=1`
                  }
                  title="YouTube video player"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  className="w-full h-full"
                />
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {directSupportId && (
            <DirectSupportModal 
              supporterId={directSupportId} 
              onClose={() => {
                setDirectSupportId(null);
                window.history.replaceState({}, '', window.location.pathname);
              }} 
            />
          )}
        </AnimatePresence>

        {/* Footer */}
        <footer className="bg-slate-900 py-16 text-white">
          <div className="max-w-7xl mx-auto px-6 text-center">
            <div className="flex flex-col items-center gap-6">
              <div className="w-16 h-16 bg-gradient-to-br from-cyan-400 to-cyan-600 rounded-2xl flex items-center justify-center shadow-xl shadow-cyan-900/40">
                <Heart className="text-white w-9 h-9 fill-white" />
              </div>
              <h3 className="text-2xl font-bold">Mission Blessings Outreach Foundation</h3>
              <p className="text-slate-400 max-w-xl mx-auto">
                {t('footerBlurb')}
              </p>
              <div className="pt-8 border-t border-white/10 w-full">
                <p className="text-[10px] uppercase tracking-[0.4em] text-slate-500 font-black">
                  © {new Date().getFullYear()} Mission Blessings. {t('allRights')}
                </p>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </ErrorBoundary>
  );
}

function MissionFieldView({ 
  type, 
  isAdmin, 
  supporters, 
  donations, 
  donors,
  activities,
  onExport,
  missionField,
  user,
  handleLogin,
  isLoggingIn,
  onSeed
}: { 
  type: string, 
  isAdmin: boolean, 
  supporters: Supporter[],
  donations: Donation[],
  donors: Donor[],
  activities: Activity[],
  onExport: () => void,
  missionField?: MissionField,
  user: User | null,
  handleLogin: () => void,
  isLoggingIn: boolean,
  onSeed: () => void
}) {
  const [isAddingSupporter, setIsAddingSupporter] = useState(false);
  const [isAddingActivity, setIsAddingActivity] = useState(false);
  const [showRegistration, setShowRegistration] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  /* Ensure table starts at the left side in the RTL container */
  React.useLayoutEffect(() => {
    const timer = setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollLeft = -scrollRef.current.scrollWidth;
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [missionField.id]);

  const [filterType, setFilterType] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [sortColumn, setSortColumn] = useState<'nameEn' | 'nameKh' | 'totalDonations'>('nameEn');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  if (!missionField) {
    return (
      <div className="py-20 text-center card bg-white border-dashed border-2 border-orange-100">
        <Clock className="w-12 h-12 mx-auto text-orange-200 mb-4 animate-pulse" />
        <p className="text-slate-400 font-bold">미션 데이터를 불러오는 중...</p>
        <p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest">Initializing Mission View...</p>
        {isAdmin && (
          <div className="mt-8 p-8 bg-orange-50 rounded-[2.5rem] border-2 border-orange-100 max-w-md mx-auto">
            <ShieldAlert className="w-12 h-12 text-orange-400 mx-auto mb-4" />
            <h4 className="text-xl font-bold text-orange-800 mb-2">시스템 초기화</h4>
            <p className="text-sm text-slate-600 mb-6 font-medium">
              미션 데이터베이스가 비어 있습니다. 디렉터로서 기본 미션 필드와 후원자 데이터를 생성할 수 있습니다.
            </p>
            <button 
              onClick={onSeed}
              className="w-full bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700 transition-all flex items-center justify-center gap-2 py-4 shadow-xl shadow-orange-200"
            >
              <Sparkles className="w-5 h-5" />
              미션 데이터 초기화 시작
            </button>
          </div>
        )}
        {!isAdmin && (
          <div className="mt-8 p-8 bg-orange-50 rounded-[2.5rem] border-2 border-orange-100 max-w-md mx-auto">
            <Heart className="w-12 h-12 text-orange-400 mx-auto mb-4" />
            <h4 className="text-xl font-bold text-orange-800 mb-2">미션 블레싱에 오신 것을 환영합니다</h4>
            <p className="text-sm text-slate-600 mb-6 font-medium">
              현재 미션 데이터를 준비 중입니다. 곧 새로운 소식과 후원 기회를 확인하실 수 있습니다.
            </p>
            {!user && (
              <button onClick={handleLogin} className="bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700 transition-all px-8 py-3 w-full">로그인하여 전체 기능 사용하기</button>
            )}
          </div>
        )}
      </div>
    );
  }

  const filteredActivities = activities.filter(activity => {
    const matchesType = filterType === 'all' || activity.type === filterType;
    const activityDate = activity.date?.toDate ? activity.date.toDate() : new Date();
    
    // Normalize dates for comparison
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    if (end) end.setHours(23, 59, 59, 999);

    const matchesStartDate = !start || activityDate >= start;
    const matchesEndDate = !end || activityDate <= end;
    return matchesType && matchesStartDate && matchesEndDate;
  });

  const activityTypes = Array.from(new Set(activities.map(a => a.type).filter(Boolean))) as string[];

  const sortedSupporters = [...supporters].sort((a, b) => {
    const unnamedA = isUnnamedRecipient(a);
    const unnamedB = isUnnamedRecipient(b);
    if (unnamedA !== unnamedB) return unnamedA ? 1 : -1;

    if (sortColumn === 'totalDonations') {
      const totalA = donations.filter(d => d.supporterId === a.id).reduce((sum, d) => sum + d.amount, 0);
      const totalB = donations.filter(d => d.supporterId === b.id).reduce((sum, d) => sum + d.amount, 0);
      return sortDirection === 'asc' ? totalA - totalB : totalB - totalA;
    }

    const nameA = getRecipientNameForSort(a).toLowerCase();
    const nameB = getRecipientNameForSort(b).toLowerCase();
    if (sortColumn === 'nameEn' || sortColumn === 'nameKh') {
      const cmp = nameA.localeCompare(nameB, ['en', 'ko'], { numeric: true, sensitivity: 'base' });
      return sortDirection === 'asc' ? cmp : -cmp;
    }
    
    const valA = (a[sortColumn] || '').toString().toLowerCase();
    const valB = (b[sortColumn] || '').toString().toLowerCase();
    
    if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
    if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (column: 'nameEn' | 'nameKh' | 'totalDonations') => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const SortIcon = ({ column }: { column: 'nameEn' | 'nameKh' | 'totalDonations' }) => {
    if (sortColumn !== column) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 ml-1 text-slate-600" /> : <ArrowDown className="w-3 h-3 ml-1 text-slate-600" />;
  };

  const isTemp = missionField.id.startsWith('temp-');

  return (
    <div className="space-y-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-2xl sm:text-4xl font-black text-slate-800 mb-1">
            {missionField.name === 'Cambodia' ? t('cambodia')
              : missionField.name === 'Mexico' ? t('mexico')
              : missionField.name === 'USA' ? t('usa')
              : missionField.name === 'Other Nations' ? t('otherNations')
              : missionField.name}
          </h2>
          <p className="text-slate-500 font-black uppercase tracking-widest text-[10px]">{t('missionTracking')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isAdmin && (
            <button 
              type="button"
              onClick={handleLogin}
              disabled={isLoggingIn}
              className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200 transition-all flex items-center gap-2 disabled:opacity-60"
            >
              {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              <span>{isLoggingIn ? t('signingIn') : t('adminLogin')}</span>
            </button>
          )}
          <button onClick={onExport} className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200 transition-all flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4" />
            <span>{t('exportList')}</span>
          </button>
          
          {isAdmin && missionField.name === 'Cambodia' && (
            <button 
              onClick={async () => {
                const missingNames = [
                  'Serey', 'Vanna', 'Chavy', 'Borey', 'Dara', 'Kalyan', 'Mony', 'Phala', 
                  'Rithy', 'Sokha', 'Thyda', 'Veasna', 'Vibol', 'Arun', 'Chandra', 
                  'Kannitha', 'Makara', 'Narith', 'Sovan', 'Vannak'
                ];
                
                for (const name of missingNames) {
                  const exists = supporters.some(s => s.nameEn === name && s.missionFieldId === missionField.id);
                  if (!exists) {
                    await addDoc(collection(db, 'supporters'), {
                      nameEn: name,
                      isPastor: false,
                      churchAttendance: 'Weekly',
                      faithStatus: 'Baptized',
                      qrCodeData: '',
                      updatedAt: Timestamp.now(),
                      missionFieldId: missionField.id,
                      monthlyRate: 30,
                      bio: '',
                      familySize: 4
                    });
                  }
                }
                alert('Cambodia recipients updated!');
              }}
              className="px-4 py-2 bg-slate-600 text-white rounded-lg text-xs font-bold hover:bg-slate-700 transition-all flex items-center gap-2 shadow-md shadow-slate-100"
            >
              <Sparkles className="w-4 h-4" />
              <span>Sync Cambodia Names</span>
            </button>
          )}
          
          {isAdmin && (
            <button 
              onClick={() => type === 'usa' ? setIsAddingActivity(true) : setIsAddingSupporter(true)}
              className="px-4 py-2 bg-slate-600 text-white rounded-lg text-xs font-bold hover:bg-slate-700 transition-all flex items-center gap-2 shadow-md shadow-slate-100"
            >
              <Plus className="w-4 h-4" />
              <span>{type === 'usa' ? t('addActivity') : t('addRecipient')}</span>
            </button>
          )}
        </div>
      </div>

      {type === 'usa' ? (
        <div className="space-y-8">
          {/* USA Specific Ads & Announcements Box */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 border-2 border-emerald-600 rounded-3xl p-8 text-slate-800 shadow-sm relative overflow-hidden">
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-4">
                  <Megaphone className="w-5 h-5 text-slate-600" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">Announcements</span>
                </div>
                <h3 className="text-3xl font-black mb-4 leading-tight">Evangelism & Charity <br/>Activities</h3>
                <p className="text-slate-600 text-sm mb-8 max-w-xl leading-relaxed">
                  Join our upcoming local outreach programs. We are currently organizing community food drives and weekend youth mentoring sessions across the USA.
                </p>
                <div className="flex flex-wrap gap-4">
                  <button 
                    onClick={() => setShowRegistration(true)}
                    className="px-6 py-3 bg-slate-600 text-white rounded-xl font-bold hover:bg-slate-700 transition-all shadow-lg active:scale-95"
                  >
                    Register Now
                  </button>
                  <button 
                    onClick={() => setShowSchedule(true)}
                    className="px-6 py-3 border-2 border-slate-600 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-all active:scale-95"
                  >
                    View Schedule
                  </button>
                </div>
              </div>
            </div>

            <div className="border-2 border-slate-600 rounded-3xl p-8 text-slate-800 shadow-sm relative overflow-hidden flex flex-col justify-between">
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-4">
                  <Heart className="w-5 h-5 text-slate-600" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">Special Ad</span>
                </div>
                <h3 className="text-2xl font-black mb-4 leading-tight">Support Local Families</h3>
                <p className="text-slate-600 text-xs mb-8 leading-relaxed">
                  Your donations directly impact local communities through our "Blessing Box" initiative.
                </p>
              </div>
              <button className="relative z-10 w-full py-4 bg-slate-600 text-white rounded-xl font-bold hover:bg-slate-700 transition-all shadow-lg active:scale-95">
                Donate to USA
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredActivities.map(activity => (
              <ActivityCard key={activity.id} activity={activity} isAdmin={isAdmin} />
            ))}
            {filteredActivities.length === 0 && (
              <div className="col-span-full py-20 text-center card bg-white border-dashed border-2 border-orange-100">
                <Camera className="w-12 h-12 mx-auto text-orange-200 mb-4" />
                <p className="text-slate-400 font-bold">No activities match your filters.</p>
              </div>
            )}
          </div>
        </div>
      ) : isSimplifiedMissionField(missionField.name) ? (
        <>
          <div className="lg:hidden space-y-4">
            <button
              type="button"
              onClick={() => handleSort('nameEn')}
              className="w-full flex items-center justify-between px-1 py-1 text-left"
            >
              <span className="font-black text-slate-700 text-sm">{t('sortByName')}</span>
              <SortIcon column="nameEn" />
            </button>
            {sortedSupporters.map((supporter) => (
              <CambodiaSupporterRow
                key={`card-${supporter.id}`}
                supporter={supporter}
                isAdmin={isAdmin}
                handleLogin={handleLogin}
                variant="card"
                showNationality={missionField.name === 'Other Nations'}
              />
            ))}
            {sortedSupporters.length === 0 && (
              <div className="px-6 py-16 text-center bg-white rounded-2xl border border-slate-200">
                <Users className="w-12 h-12 mx-auto text-slate-200 mb-4" />
                <p className="text-lg font-bold text-slate-400 mb-2">{t('noRecipients')}</p>
                <p className="text-sm text-slate-300">
                  {isAdmin
                    ? t('noRecipientsAdmin')
                    : t('noRecipientsGuest')}
                </p>
              </div>
            )}
          </div>
          <div className="hidden lg:block bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
            <div className="overflow-auto max-h-[640px]">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-100 border-b border-slate-200 sticky top-0 z-20">
                  <tr>
                    <th
                      className="w-48 px-4 py-3 border-r border-slate-200 cursor-pointer hover:bg-slate-200 transition-colors"
                      onClick={() => handleSort('nameEn')}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-black text-slate-700 text-sm">{t('recipientName')}</span>
                        <SortIcon column="nameEn" />
                      </div>
                    </th>
                    {missionField.name === 'Other Nations' && (
                      <th className="w-36 px-4 py-3 border-r border-slate-200 font-black text-slate-700 text-sm">{t('nationality')}</th>
                    )}
                    <th className="px-4 py-3 border-r border-slate-200 font-black text-slate-700 text-sm">{t('situationPrayer')}</th>
                    <th className="w-56 px-4 py-3 border-r border-slate-200 font-black text-slate-700 text-sm">{t('other')}</th>
                    <th className="w-80 px-4 py-3 font-black text-slate-700 text-sm">
                      <div>{t('photos')}</div>
                      <div className="font-medium text-[10px] text-slate-400 tracking-normal mt-0.5">{t('photosHint')}</div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedSupporters.map((supporter) => (
                    <CambodiaSupporterRow
                      key={`row-${supporter.id}`}
                      supporter={supporter}
                      isAdmin={isAdmin}
                      handleLogin={handleLogin}
                      variant="row"
                      showNationality={missionField.name === 'Other Nations'}
                    />
                  ))}
                  {sortedSupporters.length === 0 && (
                    <tr>
                      <td colSpan={missionField.name === 'Other Nations' ? 5 : 4} className="px-6 py-24 text-center bg-white">
                        <Users className="w-12 h-12 mx-auto text-slate-200 mb-4" />
                        <p className="text-lg font-bold text-slate-400 mb-2">{t('noRecipients')}</p>
                        <p className="text-sm text-slate-300">
                          {isAdmin
                            ? t('noRecipientsAdmin')
                            : t('noRecipientsGuest')}
                        </p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xl font-mono text-[11px] overflow-hidden">
          <div ref={scrollRef} className="excel-container h-[600px]">
            <div className="excel-container-inner min-w-max">
              <table className="text-left border-collapse table-fixed min-w-[2200px]">
                <thead className="bg-slate-200 border-b border-slate-300 sticky top-0 z-30">
                  <tr>
                    <th className="w-8 border-r border-slate-300 text-center bg-slate-200 py-2">
                      <div className="flex flex-col items-center justify-center">
                        <span className="text-slate-500">#</span>
                        {isAdmin && <ShieldCheck className="w-3 h-3 text-slate-600" title="Admin Mode Active" />}
                      </div>
                    </th>
                    <th 
                      className="w-40 px-2 py-2 border-r border-slate-300 cursor-pointer hover:bg-slate-300 transition-colors group"
                      onClick={() => handleSort('nameEn')}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-black text-slate-700 uppercase tracking-widest">Recipient Name</span>
                        <SortIcon column="nameEn" />
                      </div>
                    </th>
                    {missionField.name === 'Other Nations' && (
                      <th className="w-28 px-2 py-2 border-r border-slate-300 font-black text-slate-700 uppercase tracking-widest">NATIONALITY</th>
                    )}
                    <th className="w-16 px-4 py-4 border-r border-slate-100 text-center font-black text-slate-400 uppercase tracking-widest">FAMILY SIZE</th>
                    <th className="w-24 px-4 py-4 border-r border-slate-100 font-black text-slate-400 uppercase tracking-widest">MONTHLY SUPPORT</th>
                    <th className="w-32 px-4 py-4 border-r border-slate-100 font-black text-slate-400 uppercase tracking-widest">AREA / REGION</th>
                    <th className="w-28 px-4 py-4 border-r border-slate-100 font-black text-slate-400 uppercase tracking-widest">FAITH LEVEL</th>
                    <th className="w-64 px-4 py-4 border-r border-slate-100 font-black text-slate-400 uppercase tracking-widest">NEEDS / REQUESTS</th>
                    <th className="w-20 px-4 py-4 border-r border-slate-100 text-center font-black text-slate-400 uppercase tracking-widest">QR CODE</th>
                    <th className="w-64 px-4 py-4 border-r border-slate-100 font-black text-slate-400 uppercase tracking-widest">SPECIAL NOTES (EN)</th>
                    <th className="w-10 px-2 py-4 text-center font-black text-slate-400 uppercase tracking-widest">DEL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedSupporters.map((supporter, idx) => (
                    <SupporterRow 
                      key={supporter.id} 
                      supporter={supporter} 
                      donations={donations.filter(d => d.supporterId === supporter.id)}
                      donors={donors}
                      isAdmin={isAdmin}
                      missionFieldId={missionField.id}
                      index={idx + 1}
                    />
                  ))}
                  {sortedSupporters.length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-6 py-32 text-center bg-white">
                        <div className="max-w-md mx-auto">
                          <Users className="w-16 h-16 mx-auto text-slate-200 mb-6" />
                          <p className="text-xl font-bold text-slate-400 mb-2">No data available in this sheet.</p>
                          <p className="text-sm text-slate-300 mb-8">
                            {isAdmin 
                              ? "As a Director, you can add new recipients or use the Sync button to populate this mission field."
                              : "The mission data is currently being updated by the Director. Please check back soon."}
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {isAddingSupporter && (
        <AddSupporterModal onClose={() => setIsAddingSupporter(false)} missionFieldId={missionField.id} simplified={isSimplifiedMissionField(missionField.name)} />
      )}
      {isAddingActivity && (
        <AddActivityModal onClose={() => setIsAddingActivity(false)} missionFieldId={missionField.id} />
      )}
      
      <AnimatePresence>
        {showRegistration && (
          <RegistrationModal onClose={() => setShowRegistration(false)} />
        )}
        {showSchedule && (
          <AnnouncementBoardModal onClose={() => setShowSchedule(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function RecipientPhotosCell({ supporter, isAdmin, handleLogin, size = 'sm' }: { supporter: Supporter, isAdmin: boolean, handleLogin?: () => void, size?: 'sm' | 'lg' }) {
  const { t } = useI18n();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [photoUrls, setPhotoUrls] = useState<string[]>(supporter.photoUrls || []);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    setPhotoUrls(supporter.photoUrls || []);
  }, [supporter.id, supporter.photoUrls]);

  const persistPhotos = async (next: string[]) => {
    setPhotoUrls(next);
    if (supporter.id.startsWith('mock-') || supporter.id.startsWith('temp-')) return;
    try {
      await updateDoc(doc(db, 'supporters', supporter.id), {
        photoUrls: next,
        updatedAt: Timestamp.now()
      });
    } catch (error) {
      console.error('Error saving photos', error);
    }
  };

  const addImageBlobs = async (files: Blob[]) => {
    const remaining = MAX_RECIPIENT_PHOTOS - photoUrls.length;
    if (remaining <= 0) {
      alert(`사진은 최대 ${MAX_RECIPIENT_PHOTOS}장까지 넣을 수 있습니다.`);
      return;
    }
    const selected = files.slice(0, remaining);
    setIsUploading(true);
    try {
      const compressed = await Promise.all(selected.map(file => compressImageFile(file)));
      await persistPhotos([...photoUrls, ...compressed]);
    } catch (error) {
      console.error('Error compressing photos', error);
      alert('사진을 넣지 못했습니다. 다른 이미지로 다시 시도해 주세요.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const images = Array.from(list).filter(file => file.type.startsWith('image/'));
    if (images.length === 0) return;
    addImageBlobs(images);
  };

  const handlePasteFromClipboard = async () => {
    try {
      const items = await navigator.clipboard.read();
      const blobs: Blob[] = [];
      for (const item of items) {
        const type = item.types.find(t => t.startsWith('image/'));
        if (type) blobs.push(await item.getType(type));
      }
      if (blobs.length === 0) {
        alert('클립보드에 사진이 없습니다. 사진을 복사(Ctrl+C)한 다음 다시 눌러 주세요.');
        return;
      }
      await addImageBlobs(blobs);
    } catch {
      alert('붙여넣기를 허용해 주세요. 또는 업로드 버튼으로 파일을 선택하세요.');
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.clipboardData.items);
    const imageItems = items.filter(item => item.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    event.preventDefault();
    const blobs = imageItems
      .map(item => item.getAsFile())
      .filter((file): file is File => !!file);
    addImageBlobs(blobs);
  };

  const removePhoto = async (index: number) => {
    if (!isAdmin) return;
    const next = photoUrls.filter((_, i) => i !== index);
    await persistPhotos(next);
  };

  return (
    <>
      <div
        tabIndex={0}
        onPaste={handlePaste}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "min-h-[72px] rounded-lg p-1.5 outline-none transition-all",
          "border border-dashed border-slate-200 bg-slate-50/80",
          isAdmin && "focus:border-slate-400",
          isDragOver && "border-emerald-400 bg-emerald-50"
        )}
        title={isAdmin ? '사진을 붙여넣거나 업로드하세요 (최대 4장)' : '관리자 로그인 후 사진을 넣을 수 있습니다'}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {photoUrls.map((url, index) => (
            <div key={`${supporter.id}-photo-${index}`} className={cn("relative rounded-md overflow-hidden border border-slate-200 bg-white group/photo", size === 'lg' ? "w-20 h-20" : "w-14 h-14")}>
              <button type="button" onClick={() => setPreviewUrl(url)} className="w-full h-full">
                <img src={url} alt={`수혜자 사진 ${index + 1}`} className="w-full h-full object-cover" />
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => removePhoto(index)}
                  className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover/photo:opacity-100 transition-opacity"
                  title="사진 삭제"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
        {photoUrls.length < MAX_RECIPIENT_PHOTOS && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <label className="px-2 py-1 rounded-md bg-white border border-slate-200 text-[10px] font-bold text-slate-600 hover:border-emerald-400 hover:text-emerald-700 transition-all flex items-center gap-1 cursor-pointer">
              {isUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ImagePlus className="w-3 h-3" />}
              {t('upload')}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  handleFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
            <button
              type="button"
              onClick={handlePasteFromClipboard}
              disabled={isUploading}
              className="px-2 py-1 rounded-md bg-white border border-slate-200 text-[10px] font-bold text-slate-600 hover:border-emerald-400 hover:text-emerald-700 transition-all flex items-center gap-1"
            >
              <ClipboardPaste className="w-3 h-3" />
              {t('paste')}
            </button>
            <span className="text-[9px] text-slate-400 font-medium">{photoUrls.length}/{MAX_RECIPIENT_PHOTOS}</span>
          </div>
        )}
      </div>
      <AnimatePresence>
        {previewUrl && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPreviewUrl(null)}
              className="absolute inset-0 bg-slate-900/80"
            />
            <motion.img
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              src={previewUrl}
              alt="수혜자 사진"
              className="relative z-10 max-h-[85vh] max-w-[90vw] rounded-2xl shadow-2xl object-contain"
            />
            <button
              onClick={() => setPreviewUrl(null)}
              className="absolute top-6 right-6 z-20 w-10 h-10 rounded-full bg-white/15 text-white flex items-center justify-center hover:bg-white/25"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

function CambodiaSupporterRow({ supporter, isAdmin, handleLogin, variant = 'row', showNationality = false }: {
  supporter: Supporter,
  isAdmin: boolean,
  handleLogin?: () => void,
  variant?: 'row' | 'card',
  showNationality?: boolean,
  key?: string
}) {
  const { t, locale } = useI18n();
  const composed = composeCambodiaFields(supporter);
  const [localName, setLocalName] = useState(composed.name);
  const [localNationality, setLocalNationality] = useState(supporter.nationality || '');
  const [localSituation, setLocalSituation] = useState(composed.situation);
  const [localOther, setLocalOther] = useState(composed.other);
  const [viewName, setViewName] = useState(composed.name);
  const [viewNationality, setViewNationality] = useState(supporter.nationality || '');
  const [viewSituation, setViewSituation] = useState(composed.situation);
  const [viewOther, setViewOther] = useState(composed.other);
  const [isLocalizing, setIsLocalizing] = useState(false);
  const canEditContent = isAdmin && locale === 'mixed';

  useEffect(() => {
    const next = composeCambodiaFields(supporter);
    setLocalName(next.name);
    setLocalNationality(supporter.nationality || '');
    setLocalSituation(next.situation);
    setLocalOther(next.other);
  }, [
    supporter.id,
    supporter.nameEn,
    supporter.nameKh,
    supporter.nationality,
    supporter.faithStatus,
    supporter.area,
    supporter.needs,
    supporter.bio,
    supporter.additionalNotes,
    supporter.churchAttendance,
    supporter.situationPrayer,
    supporter.otherNotes
  ]);

  useEffect(() => {
    let cancelled = false;
    const source = {
      name: composed.name,
      situation: composed.situation,
      other: composed.other,
      nationality: supporter.nationality || '',
    };
    if (locale === 'mixed') {
      setViewName(source.name);
      setViewNationality(source.nationality);
      setViewSituation(source.situation);
      setViewOther(source.other);
      setIsLocalizing(false);
      return;
    }
    setIsLocalizing(true);
    localizeRecipientCopy(source, locale).then((localized) => {
      if (cancelled) return;
      setViewName(localized.name);
      setViewNationality(localized.nationality);
      setViewSituation(localized.situation);
      setViewOther(localized.other);
      setIsLocalizing(false);
    });
    return () => {
      cancelled = true;
    };
  }, [
    locale,
    composed.name,
    composed.situation,
    composed.other,
    supporter.nationality,
    supporter.id
  ]);

  const handleUpdate = async () => {
    if (!canEditContent) return;
    try {
      await updateDoc(doc(db, 'supporters', supporter.id), {
        nameEn: localName,
        ...(showNationality ? { nationality: localNationality } : {}),
        needs: localSituation,
        situationPrayer: localSituation,
        additionalNotes: localOther,
        otherNotes: localOther,
        updatedAt: Timestamp.now()
      });
    } catch (error) {
      console.error("Error updating recipient", error);
    }
  };

  const displayName = canEditContent ? localName : viewName;
  const displayNationality = canEditContent ? localNationality : viewNationality;
  const displaySituation = canEditContent ? localSituation : viewSituation;
  const displayOther = canEditContent ? localOther : viewOther;

  const cellInputClass = cn(
    "w-full outline-none px-3 py-2 rounded-lg transition-all text-sm leading-relaxed",
    canEditContent ? "bg-slate-50 border border-slate-200 focus:border-slate-400 focus:bg-white" : "bg-transparent border-transparent cursor-default",
    isLocalizing && locale !== 'mixed' && "opacity-70"
  );

  const deleteButton = isAdmin ? (
    <button
      onClick={async () => {
        if (confirm(t('deleteRecipient'))) {
          await deleteDoc(doc(db, 'supporters', supporter.id));
        }
      }}
      className={cn(
        "p-2 hover:bg-rose-50 rounded-lg text-slate-300 hover:text-rose-500 transition-all shrink-0",
        variant === 'row' && "mt-1 opacity-0 group-hover:opacity-100"
      )}
      title="삭제"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  ) : null;

  if (variant === 'card') {
    return (
      <article className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-4 min-w-0">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            {canEditContent ? (
              <>
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-1">{t('recipientName')}</p>
                <input
                  type="text"
                  value={localName}
                  onChange={(e) => setLocalName(e.target.value)}
                  onBlur={handleUpdate}
                  className="w-full outline-none px-3 py-2 rounded-lg font-bold text-[18px] leading-snug text-slate-900 bg-slate-50 border border-slate-200 focus:border-slate-400"
                  placeholder={t('recipientName')}
                />
              </>
            ) : (
              <h3 className="text-[18px] font-black text-slate-900 leading-snug break-words">{displayName || t('unnamed')}</h3>
            )}
          </div>
          {deleteButton}
        </div>
        {showNationality && (
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">{t('nationality')}</p>
            {canEditContent ? (
              <input
                type="text"
                value={localNationality}
                onChange={(e) => setLocalNationality(e.target.value)}
                onBlur={handleUpdate}
                className="w-full outline-none px-3 py-2 rounded-lg text-[16px] text-slate-800 bg-slate-50 border border-slate-200 focus:border-slate-400"
                placeholder={t('nationality')}
              />
            ) : (
              <p className="text-[16px] leading-7 text-slate-800 break-words">{displayNationality || <span className="text-slate-400">{t('nationality')}</span>}</p>
            )}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">{t('situationPrayer')}</p>
          <ExpandingField
            value={canEditContent ? localSituation : displaySituation}
            onChange={setLocalSituation}
            onBlur={handleUpdate}
            readOnly={!canEditContent}
            placeholder={t('situationPrayer')}
            minHeight={120}
            className="text-slate-800"
          />
        </div>
        {(canEditContent || displayOther.trim()) && (
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">{t('other')}</p>
            <ExpandingField
              value={canEditContent ? localOther : displayOther}
              onChange={setLocalOther}
              onBlur={handleUpdate}
              readOnly={!canEditContent}
              placeholder={t('other')}
              minHeight={72}
              className="text-slate-600"
            />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">{t('photos')}</p>
          <RecipientPhotosCell
            supporter={supporter}
            isAdmin={isAdmin}
            handleLogin={handleLogin}
            size="lg"
          />
        </div>
      </article>
    );
  }

  return (
    <tr className="hover:bg-slate-50 transition-colors group align-top">
      <td className="w-48 px-3 py-3 border-r border-slate-100">
        <input
          type="text"
          value={canEditContent ? localName : displayName}
          onChange={(e) => setLocalName(e.target.value)}
          onBlur={handleUpdate}
          readOnly={!canEditContent}
          className={cn(cellInputClass, "font-bold text-slate-800")}
          placeholder={t('recipientName')}
        />
      </td>
      {showNationality && (
        <td className="w-36 px-3 py-3 border-r border-slate-100">
          <input
            type="text"
            value={canEditContent ? localNationality : displayNationality}
            onChange={(e) => setLocalNationality(e.target.value)}
            onBlur={handleUpdate}
            readOnly={!canEditContent}
            className={cn(cellInputClass, "text-slate-700")}
            placeholder={t('nationality')}
          />
        </td>
      )}
      <td className="px-3 py-3 border-r border-slate-100">
        <textarea
          value={canEditContent ? localSituation : displaySituation}
          onChange={(e) => setLocalSituation(e.target.value)}
          onBlur={handleUpdate}
          readOnly={!canEditContent}
          className={cn(cellInputClass, "resize-y min-h-[72px] text-slate-700")}
          placeholder={t('situationPrayer')}
        />
      </td>
      <td className="w-56 px-3 py-3 border-r border-slate-100">
        <div className="flex items-start gap-2">
          <textarea
            value={canEditContent ? localOther : displayOther}
            onChange={(e) => setLocalOther(e.target.value)}
            onBlur={handleUpdate}
            readOnly={!canEditContent}
            className={cn(cellInputClass, "resize-y min-h-[72px] text-slate-600")}
            placeholder={t('other')}
          />
          {deleteButton}
        </div>
      </td>
      <td className="w-72 px-3 py-3">
        <RecipientPhotosCell
          supporter={supporter}
          isAdmin={isAdmin}
          handleLogin={handleLogin}
        />
      </td>
    </tr>
  );
}

function SupporterRow({ supporter, donations, donors, isAdmin, missionFieldId, index }: { 
  supporter: Supporter, 
  donations: Donation[],
  donors: Donor[],
  isAdmin: boolean,
  missionFieldId: string,
  index: number,
  key?: string
}) {
  const [showDonationForm, setShowDonationForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [localNameEn, setLocalNameEn] = useState(supporter.nameEn);
  const [localFamilySize, setLocalFamilySize] = useState(supporter.familySize || 0);
  const [localMonthlyRate, setLocalMonthlyRate] = useState(supporter.monthlyRate || 0);
  const [localFaithStatus, setLocalFaithStatus] = useState(supporter.faithStatus);
  const [localNeeds, setLocalNeeds] = useState(supporter.needs || '');
  const [localBio, setLocalBio] = useState(supporter.bio || '');
  const [localAdditionalNotes, setLocalAdditionalNotes] = useState(supporter.additionalNotes || '');
  const [localNationality, setLocalNationality] = useState(supporter.nationality || '');
  const [localArea, setLocalArea] = useState(supporter.area || '');
  
  const totalDonations = donations.reduce((sum, d) => sum + d.amount, 0);

  const handleUpdate = async () => {
    console.log("Updating supporter:", supporter.id, "isAdmin:", isAdmin);
    if (!isAdmin) return;
    try {
      await updateDoc(doc(db, 'supporters', supporter.id), {
        nameEn: localNameEn,
        familySize: Number(localFamilySize),
        monthlyRate: Number(localMonthlyRate),
        faithStatus: localFaithStatus,
        needs: localNeeds,
        bio: localBio,
        area: localArea,
        additionalNotes: localAdditionalNotes,
        nationality: localNationality,
        updatedAt: Timestamp.now()
      });
      setIsEditing(false);
    } catch (error) {
      console.error("Error updating recipient", error);
    }
  };

  const cellInputClass = cn(
    "w-full outline-none px-2 py-1.5 rounded-lg transition-all text-[11px]",
    isAdmin ? "bg-slate-50 border border-slate-200 focus:border-slate-400 focus:bg-white" : "bg-transparent border-transparent cursor-default"
  );

  return (
    <tr className="hover:bg-slate-50 transition-colors group border-b border-slate-100">
      <td className="w-8 border-r border-slate-100 py-4 text-center text-slate-300 bg-slate-50/50 select-none text-[10px] font-bold">
        {index}
      </td>
      <td className="w-40 px-3 py-2 border-r border-slate-100">
        <input 
          type="text"
          value={localNameEn}
          onChange={(e) => { setLocalNameEn(e.target.value); setIsEditing(true); }}
          onBlur={handleUpdate}
          readOnly={!isAdmin}
          className={cn(cellInputClass, "font-bold text-slate-600")}
          placeholder="Name"
          title={!isAdmin ? "View only mode" : ""}
        />
      </td>
      {missionFieldId.includes('other') && (
        <td className="w-28 px-3 py-2 border-r border-slate-100">
          <input 
            type="text"
            value={localNationality}
            onChange={(e) => { setLocalNationality(e.target.value); setIsEditing(true); }}
            onBlur={handleUpdate}
            readOnly={!isAdmin}
            className={cn(cellInputClass, "text-slate-500")}
            placeholder="Nationality"
            title={!isAdmin ? "View only mode" : ""}
          />
        </td>
      )}
      <td className="w-16 px-3 py-2 border-r border-slate-100">
        <input 
          type="number"
          value={localFamilySize}
          onChange={(e) => { setLocalFamilySize(Number(e.target.value)); setIsEditing(true); }}
          onBlur={handleUpdate}
          readOnly={!isAdmin}
          className={cn(cellInputClass, "text-center text-slate-500")}
          title={!isAdmin ? "View only mode" : ""}
        />
      </td>
      <td className="w-24 px-3 py-2 border-r border-slate-100">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300">$</span>
          <input 
            type="number"
            value={localMonthlyRate}
            onChange={(e) => { setLocalMonthlyRate(Number(e.target.value)); setIsEditing(true); }}
            onBlur={handleUpdate}
            readOnly={!isAdmin}
            className={cn(cellInputClass, "pl-6 font-black text-slate-600")}
            title={!isAdmin ? "View only mode" : ""}
          />
        </div>
      </td>
      <td className="w-32 px-3 py-2 border-r border-slate-100">
        <input 
          type="text"
          value={localArea}
          onChange={(e) => { setLocalArea(e.target.value); setIsEditing(true); }}
          onBlur={handleUpdate}
          readOnly={!isAdmin}
          className={cn(cellInputClass, "text-slate-500")}
          placeholder="Area..."
          title={!isAdmin ? "View only mode" : ""}
        />
      </td>
      <td className="w-28 px-3 py-2 border-r border-slate-100">
        <input 
          type="text"
          value={localFaithStatus}
          onChange={(e) => { setLocalFaithStatus(e.target.value); setIsEditing(true); }}
          onBlur={handleUpdate}
          readOnly={!isAdmin}
          className={cn(cellInputClass, "text-slate-500")}
          title={!isAdmin ? "View only mode" : ""}
        />
      </td>
      <td className="w-64 px-2 py-1.5 border-r border-slate-300">
        <textarea 
          value={localNeeds}
          onChange={(e) => { setLocalNeeds(e.target.value); setIsEditing(true); }}
          onBlur={handleUpdate}
          readOnly={!isAdmin}
          className={cn(cellInputClass, "resize-none h-6 py-0.5 leading-tight text-slate-600 font-bold")}
          placeholder="What is needed?"
          title={!isAdmin ? "View only mode" : ""}
        />
      </td>
      <td className="w-20 px-2 py-1.5 border-r border-slate-300">
        <div className="flex justify-center">
          <div className="p-0.5 bg-white border border-slate-200 rounded shadow-sm">
            <QRCode 
              value={`${window.location.origin}?supporterId=${supporter.id}`} 
              size={24}
              level="H"
            />
          </div>
        </div>
      </td>
      <td className="w-64 px-2 py-1.5 border-r border-slate-300">
        <textarea 
          value={localBio}
          onChange={(e) => { setLocalBio(e.target.value); setIsEditing(true); }}
          onBlur={handleUpdate}
          readOnly={!isAdmin}
          className={cn(cellInputClass, "resize-none h-6 py-0.5 leading-tight italic text-slate-500")}
          placeholder="Notes..."
          title={!isAdmin ? "View only mode" : ""}
        />
      </td>
      <td className="w-10 px-2 py-2 text-center">
        {isAdmin && (
          <button 
            onClick={async () => {
              if (confirm('Delete this row?')) {
                await deleteDoc(doc(db, 'supporters', supporter.id));
              }
            }}
            className="p-2 hover:bg-rose-50 rounded-xl text-slate-200 hover:text-rose-400 transition-all opacity-0 group-hover:opacity-100"
            title="Delete Row"
          >
            <Plus className="w-4 h-4 rotate-45" />
          </button>
        )}
      </td>

      {showDonationForm && (
        <AddDonationForm 
          supporterId={supporter.id} 
          donors={donors}
          missionFieldId={missionFieldId}
          onClose={() => setShowDonationForm(false)} 
        />
      )}
    </tr>
  );
}

function ActivityCard({ activity, isAdmin }: { activity: Activity, isAdmin: boolean, key?: React.Key }) {
  const [isEditing, setIsEditing] = useState(false);
  const [localTitle, setLocalTitle] = useState(activity.title);
  const [localDescription, setLocalDescription] = useState(activity.description);

  const handleUpdate = async () => {
    if (!isAdmin) return;
    try {
      await updateDoc(doc(db, 'activities', activity.id), {
        title: localTitle,
        description: localDescription,
        updatedAt: Timestamp.now()
      });
      setIsEditing(false);
    } catch (error) {
      console.error("Error updating activity", error);
    }
  };

  const handleDelete = async () => {
    if (!isAdmin) return;
    if (confirm('Delete this activity?')) {
      try {
        await deleteDoc(doc(db, 'activities', activity.id));
      } catch (error) {
        console.error("Error deleting activity", error);
      }
    }
  };

  return (
    <div className="card group hover:shadow-2xl transition-all duration-500 border-none shadow-xl shadow-orange-100/50 flex flex-col h-full">
      <div className="aspect-[4/3] bg-orange-50 overflow-hidden relative shrink-0">
        {activity.photoUrls?.[0] ? (
          <img src={activity.photoUrls[0]} alt={activity.title} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-orange-200">
            <Camera className="w-12 h-12" />
          </div>
        )}
        <div className="absolute top-6 left-6 flex flex-col gap-2">
          <span className="bg-white/90 backdrop-blur-xl px-4 py-1.5 rounded-full text-[10px] font-black text-orange-600 uppercase tracking-[0.2em] self-start shadow-lg">
            {activity.date?.toDate ? format(activity.date.toDate(), 'MMM d') : 'New'}
          </span>
          {activity.type && (
            <span className="bg-orange-600/90 backdrop-blur-xl px-4 py-1.5 rounded-full text-[10px] font-black text-white uppercase tracking-[0.2em] self-start shadow-lg">
              {activity.type}
            </span>
          )}
        </div>
        
        {isAdmin && (
          <button 
            onClick={handleDelete}
            className="absolute top-6 right-6 p-3 bg-rose-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all shadow-xl hover:bg-rose-600 active:scale-95"
            title="Delete Activity"
          >
            <Plus className="w-4 h-4 rotate-45" />
          </button>
        )}
      </div>
      <div className="p-10 flex-grow flex flex-col">
        {isAdmin ? (
          <div className="space-y-6 flex-grow flex flex-col">
            <input 
              type="text"
              value={localTitle}
              onChange={(e) => { setLocalTitle(e.target.value); setIsEditing(true); }}
              onBlur={handleUpdate}
              className="w-full text-3xl font-bold text-slate-800 bg-transparent border-b-2 border-transparent focus:border-sage-600 outline-none transition-all"
              placeholder="Activity Title"
            />
            <textarea 
              value={localDescription}
              onChange={(e) => { setLocalDescription(e.target.value); setIsEditing(true); }}
              onBlur={handleUpdate}
              className="w-full text-sm text-slate-500 leading-relaxed bg-transparent border-b-2 border-transparent focus:border-sage-600 outline-none transition-all resize-none flex-grow"
              placeholder="Activity Description"
              rows={4}
            />
            {isEditing && (
              <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] animate-pulse">Saving changes...</p>
            )}
          </div>
        ) : (
          <>
            <h4 className="text-3xl font-bold mb-4 text-slate-800 group-hover:text-slate-600 transition-colors leading-tight">{activity.title}</h4>
            <p className="text-sm text-slate-500 leading-relaxed line-clamp-3 font-medium">{activity.description}</p>
          </>
        )}
      </div>
    </div>
  );
}

function DonationSection() {
  const { t } = useI18n();
  return (
    <div className="max-w-4xl mx-auto">
      <div className="card p-12 bg-white shadow-2xl shadow-sage-200/30 border-none">
        <div className="text-center mb-12">
          <h3 className="text-4xl font-serif font-bold text-slate-800 mb-10">{t('supportTitle')}</h3>
          <h4 className="font-bold text-xl mb-3 text-slate-800">{t('writeChecks')}</h4>
          <div className="text-slate-500 text-sm leading-relaxed max-w-lg mx-auto space-y-1">
            <p>MBOF (Mission Blessings Outreach Foundation)</p>
            <p>9781 Harle Ave</p>
            <p>Anaheim Ca 92804</p>
          </div>
        </div>
        
        <div className="flex flex-col items-center space-y-12">
          <div className="flex flex-col items-center text-center gap-6 max-w-md">
            <div className="w-16 h-16 bg-sage-50 rounded-2xl flex items-center justify-center shrink-0">
              <QrCode className="w-8 h-8 text-slate-600" />
            </div>
            <div>
              <h4 className="font-bold text-xl mb-3 text-slate-800">{t('scanToDonate')}</h4>
              <p className="text-slate-500 text-sm mb-6 leading-relaxed">{t('scanBlurb')}</p>
              <div className="w-[320px] mx-auto bg-white border border-slate-200 rounded-3xl flex flex-col items-center overflow-hidden shadow-2xl">
                <div className="flex flex-col items-center pt-6 pb-6 px-5 w-full">
                  <h3 className="text-[14px] font-[900] text-slate-900 tracking-tighter text-center leading-none mb-6">
                    information@missionblessings.org
                  </h3>

                  <div className="mb-6">
                    <img 
                      src="/zelle_qr.png" 
                      alt="Zelle QR Code"
                      className="w-[200px] h-auto object-contain rounded-lg"
                    />
                  </div>

                </div>
              </div>
            </div>
          </div>
          
          <div className="flex flex-col items-center text-center gap-6 w-full max-w-md">
            <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center shrink-0">
              <Home className="w-8 h-8 text-slate-600" />
            </div>
            <div className="w-full">
              <h4 className="font-bold text-xl mb-3 text-slate-800">{t('bankTransfer')}</h4>
              <div className="bg-sage-50/50 p-8 rounded-[2.5rem] space-y-4 border border-sage-100">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{t('bankName')}</p>
                  <p className="font-bold text-slate-700">Bank of America</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{t('accountName')}</p>
                  <p className="font-bold text-slate-700">Mission Blessings Outreach Foundation</p>
                </div>
              </div>
            </div>
          </div>

          <div className="w-full max-w-2xl text-center">
            {t('taxDeductibleEn') && (
              <p className="text-2xl md:text-3xl font-black text-slate-800 tracking-tight">
                {t('taxDeductibleEn')}
              </p>
            )}
            {t('taxDeductibleKo') && (
              <p className={cn("text-sm md:text-base font-medium text-slate-500", t('taxDeductibleEn') && "mt-2")}>
                {t('taxDeductibleKo')}
              </p>
            )}
          </div>

          <div className="pt-12 border-t border-slate-100 w-full text-center">
            <div className="bg-gradient-to-br from-cyan-400 to-cyan-600 rounded-[3rem] p-12 text-white relative overflow-hidden shadow-2xl shadow-cyan-200">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-10">
                <Heart className="w-64 h-64 fill-white" />
              </div>
              <div className="relative z-10">
                <Heart className="w-12 h-12 text-white fill-white mx-auto mb-6 drop-shadow-lg" />
                <h4 className="text-3xl font-serif font-black mb-4">{t('yourGift')}</h4>
                <p className="text-cyan-50 font-bold leading-relaxed mx-auto max-w-lg text-lg">
                  {t('yourGiftBody')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
function PrayerRoomView({ prayerRequests, user, isAdmin }: { prayerRequests: PrayerRequest[], user: User | null, isAdmin: boolean }) {
  const { t } = useI18n();
  const [content, setContent] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<'Request' | 'Thanksgiving'>('Request');
  const [filter, setFilter] = useState<'All' | 'Request' | 'Thanksgiving'>('All');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'prayerRequests'), {
        userId: user?.uid || 'anonymous',
        userName: name.trim() || user?.displayName || 'Anonymous',
        type,
        content,
        createdAt: Timestamp.now()
      });
      setContent('');
      setName('');
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'prayerRequests');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!isAdmin) return;
    try {
      await deleteDoc(doc(db, 'prayerRequests', id));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, 'prayerRequests');
    }
  };

  const filteredRequests = [...prayerRequests]
    .filter(r => filter === 'All' || r.type === filter)
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

  return (
    <div className="max-w-4xl mx-auto space-y-12">
      <div className="text-center">
        <h3 className="text-4xl font-serif font-bold text-slate-800 mb-4">{t('prayerTitle')}</h3>
        <p className="text-slate-500 font-medium max-w-2xl mx-auto">
          {t('prayerBlurb')}
        </p>
      </div>

      <div className="card p-10 bg-white shadow-2xl shadow-sage-200/30 border-none">
        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 ml-4">{t('yourNameOptional')}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('anonymous')}
                className="w-full px-8 py-4 bg-sage-50 rounded-2xl outline-none border-2 border-transparent focus:border-sage-600 focus:bg-white transition-all font-medium text-slate-700 placeholder:text-slate-300 h-[60px]"
              />
            </div>
            <div className="space-y-3">
              <div className="flex gap-3 mt-7">
                <button
                  type="button"
                  onClick={() => setType('Request')}
                  className={cn(
                    "flex-1 h-[60px] rounded-2xl font-bold text-xs transition-all border-2",
                    type === 'Request' ? "bg-slate-500 border-slate-500 text-white shadow-md shadow-slate-100" : "bg-slate-50 border-transparent text-slate-400 hover:bg-slate-100"
                  )}
                >
                  {t('prayerRequest')}
                </button>
                <button
                  type="button"
                  onClick={() => setType('Thanksgiving')}
                  className={cn(
                    "flex-1 h-[60px] rounded-2xl font-bold text-xs transition-all border-2",
                    type === 'Thanksgiving' ? "bg-orange-500 border-orange-500 text-white shadow-md shadow-orange-100" : "bg-sage-50 border-transparent text-slate-400 hover:bg-sage-100"
                  )}
                >
                  {t('thanksgiving')}
                </button>
              </div>
            </div>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={type === 'Request' ? "How can we pray for you?" : "What are you thankful for?"}
            className="w-full p-8 bg-slate-50 rounded-[2rem] outline-none border-2 border-transparent focus:border-slate-600 focus:bg-white transition-all min-h-[180px] resize-none font-medium text-slate-700 placeholder:text-slate-300"
          />
          <button
            type="submit"
            disabled={isSubmitting || !content.trim()}
            className={cn(
              "w-full h-[60px] text-white rounded-2xl font-bold text-lg shadow-xl transition-all disabled:opacity-50 flex items-center justify-center gap-4",
              type === 'Request' 
                ? "bg-slate-600 shadow-slate-200 hover:bg-slate-700" 
                : "bg-orange-500 shadow-orange-200 hover:bg-orange-600"
            )}
          >
            {isSubmitting ? <Loader2 className="w-6 h-6 animate-spin" /> : <Sparkles className="w-6 h-6 text-white/80" />}
            Post {type}
          </button>
        </form>
      </div>

      <div className="pt-12 border-t border-slate-100">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
          <div>
            <h4 className="text-2xl font-serif font-bold text-slate-800">{t('communityWall')}</h4>
            <p className="text-sm text-slate-400 font-medium mt-1">{t('communityWallSub')}</p>
          </div>
          <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-2xl w-full md:w-[400px]">
            {(['Request', 'Thanksgiving', 'All'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                  filter === f 
                    ? f === 'Request' ? "bg-slate-500 text-white shadow-md shadow-slate-100"
                      : f === 'Thanksgiving' ? "bg-orange-500 text-white shadow-md shadow-orange-100"
                      : "bg-sky-500 text-white shadow-md shadow-sky-100"
                    : "text-slate-400 hover:text-slate-600"
                )}
              >
                {f === 'All' ? `${t('all')} (${prayerRequests.length})` : f === 'Request' ? t('prayerRequest') : t('thanksgiving')}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-8">
          {filteredRequests.map((request) => (
            <motion.div
              key={request.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="card p-10 bg-white shadow-xl shadow-sage-200/20 border-none relative overflow-hidden group"
            >
            <div className="flex items-start gap-8 relative z-10">
              <div className={cn(
                "w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 shadow-inner transition-colors",
                request.type === 'Request' ? "bg-slate-50 text-slate-600" : "bg-orange-50 text-orange-600"
              )}>
                {request.type === 'Request' ? <Heart className="w-7 h-7" /> : <Sparkles className="w-7 h-7" />}
              </div>
              <div className="flex-grow">
                <div className="flex justify-between items-start mb-4">
                  <h4 className="text-xl font-serif font-bold text-slate-800">
                    <LocalizedText text={request.userName} as="span" />
                  </h4>
                  <div className="flex items-center gap-6">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">
                      {request.createdAt?.toDate?.().toLocaleDateString() || 'Just now'}
                    </span>
                    {isAdmin && (
                      <button 
                        onClick={() => handleDelete(request.id)}
                        className="p-2 text-rose-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                        title="Delete Post"
                      >
                        <Plus className="w-5 h-5 rotate-45" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="mb-6">
                  <span className={cn(
                    "text-[10px] font-bold uppercase tracking-[0.2em] px-4 py-1.5 rounded-full",
                    request.type === 'Request' ? "bg-slate-100 text-slate-700" : "bg-slate-100 text-slate-700"
                  )}>
                    {request.type}
                  </span>
                </div>
                <LocalizedText
                  text={request.content}
                  className="text-slate-600 leading-relaxed font-medium text-lg whitespace-pre-wrap"
                />
              </div>
            </div>
          </motion.div>
        ))}
        {filteredRequests.length === 0 && (
          <div className="text-center py-24 bg-sage-50/50 rounded-[3rem] border-2 border-dashed border-sage-100">
            <p className="text-slate-300 font-bold text-lg">
              {filter === 'All' 
                ? "No prayer requests or thanksgivings yet. Be the first to share!" 
                : `No ${filter.toLowerCase()}s found.`}
            </p>
          </div>
        )}
      </div>
    </div>
  </div>
  );
}

function DonorsView({ donors, donations, supporters }: { donors: Donor[], donations: Donation[], supporters: Supporter[] }) {
  const [isAddingDonor, setIsAddingDonor] = useState(false);
  const [selectedDonorId, setSelectedDonorId] = useState<string | null>(null);

  const selectedDonor = donors.find(d => d.id === selectedDonorId);
  const selectedDonorDonations = donations.filter(d => d.donorId === selectedDonorId);

  return (
    <div className="space-y-12">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-3xl font-black text-slate-800">Donor Management</h3>
          <p className="text-slate-500 font-bold">Manage your supporters and their contribution history.</p>
        </div>
        <button 
          onClick={() => setIsAddingDonor(true)}
          className="px-6 py-3 bg-slate-600 text-white rounded-xl font-bold hover:bg-slate-700 transition-all flex items-center gap-2 shadow-lg shadow-slate-100"
        >
          <Plus className="w-5 h-5" />
          Add New Donor
        </button>
      </div>

      <div className="card overflow-hidden bg-white shadow-2xl shadow-emerald-100/50 border-none">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-black text-slate-600">Donor Name</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-black text-slate-600">Contact Info</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-black text-slate-600">Preferences</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-black text-slate-600">Total Given</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-black text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {donors.map(donor => {
                const donorDonations = donations.filter(d => d.donorId === donor.id);
                const totalGiven = donorDonations.reduce((sum, d) => sum + d.amount, 0);
                
                return (
                  <tr key={donor.id} className="hover:bg-emerald-50/30 transition-colors">
                    <td className="px-6 py-6">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600 font-black">
                          {donor.name[0]}
                        </div>
                        <span className="font-bold text-slate-800">{donor.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-6">
                      <div className="space-y-1">
                        <p className="text-sm text-slate-600 flex items-center gap-2">
                          <Globe className="w-3 h-3 text-slate-400" /> {donor.email}
                        </p>
                        {donor.phone && (
                          <p className="text-sm text-slate-600 flex items-center gap-2">
                            <Home className="w-3 h-3 text-slate-400" /> {donor.phone}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-6">
                      <span className={cn(
                        "text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full",
                        donor.communicationPreference === 'Email' ? "bg-emerald-100 text-emerald-600" :
                        donor.communicationPreference === 'SMS' ? "bg-emerald-100 text-emerald-600" :
                        "bg-slate-100 text-slate-600"
                      )}>
                        {donor.communicationPreference}
                      </span>
                    </td>
                    <td className="px-6 py-6">
                      <p className="text-lg font-black text-slate-600">${totalGiven.toLocaleString()}</p>
                      <p className="text-[9px] text-slate-400 uppercase tracking-widest font-bold">{donorDonations.length} Donations</p>
                    </td>
                    <td className="px-6 py-6">
                      <button 
                        onClick={() => setSelectedDonorId(donor.id)}
                        className="p-2 hover:bg-slate-100 rounded-xl transition-all text-slate-400"
                      >
                        <Info className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {donors.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-20 text-center text-slate-400 font-bold italic">
                    No donors recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isAddingDonor && (
        <AddDonorModal onClose={() => setIsAddingDonor(false)} />
      )}

      {selectedDonor && (
        <DonorDetailsModal 
          donor={selectedDonor} 
          donations={selectedDonorDonations} 
          supporters={supporters}
          onClose={() => setSelectedDonorId(null)} 
        />
      )}
    </div>
  );
}

function DonorDetailsModal({ donor, donations, supporters, onClose }: { donor: Donor, donations: Donation[], supporters: Supporter[], onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white w-full max-w-2xl rounded-[2.5rem] p-10 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-start mb-8">
          <div>
            <h3 className="text-3xl font-bold">{donor.name}</h3>
            <p className="text-slate-500">{donor.email} • {donor.phone || 'No phone'}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-all">
            <Plus className="w-6 h-6 rotate-45" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <div className="p-6 bg-emerald-50 rounded-3xl">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-1">Total Given</p>
            <p className="text-3xl font-black text-slate-700">${donations.reduce((sum, d) => sum + d.amount, 0).toLocaleString()}</p>
          </div>
          <div className="p-6 bg-emerald-50 rounded-3xl">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-1">Donations</p>
            <p className="text-3xl font-black text-slate-700">{donations.length}</p>
          </div>
          <div className="p-6 bg-emerald-50 rounded-3xl">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-1">Preference</p>
            <p className="text-3xl font-black text-slate-700">{donor.communicationPreference}</p>
          </div>
        </div>

        <h4 className="text-lg font-bold mb-4 text-slate-800">Donation History</h4>
        <div className="space-y-3">
          {donations.sort((a, b) => (b.date?.toMillis?.() || 0) - (a.date?.toMillis?.() || 0)).map(donation => {
            const recipient = supporters.find(s => s.id === donation.supporterId);
            return (
              <div key={donation.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div>
                  <p className="font-bold text-slate-800">${donation.amount.toLocaleString()}</p>
                  <p className="text-xs text-slate-500">
                    To: {recipient?.nameEn || 'Unknown'} • {donation.date?.toDate ? format(donation.date.toDate(), 'MMM d, yyyy') : ''}
                  </p>
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  {donation.acknowledgment}
                </span>
              </div>
            );
          })}
          {donations.length === 0 && (
            <p className="text-center py-8 text-slate-400 italic">No donations recorded yet.</p>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function AddDonorModal({ onClose }: { onClose: () => void }) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    communicationPreference: 'Email' as 'Email' | 'SMS' | 'None'
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'donors'), {
        ...formData,
        createdAt: Timestamp.now()
      });
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'donors');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white w-full max-w-xl rounded-[2.5rem] p-10 shadow-2xl">
        <h3 className="text-3xl font-bold mb-8">Add New Donor</h3>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Full Name</label>
            <input type="text" required className="w-full p-4 bg-emerald-50 rounded-2xl outline-none border-2 border-transparent focus:border-emerald-200 transition-all" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Email Address</label>
              <input type="email" required className="w-full p-4 bg-emerald-50 rounded-2xl outline-none border-2 border-transparent focus:border-emerald-200 transition-all" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Phone Number</label>
              <input type="tel" className="w-full p-4 bg-emerald-50 rounded-2xl outline-none border-2 border-transparent focus:border-emerald-200 transition-all" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Communication Preference</label>
            <div className="flex gap-3">
              {['Email', 'SMS', 'None'].map((pref) => (
                <button
                  key={pref}
                  type="button"
                  onClick={() => setFormData({...formData, communicationPreference: pref as any})}
                  className={cn(
                    "flex-1 py-3 rounded-xl font-bold text-sm transition-all border-2",
                    formData.communicationPreference === pref
                      ? "bg-emerald-50 border-emerald-600 text-emerald-700"
                      : "bg-white border-slate-100 text-slate-500 hover:border-emerald-200"
                  )}
                >
                  {pref}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-4 pt-4">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">Cancel</button>
            <button type="submit" className="flex-1 btn-primary bg-slate-600 hover:bg-slate-700 shadow-slate-200">Add Donor</button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function AddSupporterModal({ onClose, missionFieldId, simplified = false }: { onClose: () => void, missionFieldId: string, simplified?: boolean }) {
  const { t } = useI18n();
  const [formData, setFormData] = useState({
    nameEn: '',
    isPastor: false,
    churchAttendance: 'Weekly',
    faithStatus: 'Active',
    bio: '',
    needs: '',
    nationality: '',
    monthlyRate: 0,
    familySize: 1,
    otherNotes: ''
  });

  const isOtherNations = missionFieldId.includes('other');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'supporters'), simplified ? {
        nameEn: formData.nameEn,
        isPastor: false,
        churchAttendance: '',
        faithStatus: '',
        bio: '',
        needs: formData.needs,
        situationPrayer: formData.needs,
        additionalNotes: formData.otherNotes,
        otherNotes: formData.otherNotes,
        nationality: isOtherNations ? formData.nationality : '',
        missionFieldId,
        qrCodeData: '',
        updatedAt: Timestamp.now()
      } : {
        ...formData,
        missionFieldId,
        qrCodeData: '',
        updatedAt: Timestamp.now()
      });
      onClose();
    } catch (error) {
      console.error("Error adding recipient", error);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white w-full max-w-xl rounded-[2.5rem] p-10 shadow-2xl">
        <h3 className="text-3xl font-bold mb-8">{simplified ? t('addRecipientTitle') : t('addRecipient')}</h3>
        <form onSubmit={handleSubmit} className="space-y-6">
          {simplified ? (
            <>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t('recipientName')}</label>
                <input type="text" required className="w-full p-4 bg-emerald-50 rounded-2xl outline-none border-2 border-transparent focus:border-emerald-200 transition-all" value={formData.nameEn} onChange={e => setFormData({...formData, nameEn: e.target.value})} placeholder={t('namePlaceholder')} />
              </div>
              {isOtherNations && (
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t('nationality')}</label>
                  <input type="text" className="w-full p-4 bg-emerald-50 rounded-2xl outline-none border-2 border-transparent focus:border-emerald-200 transition-all" value={formData.nationality} onChange={e => setFormData({...formData, nationality: e.target.value})} placeholder={t('nationality')} />
                </div>
              )}
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t('situationPrayer')}</label>
                <textarea className="w-full p-4 bg-emerald-50 rounded-2xl outline-none border-2 border-transparent focus:border-emerald-200 transition-all min-h-[140px]" value={formData.needs} onChange={e => setFormData({...formData, needs: e.target.value})} placeholder={t('situationPlaceholder')} />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t('other')}</label>
                <textarea className="w-full p-4 bg-emerald-50 rounded-2xl outline-none border-2 border-transparent focus:border-emerald-200 transition-all min-h-[80px]" value={formData.otherNotes} onChange={e => setFormData({...formData, otherNotes: e.target.value})} placeholder={t('otherPlaceholder')} />
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Recipient Name (EN)</label>
                  <input type="text" required className="w-full p-4 bg-emerald-50 rounded-2xl outline-none border-2 border-transparent focus:border-emerald-200 transition-all" value={formData.nameEn} onChange={e => setFormData({...formData, nameEn: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">FAMILY SIZE</label>
                  <input type="number" required className="w-full p-4 bg-emerald-50 rounded-2xl outline-none border-2 border-transparent focus:border-emerald-200 transition-all" value={formData.familySize} onChange={e => setFormData({...formData, familySize: Number(e.target.value)})} />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Monthly Support ($)</label>
                  <input type="number" required className="w-full p-4 bg-emerald-50 rounded-2xl outline-none border-2 border-transparent focus:border-emerald-200 transition-all" value={formData.monthlyRate} onChange={e => setFormData({...formData, monthlyRate: Number(e.target.value)})} />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Faith Level</label>
                  <input type="text" required className="w-full p-4 bg-emerald-50 rounded-2xl outline-none border-2 border-transparent focus:border-emerald-200 transition-all" value={formData.faithStatus} onChange={e => setFormData({...formData, faithStatus: e.target.value})} />
                </div>
              </div>
              {isOtherNations && (
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Nationality</label>
                  <input type="text" className="w-full p-4 bg-emerald-50 rounded-2xl outline-none border-2 border-transparent focus:border-emerald-200 transition-all" value={formData.nationality} onChange={e => setFormData({...formData, nationality: e.target.value})} placeholder="Country of origin" />
                </div>
              )}
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Needs / Requests</label>
                <input type="text" className="w-full p-4 bg-emerald-50 rounded-2xl outline-none border-2 border-transparent focus:border-emerald-200 transition-all" value={formData.needs} onChange={e => setFormData({...formData, needs: e.target.value})} placeholder="What is needed?" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Special Notes (EN)</label>
                <textarea className="w-full p-4 bg-emerald-50 rounded-2xl outline-none border-2 border-transparent focus:border-emerald-200 transition-all min-h-[100px]" value={formData.bio} onChange={e => setFormData({...formData, bio: e.target.value})} placeholder="Write something about the recipient..." />
              </div>
            </>
          )}
          <div className="flex gap-4 pt-4">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">{t('cancel')}</button>
            <button type="submit" className="flex-1 btn-primary">{simplified ? t('add') : t('addRecipient')}</button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function AddActivityModal({ onClose, missionFieldId }: { onClose: () => void, missionFieldId: string }) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    photoUrl: '',
    type: 'Community'
  });
  const [isGenerating, setIsGenerating] = useState(false);

  const activityTypes = ["Education", "Health", "Community", "Spiritual", "Infrastructure", "Other"];

  const handleGenerateImage = async () => {
    if (!formData.description) {
      alert("Please provide a description first to generate an image.");
      return;
    }

    setIsGenerating(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            {
              text: `Generate a bright, hopeful, and artistic illustration (cartoon/sketch style) for a mission activity: ${formData.title}. Description: ${formData.description}`,
            },
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: "4:3"
          }
        }
      });

      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          const base64EncodeString = part.inlineData.data;
          setFormData(prev => ({ ...prev, photoUrl: `data:image/png;base64,${base64EncodeString}` }));
          break;
        }
      }
    } catch (error) {
      console.error("Error generating image", error);
      alert("Failed to generate image. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'activities'), {
        ...formData,
        missionFieldId,
        date: Timestamp.now(),
        photoUrls: formData.photoUrl ? [formData.photoUrl] : []
      });
      onClose();
    } catch (error) {
      console.error("Error adding activity", error);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white w-full max-w-xl rounded-[2.5rem] p-10 shadow-2xl">
        <h3 className="text-3xl font-bold mb-8">Add Activity</h3>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Title</label>
              <input type="text" required className="w-full p-4 bg-emerald-50 rounded-2xl outline-none border-2 border-transparent focus:border-emerald-200 transition-all" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Activity Type</label>
              <select 
                className="w-full p-4 bg-emerald-50 rounded-2xl outline-none border-2 border-transparent focus:border-emerald-200 transition-all"
                value={formData.type}
                onChange={e => setFormData({...formData, type: e.target.value})}
              >
                {activityTypes.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Description</label>
            <textarea required className="w-full p-4 bg-emerald-50 rounded-2xl outline-none border-2 border-transparent focus:border-emerald-200 transition-all h-32 resize-none" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Photo URL or AI Generated</label>
              <button 
                type="button"
                onClick={handleGenerateImage}
                disabled={isGenerating || !formData.description}
                className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-emerald-600 hover:text-emerald-700 disabled:text-slate-300 transition-colors"
              >
                {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {isGenerating ? 'Generating...' : 'Generate with AI'}
              </button>
            </div>
            <div className="space-y-4">
              <input type="url" className="w-full p-4 bg-emerald-50 rounded-2xl outline-none border-2 border-transparent focus:border-emerald-200 transition-all" value={formData.photoUrl} onChange={e => setFormData({...formData, photoUrl: e.target.value})} placeholder="Paste URL or use AI button above" />
              {formData.photoUrl && (
                <div className="relative aspect-video rounded-2xl overflow-hidden border-2 border-emerald-100">
                  <img src={formData.photoUrl} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  <button 
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, photoUrl: '' }))}
                    className="absolute top-2 right-2 p-1 bg-white/80 backdrop-blur rounded-full text-slate-500 hover:text-rose-500 transition-colors"
                  >
                    <Plus className="w-4 h-4 rotate-45" />
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-4 pt-4">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">Cancel</button>
            <button type="submit" className="flex-1 btn-primary">Save Activity</button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function DirectSupportModal({ supporterId, onClose }: { supporterId: string, onClose: () => void }) {
  const [supporter, setSupporter] = useState<Supporter | null>(null);
  const [amount, setAmount] = useState('50');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'supporters', supporterId), (snapshot) => {
      if (snapshot.exists()) {
        setSupporter({ id: snapshot.id, ...snapshot.data() } as Supporter);
      }
    });
    return unsub;
  }, [supporterId]);

  const handleSupport = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    try {
      // In a real app, this would integrate with a payment gateway
      // For now, we record the donation to the database
      await addDoc(collection(db, 'donations'), {
        supporterId,
        missionFieldId: supporter?.missionFieldId || 'unknown',
        amount: Number(amount),
        date: Timestamp.now(),
        acknowledgment: 'Direct Support via QR Code'
      });
      setIsSuccess(true);
      setTimeout(onClose, 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'donations');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!supporter) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }} 
        animate={{ scale: 1, opacity: 1 }} 
        className="bg-white w-full max-w-md rounded-3xl overflow-hidden shadow-2xl"
      >
        <div className="bg-gradient-to-br from-cyan-400 to-cyan-600 p-10 text-white text-center relative overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-10">
            <Heart className="w-48 h-48 fill-white" />
          </div>
          <button onClick={onClose} className="absolute top-4 right-4 p-2 hover:bg-white/20 rounded-full transition-colors z-20">
            <Plus className="w-6 h-6 rotate-45" />
          </button>
          <div className="w-20 h-20 bg-white/20 backdrop-blur-md rounded-3xl flex items-center justify-center mx-auto mb-6 relative z-10 shadow-xl border border-white/30">
            <Heart className="w-10 h-10 text-white fill-white" />
          </div>
          <h3 className="text-3xl font-black mb-1 relative z-10">Direct Support</h3>
          <p className="text-cyan-50 font-bold opacity-90 relative z-10">For {supporter.nameEn}</p>
          {supporter.nameKh && (
            <p className="text-2xl font-black text-white mt-1 relative z-10">{supporter.nameKh}</p>
          )}
        </div>

        <div className="p-8">
          {isSuccess ? (
            <div className="text-center py-10">
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <ShieldCheck className="w-10 h-10 text-slate-600" />
              </div>
              <h4 className="text-2xl font-black text-slate-800 mb-2">Thank You!</h4>
              <p className="text-slate-500">Your support has been recorded and will make a real difference.</p>
            </div>
          ) : (
            <form onSubmit={handleSupport} className="space-y-8">
              <div className="space-y-4">
                <label className="text-xs font-black uppercase tracking-widest text-slate-400 block text-center">Select Amount</label>
                <div className="grid grid-cols-3 gap-3">
                  {['25', '50', '100'].map(val => (
                    <button 
                      key={val}
                      type="button"
                      onClick={() => setAmount(val)}
                      className={cn(
                        "py-4 rounded-xl font-black transition-all border-2",
                        amount === val 
                          ? "bg-emerald-600 border-emerald-600 text-white shadow-lg shadow-emerald-100" 
                          : "bg-slate-50 border-transparent text-slate-400 hover:bg-slate-100"
                      )}
                    >
                      ${val}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-slate-300">$</span>
                  <input 
                    type="number" 
                    value={amount} 
                    onChange={e => setAmount(e.target.value)}
                    className="w-full p-4 pl-8 bg-slate-50 rounded-xl outline-none border-2 border-transparent focus:border-emerald-600 focus:bg-white transition-all font-bold text-slate-800"
                    placeholder="Other amount"
                  />
                </div>
              </div>

              <button 
                type="submit" 
                disabled={isProcessing || !amount}
                className="w-full py-4 bg-slate-600 text-white rounded-xl font-black text-lg shadow-xl shadow-slate-100 hover:bg-slate-700 transition-all disabled:opacity-50 flex items-center justify-center gap-3 active:scale-95"
              >
                {isProcessing ? <Loader2 className="w-6 h-6 animate-spin" /> : <Heart className="w-6 h-6" />}
                {isProcessing ? 'Processing...' : 'Send Support Now'}
              </button>
              
              <p className="text-[10px] text-center text-slate-400 font-bold uppercase tracking-widest">
                100% of your gift goes directly to mission work
              </p>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function AddDonationForm({ supporterId, missionFieldId, donors, onClose }: { supporterId: string, missionFieldId: string, donors: Donor[], onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [donorId, setDonorId] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'donations'), {
        supporterId,
        missionFieldId,
        donorId: donorId || null,
        amount: Number(amount),
        date: Timestamp.now(),
        acknowledgment: 'Received with thanks'
      });
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'donations');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[110] flex items-center justify-center p-6">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white w-full max-w-sm rounded-[2rem] p-8 shadow-2xl">
        <h4 className="text-2xl font-bold mb-6">Record Support</h4>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Donor (Optional)</label>
            <select 
              className="w-full p-4 bg-emerald-50 rounded-2xl outline-none border-2 border-emerald-200 text-sm font-bold"
              value={donorId}
              onChange={e => setDonorId(e.target.value)}
            >
              <option value="">Anonymous / Other</option>
              {donors.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Amount ($)</label>
            <input type="number" required className="w-full p-4 bg-emerald-50 rounded-2xl outline-none border-2 border-emerald-200 font-bold" value={amount} onChange={e => setAmount(e.target.value)} autoFocus />
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl font-bold text-slate-400 hover:bg-slate-50 transition-all">Cancel</button>
            <button type="submit" className="flex-1 py-3 rounded-xl font-bold bg-slate-600 text-white shadow-lg shadow-slate-200">Save</button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function RegistrationModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [interest, setInterest] = useState('Volunteer');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setTimeout(onClose, 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }} 
        animate={{ scale: 1, opacity: 1 }} 
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white w-full max-w-md rounded-3xl p-8 shadow-2xl relative"
      >
        <button onClick={onClose} className="absolute top-4 right-4 p-2 hover:bg-slate-100 rounded-full transition-colors">
          <Plus className="w-6 h-6 rotate-45 text-slate-400" />
        </button>

        {submitted ? (
          <div className="text-center py-10">
            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Sparkles className="w-10 h-10 text-emerald-600" />
            </div>
            <h4 className="text-2xl font-black text-slate-800 mb-2">Registration Complete</h4>
            <p className="text-slate-500">Thank you for joining our mission. We will contact you soon!</p>
            <button 
              onClick={onClose}
              className="mt-8 px-8 py-3 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-700 transition-all"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-2">
                <Megaphone className="w-5 h-5 text-emerald-600" />
                <span className="text-xs font-black uppercase tracking-widest text-emerald-600">Join the Mission</span>
              </div>
              <h4 className="text-2xl font-black text-slate-800 mb-2">USA Outreach Registration</h4>
              <p className="text-slate-500 text-sm leading-relaxed">Register to volunteer or receive updates about our USA outreach programs.</p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-slate-400">Full Name</label>
                <input 
                  type="text" 
                  required 
                  className="w-full p-4 bg-slate-50 rounded-xl outline-none border-2 border-slate-100 focus:border-emerald-600 focus:bg-white transition-all font-bold text-slate-800" 
                  value={name} 
                  onChange={setName ? (e => setName(e.target.value)) : undefined} 
                  placeholder="Your Name"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-slate-400">Email Address</label>
                <input 
                  type="email" 
                  required 
                  className="w-full p-4 bg-slate-50 rounded-xl outline-none border-2 border-slate-100 focus:border-emerald-600 focus:bg-white transition-all font-bold text-slate-800" 
                  value={email} 
                  onChange={setEmail ? (e => setEmail(e.target.value)) : undefined} 
                  placeholder="your@email.com"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-slate-400">Area of Interest</label>
                <select 
                  className="w-full p-4 bg-slate-50 rounded-xl outline-none border-2 border-slate-100 focus:border-emerald-600 focus:bg-white transition-all font-bold text-slate-800"
                  value={interest}
                  onChange={setInterest ? (e => setInterest(e.target.value)) : undefined}
                >
                  <option>Volunteer</option>
                  <option>Donation</option>
                  <option>Mentorship</option>
                  <option>Community Events</option>
                </select>
              </div>
              <button type="submit" className="w-full py-4 bg-emerald-600 text-white rounded-xl font-black text-lg shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all active:scale-95">
                Submit Registration
              </button>
            </form>
          </>
        )}
      </motion.div>
    </div>
  );
}

function AnnouncementBoardModal({ onClose }: { onClose: () => void }) {
  const announcements = [
    { date: '2024-05-15', title: 'Community Food Drive', time: '10:00 AM - 2:00 PM', location: 'Central Park Hub' },
    { date: '2024-05-22', title: 'Youth Mentoring Workshop', time: '4:00 PM - 6:00 PM', location: 'Community Center' },
    { date: '2024-06-01', title: 'Health & Wellness Seminar', time: '9:00 AM - 12:00 PM', location: 'Main Library' },
    { date: '2024-06-10', title: 'Local Family Support Meeting', time: '6:30 PM - 8:00 PM', location: 'Grace Hall' }
  ];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }} 
        animate={{ scale: 1, opacity: 1 }} 
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white w-full max-w-2xl rounded-3xl p-8 shadow-2xl relative"
      >
        <button onClick={onClose} className="absolute top-4 right-4 p-2 hover:bg-slate-100 rounded-full transition-colors">
          <Plus className="w-6 h-6 rotate-45 text-slate-400" />
        </button>

        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-5 h-5 text-emerald-600" />
            <span className="text-xs font-black uppercase tracking-widest text-emerald-600">Activity Schedule</span>
          </div>
          <h4 className="text-3xl font-black text-slate-800">USA Outreach Bulletin Board</h4>
        </div>

        <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
          {announcements.map((item, idx) => (
            <div key={idx} className="p-6 bg-slate-50 rounded-2xl border border-slate-100 hover:border-emerald-200 transition-all group">
              <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">{item.date}</span>
                <span className="text-[10px] font-bold text-slate-400 bg-white px-2 py-0.5 rounded-full shadow-sm">{item.time}</span>
              </div>
              <h5 className="text-xl font-black text-slate-800 group-hover:text-emerald-600 transition-colors mb-2">{item.title}</h5>
              <div className="flex items-center gap-2 text-slate-500 text-sm">
                <MapPin className="w-4 h-4 text-slate-400" />
                <span>{item.location}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 pt-6 border-t border-slate-100 flex justify-between items-center">
          <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Updated weekly • Outreach 2024</p>
          <button onClick={onClose} className="px-6 py-2 bg-slate-800 text-white rounded-lg font-bold hover:bg-slate-700 transition-all">Close</button>
        </div>
      </motion.div>
    </div>
  );
}

// --- YouTube Gallery Component (Static 10-Video Version) ---
/**
 * [ID 혹은 링크 방식 지원]
 * 유튜브 주소 전체를 붙여넣으시거나, 영상 ID(예: dQw4v9WgXcQ)만 넣으셔도 자동으로 변환됩니다.
 */
function extractYoutubeId(urlOrId: string) {
  if (!urlOrId) return '';
  const trimmed = urlOrId.trim();
  
  // 1. If it's already a clean 11-char ID
  if (trimmed.length === 11 && !trimmed.includes('/') && !trimmed.includes('.') && !trimmed.includes(':')) {
    return trimmed;
  }
  
  // 2. Comprehensive Regex for all YouTube URL variants (shorts, mobile, embed, standard)
  const regExp = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  const match = trimmed.match(regExp);
  
  if (match && match[1]) return match[1];
  
  // 3. Fallback: try to find anything that looks like an 11-char ID in the string
  const fallbackMatch = trimmed.match(/[a-zA-Z0-9_-]{11}/);
  if (fallbackMatch) return fallbackMatch[0];

  return trimmed;
}

const STATIC_VIDEOS: GalleryVideo[] = [
  // --- 한국어 영상 (KOREAN) ---
  { id: '3Lz70DRD15s', title: '[KOR] 월요일: 열방을 향한 비전', lang: 'ko', day: 'Mon', updatedAt: null },
  { id: '_1132vEYBCc', title: '[KOR] 화요일: 은혜의 보좌 앞으로', lang: 'ko', day: 'Tue', updatedAt: null },
  { id: 'kzEhIns2_hI', title: '[KOR] 수요일: 성령의 인도하심', lang: 'ko', day: 'Wed', updatedAt: null },
  { id: 'WIA5oKh1aT4', title: '[KOR] 목요일: 믿음의 승리', lang: 'ko', day: 'Thu', updatedAt: null },
  { id: '4CtsNENMNMg', title: '[KOR] 금요일: 감사의 고백', lang: 'ko', day: 'Fri', updatedAt: null },
  
  // --- 영어 영상 (ENGLISH) ---
  { id: '-jnKi-1jkHE', title: '[ENG] Monday: Vision for Nations', lang: 'en', day: 'Mon', updatedAt: null },
  { id: 'pPMfDjd-gpI', title: '[ENG] Tuesday: Throne of Grace', lang: 'en', day: 'Tue', updatedAt: null },
  { id: 'RY_V09VwL9g', title: '[ENG] Wednesday: Holy Spirit Guidance', lang: 'en', day: 'Wed', updatedAt: null },
  { id: 'mBokrUT0z38', title: '[ENG] Thursday: Victory of Faith', lang: 'en', day: 'Thu', updatedAt: null },
  { id: 'mYfkHca9_pw', title: '[ENG] Friday: Confession of Thanks', lang: 'en', day: 'Fri', updatedAt: null },
];

function YouTubeGallerySection({ setActiveVideoId, isAdmin, handleLogin }: { setActiveVideoId: (id: string | null) => void, isAdmin: boolean, handleLogin: () => void }) {
  const { locale } = useI18n();
  const [filter, setFilter] = useState<'all' | 'ko' | 'en'>('all');
  const [showUpload, setShowUpload] = useState(false);
  const [videos, setVideos] = useState(STATIC_VIDEOS);
  const [isSaving, setIsSaving] = useState(false);
  const [editUrls, setEditUrls] = useState<Record<string, string>>({});
  const [editTitles, setEditTitles] = useState<Record<string, string>>({});

  useEffect(() => {
    setFilter(locale === 'en' ? 'en' : locale === 'ko' ? 'ko' : 'all');
  }, [locale]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'gallery_videos'), (snapshot) => {
      const dbVideos = snapshot.docs.map(doc => doc.data() as GalleryVideo);
      const merged = STATIC_VIDEOS.map(sv => {
        const match = dbVideos.find(dv => dv.lang === sv.lang && dv.day === sv.day);
        // DB에 저장된 정보가 있으면 최우선으로 사용 (ID와 Title 모두)
        if (match) {
          return {
            ...sv,
            id: match.id || sv.id,
            title: match.title || sv.title,
            updatedAt: match.updatedAt
          };
        }
        return sv;
      });
      setVideos(merged);
      
      // Initialize edit fields
      const newEditUrls: Record<string, string> = {};
      const newEditTitles: Record<string, string> = {};
      merged.forEach(v => {
        const key = `${v.lang}_${v.day}`;
        newEditUrls[key] = v.id ? `https://www.youtube.com/watch?v=${v.id}` : '';
        newEditTitles[key] = v.title || '';
      });
      
      // Only set initial values if not currently showing the upload panel
      if (!showUpload) {
        setEditUrls(newEditUrls);
        setEditTitles(newEditTitles);
      }
    }, (err) => handleFirestoreError(err, OperationType.GET, 'gallery_videos'));
    return () => unsub();
  }, [showUpload]);

  const idFromStatic = (lang: string, day: string) => 
    STATIC_VIDEOS.find(v => v.lang === lang && v.day === day)?.id || '';
  
  const titleFromStatic = (lang: string, day: string) => 
    STATIC_VIDEOS.find(v => v.lang === lang && v.day === day)?.title || '';

  const fetchYouTubeTitle = async (url: string, key: string) => {
    const videoId = extractYoutubeId(url);
    if (!videoId || videoId.length !== 11) return;
    
    // Don't overwrite if there's already a custom title manually entered (optional check)
    // For now, let's just fetch if it's empty or the user asks for it
    try {
      // noembed is a good public service for fetching metadata without CORS issues in many cases
      const response = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
      const data = await response.json();
      if (data && data.title) {
        setEditTitles(prev => ({ ...prev, [key]: data.title }));
      }
    } catch (error) {
      console.error('Error fetching YouTube title:', error);
    }
  };

  const handleUpdateVideos = async () => {
    if (!isAdmin) {
      alert('관리자 권한이 없습니다. (Admin access required)');
      return;
    }
    setIsSaving(true);
    let successCount = 0;
    
    try {
      const entries = Object.entries(editUrls) as [string, string][];
      
      for (const [key, rawUrl] of entries) {
        const [lang, day] = key.split('_');
        const videoId = extractYoutubeId(rawUrl);
        const title = editTitles[key];
        
        // Only save if there's actually a valid ID or a custom title
        // We allow 11 char IDs specifically
        const finalId = (videoId && videoId.length === 11) ? videoId : idFromStatic(lang, day);
        const finalTitle = title || titleFromStatic(lang, day);

        await setDoc(doc(db, 'gallery_videos', key), {
          id: finalId,
          title: finalTitle,
          lang,
          day,
          updatedAt: Timestamp.now()
        }, { merge: true });
        successCount++;
      }

      if (successCount > 0) {
        alert('모든 영상 정보가 성공적으로 저장되었습니다! (Saved successfully)');
        setShowUpload(false);
      } else {
        alert('저장할 변경사항이 없습니다.');
      }
    } catch (e: any) {
      console.error('Save failed:', e);
      handleFirestoreError(e, OperationType.WRITE, 'gallery_videos');
      alert('저장 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteVideo = async (lang: string, day: string) => {
    if (!window.confirm(`${day} (${lang === 'ko' ? '한국어' : 'English'}) 영상을 기본값으로 되돌리시겠습니까?`)) return;
    try {
      await deleteDoc(doc(db, 'gallery_videos', `${lang}_${day}`));
      alert('성공적으로 삭제되었습니다. (Reverted to default)');
    } catch (e: any) {
      console.error('Delete error:', e);
      handleFirestoreError(e, OperationType.DELETE, `gallery_videos/${lang}_${day}`);
      alert('삭제 중 오류가 발생했습니다. 관리자 권한을 확인해주세요.');
    }
  };

  const filteredVideos = filter === 'all' 
    ? videos 
    : videos.filter(v => v.lang === filter);

  return (
    <div className="max-w-7xl mx-auto px-6 py-12">
      <div className="bg-white rounded-[3.5rem] p-8 md:p-16 shadow-[0_32px_64px_-12px_rgba(0,0,0,0.08)] relative overflow-hidden border border-slate-100">
        {/* Artistic Background Blurs */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-emerald-50 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/3 opacity-60" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-rose-50 rounded-full blur-[120px] translate-y-1/2 -translate-x-1/3 opacity-60" />

        <div className="relative z-10">
          <div className="flex flex-col items-center text-center gap-10 mb-16 border-b border-slate-100 pb-12">
            <div className="space-y-6 max-w-2xl">
              <div className="inline-flex items-center gap-3 px-5 py-2 bg-emerald-50 rounded-full border border-emerald-100 mx-auto">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-600">Weekly Mission Archive</span>
              </div>
              <h2 className="text-5xl md:text-6xl font-serif font-bold text-slate-800 tracking-tight leading-[1.1]">
                Mission Media <br/>
                <span className="text-emerald-500 italic">Gallery</span>
              </h2>
              <p className="text-slate-500 text-lg font-medium leading-relaxed">
                미션블레싱즈에서 보내드리는 매일의 말씀을 감상하세요. <br className="hidden md:block"/>
                희망과 회복의 메시지가 열방으로 흘러갑니다.
                <span className="block text-slate-400 font-serif italic mt-3 text-base leading-snug">
                  Experience the daily Word shared by Mission Blessings. <br className="hidden md:block"/>
                  Messages of hope and restoration flow unto the nations.
                </span>
              </p>
            </div>

            {/* Gallery Control Bar */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-8 mb-12 w-full">
              <div className="flex items-center gap-2 p-1.5 bg-slate-50 rounded-[2rem] border border-slate-200/60 shadow-inner">
                <button 
                  onClick={() => setFilter('all')}
                  className={cn(
                    "px-6 py-3 rounded-full text-[13px] font-bold transition-all",
                    filter === 'all' ? "bg-pink-600 text-white shadow-lg shadow-pink-100" : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  전체보기 (All)
                </button>
                <button 
                  onClick={() => setFilter('ko')}
                  className={cn(
                    "px-6 py-3 rounded-full text-[13px] font-bold transition-all",
                    filter === 'ko' ? "bg-emerald-500 text-white shadow-lg" : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  한국어
                </button>
                <button 
                  onClick={() => setFilter('en')}
                  className={cn(
                    "px-6 py-3 rounded-full text-[13px] font-bold transition-all",
                    filter === 'en' ? "bg-rose-500 text-white shadow-lg" : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  English
                </button>
              </div>

              <button 
                onClick={() => setShowUpload(!showUpload)}
                className={cn(
                  "px-6 py-3.5 rounded-[1.5rem] text-[13px] font-bold transition-all duration-300 flex items-center gap-3 shadow-lg group",
                  showUpload 
                    ? "bg-rose-500 text-white shadow-rose-200 ring-4 ring-rose-50 scale-105" 
                    : "bg-white text-slate-500 border-2 border-slate-100 hover:border-emerald-200 hover:text-emerald-600"
                )}
              >
                <div className={cn("w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center transition-all", showUpload && "bg-white/20 rotate-45")}>
                  {isAdmin ? (
                    <Plus className={cn("w-3.5 h-3.5", showUpload ? "text-white" : "text-slate-400 group-hover:text-emerald-500")} />
                  ) : (
                    <ShieldAlert className={cn("w-3 h-3 text-slate-400", !showUpload && "group-hover:text-emerald-500")} />
                  )}
                </div>
                {isAdmin ? "영상 관리 도구 (Management)" : "관리자 메뉴 (Admin Tools)"}
              </button>
            </div>
          </div>

          <AnimatePresence>
            {showUpload && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="mb-12"
              >
                <div className="bg-slate-50 rounded-[3rem] p-10 md:p-14 border-2 border-slate-200 shadow-xl relative">
                  <div className="absolute top-0 right-0 p-8">
                    <div className="px-4 py-2 bg-rose-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg">
                      Admin Access Panel
                    </div>
                  </div>

                  <div className="flex items-center gap-4 mb-10 pb-6 border-b border-slate-200/50">
                    <div className="w-14 h-14 bg-rose-100 rounded-2xl flex items-center justify-center">
                      <Youtube className="w-7 h-7 text-rose-500" />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-slate-800 tracking-tight">주간 영상 관리 도구 (10 Boxes Management)</h3>
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mt-0.5">매주 월요일부터 금요일까지 영상을 업데이트 하세요.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-16">
                    {/* Korean Column */}
                    <div className="space-y-8">
                      <div className="flex items-center gap-4">
                        <div className="px-4 py-1.5 bg-emerald-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest shadow-md">
                          KOREA
                        </div>
                        <h4 className="font-bold text-slate-800 text-sm">한국어 말씀 (5개)</h4>
                      </div>
                      
                      <div className="space-y-4">
                        {[
                          { day: 'Mon', label: '월요일 (Monday)' },
                          { day: 'Tue', label: '화요일 (Tuesday)' },
                          { day: 'Wed', label: '수요일 (Wednesday)' },
                          { day: 'Thu', label: '목요일 (Thursday)' },
                          { day: 'Fri', label: '금요일 (Friday)' }
                        ].map(item => {
                          const key = `ko_${item.day}`;
                          const urlOrId = editUrls[key] || '';
                          const title = editTitles[key] || '';
                          return (
                            <div key={key} className="group space-y-3 bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                              <div className="flex justify-between items-center px-1">
                                <label className="text-[11px] font-black text-slate-400 group-focus-within:text-emerald-500 transition-colors uppercase tracking-widest flex items-center gap-2">
                                  <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                                  {item.label}
                                </label>
                                {isAdmin && (
                                  <button 
                                    onClick={() => {
                                      setEditUrls(prev => ({ ...prev, [key]: '' }));
                                      setEditTitles(prev => ({ ...prev, [key]: '' }));
                                    }}
                                    className="text-[10px] font-bold text-slate-300 hover:text-rose-500 transition-colors flex items-center gap-1.5 bg-slate-50 px-3 py-1 rounded-lg"
                                  >
                                    <X className="w-3 h-3" /> Reset
                                  </button>
                                )}
                              </div>
                              <div className="space-y-3">
                                <div className="relative">
                                  <input 
                                    type="text"
                                    placeholder="영상 제목 (Video Title)"
                                    value={title}
                                    readOnly={!isAdmin}
                                    onChange={e => setEditTitles(prev => ({ ...prev, [key]: e.target.value }))}
                                    className="w-full px-5 py-4 bg-slate-50 border-2 border-transparent rounded-2xl outline-none focus:border-emerald-200 focus:bg-white transition-all text-sm font-bold placeholder:text-slate-300 disabled:opacity-70"
                                  />
                                  <Type className="absolute right-5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-200" />
                                </div>
                                <div className="relative">
                                  <input 
                                    type="text"
                                    placeholder="YouTube Link (URL)"
                                    value={urlOrId}
                                    readOnly={!isAdmin}
                                    onBlur={e => fetchYouTubeTitle(e.target.value, key)}
                                    onChange={e => setEditUrls(prev => ({ ...prev, [key]: e.target.value }))}
                                    className="w-full px-5 py-4 bg-slate-50 border-2 border-transparent rounded-2xl outline-none focus:border-emerald-200 focus:bg-white transition-all text-sm font-mono placeholder:text-slate-300 disabled:opacity-70"
                                  />
                                  <Youtube className="absolute right-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-200" />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* English Column */}
                    <div className="space-y-8">
                      <div className="flex items-center gap-4">
                        <div className="px-4 py-1.5 bg-rose-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest shadow-md">
                          ENGLISH
                        </div>
                        <h4 className="font-bold text-slate-800 text-sm">English Devotionals (5개)</h4>
                      </div>
                      
                      <div className="space-y-4">
                        {[
                          { day: 'Mon', label: 'Monday (Mon)' },
                          { day: 'Tue', label: 'Tuesday (Tue)' },
                          { day: 'Wed', label: 'Wednesday (Wed)' },
                          { day: 'Thu', label: 'Thursday (Thu)' },
                          { day: 'Fri', label: 'Friday (Fri)' }
                        ].map(item => {
                          const key = `en_${item.day}`;
                          const urlOrId = editUrls[key] || '';
                          const title = editTitles[key] || '';
                          return (
                            <div key={key} className="group space-y-3 bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                              <div className="flex justify-between items-center px-1">
                                <label className="text-[11px] font-black text-slate-400 group-focus-within:text-rose-500 transition-colors uppercase tracking-widest flex items-center gap-2">
                                  <div className="w-1.5 h-1.5 bg-rose-400 rounded-full" />
                                  {item.label}
                                </label>
                                {isAdmin && (
                                  <button 
                                    onClick={() => {
                                      setEditUrls(prev => ({ ...prev, [key]: '' }));
                                      setEditTitles(prev => ({ ...prev, [key]: '' }));
                                    }}
                                    className="text-[10px] font-bold text-slate-300 hover:text-rose-500 transition-colors flex items-center gap-1.5 bg-slate-50 px-3 py-1 rounded-lg"
                                  >
                                    <X className="w-3 h-3" /> Reset
                                  </button>
                                )}
                              </div>
                              <div className="space-y-3">
                                <div className="relative">
                                  <input 
                                    type="text"
                                    placeholder="Video Title (English)"
                                    value={title}
                                    readOnly={!isAdmin}
                                    onChange={e => setEditTitles(prev => ({ ...prev, [key]: e.target.value }))}
                                    className="w-full px-5 py-4 bg-slate-50 border-2 border-transparent rounded-2xl outline-none focus:border-rose-200 focus:bg-white transition-all text-sm font-bold placeholder:text-slate-300 disabled:opacity-70"
                                  />
                                  <Type className="absolute right-5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-200" />
                                </div>
                                <div className="relative">
                                  <input 
                                    type="text"
                                    placeholder="YouTube Link (URL)"
                                    value={urlOrId}
                                    readOnly={!isAdmin}
                                    onBlur={e => fetchYouTubeTitle(e.target.value, key)}
                                    onChange={e => setEditUrls(prev => ({ ...prev, [key]: e.target.value }))}
                                    className="w-full px-5 py-4 bg-slate-50 border-2 border-transparent rounded-2xl outline-none focus:border-rose-200 focus:bg-white transition-all text-sm font-mono placeholder:text-slate-300 disabled:opacity-70"
                                  />
                                  <Youtube className="absolute right-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-200" />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="mt-16 flex flex-col items-center gap-6">
                    {isAdmin ? (
                      <>
                        <p className="text-[11px] text-slate-400 font-bold uppercase tracking-[0.2em] text-center max-w-md bg-white px-10 py-3 rounded-full border border-slate-100 shadow-sm flex items-center gap-2">
                          <Sparkles className="w-3 h-3 text-rose-400" />
                          유튜브 주소를 복사해서 붙여넣고 아래 저장 버튼을 누르세요.
                        </p>
                        <div className="flex items-center gap-4">
                          <button 
                            onClick={handleUpdateVideos}
                            disabled={isSaving}
                            className="px-20 py-5 bg-pink-600 text-white rounded-[2rem] font-black hover:bg-pink-700 transition-all shadow-2xl shadow-pink-200 flex items-center gap-3 text-sm active:scale-95 disabled:opacity-50"
                          >
                            {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5 text-emerald-400" />}
                            영상 갤러리 저장하기 (Save All 10 Boxes)
                          </button>
                          <button 
                            onClick={() => setShowUpload(false)}
                            className="px-8 py-5 bg-white text-slate-400 rounded-[2rem] font-bold border border-slate-100 hover:bg-slate-50 transition-all text-sm"
                          >
                            닫기 (Close)
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-6">
                        <div className="px-10 py-6 bg-white rounded-3xl border-2 border-dashed border-slate-200 text-center">
                          <p className="text-slate-400 text-sm font-bold mb-4">
                            영상을 수정하시려면 관리자 로그인이 필요합니다.
                          </p>
                          <button 
                            onClick={handleLogin}
                            className="px-12 py-4 bg-emerald-500 text-white rounded-2xl font-black text-sm shadow-xl shadow-emerald-100 hover:bg-emerald-600 transition-all flex items-center gap-3"
                          >
                            <ShieldAlert className="w-5 h-5" />
                            관리자 로그인하여 수정하기
                          </button>
                        </div>
                        <button 
                          onClick={() => setShowUpload(false)}
                          className="text-slate-400 text-sm font-bold hover:text-slate-600 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-8">
            <AnimatePresence mode="popLayout">
              {filteredVideos.map((video, index) => (
                <motion.div 
                  key={`${video.id}-${index}`}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ 
                    duration: 0.5,
                    delay: index * 0.05,
                    type: "spring",
                    stiffness: 100
                  }}
                  className="group relative"
                >
                  <div className="bg-white rounded-[2.5rem] overflow-hidden border border-slate-100 shadow-sm hover:shadow-2xl hover:shadow-emerald-100/50 transition-all duration-500 flex flex-col h-full border-b-[6px] border-b-transparent hover:border-b-emerald-400">
                    <div 
                      className="relative aspect-video overflow-hidden group/thumb"
                    >
                      {/* Play Action Layer (Middle) */}
                      <div 
                         className="absolute inset-0 cursor-pointer z-10"
                         onClick={() => setActiveVideoId(extractYoutubeId(video.id))}
                      />
                      
                      {/* Trash Icon Layer (Top) */}
                      {isAdmin && (
                        <div className="absolute top-4 right-4 z-50">
                          <button 
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleDeleteVideo(video.lang, video.day);
                            }}
                            className="w-10 h-10 bg-rose-500 text-white rounded-xl shadow-2xl flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-all hover:bg-rose-600 hover:scale-110 active:scale-95 ring-4 ring-rose-500/20 pointer-events-auto"
                            title="기본값으로 되돌리기 (Delete custom video)"
                          >
                            <Trash2 className="w-5 h-5 pointer-events-none" />
                          </button>
                        </div>
                      )}
                      <img 
                        src={`https://img.youtube.com/vi/${extractYoutubeId(video.id)}/mqdefault.jpg`} 
                        alt={video.title}
                        className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-all duration-500 flex items-center justify-center backdrop-blur-[2px]">
                        <div className="w-14 h-14 bg-white rounded-full flex items-center justify-center scale-50 group-hover:scale-100 transition-transform duration-500 shadow-2xl">
                          <Play className="w-6 h-6 text-emerald-600 fill-current ml-1" />
                        </div>
                      </div>
                      <div className="absolute top-4 left-4 flex items-center gap-2">
                        <div className="px-3 py-1 bg-white/90 backdrop-blur rounded-lg text-[9px] font-black text-slate-800 uppercase tracking-widest shadow-sm">
                          {video.day}
                        </div>
                      </div>
                    </div>
                    
                    <div className="p-6 flex flex-col flex-grow">
                      <h3 className="text-slate-800 font-bold text-sm line-clamp-2 leading-relaxed mb-6 group-hover:text-emerald-600 transition-colors">
                        {video.title}
                      </h3>
                      
                      <div className="mt-auto flex gap-2">
                        <button 
                          onClick={() => setActiveVideoId(extractYoutubeId(video.id))}
                          className="flex-1 py-3 bg-pink-600 hover:bg-pink-700 text-white rounded-xl font-bold text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 group/btn"
                        >
                          <Play className="w-3 h-3 fill-current group-hover/btn:scale-125 transition-transform" />
                          시청하기
                        </button>
                        <a 
                          href={`https://www.youtube.com/watch?v=${extractYoutubeId(video.id)}`}
                          target="_blank"
                          rel="no-referrer"
                          className="w-11 h-11 bg-slate-50 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-xl flex items-center justify-center transition-colors border border-slate-100"
                          title="YouTube에서 보기"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
