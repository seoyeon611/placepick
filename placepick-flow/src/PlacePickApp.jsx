import React, { useState, useEffect, useRef, useMemo } from "react";
import { fetchAllPlaces, addUserPlace, searchPlacesByName } from "./placesService.js";

/**
 * 플레이스픽(PlacePick) — 통합 앱 (최종본)
 * ------------------------------------------------------------
 * splash → login → (필요 시) signUp 단계들 → 메인 화면
 * 메인 화면 = 하단 탭바(홈 / 업로드 / 저장·예약)로 전환되는 실제 앱 셸
 *
 * 팝업(alert/confirm/prompt)은 아티팩트 iframe에서 막힐 수 있어 전부
 * 화면 내부 커스텀 토스트 / 확인창 / 모달로 대체했습니다.
 */

// ============================================================
// 로컬 저장(localStorage) 유틸 — 새로고침해도 데이터가 유지되도록.
// 주의: 이건 "이 브라우저/이 기기"에만 저장되는 방식입니다. 여러 사용자가
// 공유하는 진짜 서버 데이터베이스가 필요하면 이 부분을 실제 백엔드 API 호출로
// 교체하세요 (예: Firebase Firestore). 연동 예시는 firebase-integration.md 참고.
// ============================================================
function useLocalStorageState(key, initialValue) {
  const [state, setState] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initialValue;
    } catch (err) {
      console.warn("localStorage 읽기 실패:", key, err);
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch (err) {
      console.warn("localStorage 저장 실패:", key, err);
    }
  }, [key, state]);

  return [state, setState];
}

// 다른 화면(홈 탭 등)에서 저장/예약 탭이 리액트 상태를 공유하지 않고도
// 예약 목록에 새 예약을 실제로 추가할 수 있게 해주는 공용 함수.
// (저장/예약 탭도 같은 localStorage 키 "placepick_reservations"를 씀)
function addReservationToStorage({ reservation, placeName }) {
  const RESERVATIONS_KEY = "placepick_reservations";
  let list = [];
  try {
    const raw = window.localStorage.getItem(RESERVATIONS_KEY);
    list = raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn("예약 목록 읽기 실패:", err);
  }
  const newGroup = {
    id: `r-${Date.now()}`,
    label: "새 예약",
    date: `2026.05.${String(reservation.date).padStart(2, "0")}`,
    cancelled: false,
    isToday: false,
    items: [
      {
        time: reservation.time,
        name: placeName || "플레이스픽 다이닝",
        status: `성인 ${reservation.guestCount}명`,
        address: "서울 성동구 연무장길 12",
        rating: 4.8,
        code: String(Math.floor(1000 + Math.random() * 9000)),
      },
    ],
  };
  const updated = [newGroup, ...list];
  try {
    window.localStorage.setItem(RESERVATIONS_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn("예약 목록 저장 실패:", err);
  }
  return newGroup;
}

// 다른 화면(홈 탭 등)에서 저장/예약 탭이 리액트 상태를 공유하지 않고도
// "저장" 폴더에 실제로 선택한 장소를 추가할 수 있게 해주는 공용 함수.
// (저장/예약 탭도 같은 localStorage 키 "placepick_folders"를 씀)
function addPlaceToFolderStorage(folderName, place) {
  const FOLDERS_KEY = "placepick_folders";
  let folders = [];
  try {
    const raw = window.localStorage.getItem(FOLDERS_KEY);
    folders = raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn("폴더 목록 읽기 실패:", err);
  }

  const newItem = {
    id: `p-${Date.now()}`,
    name: place?.name || place?.displayName || "저장한 장소",
    category: place?.category || "",
    address: place?.address || "",
    hours: place?.hours || "",
    rating: place?.rating,
    photoUrl: place?.photoUrl || place?.url || null,
    aiAnalyzed: !!place?.aiAnalyzed,
    district: place?.district || "",
  };

  const idx = folders.findIndex((f) => f.name === folderName);
  if (idx >= 0) {
    folders = folders.map((f, i) => (i === idx ? { ...f, items: [newItem, ...(f.items || [])] } : f));
  } else {
    folders = [...folders, { id: `f-${Date.now()}`, name: folderName, items: [newItem] }];
  }

  try {
    window.localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
  } catch (err) {
    console.warn("폴더 저장 실패:", err);
  }
  return newItem;
}

// ============================================================
// 서버 연동 지점 (지금은 localStorage 기반 mock, 실제로는 백엔드 API로 교체하세요)
// ============================================================
const USERS_STORAGE_KEY = "placepick_users";

// file://로 열었을 때 등 일부 환경은 localStorage가 에러 없이 "조용히" 저장/읽기에
// 실패하기도 합니다(써도 안 써지거나, 써도 안 읽히는 경우). try/catch만으론 못 잡아서,
// 실제로 값을 하나 써보고 바로 읽어서 똑같이 나오는지 확인하는 방식으로 검증합니다.
let storageWorks = null; // null = 아직 검증 전

function checkLocalStorageWorks() {
  if (storageWorks !== null) return storageWorks;
  try {
    const testKey = "__placepick_storage_test__";
    const testValue = String(Date.now());
    window.localStorage.setItem(testKey, testValue);
    const readBack = window.localStorage.getItem(testKey);
    window.localStorage.removeItem(testKey);
    storageWorks = readBack === testValue;
  } catch {
    storageWorks = false;
  }
  if (!storageWorks) {
    console.warn(
      "이 브라우저/환경에서는 localStorage가 정상 동작하지 않아요(file://로 열었을 때 흔한 문제입니다). " +
        "페이지가 열려있는 동안만 유지되는 임시 저장소로 대체합니다."
    );
  }
  return storageWorks;
}

let memoryUsersFallback = [];

function getStoredUsers() {
  if (checkLocalStorageWorks()) {
    try {
      const raw = window.localStorage.getItem(USERS_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      // 아래 memoryUsersFallback으로 대체
    }
  }
  return memoryUsersFallback;
}

function saveStoredUsers(users) {
  memoryUsersFallback = users; // 항상 메모리에도 반영해서, localStorage가 조용히 실패해도 이 세션 내에서는 확실히 동작
  if (checkLocalStorageWorks()) {
    try {
      window.localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
    } catch (err) {
      console.warn("계정 저장 실패, 임시 저장소로 대체합니다:", err);
    }
  }
}

async function loginUser(userId, password) {
  await new Promise((r) => setTimeout(r, 400));
  if (!userId || !password) throw new Error("아이디와 비밀번호를 입력해주세요.");
  const users = getStoredUsers();
  const found = users.find((u) => u.id.toLowerCase() === userId.toLowerCase());
  if (!found) throw new Error("가입되지 않은 아이디입니다. 회원가입을 먼저 해주세요.");
  if (found.password !== password) throw new Error("비밀번호가 일치하지 않습니다.");
  return { id: found.id, name: found.name };
}
async function checkIdDuplicate(id) {
  await new Promise((r) => setTimeout(r, 300));
  const users = getStoredUsers();
  return users.some((u) => u.id.toLowerCase() === id.toLowerCase());
}
async function requestPhoneVerification() {
  await new Promise((r) => setTimeout(r, 500));
  return { success: true };
}
async function confirmVerificationCode(code) {
  await new Promise((r) => setTimeout(r, 400));
  return code.length === 6;
}
async function completeSignUp(payload) {
  await new Promise((r) => setTimeout(r, 500));
  const users = getStoredUsers();
  const isDuplicate = users.some((u) => u.id.toLowerCase() === payload.id.toLowerCase());
  if (isDuplicate) throw new Error("이미 사용 중인 아이디입니다.");
  users.push(payload);
  saveStoredUsers(users);
  return { success: true, ...payload };
}

// ------------------------------------------------------------
// 문의하기 전송
// ------------------------------------------------------------
// 아래 URL을 Formspree(https://formspree.io)에서 발급받은 실제 폼 주소로 바꾸면
// "문의 보내기"를 눌렀을 때 진짜로 이메일이 전송됩니다. (서버 코드 없이 바로 됨)
// 안 바꿔둔 상태에서는 localStorage에만 저장돼서 데이터가 사라지지는 않습니다.
const FORMSPREE_ENDPOINT = ""; // 예: "https://formspree.io/f/xxxxaaaa"

async function submitInquiry({ message, userId }) {
  // 1) 항상 로컬에 기록 (백엔드 연동 전에도 데이터가 사라지지 않도록)
  try {
    const key = "placepick_inquiries";
    const list = JSON.parse(window.localStorage.getItem(key) || "[]");
    list.push({ message, userId, createdAt: new Date().toISOString() });
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch (err) {
    console.warn("문의 로컬 저장 실패:", err);
  }

  // 2) Formspree 주소가 설정되어 있으면 실제로 전송
  if (FORMSPREE_ENDPOINT) {
    const res = await fetch(FORMSPREE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ message, userId }),
    });
    if (!res.ok) throw new Error("문의 전송에 실패했어요. 잠시 후 다시 시도해주세요.");
    return { success: true, delivered: true };
  }

  // Formspree 미설정 상태: 로컬 저장까지만 되고 실제 전송은 안 됨
  return { success: true, delivered: false };
}

async function extractPlaceInfo(item, index, showToast) {
  // api/analyze-place-image.js 서버 함수(Vercel Functions)를 실제로 호출합니다.
  // 로컬에서 그냥 npm run dev로 돌리면 이 서버 함수가 없어서 요청이 실패하는데,
  // 그런 경우에는 자동으로 mock 데이터로 대체해서 화면 흐름은 계속 테스트할 수 있게 해뒀어요.
  // 실제로 AI 분석이 되려면 Vercel에 배포하고 OPENAI_API_KEY 환경변수를 등록해야 합니다.
  //
  // 사진 여러 장을 올린 경우, 한 식당의 서로 다른 사진(간판/메뉴판/내부 등)으로 보고
  // 전부 한 번에 같이 분석해서 하나의 결과로 합쳐 받습니다.
  const photoFiles = item?.type === "photos" ? item.photos.map((p) => p.file) : item?.file ? [item.file] : [];
  const notify = (msg) => {
    console.warn(msg);
    if (showToast) showToast(msg);
  };

  if (photoFiles.length > 0) {
    try {
      const images = await Promise.all(
        photoFiles.map(async (file) => {
          const compressedBlob = await compressImage(file);
          const imageBase64 = await fileToBase64(compressedBlob);
          return { imageBase64, mimeType: "image/jpeg" };
        })
      );
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);
      let res;
      try {
        res = await fetch("/api/analyze-place-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ images }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      if (res.ok) {
        const data = await res.json();
        if (data && !data.error) return { ...data, aiAnalyzed: true };
        notify(`[AI분석 실패] ${data?.error || "알 수 없는 오류"} → 임시 데이터로 대체`);
      } else {
        const errBody = await res.json().catch(() => ({}));
        notify(`[AI분석 실패] 상태코드 ${res.status}: ${errBody?.error || "(응답 본문 없음)"} → 임시 데이터로 대체`);
      }
    } catch (err) {
      notify(
        err.name === "AbortError"
          ? "[AI분석 실패] 45초 넘게 응답이 없어서 중단했어요 (서버가 너무 오래 걸림) → 임시 데이터로 대체"
          : `[AI분석 실패] ${err.message || err} → 임시 데이터로 대체`
      );
    }
  }

  await new Promise((r) => setTimeout(r, 1200));
  return { ...MOCK_EXTRACT_POOL[index % MOCK_EXTRACT_POOL.length], aiAnalyzed: false };
}

// 파일을 base64 문자열(데이터 URL 접두어 제외)로 변환
// 사진을 그대로 base64로 보내면 휴대폰 사진 기준 5~10MB가 넘어서
// Vercel 서버 함수의 요청 크기 제한(4.5MB)에 걸려 500 에러가 날 수 있어요.
// 그래서 보내기 전에 가로/세로 최대 1280px, JPEG 품질 80%로 줄여서 훨씬 가볍게 만듭니다.
function compressImage(file, maxDimension = 1000, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > height && width > maxDimension) {
        height = Math.round((height * maxDimension) / width);
        width = maxDimension;
      } else if (height > maxDimension) {
        width = Math.round((width * maxDimension) / height);
        height = maxDimension;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error("이미지 압축에 실패했어요."));
          resolve(blob);
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("이미지를 불러오지 못했어요."));
    };
    img.src = objectUrl;
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result || "";
      const base64 = String(result).split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
async function savePlaces(items) {
  // 사용자가 업로드해서 확인한 장소들을 실제 DB(Firestore)의 "places" 컬렉션에 저장.
  // Firebase가 아직 설정 전이면 addUserPlace가 알아서 저장을 건너뛰고 경고만 띄움.
  const saved = await Promise.all(items.map((item) => addUserPlace(item)));
  return { success: true, items: saved };
}

// ============================================================
// 공용 UI 조각
// ============================================================
function StatusBar() {
  return (
    <div style={s.statusBar}>
      <span>9:41</span>
      <span style={s.statusIcons}>
        <i className="ti ti-antenna-bars-5" style={{ fontSize: 14 }} />
        <i className="ti ti-wifi" style={{ fontSize: 14 }} />
        <i className="ti ti-battery-4" style={{ fontSize: 14 }} />
      </span>
    </div>
  );
}
function HomeIndicator() {
  return (
    <div style={s.homeIndicatorWrap}>
      <div style={s.homeIndicator} />
    </div>
  );
}
function PhoneFrame({ children }) {
  return (
    <div style={s.phone}>
      <style>{`.no-scrollbar::-webkit-scrollbar { display: none; }`}</style>
      {children}
    </div>
  );
}
function Toast({ message }) {
  if (!message) return null;
  return (
    <div style={s.toast}>
      <span>{message}</span>
    </div>
  );
}
function ConfirmDialog({ dialog, onCancel }) {
  if (!dialog) return null;
  return (
    <div style={s.sheetOverlay} onClick={onCancel}>
      <div style={s.confirmBox} onClick={(e) => e.stopPropagation()}>
        <p style={s.confirmMessage}>{dialog.message}</p>
        <div style={s.confirmBtnRow}>
          <button type="button" style={s.confirmCancelBtn} onClick={onCancel}>
            아니오
          </button>
          <button
            type="button"
            style={dialog.danger ? { ...s.confirmOkBtn, background: "#C0392B" } : s.confirmOkBtn}
            onClick={dialog.onConfirm}
          >
            {dialog.confirmLabel || "확인"}
          </button>
        </div>
      </div>
    </div>
  );
}
function EditNameModal({ target, onSave, onCancel }) {
  const [value, setValue] = useState(target ? target.name : "");
  useEffect(() => {
    if (target) setValue(target.name);
  }, [target]);
  if (!target) return null;
  return (
    <div style={s.sheetOverlay} onClick={onCancel}>
      <div style={s.confirmBox} onClick={(e) => e.stopPropagation()}>
        <p style={s.confirmMessage}>컬렉션 이름 수정</p>
        <input type="text" value={value} onChange={(e) => setValue(e.target.value)} style={s.editNameInput} autoFocus />
        <div style={s.confirmBtnRow}>
          <button type="button" style={s.confirmCancelBtn} onClick={onCancel}>
            취소
          </button>
          <button type="button" style={s.confirmOkBtn} onClick={() => onSave(value)}>
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

// 순수 포인터 이벤트로 만든 듀얼 썸 슬라이더 (네이티브 range 2개 겹치기 방식은
// 모바일 웹뷰에서 오작동해서 이 방식으로 구현)
function DualThumbSlider({ min, max, step, minValue, maxValue, onChange }) {
  const trackRef = useRef(null);
  const draggingRef = useRef(null);
  const round = (v) => Math.round(v / step) * step;
  const percentOf = (v) => ((v - min) / (max - min)) * 100;
  const valueFromClientX = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const raw = min + ratio * (max - min);
    return Math.round(round(raw) * 10) / 10;
  };
  const startDrag = (which) => (e) => {
    e.preventDefault();
    draggingRef.current = which;
    const move = (ev) => {
      const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const v = valueFromClientX(clientX);
      if (draggingRef.current === "min") onChange(Math.min(v, maxValue - step), maxValue);
      else onChange(minValue, Math.max(v, minValue + step));
    };
    const end = () => {
      draggingRef.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);
  };
  const handleTrackClick = (e) => {
    if (e.target !== trackRef.current) return;
    const v = valueFromClientX(e.clientX);
    if (Math.abs(v - minValue) <= Math.abs(v - maxValue)) onChange(Math.min(v, maxValue - step), maxValue);
    else onChange(minValue, Math.max(v, minValue + step));
  };
  return (
    <div ref={trackRef} onClick={handleTrackClick} style={s.customSliderTrack}>
      <div style={s.customSliderBg} />
      <div style={{ ...s.customSliderActive, left: `${percentOf(minValue)}%`, right: `${100 - percentOf(maxValue)}%` }} />
      <div onMouseDown={startDrag("min")} onTouchStart={startDrag("min")} style={{ ...s.customSliderThumb, left: `${percentOf(minValue)}%` }} />
      <div onMouseDown={startDrag("max")} onTouchStart={startDrag("max")} style={{ ...s.customSliderThumb, left: `${percentOf(maxValue)}%` }} />
    </div>
  );
}

function SingleThumbSlider({ min, max, step, value, onChange }) {
  const trackRef = useRef(null);
  const round = (v) => Math.round(v / step) * step;
  const percentOf = (v) => ((v - min) / (max - min)) * 100;
  const valueFromClientX = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const raw = min + ratio * (max - min);
    return Math.round(round(raw) * 10) / 10;
  };
  const startDrag = (e) => {
    e.preventDefault();
    const move = (ev) => {
      const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
      onChange(valueFromClientX(clientX));
    };
    const end = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);
  };
  const handleTrackClick = (e) => {
    if (e.target !== trackRef.current) return;
    onChange(valueFromClientX(e.clientX));
  };
  return (
    <div ref={trackRef} onClick={handleTrackClick} style={s.customSliderTrack}>
      <div style={s.customSliderBg} />
      <div style={{ ...s.customSliderActive, left: 0, right: `${100 - percentOf(value)}%` }} />
      <div onMouseDown={startDrag} onTouchStart={startDrag} style={{ ...s.customSliderThumb, left: `${percentOf(value)}%` }} />
    </div>
  );
}

// ============================================================
// 인증 플로우: 스플래시 → 로그인 → 회원가입 단계들
// ============================================================
function SplashScreen({ onFinish }) {
  useEffect(() => {
    const t = setTimeout(onFinish, 1200);
    return () => clearTimeout(t);
  }, [onFinish]);
  return (
    <>
      <StatusBar />
      <div style={s.splashBody} onClick={onFinish}>
        <div style={s.logoPlaceholder}>
          <i className="ti ti-photo-x" style={{ fontSize: 28, color: "#B4B2A9" }} />
        </div>
        <p style={s.splashTitle}>PlacePick</p>
      </div>
      <div style={s.bottomTextWrap}>
        <p style={s.bottomText}>당신을 위한 최적의 공간 선택</p>
        <div style={s.dots}>
          <span style={s.dot} />
          <span style={s.dot} />
          <span style={s.dot} />
        </div>
      </div>
      <HomeIndicator />
    </>
  );
}

function FindIdScreen({ onBack, onGoLogin }) {
  const [step, setStep] = useState("phone"); // phone | code | result
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(CODE_TIMER_SECONDS);
  const [requesting, setRequesting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [codeError, setCodeError] = useState("");
  const [foundId, setFoundId] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (step !== "code") return;
    timerRef.current = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(timerRef.current);
  }, [step]);

  const formatTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  const handleRequestCode = async () => {
    if (phone.length < 10 || requesting) return;
    setRequesting(true);
    try {
      await requestPhoneVerification();
      setStep("code");
      setSecondsLeft(CODE_TIMER_SECONDS);
    } finally {
      setRequesting(false);
    }
  };

  const handleResend = async () => {
    setRequesting(true);
    try {
      await requestPhoneVerification();
      setSecondsLeft(CODE_TIMER_SECONDS);
      setCode("");
      setCodeError("");
    } finally {
      setRequesting(false);
    }
  };

  const handleConfirmCode = async () => {
    if (code.length !== 6) {
      setCodeError("인증번호 6자리를 입력해주세요.");
      return;
    }
    setConfirming(true);
    try {
      const ok = await confirmVerificationCode(code);
      if (!ok) {
        setCodeError("인증번호가 올바르지 않습니다.");
        return;
      }
      const users = getStoredUsers();
      const normalizedPhone = phone.replace(/\D/g, "");
      const match = users.find((u) => (u.phone || "").replace(/\D/g, "") === normalizedPhone && normalizedPhone.length > 0);
      setFoundId(match ? match.id : null);
      setStep("result");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <>
      <StatusBar />
      <SubScreenHeader title="아이디 찾기" onBack={onBack} />

      {step === "phone" && (
        <>
          <div style={s.signupBody}>
            <p style={s.stepTitle}>
              가입할 때 등록한
              <br />
              휴대폰 번호를 입력해주세요.
            </p>
            <input
              type="text"
              inputMode="numeric"
              placeholder="휴대폰 번호"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
              style={s.input}
            />
          </div>
          <div style={s.findIdFooter}>
            <button
              type="button"
              disabled={phone.length < 10 || requesting}
              onClick={handleRequestCode}
              style={{ ...s.primaryButton, opacity: phone.length < 10 ? 0.4 : 1 }}
            >
              {requesting ? "발송중..." : "인증번호 받기"}
            </button>
          </div>
        </>
      )}

      {step === "code" && (
        <>
          <div style={s.signupBody}>
            <p style={s.stepTitle}>인증번호를 입력해주세요.</p>
            <div style={s.inlineRow}>
              <input
                type="text"
                placeholder="인증번호 6자리 입력"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                  setCodeError("");
                }}
                style={{ ...s.input, flex: 1 }}
              />
              <span style={s.timerText}>{formatTime(secondsLeft)}</span>
              <button type="button" onClick={handleResend} disabled={requesting} style={s.resendButton}>
                재전송
              </button>
            </div>
            {codeError && <p style={s.fieldError}>{codeError}</p>}
          </div>
          <div style={s.findIdFooter}>
            <button type="button" disabled={confirming} onClick={handleConfirmCode} style={{ ...s.primaryButton, opacity: confirming ? 0.6 : 1 }}>
              {confirming ? "확인중..." : "확인"}
            </button>
          </div>
        </>
      )}

      {step === "result" && (
        <div style={s.findResultBody}>
          {foundId ? (
            <>
              <div style={s.confirmCheckCircle}>
                <i className="ti ti-user-check" style={{ fontSize: 30, color: "#FFFFFF" }} />
              </div>
              <p style={s.confirmTitleText}>아이디를 찾았어요!</p>
              <p style={s.findIdResultValue}>{foundId}</p>
            </>
          ) : (
            <>
              <div style={s.confirmCheckCircle}>
                <i className="ti ti-user-question" style={{ fontSize: 30, color: "#FFFFFF" }} />
              </div>
              <p style={s.confirmTitleText}>가입된 계정을 찾을 수 없어요.</p>
              <p style={s.confirmSubtitleText}>입력하신 번호로 가입된 계정이 없어요.</p>
            </>
          )}
          <div style={{ width: "100%" }}>
            <button type="button" style={s.primaryButton} onClick={onGoLogin}>
              로그인 화면으로
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function FindPasswordScreen({ onBack, onGoLogin, showToast }) {
  const [step, setStep] = useState("idPhone"); // idPhone | code | newPassword | done
  const [userId, setUserId] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(CODE_TIMER_SECONDS);
  const [requesting, setRequesting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [codeError, setCodeError] = useState("");
  const [matchedUser, setMatchedUser] = useState(null);
  const timerRef = useRef(null);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const hasLetter = /[A-Za-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasLength = password.length >= 8 && password.length <= 20;
  const isMatchPw = confirm.length > 0 && password === confirm;
  const isValidPw = hasLetter && hasNumber && hasLength && isMatchPw;

  useEffect(() => {
    if (step !== "code") return;
    timerRef.current = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(timerRef.current);
  }, [step]);

  const formatTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  const canRequestCode = userId.trim().length > 0 && phone.length >= 10;

  const handleRequestCode = async () => {
    if (!canRequestCode || requesting) return;
    setRequesting(true);
    try {
      await requestPhoneVerification();
      setStep("code");
      setSecondsLeft(CODE_TIMER_SECONDS);
    } finally {
      setRequesting(false);
    }
  };

  const handleResend = async () => {
    setRequesting(true);
    try {
      await requestPhoneVerification();
      setSecondsLeft(CODE_TIMER_SECONDS);
      setCode("");
      setCodeError("");
    } finally {
      setRequesting(false);
    }
  };

  const handleConfirmCode = async () => {
    if (code.length !== 6) {
      setCodeError("인증번호 6자리를 입력해주세요.");
      return;
    }
    setConfirming(true);
    try {
      const ok = await confirmVerificationCode(code);
      if (!ok) {
        setCodeError("인증번호가 올바르지 않습니다.");
        return;
      }
      const users = getStoredUsers();
      const normalizedPhone = phone.replace(/\D/g, "");
      const user = users.find(
        (u) => u.id.toLowerCase() === userId.trim().toLowerCase() && (u.phone || "").replace(/\D/g, "") === normalizedPhone
      );
      if (!user) {
        setCodeError("");
        showToast("아이디와 휴대폰 번호가 일치하는 계정을 찾을 수 없어요.");
        return;
      }
      setMatchedUser(user);
      setStep("newPassword");
    } finally {
      setConfirming(false);
    }
  };

  const handleSaveNewPassword = async () => {
    if (!isValidPw || saving) return;
    setSaving(true);
    try {
      const users = getStoredUsers();
      const updated = users.map((u) => (u.id.toLowerCase() === matchedUser.id.toLowerCase() ? { ...u, password } : u));
      saveStoredUsers(updated);
      setStep("done");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <StatusBar />
      <SubScreenHeader title="비밀번호 찾기" onBack={onBack} />

      {step === "idPhone" && (
        <>
          <div style={s.signupBody}>
            <p style={s.stepTitle}>
              아이디와 가입할 때 등록한
              <br />
              휴대폰 번호를 입력해주세요.
            </p>
            <input type="text" placeholder="아이디" value={userId} onChange={(e) => setUserId(e.target.value)} style={s.input} />
            <input
              type="text"
              inputMode="numeric"
              placeholder="휴대폰 번호"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
              style={{ ...s.input, marginTop: 10 }}
            />
          </div>
          <div style={s.findIdFooter}>
            <button
              type="button"
              disabled={!canRequestCode || requesting}
              onClick={handleRequestCode}
              style={{ ...s.primaryButton, opacity: !canRequestCode ? 0.4 : 1 }}
            >
              {requesting ? "발송중..." : "인증번호 받기"}
            </button>
          </div>
        </>
      )}

      {step === "code" && (
        <>
          <div style={s.signupBody}>
            <p style={s.stepTitle}>인증번호를 입력해주세요.</p>
            <div style={s.inlineRow}>
              <input
                type="text"
                placeholder="인증번호 6자리 입력"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                  setCodeError("");
                }}
                style={{ ...s.input, flex: 1 }}
              />
              <span style={s.timerText}>{formatTime(secondsLeft)}</span>
              <button type="button" onClick={handleResend} disabled={requesting} style={s.resendButton}>
                재전송
              </button>
            </div>
            {codeError && <p style={s.fieldError}>{codeError}</p>}
          </div>
          <div style={s.findIdFooter}>
            <button type="button" disabled={confirming} onClick={handleConfirmCode} style={{ ...s.primaryButton, opacity: confirming ? 0.6 : 1 }}>
              {confirming ? "확인중..." : "확인"}
            </button>
          </div>
        </>
      )}

      {step === "newPassword" && (
        <>
          <div style={s.signupBody}>
            <p style={s.stepTitle}>
              새로 사용할 비밀번호를
              <br />
              입력해주세요.
            </p>
            <div style={s.inputWithIcon}>
              <input
                type={showPw ? "text" : "password"}
                placeholder="비밀번호를 입력하세요."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={s.input}
              />
              <button type="button" style={s.eyeButton} onClick={() => setShowPw((v) => !v)} aria-label="비밀번호 표시 전환">
                <i className={showPw ? "ti ti-eye-off" : "ti ti-eye"} style={{ fontSize: 16 }} />
              </button>
            </div>
            <div style={s.validationRow}>
              <ValidationTag ok={hasLetter} label="영문" />
              <ValidationTag ok={hasNumber} label="숫자" />
              <ValidationTag ok={hasLength} label="8-20자 이내" />
            </div>
            <div style={{ ...s.inputWithIcon, marginTop: 10 }}>
              <input
                type={showConfirmPw ? "text" : "password"}
                placeholder="비밀번호를 다시 입력하세요."
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                style={s.input}
              />
              <button type="button" style={s.eyeButton} onClick={() => setShowConfirmPw((v) => !v)} aria-label="비밀번호 표시 전환">
                <i className={showConfirmPw ? "ti ti-eye-off" : "ti ti-eye"} style={{ fontSize: 16 }} />
              </button>
            </div>
            {confirm.length > 0 && (
              <div style={s.validationRow}>
                <ValidationTag ok={isMatchPw} label="비밀번호 일치" />
              </div>
            )}
          </div>
          <div style={s.findIdFooter}>
            <button
              type="button"
              disabled={!isValidPw || saving}
              onClick={handleSaveNewPassword}
              style={{ ...s.primaryButton, opacity: !isValidPw ? 0.4 : 1 }}
            >
              {saving ? "저장 중..." : "비밀번호 변경"}
            </button>
          </div>
        </>
      )}

      {step === "done" && (
        <div style={s.findResultBody}>
          <div style={s.confirmCheckCircle}>
            <i className="ti ti-check" style={{ fontSize: 30, color: "#FFFFFF" }} />
          </div>
          <p style={s.confirmTitleText}>비밀번호가 변경됐어요!</p>
          <p style={s.confirmSubtitleText}>새 비밀번호로 로그인해주세요.</p>
          <div style={{ width: "100%" }}>
            <button type="button" style={s.primaryButton} onClick={onGoLogin}>
              로그인 화면으로
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function LoginScreen({ onGoSignUp, onGoFindId, onGoFindPassword, onLoginSuccess, showToast }) {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 데모 편의 기능: 가입된 계정이 하나도 없으면 데모 계정을 자동으로 만들어서
  // 아이디/비밀번호 칸에 미리 채워둡니다. 실제 서비스 배포 시에는 이 블록을 지우세요.
  useEffect(() => {
    const users = getStoredUsers();
    if (users.length === 0) {
      const demoUser = { id: "demo_user", password: "12345678", name: "데모", phone: "" };
      saveStoredUsers([demoUser]);
      setUserId(demoUser.id);
      setPassword(demoUser.password);
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const user = await loginUser(userId, password);
      onLoginSuccess(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <StatusBar />
      <form onSubmit={handleLogin} style={s.loginBody}>
        <p style={s.loginTitle}>PlacePick</p>
        <p style={s.loginSubtitle}>당신만의 인생 맛집을 찾아보세요</p>
        {userId === "demo_user" && <p style={s.demoHint}>데모 계정이 자동으로 채워져 있어요. 바로 로그인해보세요.</p>}
        <input type="text" placeholder="아이디를 입력하세요." value={userId} onChange={(e) => setUserId(e.target.value)} style={s.input} />
        <input
          type="password"
          placeholder="비밀번호를 입력하세요."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ ...s.input, marginTop: 10 }}
        />
        {error && <p style={s.loginError}>{error}</p>}
        <button type="submit" disabled={submitting} style={{ ...s.loginButton, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? "로그인 중..." : "로그인"}
        </button>
        <div style={s.linkRow}>
          <button type="button" style={s.linkText} onClick={onGoFindId}>
            아이디 찾기
          </button>
          <span style={s.linkDivider}>|</span>
          <button type="button" style={s.linkText} onClick={onGoFindPassword}>
            비밀번호 찾기
          </button>
          <span style={s.linkDivider}>|</span>
          <button type="button" style={s.linkText} onClick={onGoSignUp}>
            회원가입
          </button>
        </div>
      </form>
      <HomeIndicator />
    </>
  );
}

function StepHeader({ onBack, step, totalSteps }) {
  const pct = Math.round((step / totalSteps) * 100);
  return (
    <>
      <div style={s.signupHeaderRow}>
        <button type="button" onClick={onBack} style={s.backButton} aria-label="뒤로가기">
          <ArrowLeftIcon />
        </button>
      </div>
      <div style={s.progressWrap}>
        <div style={s.progressBarBg}>
          <div style={{ ...s.progressBarFill, width: `${pct}%` }} />
        </div>
      </div>
    </>
  );
}

const TERMS_CONFIG = [
  { key: "age14", label: "만 14세 이상", required: true, viewable: false },
  { key: "service", label: "이용약관 동의", required: true, viewable: true },
  { key: "privacy", label: "개인정보 처리방침 동의", required: true, viewable: true },
  { key: "marketing", label: "광고성 정보 수신 및 마케팅 활용 동의", required: false, viewable: true },
];

function SignUpTermsScreen({ onBack, onNext, showToast }) {
  const [checked, setChecked] = useState({ age14: false, service: false, privacy: false, marketing: false });
  const requiredKeys = TERMS_CONFIG.filter((t) => t.required).map((t) => t.key);
  const allKeys = TERMS_CONFIG.map((t) => t.key);
  const allChecked = allKeys.every((k) => checked[k]);
  const requiredChecked = requiredKeys.every((k) => checked[k]);
  const toggleOne = (key) => setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleAll = () => {
    const next = !allChecked;
    const updated = {};
    allKeys.forEach((k) => (updated[k] = next));
    setChecked(updated);
  };

  return (
    <>
      <StatusBar />
      <StepHeader onBack={onBack} step={1} totalSteps={5} />
      <div style={s.signupBody}>
        <p style={s.signupTitle}>
          <b>PlacePick</b>의 서비스 이용약관에 동의해주세요
        </p>
        <div style={s.termsList}>
          {TERMS_CONFIG.map((t) => (
            <div key={t.key} style={s.termRow}>
              <label style={s.termLabelWrap}>
                <input type="checkbox" checked={checked[t.key]} onChange={() => toggleOne(t.key)} style={s.checkbox} />
                <span style={s.termLabel}>
                  <span style={t.required ? s.requiredTag : s.optionalTag}>[{t.required ? "필수" : "선택"}]</span> {t.label}
                </span>
              </label>
              {t.viewable && (
                <button type="button" style={s.viewLink} onClick={() => showToast(`${t.label} 상세 내용`)}>
                  보기
                </button>
              )}
            </div>
          ))}
        </div>
        <div style={s.termsDivider} />
        <label style={s.allAgreeRow}>
          <input type="checkbox" checked={allChecked} onChange={toggleAll} style={s.checkbox} />
          <span style={s.allAgreeLabel}>모두 동의 (선택 정보 포함)</span>
        </label>
      </div>
      <div style={s.signupFooter}>
        <button
          type="button"
          disabled={!requiredChecked}
          onClick={onNext}
          style={{ ...s.primaryButton, opacity: !requiredChecked ? 0.4 : 1, cursor: !requiredChecked ? "not-allowed" : "pointer" }}
        >
          동의하고 가입하기
        </button>
      </div>
      <HomeIndicator />
    </>
  );
}

function SignUpIdScreen({ onBack, onNext }) {
  const [id, setId] = useState("");
  const [status, setStatus] = useState("idle");
  const [touched, setTouched] = useState(false);

  const handleChange = (e) => {
    setId(e.target.value);
    setStatus("idle");
  };
  const handleNext = async () => {
    setTouched(true);
    if (!id) return;
    setStatus("checking");
    const isDuplicate = await checkIdDuplicate(id);
    if (isDuplicate) {
      setStatus("duplicate");
      return;
    }
    setStatus("available");
    onNext(id);
  };

  return (
    <>
      <StatusBar />
      <StepHeader onBack={onBack} step={2} totalSteps={5} />
      <div style={s.signupBody}>
        <p style={s.stepTitle}>
          사용할 아이디를
          <br />
          입력해주세요.
        </p>
        <input type="text" placeholder="아이디를 입력하세요." value={id} onChange={handleChange} style={s.input} />
        {touched && !id && <p style={s.fieldError}>아이디를 입력해주세요.</p>}
        {status === "duplicate" && <p style={s.fieldError}>이미 사용 중인 아이디입니다.</p>}
      </div>
      <div style={s.signupFooter}>
        <button type="button" onClick={handleNext} disabled={status === "checking"} style={s.primaryButton}>
          {status === "checking" ? "확인중..." : "다음"}
        </button>
      </div>
      <HomeIndicator />
    </>
  );
}

function ValidationTag({ ok, label }) {
  return (
    <span style={{ ...s.validationTag, color: ok ? "#1D9E75" : "#B0B0B0" }}>
      {label} {ok && <i className="ti ti-check" style={{ fontSize: 12 }} />}
    </span>
  );
}

function SignUpPasswordScreen({ onBack, onNext }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const hasLetter = /[A-Za-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasLength = password.length >= 8 && password.length <= 20;
  const isMatch = confirm.length > 0 && password === confirm;
  const isValid = hasLetter && hasNumber && hasLength && isMatch;

  return (
    <>
      <StatusBar />
      <StepHeader onBack={onBack} step={3} totalSteps={5} />
      <div style={s.signupBody}>
        <p style={s.stepTitle}>
          사용할 비밀번호를
          <br />
          입력해주세요.
        </p>
        <div style={s.inputWithIcon}>
          <input
            type={showPw ? "text" : "password"}
            placeholder="비밀번호를 입력하세요."
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={s.input}
          />
          <button type="button" style={s.eyeButton} onClick={() => setShowPw((v) => !v)} aria-label="비밀번호 표시 전환">
            <i className={showPw ? "ti ti-eye-off" : "ti ti-eye"} style={{ fontSize: 16 }} />
          </button>
        </div>
        <div style={s.validationRow}>
          <ValidationTag ok={hasLetter} label="영문" />
          <ValidationTag ok={hasNumber} label="숫자" />
          <ValidationTag ok={hasLength} label="8-20자 이내" />
        </div>
        <div style={{ ...s.inputWithIcon, marginTop: 10 }}>
          <input
            type={showConfirm ? "text" : "password"}
            placeholder="비밀번호를 다시 입력하세요."
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            style={s.input}
          />
          <button type="button" style={s.eyeButton} onClick={() => setShowConfirm((v) => !v)} aria-label="비밀번호 표시 전환">
            <i className={showConfirm ? "ti ti-eye-off" : "ti ti-eye"} style={{ fontSize: 16 }} />
          </button>
        </div>
        {confirm.length > 0 && (
          <div style={s.validationRow}>
            <ValidationTag ok={isMatch} label="비밀번호 일치" />
          </div>
        )}
      </div>
      <div style={s.signupFooter}>
        <button
          type="button"
          disabled={!isValid}
          onClick={() => onNext(password)}
          style={{ ...s.primaryButton, opacity: !isValid ? 0.4 : 1, cursor: !isValid ? "not-allowed" : "pointer" }}
        >
          다음
        </button>
      </div>
      <HomeIndicator />
    </>
  );
}

const CARRIERS = ["SKT", "KT", "LG U+", "알뜰폰"];
const CODE_TIMER_SECONDS = 180;

function SignUpPhoneScreen({ onBack, onNext }) {
  const [name, setName] = useState("");
  const [residentFront, setResidentFront] = useState(""); // 실제 숫자 값 (마스킹 전)
  const [carrier, setCarrier] = useState("");
  const [phone, setPhone] = useState("");
  const [codeRequested, setCodeRequested] = useState(false);
  const [code, setCode] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(CODE_TIMER_SECONDS);
  const [requesting, setRequesting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [codeError, setCodeError] = useState("");
  const timerRef = useRef(null);

  useEffect(() => {
    if (!codeRequested) return;
    timerRef.current = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(timerRef.current);
  }, [codeRequested]);

  const formatTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  const infoComplete = name && residentFront.length === 7 && carrier && phone;

  const handleResidentChange = (e) => {
    setResidentFront(e.target.value.replace(/\D/g, "").slice(0, 7));
  };

  // 생년월일(6자리) - 성별구분(1자리) 형식으로 표시하고, 다 입력하면 뒤에 장식용 별표 6개를 붙임
  const residentDisplay =
    residentFront.length <= 6
      ? residentFront
      : `${residentFront.slice(0, 6)}-${residentFront.slice(6)}${residentFront.length === 7 ? "******" : ""}`;

  const handleRequestCode = async () => {
    if (!infoComplete || requesting) return;
    setRequesting(true);
    try {
      await requestPhoneVerification();
      setCodeRequested(true);
      setSecondsLeft(CODE_TIMER_SECONDS);
    } finally {
      setRequesting(false);
    }
  };
  const handleResend = async () => {
    setRequesting(true);
    try {
      await requestPhoneVerification();
      setSecondsLeft(CODE_TIMER_SECONDS);
      setCode("");
      setCodeError("");
    } finally {
      setRequesting(false);
    }
  };
  const handleConfirmCode = async () => {
    if (code.length !== 6) {
      setCodeError("인증번호 6자리를 입력해주세요.");
      return;
    }
    setConfirming(true);
    try {
      const ok = await confirmVerificationCode(code);
      if (!ok) {
        setCodeError("인증번호가 올바르지 않습니다.");
        return;
      }
      onNext({ name, phone });
    } finally {
      setConfirming(false);
    }
  };

  // 엔터키 입력 시: 아직 인증번호 요청 전이면 요청 실행, 요청 후라면 인증번호 확인 실행
  const handleFormSubmit = (e) => {
    e.preventDefault();
    if (!codeRequested) {
      handleRequestCode();
    } else {
      handleConfirmCode();
    }
  };

  return (
    <>
      <StatusBar />
      <StepHeader onBack={onBack} step={4} totalSteps={5} />
      <form style={s.signupBody} onSubmit={handleFormSubmit}>
        <p style={s.stepTitle}>
          휴대폰 본인인증을
          <br />
          진행합니다.
        </p>
        <input type="text" placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} style={s.input} disabled={codeRequested} />
        <input
          type="text"
          inputMode="numeric"
          placeholder="주민등록번호 앞 7자리"
          value={residentDisplay}
          onChange={handleResidentChange}
          style={{ ...s.input, marginTop: 10 }}
          disabled={codeRequested}
        />
        <div style={{ ...s.inlineRow, marginTop: 10 }}>
          <select value={carrier} onChange={(e) => setCarrier(e.target.value)} style={s.select} disabled={codeRequested}>
            <option value="">통신사</option>
            {CARRIERS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            type="tel"
            placeholder="휴대폰 번호 입력"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
            style={{ ...s.input, flex: 1 }}
            disabled={codeRequested}
          />
        </div>
        {codeRequested && (
          <div style={{ ...s.inlineRow, marginTop: 14 }}>
            <input
              type="text"
              placeholder="인증번호 6자리 입력"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                setCodeError("");
              }}
              style={{ ...s.input, flex: 1 }}
            />
            <span style={s.timerText}>{formatTime(secondsLeft)}</span>
            <button type="button" onClick={handleResend} disabled={requesting} style={s.resendButton}>
              재전송
            </button>
          </div>
        )}
        {codeRequested && (
          <button
            type="button"
            style={s.editInfoLink}
            onClick={() => {
              setCodeRequested(false);
              setCode("");
              setCodeError("");
              clearInterval(timerRef.current);
            }}
          >
            입력한 정보가 틀렸나요? 정보 수정하기
          </button>
        )}
        {codeError && <p style={s.fieldError}>{codeError}</p>}
      </form>
      <div style={s.signupFooter}>
        {!codeRequested ? (
          <button
            type="button"
            disabled={!infoComplete || requesting}
            onClick={handleRequestCode}
            style={{ ...s.primaryButton, opacity: !infoComplete || requesting ? 0.4 : 1 }}
          >
            {requesting ? "발송중..." : "다음"}
          </button>
        ) : (
          <button type="button" disabled={confirming} onClick={handleConfirmCode} style={{ ...s.primaryButton, opacity: confirming ? 0.6 : 1 }}>
            {confirming ? "확인중..." : "다음"}
          </button>
        )}
      </div>
      <HomeIndicator />
    </>
  );
}

function SignUpDoneScreen({ nickname, onGoHome }) {
  return (
    <>
      <StatusBar />
      <div style={s.signupHeaderRow}>
        <div style={{ width: 20 }} />
      </div>
      <div style={s.progressWrap}>
        <div style={s.progressBarBg}>
          <div style={{ ...s.progressBarFill, width: "100%" }} />
        </div>
      </div>
      <div style={s.doneBody}>
        <p style={s.doneWelcome}>
          반가워요 <b>{nickname || "회원"}</b> 님!
        </p>
        <div style={s.doneCircle}>
          <i className="ti ti-check" style={{ fontSize: 40, color: "#FFFFFF" }} />
        </div>
        <p style={s.doneLabel}>가입 완료</p>
      </div>
      <div style={s.signupFooter}>
        <button type="button" onClick={onGoHome} style={s.secondaryButton}>
          로그인하기
        </button>
      </div>
      <HomeIndicator />
    </>
  );
}

// ============================================================
// 메인 셸: 하단 탭바 + 4개 탭
// ============================================================
const MAIN_TABS = [
  { key: "home", label: "홈", icon: "ti-home" },
  { key: "upload", label: "업로드", icon: "ti-circle-plus" },
  { key: "saved", label: "저장/예약", icon: "ti-bookmark" },
];

function MainBottomTabBar({ active, onChange }) {
  return (
    <div style={s.bottomTabBar}>
      {MAIN_TABS.map((t) => (
        <button key={t.key} type="button" style={s.bottomTabButton} onClick={() => onChange(t.key)}>
          <i className={`ti ${t.icon}`} style={{ fontSize: 20, color: active === t.key ? "#1A1A1A" : "#B0B0B0" }} />
          <span style={{ ...s.bottomTabLabel, color: active === t.key ? "#1A1A1A" : "#B0B0B0" }}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// ---- 홈 탭 (탐색/필터 + 메뉴/설정) ----
const MOCK_RESTAURANTS = [
  { id: 1, name: "다담 (Dadam)", category: "한식", rating: 4.6 },
  { id: 2, name: "스시소식", category: "일식", rating: 4.2 },
  { id: 3, name: "브릭레인 비스트로", category: "양식", rating: 3.8 },
  { id: 4, name: "카페 봄날", category: "카페", rating: 4.9 },
  { id: 5, name: "마라향", category: "중식", rating: 3.5 },
  { id: 6, name: "순이네", category: "한식", rating: 4.0 },
  { id: 7, name: "우동카덴", category: "일식", rating: 4.4 },
  { id: 8, name: "플레이스픽 다이닝", category: "양식", rating: 3.2 },
];
const MAP_PIN_PLACES = [
  { ...MOCK_RESTAURANTS[0], x: 120, y: 90, icon: "ti-tools-kitchen-2" },
  { ...MOCK_RESTAURANTS[3], x: 200, y: 150, icon: "ti-coffee" },
  { ...MOCK_RESTAURANTS[6], x: 245, y: 230, icon: "ti-tools-kitchen-2" },
];
const FILTER_CHIPS = ["평점", "음식 종류", "가격", "리뷰", "분위기", "더보기"];
const MORE_FILTER_OPTIONS = ["혼밥 가능", "영업중", "24시간 운영", "오늘 휴무 제외", "단체석", "와이파이", "콘센트", "반려동물 동반", "비건", "주차 가능"];
const MOOD_OPTIONS = ["로컬", "캐주얼", "모던", "감성", "럭셔리"];
const FOOD_TYPE_OPTIONS = [
  { key: "양식", icon: "ti-chef-hat" },
  { key: "중식", icon: "ti-noodles" },
  { key: "한식", icon: "ti-soup" },
  { key: "일식", icon: "ti-fish" },
  { key: "카페", icon: "ti-coffee" },
  { key: "술집", icon: "ti-beer" },
  { key: "베이커리", icon: "ti-bread" },
  { key: "멕시칸", icon: "ti-pizza" },
  { key: "태국음식", icon: "ti-bowl" },
  { key: "분식", icon: "ti-meat" },
];

// ---- 예전에 검색 결과 화면을 mock으로 채우던 데이터 (지금은 allPlaces의 실제 데이터를 씀).
// RESTAURANT_DETAIL_TEMPLATE만 상세 화면의 fallback 값으로 계속 사용됨.
const RESTAURANT_DETAIL_TEMPLATE = {
  name: "플레이스픽 다이닝",
  rating: 4.8,
  address: "서울특별시 강남구 테헤란로 123",
  hours: "주말 휴무, 평일 9:00 ~ 21:00",
  phone: "010-0000-0000",
  tags: ["혼밥가능", "브레이크타임 없음", "다이닝 테이블", "와이파이", "룸먼트"],
  signatureMenu: [
    { name: "트러플 머쉬룸 리조또", desc: "이탈리아산 블랙 트러플의 진한 풍미가 가득한 크리미한 리조또", price: "28,000원" },
    { name: "한우 채끝 스테이크", desc: "최상급 1++ 한우를 21일간 숙성한 구 워낸 스테이크", price: "54,000원" },
  ],
  reviewCount: 124,
  imageCount: 5,
};

const RESERVATION_TIME_SLOTS = ["오전 11:00", "오전 11:30", "오후 12:00", "오후 12:30", "오후 01:00", "오후 01:30", "오후 02:00", "오후 02:30", "오후 03:00"];


const MENU_ITEMS = [
  { key: "contact", label: "문의하기", icon: "ti-help-circle" },
  { key: "notice", label: "공지사항", icon: "ti-bell" },
  { key: "settings", label: "설정", icon: "ti-settings" },
];

function HamburgerIcon() {
  return (
    <span style={s.hamburgerWrap}>
      <span style={s.hamburgerBar} />
      <span style={s.hamburgerBar} />
      <span style={s.hamburgerBar} />
    </span>
  );
}

function BellIcon({ size = 20, color = "#1A1A1A" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function ArrowLeftIcon({ size = 20, color = "#1A1A1A" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  );
}

function CloseIcon({ size = 20, color = "#1A1A1A" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

// 지도 앱에서 흔히 보는 "현재 위치" 크로스헤어 아이콘
function LocationIcon({ size = 18, color = "#1A1A1A" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3" />
      <path d="M12 19v3" />
      <path d="M2 12h3" />
      <path d="M19 12h3" />
    </svg>
  );
}

// 실제 카카오맵 SDK를 붙이기 전까지 쓰는 지도 목업.
// kakao-map-integration.md 가이드대로 연동하면 이 컴포넌트를 실제 <KakaoMap /> 으로 교체하면 됨.
// 카카오맵 좌표 (서울 기준 임의 배치, 실제 서비스에서는 DB에 저장된 lat/lng를 씀)
const MAP_PIN_COORDS = [
  { lat: 37.5665, lng: 126.978 },
  { lat: 37.5595, lng: 126.994 },
  { lat: 37.55, lng: 127.0 },
];

// 카카오맵 SDK(window.kakao)가 로드되어 있으면 실제 지도를, 아니면 목업을 보여줌.
// index.html에 카카오 JS 키를 넣은 스크립트 태그를 추가하면 자동으로 실제 지도로 전환됩니다.
function KakaoMapReal({ places, userLocation, showToast }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const myLocationMarkerRef = useRef(null);
  const placeMarkersRef = useRef([]);
  const [selected, setSelected] = useState(null);
  const [mapReady, setMapReady] = useState(false);

  // 위/경도 정보가 있는 실제 장소만 지도에 표시 (최대 30곳, 너무 많으면 지도가 느려짐)
  const pinnablePlaces = useMemo(
    () => (places || []).filter((p) => typeof p.lat === "number" && typeof p.lng === "number").slice(0, 30),
    [places]
  );

  // 지도 자체는 딱 한 번만 만듦 (여기서 마커까지 같이 새로 만들면, 나중에 places가
  // 바뀔 때마다 지도가 통째로 재생성되면서 중심이 서울로 리셋되는 문제가 있었음)
  useEffect(() => {
    if (!window.kakao || !window.kakao.maps) return;
    window.kakao.maps.load(() => {
      const map = new window.kakao.maps.Map(mapRef.current, {
        center: new window.kakao.maps.LatLng(37.5665, 126.978),
        level: 6,
      });
      mapInstanceRef.current = map;
      setMapReady(true);
    });
  }, []);

  // 장소 목록이 바뀔 때는 지도를 다시 만들지 않고, 마커만 지웠다가 새로 찍음
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !window.kakao || !window.kakao.maps) return;
    placeMarkersRef.current.forEach((m) => m.setMap(null));
    placeMarkersRef.current = [];

    const list = pinnablePlaces.length > 0 ? pinnablePlaces : MAP_PIN_PLACES.map((p, i) => ({ ...p, ...MAP_PIN_COORDS[i] }));
    list.forEach((place) => {
      if (typeof place.lat !== "number" || typeof place.lng !== "number") return;
      const marker = new window.kakao.maps.Marker({
        position: new window.kakao.maps.LatLng(place.lat, place.lng),
        map: mapInstanceRef.current,
      });
      window.kakao.maps.event.addListener(marker, "click", () => setSelected(place));
      placeMarkersRef.current.push(marker);
    });
  }, [pinnablePlaces, mapReady]);

  // "내 위치" 버튼으로 실제 위치를 받아오면, 지도를 그 위치로 옮기고 파란 점 마커를 찍음
  useEffect(() => {
    if (!userLocation || !mapInstanceRef.current || !window.kakao || !window.kakao.maps) return;
    const position = new window.kakao.maps.LatLng(userLocation.lat, userLocation.lng);
    mapInstanceRef.current.setCenter(position);
    mapInstanceRef.current.setLevel(4);

    if (myLocationMarkerRef.current) {
      myLocationMarkerRef.current.setMap(null);
    }
    const markerImage = new window.kakao.maps.MarkerImage(
      "data:image/svg+xml;charset=UTF-8," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><circle cx="11" cy="11" r="8" fill="%232F7DE1" stroke="white" stroke-width="3"/></svg>'
        ),
      new window.kakao.maps.Size(22, 22),
      { offset: new window.kakao.maps.Point(11, 11) }
    );
    myLocationMarkerRef.current = new window.kakao.maps.Marker({
      position,
      map: mapInstanceRef.current,
      image: markerImage,
      zIndex: 10,
    });
  }, [userLocation]);

  return (
    <div style={s.mapMockupWrap}>
      <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
      {selected && (
        <div style={s.mapPlaceCard} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>{selected.name}</span>
            <span style={{ fontSize: 11.5 }}>
              <i className="ti ti-star-filled" style={{ fontSize: 11, color: "#F2B84B" }} /> {selected.rating}
            </span>
          </div>
          <p style={{ fontSize: 11.5, color: "#8A8A8A", margin: "4px 0 0" }}>{selected.category}</p>
        </div>
      )}
    </div>
  );
}

function MapView({ places, userLocation, showToast }) {
  const [kakaoReady, setKakaoReady] = useState(
    typeof window !== "undefined" && !!(window.kakao && window.kakao.maps)
  );

  useEffect(() => {
    if (kakaoReady) return;
    // 카카오 SDK 스크립트가 나중에(비동기로) 로드될 수도 있어 잠깐 재확인
    const t = setInterval(() => {
      if (window.kakao && window.kakao.maps) {
        setKakaoReady(true);
        clearInterval(t);
      }
    }, 500);
    const timeout = setTimeout(() => clearInterval(t), 5000);
    return () => {
      clearInterval(t);
      clearTimeout(timeout);
    };
  }, [kakaoReady]);

  return kakaoReady ? (
    <KakaoMapReal places={places} userLocation={userLocation} showToast={showToast} />
  ) : (
    <MapMockup places={places} showToast={showToast} />
  );
}

function MapMockup({ places, showToast }) {
  const [selected, setSelected] = useState(null);

  // 목업 지도는 실제 좌표가 없는 일러스트라, 실제 장소 몇 곳을 뽑아서 그럴듯한 위치에 배치
  const pins = useMemo(() => {
    const source = places && places.length > 0 ? places : MAP_PIN_PLACES;
    const positions = [
      { x: 120, y: 90 },
      { x: 200, y: 150 },
      { x: 245, y: 230 },
      { x: 60, y: 190 },
      { x: 170, y: 40 },
    ];
    return source.slice(0, 5).map((p, i) => ({
      ...p,
      x: positions[i % positions.length].x,
      y: positions[i % positions.length].y,
      icon: p.category === "카페" ? "ti-coffee" : "ti-tools-kitchen-2",
    }));
  }, [places]);

  return (
    <div style={s.mapMockupWrap}>
      <svg width="100%" height="100%" viewBox="0 0 300 260" style={{ position: "absolute", inset: 0 }}>
        <rect width="300" height="260" fill="#E9EDE4" />
        <rect x="0" y="60" width="300" height="12" fill="#FFFFFF" />
        <rect x="0" y="150" width="300" height="9" fill="#FFFFFF" />
        <rect x="90" y="0" width="10" height="260" fill="#FFFFFF" />
        <rect x="200" y="0" width="9" height="260" fill="#FFFFFF" />
        <rect x="40" y="90" width="28" height="35" fill="#D8DED0" />
        <rect x="130" y="80" width="40" height="50" fill="#D8DED0" />
        <rect x="220" y="160" width="45" height="38" fill="#D8DED0" />
      </svg>
      {pins.map((p, i) => (
        <button
          key={p.id || i}
          type="button"
          onClick={() => setSelected(p)}
          style={{ ...s.mapPin, left: p.x, top: p.y }}
          aria-label={p.name}
        >
          <span style={s.mapPinInner}>
            <i className={`ti ${p.icon}`} style={{ fontSize: 12, color: "#FFFFFF", transform: "rotate(45deg)" }} />
          </span>
        </button>
      ))}
      <div style={s.mapMyLocationDot} />

      {selected && (
        <div style={s.mapPlaceCard} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>{selected.name}</span>
            <span style={{ fontSize: 11.5 }}>
              <i className="ti ti-star-filled" style={{ fontSize: 11, color: "#F2B84B" }} /> {selected.rating}
            </span>
          </div>
          <p style={{ fontSize: 11.5, color: "#8A8A8A", margin: "4px 0 0" }}>{selected.category}</p>
        </div>
      )}
    </div>
  );
}

const REGION_DISTRICTS = {
  서울: [
    "강남구", "강동구", "강북구", "강서구", "관악구", "광진구", "구로구", "금천구", "노원구", "도봉구",
    "동대문구", "동작구", "마포구", "서대문구", "서초구", "성동구", "성북구", "송파구", "양천구", "영등포구",
    "용산구", "은평구", "종로구", "중구", "중랑구",
  ],
  부산: ["강서구", "금정구", "남구", "동구", "동래구", "부산진구", "북구", "사상구", "사하구", "서구", "수영구", "연제구", "영도구", "중구", "해운대구", "기장군"],
  대구: ["남구", "달서구", "달성군", "동구", "북구", "서구", "수성구", "중구", "군위군"],
  인천: ["강화군", "계양구", "남동구", "동구", "미추홀구", "부평구", "서구", "연수구", "옹진군", "중구"],
  광주: ["광산구", "남구", "동구", "북구", "서구"],
  대전: ["대덕구", "동구", "서구", "유성구", "중구"],
  울산: ["남구", "동구", "북구", "중구", "울주군"],
  세종: ["세종시"],
  경기: [
    "고양시", "과천시", "광명시", "광주시", "구리시", "군포시", "김포시", "남양주시", "동두천시", "부천시",
    "성남시", "수원시", "시흥시", "안산시", "안성시", "안양시", "양주시", "양평군", "여주시", "연천군",
    "오산시", "용인시", "의왕시", "의정부시", "이천시", "파주시", "평택시", "포천시", "하남시", "화성시",
  ],
  강원: ["강릉시", "고성군", "동해시", "삼척시", "속초시", "양구군", "양양군", "영월군", "원주시", "인제군", "정선군", "철원군", "춘천시", "태백시", "평창군", "홍천군", "화천군", "횡성군"],
  충북: ["괴산군", "단양군", "보은군", "영동군", "옥천군", "음성군", "제천시", "증평군", "진천군", "청주시", "충주시"],
  충남: ["계룡시", "공주시", "금산군", "논산시", "당진시", "보령시", "부여군", "서산시", "서천군", "아산시", "예산군", "천안시", "청양군", "태안군", "홍성군"],
  전북: ["고창군", "군산시", "김제시", "남원시", "무주군", "부안군", "순창군", "완주군", "익산시", "임실군", "장수군", "전주시", "정읍시", "진안군"],
  전남: ["강진군", "고흥군", "곡성군", "광양시", "구례군", "나주시", "담양군", "목포시", "무안군", "보성군", "순천시", "신안군", "여수시", "영광군", "영암군", "완도군", "장성군", "장흥군", "진도군", "함평군", "해남군", "화순군"],
  경북: ["경산시", "경주시", "고령군", "구미시", "군위군", "김천시", "문경시", "봉화군", "상주시", "성주군", "안동시", "영덕군", "영양군", "영주시", "영천시", "예천군", "울릉군", "울진군", "의성군", "청도군", "청송군", "칠곡군", "포항시"],
  경남: ["거제시", "거창군", "고성군", "김해시", "남해군", "밀양시", "사천시", "산청군", "양산시", "의령군", "진주시", "창녕군", "창원시", "통영시", "하동군", "함안군", "함양군", "합천군"],
  제주: ["제주시", "서귀포시"],
};
const REGION_TABS = ["전체", "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"];

// 카카오맵이 돌려주는 region_1depth_name(예: "서울특별시", "강원특별자치도")을
// 위 REGION_TABS의 짧은 이름으로 바꿔서 매칭하기 위한 표
const REGION1_MATCH = {
  서울: ["서울"],
  부산: ["부산"],
  대구: ["대구"],
  인천: ["인천"],
  광주: ["광주"],
  대전: ["대전"],
  울산: ["울산"],
  세종: ["세종"],
  경기: ["경기"],
  강원: ["강원"],
  충북: ["충청북도", "충북"],
  충남: ["충청남도", "충남"],
  전북: ["전라북도", "전북"],
  전남: ["전라남도", "전남"],
  경북: ["경상북도", "경북"],
  경남: ["경상남도", "경남"],
  제주: ["제주"],
};
function matchRegionTab(region1) {
  for (const [tab, keywords] of Object.entries(REGION1_MATCH)) {
    if (keywords.some((k) => region1.includes(k))) return tab;
  }
  return null;
}

function RegionSelectPanel({ expanded, onToggle, activeRegion, setActiveRegion, selectedDistricts, toggleDistrict, showToast }) {
  const districts = REGION_DISTRICTS[activeRegion] || [];

  return (
    <div style={s.regionPanel}>
      <button type="button" style={s.collapseHeader} onClick={onToggle}>
        <span>지역 선택</span>
        <i className={expanded ? "ti ti-chevron-up" : "ti ti-chevron-down"} style={{ fontSize: 15 }} />
      </button>
      {expanded && (
        <>
          <div style={s.regionTabRow}>
            {REGION_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveRegion(tab)}
                style={activeRegion === tab ? s.regionTabActive : s.regionTab}
              >
                {tab}
              </button>
            ))}
          </div>
          {activeRegion === "전체" ? (
            <p style={s.regionAllText}>모든 지역의 맛집을 보여드려요.</p>
          ) : (
            <div style={s.districtGrid}>
              {districts.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDistrict(d)}
                  style={selectedDistricts.includes(d) ? s.districtBtnActive : s.districtBtn}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ExploreContent({ onOpenMenu, onOpenSettings, onViewResults, showToast }) {
  const [activeFilterChip, setActiveFilterChip] = useState("평점");
  const [ratingValue, setRatingValue] = useState(0);
  const [priceValue, setPriceValue] = useState(1000);
  const [reviewValue, setReviewValue] = useState(0);
  const [moodTags, setMoodTags] = useState([]);
  const [foodTypes, setFoodTypes] = useState([]);
  const [moreFilters, setMoreFilters] = useState(["혼밥 가능"]);

  // 실제 DB(Firestore)에서 장소 목록을 불러옴. src/firebase.js가 아직 설정 전이면
  // 자동으로 mock 데이터를 대신 씀 (placesService.js 참고).
  const [allPlaces, setAllPlaces] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [locating, setLocating] = useState(false);
  const [placesLoading, setPlacesLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetchAllPlaces()
      .then((places) => {
        if (!cancelled) setAllPlaces(places);
      })
      .catch((err) => {
        console.error("장소 데이터를 불러오지 못했어요:", err);
        showToast("장소 데이터를 불러오지 못했어요.");
      })
      .finally(() => {
        if (!cancelled) setPlacesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [regionExpanded, setRegionExpanded] = useState(false);
  const [filterExpanded, setFilterExpanded] = useState(true);
  const [activeRegion, setActiveRegion] = useState("서울");
  const [selectedDistricts, setSelectedDistricts] = useState([]);

  const toggleDistrict = (district) => {
    setSelectedDistricts((prev) => (prev.includes(district) ? prev.filter((d) => d !== district) : [...prev, district]));
  };

  const toggleFoodType = (type) => {
    setFoodTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  };

  const toggleMoreFilter = (option) => {
    setMoreFilters((prev) => (prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option]));
  };

  const toggleMoodTag = (tag) => {
    setMoodTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const handleReset = () => {
    setRatingValue(0);
    setPriceValue(1000);
    setReviewValue(0);
    setMoodTags([]);
    setFoodTypes([]);
    setOpenOnly(false);
    setMoreFilters([]);
  };

  // 선택된 모든 필터(평점/음식종류/가격/리뷰수/분위기/영업중/더보기 태그)를 한번에 적용
  const filteredResults = useMemo(() => {
    return allPlaces.filter((item) => {
      if (ratingValue > 0 && item.rating < ratingValue) return false;
      if (foodTypes.length > 0 && !foodTypes.includes(item.category)) return false;
      const otherTags = moreFilters.filter((f) => f !== "영업중");
      if (moreFilters.includes("영업중") && !item.openNow) return false;
      if (otherTags.length > 0 && !otherTags.every((f) => item.tags.includes(f))) return false;
      // 가격 슬라이더는 최소값(1000, 슬라이더 맨 왼쪽)일 땐 필터를 안 걸고,
      // 사용자가 움직였을 때만 "이 가격 이하"로 필터링
      if (priceValue > 1000 && item.price > priceValue) return false;
      if (reviewValue > 0 && item.reviewCount < reviewValue) return false;
      if (moodTags.length > 0 && !moodTags.includes(item.mood)) return false;
      if (activeRegion !== "전체" && selectedDistricts.length > 0 && !selectedDistricts.includes(item.district)) return false;
      return true;
    });
  }, [allPlaces, ratingValue, foodTypes, moreFilters, priceValue, reviewValue, moodTags, activeRegion, selectedDistricts]);

  const filteredCount = filteredResults.length;

  const handleViewResults = () => {
    onViewResults(filteredResults);
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      showToast("이 브라우저는 위치 정보를 지원하지 않아요.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setUserLocation({ lat: latitude, lng: longitude });
        showToast("내 위치로 지도를 이동했어요.");

        try {
          if (!(window.kakao && window.kakao.maps && window.kakao.maps.services)) {
            showToast("지도가 아직 다 안 켜졌어요. 잠시 후 다시 눌러주세요.");
            return;
          }
          const geocoder = new window.kakao.maps.services.Geocoder();
          const result = await new Promise((resolve) => {
            geocoder.coord2Address(longitude, latitude, (res, status) => {
              resolve(status === window.kakao.maps.services.Status.OK ? res : null);
            });
          });
          if (!result || !result[0]) {
            showToast("현재 위치의 주소를 확인하지 못했어요.");
            return;
          }

          const region1 = result[0].address.region_1depth_name || "";
          const region2 = result[0].address.region_2depth_name || "";
          const matchedTab = matchRegionTab(region1);

          // 카카오가 "안산시 단원구"처럼 더 세분화된 이름을 줄 수도 있어서,
          // 정확히 똑같은 문자열이 아니라 서로 포함하는 관계면 매칭되도록 처리
          const matchedDistrict = matchedTab
            ? REGION_DISTRICTS[matchedTab]?.find((d) => region2 === d || region2.startsWith(d) || d.startsWith(region2))
            : null;

          if (!matchedTab || !matchedDistrict) {
            showToast("현재 위치의 지역을 확인하지 못했어요.");
            return;
          }

          setActiveRegion(matchedTab);
          setSelectedDistricts([matchedDistrict]);
          setRegionExpanded(true);
          // 새로 불러온 지역 식당들이 "혼밥 가능" 같은 기본 필터에 걸려 다 사라지지 않도록,
          // 위치 기반 검색을 할 때는 더보기 태그 필터를 초기화
          setMoreFilters([]);

          const hasThisDistrict = allPlaces.some((p) => p.district === matchedDistrict);
          if (!hasThisDistrict) {
            showToast(`${matchedDistrict} 실제 식당을 불러오는 중...`);
            const nearby = await searchPlacesByName(`${matchedTab} ${matchedDistrict} 맛집`);
            if (nearby.length > 0) {
              // 카카오가 준 원래 지역명("안산시 단원구" 등)이 아니라, 방금 설정한 필터 값
              // (matchedDistrict)과 정확히 똑같이 맞춰야 지역 필터에서 걸러지지 않음
              setAllPlaces((cur) => [...cur, ...nearby.map((p) => ({ ...p, district: matchedDistrict }))]);
              showToast(`${matchedDistrict} 실제 식당 ${nearby.length}곳을 새로 불러왔어요.`);
            } else {
              showToast(`${matchedDistrict} 주변 식당을 찾지 못했어요.`);
            }
          } else {
            showToast(`${matchedDistrict} 주변 식당으로 지역이 자동 설정됐어요.`);
          }
        } catch (err) {
          console.error(err);
          showToast("주변 식당을 불러오지 못했어요.");
        } finally {
          setLocating(false);
        }
      },
      () => {
        showToast("위치 권한을 허용해주세요.");
        setLocating(false);
      }
    );
  };

  return (
    <>
      <div style={s.header}>
        <button type="button" style={s.iconButton} onClick={onOpenMenu} aria-label="메뉴">
          <HamburgerIcon />
        </button>
        <span style={s.headerTitle}>PlacePick</span>
        <div style={{ display: "flex", gap: 4 }}>
          <button type="button" style={s.iconButton} onClick={onOpenSettings} aria-label="설정">
            <i className="ti ti-settings" style={{ fontSize: 20 }} />
          </button>
          <button type="button" style={s.iconButton} aria-label="알림">
            <BellIcon />
          </button>
        </div>
      </div>
      <div style={{ ...s.searchBarRow, justifyContent: "flex-end" }}>
        <button
          type="button"
          style={{ ...s.locationButton, opacity: locating ? 0.5 : 1 }}
          aria-label="내 위치"
          disabled={locating}
          onClick={handleUseMyLocation}
        >
          <LocationIcon />
        </button>
      </div>
      <div style={{ position: "relative" }}>
        <MapView places={allPlaces} userLocation={userLocation} showToast={showToast} />
        <div style={s.zoomControl}>
          <button type="button" style={s.zoomBtn} onClick={() => showToast("지도를 확대했어요.")} aria-label="확대">
            <i className="ti ti-plus" style={{ fontSize: 14 }} />
          </button>
          <div style={s.zoomDivider} />
          <button type="button" style={s.zoomBtn} onClick={() => showToast("지도를 축소했어요.")} aria-label="축소">
            <i className="ti ti-minus" style={{ fontSize: 14 }} />
          </button>
        </div>
      </div>

      <RegionSelectPanel
        expanded={regionExpanded}
        onToggle={() => setRegionExpanded((v) => !v)}
        activeRegion={activeRegion}
        setActiveRegion={setActiveRegion}
        selectedDistricts={selectedDistricts}
        toggleDistrict={toggleDistrict}
        showToast={showToast}
      />

      <button type="button" style={s.collapseHeader} onClick={() => setFilterExpanded((v) => !v)}>
        <span>필터 선택</span>
        <i className={filterExpanded ? "ti ti-chevron-up" : "ti ti-chevron-down"} style={{ fontSize: 15 }} />
      </button>

      {filterExpanded && (
        <>
          <div className="no-scrollbar" style={s.filterChipsRow}>
            {FILTER_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => setActiveFilterChip(chip)}
                style={activeFilterChip === chip ? s.chipActive : s.chip}
              >
                {chip}
              </button>
            ))}
          </div>

          {activeFilterChip === "평점" && (
            <div style={s.ratingSection}>
              <div style={s.ratingHeaderRow}>
                <span style={s.ratingLabel}>평점 선택</span>
                <span style={s.ratingValue}>{ratingValue.toFixed(1)}{ratingValue >= 5 ? "" : ""}</span>
              </div>
              <div style={s.sliderWrap}>
                <span style={{ fontSize: 11, color: "#8A8A8A" }}>0.0</span>
                <SingleThumbSlider min={0} max={5} step={0.1} value={ratingValue} onChange={setRatingValue} />
                <span style={{ fontSize: 11, color: "#8A8A8A" }}>5.0+</span>
              </div>
              <div style={{ textAlign: "center", marginTop: 6 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <i
                    key={n}
                    className={n <= Math.round(ratingValue) ? "ti ti-star-filled" : "ti ti-star"}
                    style={{ fontSize: 13, color: n <= Math.round(ratingValue) ? "#F2B84B" : "#DADADA", marginRight: 2 }}
                  />
                ))}
              </div>
            </div>
          )}

          {activeFilterChip === "음식 종류" && (
            <div style={s.foodTypeSection}>
              <div style={s.foodTypeChipRow}>
                {FOOD_TYPE_OPTIONS.map((opt) => {
                  const active = foodTypes.includes(opt.key);
                  return (
                    <button key={opt.key} type="button" onClick={() => toggleFoodType(opt.key)} style={active ? s.chipActive : s.chip}>
                      {opt.key}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {activeFilterChip === "가격" && (
            <div style={s.ratingSection}>
              <p style={s.ratingLabel}>가격 선택</p>
              <div style={s.sliderWrap}>
                <span style={{ fontSize: 11, color: "#8A8A8A" }}>{priceValue.toLocaleString()}원</span>
                <SingleThumbSlider min={1000} max={1000000} step={1000} value={priceValue} onChange={setPriceValue} />
                <span style={{ fontSize: 11, color: "#8A8A8A" }}>100만원+</span>
              </div>
            </div>
          )}

          {activeFilterChip === "리뷰" && (
            <div style={s.ratingSection}>
              <p style={s.ratingLabel}>리뷰 수 선택</p>
              <div style={s.sliderWrap}>
                <span style={{ fontSize: 11, color: "#8A8A8A" }}>{reviewValue}</span>
                <SingleThumbSlider min={0} max={500} step={10} value={reviewValue} onChange={setReviewValue} />
                <span style={{ fontSize: 11, color: "#8A8A8A" }}>500+</span>
              </div>
            </div>
          )}

          {activeFilterChip === "분위기" && (
            <div style={s.foodTypeSection}>
              <div style={s.foodTypeChipRow}>
                {MOOD_OPTIONS.map((tag) => (
                  <button key={tag} type="button" onClick={() => toggleMoodTag(tag)} style={moodTags.includes(tag) ? s.chipActive : s.chip}>
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeFilterChip === "더보기" && (
            <div style={s.foodTypeSection}>
              <div style={s.foodTypeChipRow}>
                {MORE_FILTER_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => toggleMoreFilter(option)}
                    style={moreFilters.includes(option) ? s.chipActive : s.chip}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={s.actionRow}>
            <button type="button" onClick={handleReset} style={s.resetButton}>
              초기화
            </button>
            <button type="button" onClick={handleViewResults} disabled={placesLoading} style={s.resultButton}>
              {placesLoading ? "불러오는 중..." : `${filteredCount}개 결과 보기 →`}
            </button>
          </div>
        </>
      )}
    </>
  );
}

function SideMenuDrawer({ open, onClose, onNavigate, onLogout }) {
  return (
    <div style={{ ...s.drawerOverlay, pointerEvents: open ? "auto" : "none", opacity: open ? 1 : 0 }} onClick={onClose}>
      <div style={{ ...s.drawer, transform: open ? "translateX(0)" : "translateX(-100%)" }} onClick={(e) => e.stopPropagation()}>
        <div style={s.drawerProfileRow}>
          <div style={s.avatarCircle}>
            <i className="ti ti-user" style={{ fontSize: 20, color: "#B0B0B0" }} />
          </div>
          <p style={s.drawerUserName}>사용자님</p>
        </div>
        <div style={s.drawerList}>
          {MENU_ITEMS.map((item) => (
            <button key={item.key} type="button" style={s.drawerListItem} onClick={() => onNavigate(item.key)}>
              <i className={`ti ${item.icon}`} style={{ fontSize: 17 }} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <div style={s.drawerFooter}>
          <button type="button" style={s.logoutButton} onClick={onLogout}>
            <i className="ti ti-logout" style={{ fontSize: 15 }} /> 로그아웃
          </button>
          <p style={s.appVersionText}>App Version 1.0.0</p>
        </div>
      </div>
    </div>
  );
}

function SubScreenHeader({ title, onBack }) {
  return (
    <div style={s.settingsHeader}>
      <button type="button" style={s.iconButton} onClick={onBack} aria-label="뒤로가기">
        <ArrowLeftIcon />
      </button>
      <span style={s.settingsTitle}>{title}</span>
      <span style={{ width: 28 }} />
    </div>
  );
}

function ReservationSyncScreen({ onBack }) {
  const [syncOn, setSyncOn] = useState(true);
  return (
    <>
      <SubScreenHeader title="예약 연동" onBack={onBack} />
      <div style={s.settingsBody}>
        <div style={s.settingsRow}>
          <p style={s.settingsRowTitle}>전화 · 링크 예약 앱에 연동하기</p>
          <button type="button" onClick={() => setSyncOn((v) => !v)} style={{ ...s.toggleTrack, background: syncOn ? "#1A1A1A" : "#DADADA" }}>
            <span style={{ ...s.toggleThumb, transform: syncOn ? "translateX(18px)" : "translateX(0)" }} />
          </button>
        </div>

        <p style={s.syncPhoneLabel}>
          휴대폰 번호: <b>010-1234-5678</b>
        </p>

        <p style={s.syncSectionTitle}>예약 연동이란?</p>
        <p style={s.syncSectionText}>
          전화 또는 예약 링크로 한 예약을 앱에서 관리할 수 있게 하는 기능입니다. 예약에 사용한 휴대폰 번호로 방문예정일을 불러올 수 있습니다.
        </p>

        <p style={s.syncSectionTitle}>예약 링크란?</p>
        <p style={s.syncSectionText}>플레이스픽 가맹점을 예약할 수 있는 웹페이지 링크를 말합니다.</p>
      </div>
    </>
  );
}

function ImprovementSuggestionScreen({ onBack, showToast }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [agreed, setAgreed] = useState(true);
  const [sending, setSending] = useState(false);

  const canSubmit = title.trim() && body.trim() && agreed;

  const handleSubmit = async () => {
    if (!canSubmit) {
      showToast("제목, 내용을 입력하고 동의해주세요.");
      return;
    }
    setSending(true);
    try {
      await submitInquiry({ message: `[개선 제안] ${title.trim()}\n${body.trim()}`, userId: null });
      showToast("소중한 제안 감사합니다!");
      setTitle("");
      setBody("");
    } catch (err) {
      showToast(err.message || "제안 전송 중 오류가 발생했어요.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <SubScreenHeader title="개선 제안" onBack={onBack} />
      <div style={s.suggestBody}>
        <p style={s.suggestIntroText}>
          플레이스픽이 보다 나은 서비스와 사용 경험을 제공할 수 있도록 사용 의견이나 제안을 보내주세요. 보내주신 의견은 제품 개선 활동에 큰 도움이 됩니다.
          <br />
          *예약 관련 또는 플레이스픽 담당자 확인이 필요한 문의 사항은 "1:1 문의" 메뉴를 사용 부탁 드립니다.
        </p>
        <input type="text" placeholder="제목을 입력해주세요." value={title} onChange={(e) => setTitle(e.target.value)} style={s.suggestTitleInput} />
        <textarea placeholder="내용을 입력해주세요." value={body} onChange={(e) => setBody(e.target.value)} style={s.suggestBodyTextarea} />
        <p style={s.suggestDisclaimer}>
          문의 내용에 대한 상세한 확인이 필요하거나 긴급한 문의일 경우, 회원 가입 시 입력하신 휴대폰 번호로 연락드릴 수 있습니다. 개인정보 처리에
          대한 자세한 내용은 <span style={s.suggestDisclaimerLink}>개인정보 처리방침</span>을 참고해주시기 바랍니다.
        </p>
        <label style={s.suggestAgreeRow}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={s.checkbox} />
          <span style={s.suggestAgreeLabel}>위 내용에 동의합니다.</span>
        </label>
      </div>
      <div style={s.footer}>
        <button type="button" onClick={handleSubmit} disabled={sending} style={{ ...s.primaryButton, opacity: canSubmit ? 1 : 0.5 }}>
          {sending ? "전송 중..." : "제안하기"}
        </button>
      </div>
    </>
  );
}

const INITIAL_MY_REVIEWS = [
  {
    id: "rv1",
    placeName: "식당 이름",
    rating: 5,
    date: "2026.05.04",
    text: "메뉴가 다양하고 식당 분위기도 좋고 맛도 너무 좋았어요 다시 가보고 싶네요 ㅎㅎ",
    hasPhoto: true,
    hidden: false,
  },
  {
    id: "rv2",
    placeName: "식당 이름",
    rating: 5,
    date: "2026.05.04",
    text: "메뉴가 다양하고 식당 분위기도 좋고 맛도 너무 좋았어요!! 다시 가보고 싶네요 ㅎㅎ",
    hasPhoto: true,
    hidden: false,
  },
  {
    id: "rv3",
    placeName: "식당 이름",
    rating: 5,
    date: "2026.05.04",
    text: "메뉴가 다양하고 식당 분위기도 좋고 맛도 너무 좋았어요!! 다시 가보고 싶네요 ㅎㅎ",
    hasPhoto: false,
    hidden: false,
  },
];

function MyReviewScreen({ onBack, showToast, showConfirm }) {
  const [reviews, setReviews] = useLocalStorageState("placepick_my_reviews", INITIAL_MY_REVIEWS);
  const visibleReviews = reviews.filter((r) => !r.hidden);

  const handleDelete = (id) => {
    showConfirm({
      message: "이 리뷰를 삭제할까요?",
      danger: true,
      confirmLabel: "삭제",
      onConfirm: () => {
        setReviews((prev) => prev.filter((r) => r.id !== id));
        showToast("리뷰를 삭제했어요.");
      },
    });
  };

  return (
    <>
      <SubScreenHeader title="내 리뷰" onBack={onBack} />
      {visibleReviews.length === 0 ? (
        <div style={s.myReviewEmptyBody}>
          <div style={s.myReviewEmptyIcon}>
            <i className="ti ti-info-circle" style={{ fontSize: 22, color: "#C4C2B8" }} />
          </div>
          <p style={s.myReviewEmptyText}>작성한 리뷰가 없어요</p>
        </div>
      ) : (
        <div style={s.scrollBody}>
          <p style={s.myReviewCountText}>내가 쓴 총 리뷰 {visibleReviews.length}개</p>
          <button type="button" style={s.myReviewGuideLink} onClick={() => showToast("리뷰 수정 안내는 준비 중이에요.")}>
            리뷰 수정 안내
          </button>

          {visibleReviews.map((review) => (
            <div key={review.id} style={s.myReviewCard}>
              <div style={s.myReviewTopRow}>
                <button type="button" style={s.myReviewPlaceLink} onClick={() => showToast("식당 상세로 이동합니다.")}>
                  {review.placeName} <i className="ti ti-chevron-right" style={{ fontSize: 13 }} />
                </button>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" style={{ ...s.myReviewActionBtn, color: "#C0392B" }} onClick={() => handleDelete(review.id)}>
                    삭제
                  </button>
                </div>
              </div>
              <p style={s.myReviewMetaRow}>
                {"★".repeat(review.rating)}
                <span style={{ color: "#DADADA" }}>{"★".repeat(5 - review.rating)}</span>
                <span style={{ marginLeft: 6, color: "#B0B0B0" }}>{review.date}</span>
              </p>
              <p style={s.myReviewText}>{review.text}</p>
              {review.hasPhoto && (
                <div style={s.myReviewPhoto}>
                  <i className="ti ti-photo-x" style={{ fontSize: 20, color: "#C4C2B8" }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function SettingsScreen({ onBack, showToast, showConfirm, onLogout }) {
  const [notifOn, setNotifOn] = useState(false);
  const [showReservationSync, setShowReservationSync] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showSuggestion, setShowSuggestion] = useState(false);
  const [showMyReviews, setShowMyReviews] = useState(false);

  if (showReservationSync) {
    return <ReservationSyncScreen onBack={() => setShowReservationSync(false)} />;
  }
  if (showProfile) {
    return <ProfileScreen onBack={() => setShowProfile(false)} showToast={showToast} onLogout={onLogout} />;
  }
  if (showSuggestion) {
    return <ImprovementSuggestionScreen onBack={() => setShowSuggestion(false)} showToast={showToast} />;
  }
  if (showMyReviews) {
    return <MyReviewScreen onBack={() => setShowMyReviews(false)} showToast={showToast} showConfirm={showConfirm} />;
  }

  return (
    <>
      <SubScreenHeader title="설정" onBack={onBack} />
      <div style={s.settingsBody}>
        <p style={s.notifIntroText}>
          알림을 키면 <b>다양한 맛집을</b> 추천받을 수 있어요!
        </p>
        <div style={s.notifCard}>
          <i className="ti ti-bell" style={{ fontSize: 24, color: "#1A1A1A" }} />
          <p style={s.notifCardHint}>*기기 설정 &gt; 알림 &gt; 알림 허용</p>
        </div>
        <div style={s.settingsRow}>
          <div>
            <p style={s.settingsRowTitle}>서비스 이용 알림</p>
            <p style={s.settingsRowSub}>예약, 맛집 추천 정보 등</p>
          </div>
          <button type="button" onClick={() => setNotifOn((v) => !v)} style={{ ...s.toggleTrack, background: notifOn ? "#1A1A1A" : "#DADADA" }}>
            <span style={{ ...s.toggleThumb, transform: notifOn ? "translateX(18px)" : "translateX(0)" }} />
          </button>
        </div>
        <p style={s.settingsSectionLabel}>계정</p>
        <button type="button" style={s.settingsListItem} onClick={() => setShowProfile(true)}>
          내 정보 수정
        </button>
        <p style={s.settingsSectionLabel}>예약 정보</p>
        <button type="button" style={s.settingsListItem} onClick={() => setShowReservationSync(true)}>
          예약 연동
        </button>
        <p style={s.settingsSectionLabel}>리뷰 관리</p>
        <button type="button" style={s.settingsListItem} onClick={() => setShowMyReviews(true)}>
          내 리뷰
        </button>
        <p style={s.settingsSectionLabel}>서비스 이용</p>
        <button type="button" style={s.settingsListItem} onClick={() => setShowSuggestion(true)}>
          개선 제안
        </button>
      </div>
    </>
  );
}

function ProfileScreen({ onBack, showToast, onLogout }) {
  const rows = [
    { label: "이름", value: "홍길동" },
    { label: "휴대폰 번호", badge: "미인증", value: "010-1234-5678" },
    { label: "비밀번호", value: "미설정" },
    { label: "성별", value: "선택안함" },
    { label: "알림 설정", value: "" },
  ];
  return (
    <>
      <SubScreenHeader title="내 정보 수정" onBack={onBack} />
      <div style={s.settingsBody}>
        {rows.map((row) => (
          <button key={row.label} type="button" style={s.profileEditRow} onClick={() => showToast(`${row.label} 수정 화면은 준비 중이에요.`)}>
            <span style={s.profileEditLabel}>{row.label}</span>
            <span style={s.profileEditValueWrap}>
              {row.badge && <span style={s.profileEditBadge}>{row.badge}</span>}
              <span style={s.profileEditValue}>{row.value}</span>
              <i className="ti ti-chevron-right" style={{ fontSize: 15, color: "#C4C2B8" }} />
            </span>
          </button>
        ))}
        <button type="button" style={s.profileLogoutRow} onClick={() => onLogout && onLogout()}>
          로그아웃
        </button>
        <p style={s.profileWithdrawText}>
          회원탈퇴를 하시려면{" "}
          <button type="button" style={s.profileWithdrawLink} onClick={() => showToast("회원탈퇴 화면은 준비 중이에요.")}>
            여기
          </button>
          를 눌러주세요
        </p>
      </div>
    </>
  );
}

const FAQ_ITEMS = [
  { q: "예약은 어떻게 취소하나요?", a: "저장/예약 탭의 예약 탭에서 취소하기를 눌러주세요." },
  { q: "저장한 맛집은 어디서 보나요?", a: "하단 탭바의 저장/예약 메뉴에서 확인할 수 있어요." },
  { q: "비밀번호를 잊어버렸어요.", a: "로그인 화면의 비밀번호 찾기를 이용해주세요." },
];

function ContactScreen({ onBack, showToast }) {
  const [openIndex, setOpenIndex] = useState(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const handleSubmit = async () => {
    if (!message.trim()) {
      showToast("문의 내용을 입력해주세요.");
      return;
    }
    setSending(true);
    try {
      const result = await submitInquiry({ message: message.trim(), userId: null });
      showToast(result.delivered ? "문의가 전송됐어요. 빠르게 답변드릴게요!" : "문의가 접수되었어요. (실전송은 아직 설정 전이에요)");
      setMessage("");
    } catch (err) {
      showToast(err.message || "문의 전송 중 오류가 발생했어요.");
    } finally {
      setSending(false);
    }
  };
  return (
    <>
      <SubScreenHeader title="문의하기" onBack={onBack} />
      <div style={s.settingsBody}>
        <p style={s.subSectionLabel}>자주 묻는 질문</p>
        {FAQ_ITEMS.map((item, i) => (
          <div key={i} style={s.faqItem}>
            <button type="button" style={s.faqQuestion} onClick={() => setOpenIndex(openIndex === i ? null : i)}>
              <span>{item.q}</span>
              <i className={openIndex === i ? "ti ti-chevron-up" : "ti ti-chevron-down"} style={{ fontSize: 14 }} />
            </button>
            {openIndex === i && <p style={s.faqAnswer}>{item.a}</p>}
          </div>
        ))}
        <p style={{ ...s.subSectionLabel, marginTop: 20 }}>1:1 문의</p>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="문의하실 내용을 입력해주세요." style={s.contactTextarea} />
        <button type="button" style={{ ...s.contactSubmitBtn, opacity: sending ? 0.6 : 1 }} onClick={handleSubmit} disabled={sending}>
          {sending ? "전송 중..." : "문의 보내기"}
        </button>
      </div>
    </>
  );
}

const NOTICE_ITEMS = [
  { date: "2026.06.20", title: "플레이스픽 앱 업데이트 안내 (v1.0.0)" },
  { date: "2026.06.02", title: "서비스 이용약관 개정 안내" },
];

function NoticeScreen({ onBack }) {
  const [openIndex, setOpenIndex] = useState(null);
  return (
    <>
      <SubScreenHeader title="공지사항" onBack={onBack} />
      <div style={s.settingsBody}>
        {NOTICE_ITEMS.map((item, i) => (
          <div key={i} style={s.faqItem}>
            <button type="button" style={s.faqQuestion} onClick={() => setOpenIndex(openIndex === i ? null : i)}>
              <span>
                <span style={s.noticeDate}>{item.date}</span> {item.title}
              </span>
              <i className={openIndex === i ? "ti ti-chevron-up" : "ti ti-chevron-down"} style={{ fontSize: 14 }} />
            </button>
            {openIndex === i && <p style={s.faqAnswer}>자세한 공지 내용이 여기에 표시됩니다. (mock 데이터)</p>}
          </div>
        ))}
      </div>
    </>
  );
}

// ---- 검색 결과 목록 ----
function ResultsListScreen({ items, onBack, onSelectPlace }) {
  const [query, setQuery] = useState("");
  const filteredItems = query.trim()
    ? items.filter((item) => {
        const q = query.trim().toLowerCase();
        return (
          (item.displayName || item.name || "").toLowerCase().includes(q) ||
          (item.category || "").toLowerCase().includes(q) ||
          (item.address || "").toLowerCase().includes(q) ||
          (item.district || "").toLowerCase().includes(q)
        );
      })
    : items;

  return (
    <>
      <div style={s.header}>
        <button type="button" style={s.iconButton} onClick={onBack} aria-label="뒤로가기">
          <ArrowLeftIcon />
        </button>
        <span style={s.headerTitle}>PlacePick</span>
        <button type="button" style={s.iconButton} aria-label="알림">
          <BellIcon />
        </button>
      </div>
      <div style={s.searchBarRow}>
        <div style={s.searchBarWrap}>
          <i className="ti ti-search" style={{ fontSize: 15, color: "#B0B0B0" }} />
          <input
            type="text"
            placeholder="식당, 음식 또는 지역 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={s.searchBarInput}
          />
        </div>
      </div>
      <p style={s.resultsCountText}>{filteredItems.length}개의 식당을 찾았습니다.</p>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
        {filteredItems.length === 0 && <p style={s.emptyText}>조건에 맞는 식당이 없어요. 필터를 조정해보세요.</p>}
        {filteredItems.map((item) => (
          <button key={item.id} type="button" style={s.resultCard} onClick={() => onSelectPlace(item)}>
            <div style={s.resultCardImage}>
              <span style={s.resultCardBadgeRow}>
                <span style={s.resultCardRatingBadge}>
                  <i className="ti ti-star-filled" style={{ fontSize: 10, color: "#F2B84B" }} /> {item.rating} · {item.saves} Saves
                </span>
                <span style={s.resultCardBookmark}>
                  <i className="ti ti-bookmark" style={{ fontSize: 14, color: "#FFFFFF" }} />
                </span>
              </span>
              <i className="ti ti-photo-x" style={{ fontSize: 26, color: "#B4B2A9" }} />
            </div>
            <div style={{ padding: "10px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>{item.displayName}</span>
                <span style={{ fontSize: 10.5, color: "#1D9E75", fontWeight: 600 }}>{item.openNow ? "Open Now" : "Closed"}</span>
              </div>
              <p style={{ fontSize: 11, color: "#8A8A8A", margin: "2px 0 6px" }}>
                {item.category} · {item.priceLevel} · {item.distance}
              </p>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                {item.tags.map((t) => (
                  <span key={t} style={s.resultCardTag}>
                    {t}
                  </span>
                ))}
              </div>
              <p style={s.resultCardMenuLabel}>Signature Menu</p>
              {item.signatureMenu.map((m) => (
                <div key={m.name} style={s.resultCardMenuRow}>
                  <span style={{ fontSize: 11 }}>{m.name}</span>
                  <span style={{ fontSize: 11, color: "#8A8A8A" }}>{m.price}</span>
                </div>
              ))}
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

// ---- 식당 상세 페이지 ----
function RestaurantDetailScreen({ place, onBack, onOpenSave, onOpenReserve, showToast }) {
  const detail = {
    ...RESTAURANT_DETAIL_TEMPLATE,
    name: place?.name ?? RESTAURANT_DETAIL_TEMPLATE.name,
    category: place?.category ?? RESTAURANT_DETAIL_TEMPLATE.category,
    rating: place?.rating ?? RESTAURANT_DETAIL_TEMPLATE.rating,
    address: place?.address ?? RESTAURANT_DETAIL_TEMPLATE.address,
    hours: place?.hours || RESTAURANT_DETAIL_TEMPLATE.hours,
  };
  return (
    <>
      <div style={s.header}>
        <button type="button" style={s.iconButton} onClick={onBack} aria-label="뒤로가기">
          <ArrowLeftIcon />
        </button>
        <span style={s.headerTitle}>{detail.name}</span>
        <span style={{ width: 28 }} />
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={s.detailImageBox}>
          {place?.photoUrl ? (
            <img src={place.photoUrl} alt={detail.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <i className="ti ti-photo-x" style={{ fontSize: 40, color: "#C4C2B8" }} />
          )}
          <span style={s.detailImageCounter}>1/{detail.imageCount}</span>
          {place?.aiAnalyzed && (
            <span style={s.aiAnalyzedBadge}>
              <i className="ti ti-sparkles" style={{ fontSize: 12 }} /> AI 분석 완료
            </span>
          )}
        </div>
        <div style={{ padding: "14px 20px 0" }}>
          {place?.aiAnalyzed && (
            <div style={s.aiBadgeRow}>
              <i className="ti ti-sparkles" style={{ fontSize: 13, color: "#EF9F27" }} />
              <span>업로드한 사진을 AI가 분석해서 등록된 정보예요</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 17, fontWeight: 700 }}>{detail.name}</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              <i className="ti ti-star-filled" style={{ fontSize: 13, color: "#F2B84B" }} /> {detail.rating}
            </span>
          </div>
          <p style={s.detailMetaRow}>
            <i className="ti ti-map-pin" style={{ fontSize: 12 }} /> {detail.address}
          </p>
          <p style={s.detailMetaRow}>
            <i className="ti ti-clock" style={{ fontSize: 12 }} /> {detail.hours}
          </p>
          <p style={s.detailMetaRow}>
            <i className="ti ti-phone" style={{ fontSize: 12 }} /> {detail.phone}
          </p>

          <div style={s.detailActionRow}>
            <button type="button" style={s.detailActionBtn} onClick={() => showToast(`${detail.phone}로 전화 연결`)}>
              <i className="ti ti-phone" style={{ fontSize: 16 }} />
              <span>전화</span>
            </button>
            <button type="button" style={s.detailActionBtn} onClick={() => showToast("지도 화면으로 이동합니다.")}>
              <i className="ti ti-map" style={{ fontSize: 16 }} />
              <span>지도</span>
            </button>
            <button type="button" style={s.detailActionBtn} onClick={() => showToast("공유 링크를 복사했어요.")}>
              <i className="ti ti-share-2" style={{ fontSize: 16 }} />
              <span>공유</span>
            </button>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 14 }}>
            {detail.tags.map((t) => (
              <span key={t} style={s.resultCardTag}>
                {t}
              </span>
            ))}
          </div>

          <p style={s.detailSectionTitle}>시그니처 메뉴</p>
          {detail.signatureMenu.map((m) => (
            <div key={m.name} style={s.detailMenuCard}>
              <div style={s.detailMenuThumb}>
                <i className="ti ti-photo-x" style={{ fontSize: 18, color: "#C4C2B8" }} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 12.5, fontWeight: 600, margin: "0 0 2px" }}>{m.name}</p>
                <p style={{ fontSize: 10.5, color: "#8A8A8A", margin: "0 0 4px" }}>{m.desc}</p>
                <p style={{ fontSize: 11.5, fontWeight: 700, margin: 0 }}>{m.price}</p>
              </div>
            </div>
          ))}

          <p style={s.detailSectionTitle}>리뷰 ({detail.reviewCount})</p>
          <button type="button" style={s.detailMoreReviewBtn} onClick={() => showToast("리뷰 목록은 준비 중이에요.")}>
            리뷰 더보기 →
          </button>
        </div>
      </div>
      <div style={s.detailFooter}>
        <button type="button" style={s.detailSaveBtn} onClick={onOpenSave}>
          <i className="ti ti-bookmark" style={{ fontSize: 15 }} /> 저장
        </button>
        <button type="button" style={s.detailReserveBtn} onClick={onOpenReserve}>
          예약하기
        </button>
      </div>
    </>
  );
}

// ---- 저장한다면? (컬렉션 선택 바텀시트) ----
function SaveToCollectionSheet({ onClose, onSaved, showToast, fullScreen }) {
  const [folders] = useLocalStorageState("placepick_folders", INITIAL_FOLDERS);
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const folderNames = folders.map((f) => f.name);

  const handleSave = () => {
    const name = addingNew ? newFolderName.trim() : selectedCollection;
    if (!name) {
      showToast(addingNew ? "새 폴더 이름을 입력해주세요." : "저장할 폴더를 선택해주세요.");
      return;
    }
    onSaved(name);
  };

  const body = (
    <>
      <div style={{ padding: "4px 20px 0" }}>
        {folderNames.length === 0 && !addingNew && <p style={s.emptyText}>아직 만든 폴더가 없어요. 새 폴더를 만들어보세요.</p>}
        {!addingNew &&
          folderNames.map((name) => (
            <button key={name} type="button" style={s.collectionRadioRow} onClick={() => setSelectedCollection(name)}>
              <span style={{ fontSize: 13.5 }}>{name}</span>
              <span style={{ ...s.radioCircle, ...(selectedCollection === name ? s.radioCircleActive : {}) }} />
            </button>
          ))}
        {addingNew ? (
          <input
            type="text"
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="새 폴더 이름"
            style={{ ...s.editInput, marginTop: 10 }}
          />
        ) : (
          <button type="button" style={s.addCollectionBtn} onClick={() => setAddingNew(true)}>
            <i className="ti ti-plus" style={{ fontSize: 16 }} /> 새 폴더 만들기
          </button>
        )}
      </div>
      <div style={{ padding: "16px 20px 6px" }}>
        <button type="button" style={s.primaryButton} onClick={handleSave}>
          저장하기
        </button>
      </div>
    </>
  );

  if (fullScreen) {
    return (
      <>
        <SubScreenHeader title="저장할 폴더 선택" onBack={onClose} />
        {body}
      </>
    );
  }

  return (
    <div style={s.sheetOverlay} onClick={onClose}>
      <div style={s.actionSheet} onClick={(e) => e.stopPropagation()}>
        <div style={s.sheetHandle} />
        <p style={s.sheetTitle}>저장한다면?</p>
        {body}
      </div>
    </div>
  );
}

// ---- 예약한다면? (예약 정보 설정 바텀시트) ----
function ReservationSheet({ onClose, onComplete, showToast }) {
  const [guestCount, setGuestCount] = useState(2);
  const [selectedDate, setSelectedDate] = useState(11);
  const [selectedTime, setSelectedTime] = useState("오후 12:30");

  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const leadingBlanks = 3; // 달력 시작 요일 맞추기용 (데모)

  const handleComplete = () => {
    if (!selectedDate || !selectedTime) {
      showToast("날짜와 시간을 선택해주세요.");
      return;
    }
    onComplete({ guestCount, date: selectedDate, time: selectedTime });
  };

  return (
    <div style={s.sheetOverlay} onClick={onClose}>
      <div style={{ ...s.actionSheet, maxHeight: "85%", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={s.sheetHandle} />
        <div style={s.reservationSheetHeaderRow}>
          <p style={s.sheetTitle}>예약 정보 설정</p>
          <button type="button" style={s.sheetCloseBtn} onClick={onClose} aria-label="닫기">
            <CloseIcon size={18} />
          </button>
        </div>

        <div style={{ padding: "0 20px" }}>
          <p style={s.reservationFieldLabel}>방문 인원</p>
          <div style={s.guestCountRow}>
            <i className="ti ti-user" style={{ fontSize: 15, color: "#8A8A8A" }} />
            <span style={{ fontSize: 12.5, flex: 1 }}>성인 및 아동</span>
            <button type="button" style={s.stepperBtn} onClick={() => setGuestCount((c) => Math.max(1, c - 1))} aria-label="인원 줄이기">
              <i className="ti ti-minus" style={{ fontSize: 13 }} />
            </button>
            <span style={{ fontSize: 13, fontWeight: 700, width: 20, textAlign: "center" }}>{guestCount}</span>
            <button type="button" style={s.stepperBtn} onClick={() => setGuestCount((c) => c + 1)} aria-label="인원 늘리기">
              <i className="ti ti-plus" style={{ fontSize: 13 }} />
            </button>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18 }}>
            <p style={s.reservationFieldLabel}>예약 날짜</p>
            <span style={{ fontSize: 11, color: "#8A8A8A" }}>2026년 5월</span>
          </div>
          <div style={s.calendarGrid}>
            {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
              <span key={d} style={s.calendarDayLabel}>
                {d}
              </span>
            ))}
            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <span key={`blank-${i}`} />
            ))}
            {days.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setSelectedDate(d)}
                style={d === selectedDate ? s.calendarDateActive : s.calendarDate}
              >
                {d}
              </button>
            ))}
          </div>

          <p style={{ ...s.reservationFieldLabel, marginTop: 18 }}>예약 시간</p>
          <div style={s.timeSlotGrid}>
            {RESERVATION_TIME_SLOTS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSelectedTime(t)}
                style={t === selectedTime ? s.timeSlotActive : s.timeSlot}
              >
                {t}
              </button>
            ))}
          </div>

          <div style={s.reservationNoticeBox}>
            <i className="ti ti-info-circle" style={{ fontSize: 14, color: "#8A8A8A" }} />
            <p style={s.reservationNoticeText}>
              예약 시간 24시간 전까지는 수수료 없이 취소가 가능합니다. 당일 취소 시 예약금의 50%가 위약금으로 청구될 수 있습니다.
            </p>
          </div>
        </div>

        <div style={{ padding: "16px 20px 6px" }}>
          <button type="button" style={s.reservationCompleteBtn} onClick={handleComplete}>
            예약 완료
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- 예약 확인 ----
function ReservationConfirmScreen({ reservation, place, onClose, onGoMap, onGoReservations }) {
  const reservationNumber = "PP-20260523-01";
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 16px 0" }}>
        <button type="button" style={s.iconButton} onClick={onClose} aria-label="닫기">
          <CloseIcon size={20} />
        </button>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 24px 0", textAlign: "center" }}>
        <div style={s.confirmCheckCircle}>
          <i className="ti ti-check" style={{ fontSize: 34, color: "#FFFFFF" }} />
        </div>
        <p style={s.confirmTitleText}>예약이 완료되었습니다!</p>
        <p style={s.confirmSubtitleText}>방문 일정에 맞춰 매장을 방문해 주세요.</p>

        <div style={s.confirmCard}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div>
              <p style={{ fontSize: 10.5, color: "#8A8A8A", margin: "0 0 2px" }}>예약 번호</p>
              <p style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>{reservationNumber}</p>
            </div>
            <span style={s.confirmBadge}>확정됨</span>
          </div>
          <div style={s.confirmInfoRow}>
            <i className="ti ti-building-store" style={{ fontSize: 14, color: "#8A8A8A" }} />
            <div>
              <p style={{ fontSize: 10.5, color: "#8A8A8A", margin: "0 0 2px" }}>매장명</p>
              <p style={{ fontSize: 12.5, fontWeight: 600, margin: 0 }}>{place?.displayName || "플레이스픽 다이닝"}</p>
            </div>
          </div>
          <div style={s.confirmInfoRow}>
            <i className="ti ti-calendar" style={{ fontSize: 14, color: "#8A8A8A" }} />
            <div>
              <p style={{ fontSize: 10.5, color: "#8A8A8A", margin: "0 0 2px" }}>날짜 및 시간</p>
              <p style={{ fontSize: 12.5, fontWeight: 600, margin: 0 }}>
                2026년 5월 {reservation?.date || 23}일 · {reservation?.time || "오후 12:30"}
              </p>
            </div>
          </div>
          <div style={s.confirmInfoRow}>
            <i className="ti ti-users" style={{ fontSize: 14, color: "#8A8A8A" }} />
            <div>
              <p style={{ fontSize: 10.5, color: "#8A8A8A", margin: "0 0 2px" }}>인원</p>
              <p style={{ fontSize: 12.5, fontWeight: 600, margin: 0 }}>성인 {reservation?.guestCount || 2}명</p>
            </div>
          </div>
        </div>

        <div style={s.confirmMapCard}>
          <i className="ti ti-map-pin" style={{ fontSize: 20, color: "#8A8A8A" }} />
          <span style={{ fontSize: 12, color: "#3A3A3A" }}>서울 성동구 연무장길 12</span>
        </div>
      </div>
      <div style={{ padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
        <button type="button" style={s.confirmMapBtn} onClick={onGoMap}>
          <i className="ti ti-map" style={{ fontSize: 15 }} /> 지도에서 확인
        </button>
        <button type="button" style={s.confirmListBtn} onClick={onGoReservations}>
          예약 내역으로 이동
        </button>
      </div>
    </div>
  );
}


function HomeTab({ showToast, showConfirm, onGoToReservations, onLogout }) {
  const [subScreen, setSubScreen] = useState("explore");
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [saveSheetOpen, setSaveSheetOpen] = useState(false);
  const [reserveSheetOpen, setReserveSheetOpen] = useState(false);
  const [lastReservation, setLastReservation] = useState(null);
  const [filteredResults, setFilteredResults] = useState([]);

  return (
    <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
      {subScreen === "explore" && (
        <ExploreContent
          onOpenMenu={() => setMenuOpen(true)}
          onOpenSettings={() => setSubScreen("settings")}
          onViewResults={(results) => {
            setFilteredResults(results);
            setSubScreen("results");
          }}
          showToast={showToast}
        />
      )}
      {subScreen === "results" && (
        <ResultsListScreen
          items={filteredResults}
          onBack={() => setSubScreen("explore")}
          onSelectPlace={(place) => {
            setSelectedPlace(place);
            setSubScreen("detail");
          }}
        />
      )}
      {subScreen === "detail" && (
        <RestaurantDetailScreen
          place={selectedPlace}
          onBack={() => setSubScreen("results")}
          onOpenSave={() => setSaveSheetOpen(true)}
          onOpenReserve={() => setReserveSheetOpen(true)}
          showToast={showToast}
        />
      )}
      {subScreen === "reservationConfirm" && (
        <ReservationConfirmScreen
          reservation={lastReservation}
          place={selectedPlace}
          onClose={() => setSubScreen("detail")}
          onGoMap={() => {
            showToast("지도 화면으로 이동합니다.");
            setSubScreen("explore");
          }}
          onGoReservations={onGoToReservations}
        />
      )}
      {subScreen === "settings" && (
        <SettingsScreen
          onBack={() => {
            setSubScreen("explore");
            setMenuOpen(true);
          }}
          showToast={showToast}
          showConfirm={showConfirm}
          onLogout={onLogout}
        />
      )}
      {subScreen === "profile" && <ProfileScreen onBack={() => setSubScreen("explore")} showToast={showToast} onLogout={onLogout} />}
      {subScreen === "contact" && (
        <ContactScreen
          onBack={() => {
            setSubScreen("explore");
            setMenuOpen(true);
          }}
          showToast={showToast}
        />
      )}
      {subScreen === "notice" && (
        <NoticeScreen
          onBack={() => {
            setSubScreen("explore");
            setMenuOpen(true);
          }}
        />
      )}

      {saveSheetOpen && (
        <SaveToCollectionSheet
          onClose={() => setSaveSheetOpen(false)}
          showToast={showToast}
          onSaved={(collectionName) => {
            addPlaceToFolderStorage(collectionName, selectedPlace);
            setSaveSheetOpen(false);
            showToast(`"${collectionName}"에 저장했어요.`);
          }}
        />
      )}
      {reserveSheetOpen && (
        <ReservationSheet
          onClose={() => setReserveSheetOpen(false)}
          showToast={showToast}
          onComplete={(reservation) => {
            addReservationToStorage({ reservation, placeName: selectedPlace?.displayName || "플레이스픽 다이닝" });
            setLastReservation(reservation);
            setReserveSheetOpen(false);
            setSubScreen("reservationConfirm");
          }}
        />
      )}

      <SideMenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onNavigate={(key) => {
          setMenuOpen(false);
          setSubScreen(key);
        }}
        onLogout={() => {
          setMenuOpen(false);
          onLogout();
        }}
      />
    </div>
  );
}

// ---- 업로드 탭 ----
const MOCK_EXTRACT_POOL = [
  { name: "도담 레스토랑", category: "한식", price: "20000 ~ 50000", address: "서울 송파구 올림픽로 99", hours: "주말 휴무, 평일 9:00 ~ 21:00" },
  { name: "SEOUL 피자 & 스파게티", category: "양식", price: "15000 ~ 40000", address: "서울 강남구 테헤란로 123", hours: "주말 휴무, 평일 9:00 ~ 21:00" },
  { name: "한강 바베큐", category: "바베큐", price: "30000 ~ 60000", address: "서울 영등포구 여의도동 45", hours: "매일 11:00 ~ 22:00" },
];
const PHOTO_COUNT = 11;

const UploadShellContext = React.createContext({ showToast: () => {}, onOpenMenu: () => {} });
function UploadShellConsumer({ children }) {
  const ctx = React.useContext(UploadShellContext);
  return children(ctx);
}

function UploadInitScreen({ onNext }) {
  const [linkValue, setLinkValue] = useState("");
  const [photos, setPhotos] = useState([]); // { id, file, url }
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null); // null = 검색 전
  const [searching, setSearching] = useState(false);
  const fileInputRef = useRef(null);

  const handleFilesChosen = (e) => {
    const files = Array.from(e.target.files || []);
    const newPhotos = files.map((file) => ({
      id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      file,
      url: URL.createObjectURL(file),
    }));
    setPhotos((prev) => [...prev, ...newPhotos]);
    e.target.value = ""; // 같은 파일을 다시 선택할 수 있게 초기화
  };

  const removePhoto = (id) => {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((p) => p.id !== id);
    });
  };

  return (
    <UploadShellConsumer>
      {({ showToast, onOpenMenu }) => {
        const handleSearch = async () => {
          if (!searchQuery.trim()) {
            showToast("식당명 또는 카페명을 입력해주세요.");
            return;
          }
          setSearching(true);
          try {
            const results = await searchPlacesByName(searchQuery.trim());
            setSearchResults(results);
            if (results.length === 0) showToast("검색 결과가 없어요.");
          } catch (err) {
            showToast(err.message || "검색에 실패했어요.");
          } finally {
            setSearching(false);
          }
        };

        const handlePickSearchResult = (place) => {
          // 이미 이름/주소가 확실한 데이터라 사진 읽기 단계 없이 바로 정보확인으로
          onNext([{ type: "searched", data: place }]);
        };

        const handlePhotosUpload = () => {
          if (photos.length === 0) {
            fileInputRef.current?.click();
            return;
          }
          // 여러 장을 각각 다른 식당으로 취급하지 않고, "한 식당의 여러 사진"으로 묶어서 전달
          onNext([{ type: "photos", photos: photos.map((p) => ({ file: p.file, url: p.url })) }]);
        };

        const handleLinkExtract = () => {
          if (!linkValue.trim()) {
            showToast("링크를 입력해주세요.");
            return;
          }
          onNext([{ type: "link", value: linkValue }]);
        };

        return (
          <>
            <div style={s.header}>
              <button type="button" style={s.iconButton} onClick={onOpenMenu} aria-label="메뉴">
                <HamburgerIcon />
              </button>
              <span style={s.headerTitle}>PlacePick</span>
              <div style={{ display: "flex", gap: 4 }}>
                <button type="button" style={s.iconButton} aria-label="설정">
                  <i className="ti ti-settings" style={{ fontSize: 20 }} />
                </button>
                <button type="button" style={s.iconButton} aria-label="알림">
                  <BellIcon />
                </button>
              </div>
            </div>

            <div style={s.archiveBody}>
              <p style={s.archiveTitle}>맛집 아카이브</p>
              <p style={s.archiveSubtitle}>식당명 검색 또는 이미지/링크 업로드로 맛집을 저장하세요.</p>

              <p style={s.archiveSectionLabel}>식당 검색</p>
              <div style={s.archiveSearchRow}>
                <div style={s.archiveSearchInputWrap}>
                  <i className="ti ti-search" style={{ fontSize: 15, color: "#B0B0B0" }} />
                  <input
                    type="text"
                    placeholder="식당명 또는 카페명을 입력하세요."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    style={s.archiveSearchInput}
                  />
                </div>
                <button type="button" style={s.archiveSearchBtn} onClick={handleSearch} disabled={searching}>
                  {searching ? "검색중" : "검색"}
                </button>
              </div>

              {searchResults && (
                <div style={s.archiveResultList}>
                  {searchResults.map((place) => (
                    <button key={place.id} type="button" style={s.archiveResultItem} onClick={() => handlePickSearchResult(place)}>
                      <div>
                        <p style={s.archiveResultName}>{place.name}</p>
                        <p style={s.archiveResultAddress}>{place.address}</p>
                      </div>
                      <i className="ti ti-plus" style={{ fontSize: 16, color: "#8A8A8A" }} />
                    </button>
                  ))}
                </div>
              )}

              <div style={s.archiveDividerRow}>
                <div style={s.archiveDividerLine} />
                <span style={s.archiveDividerText}>또는 이미지/링크 스캔</span>
                <div style={s.archiveDividerLine} />
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFilesChosen}
                style={{ display: "none" }}
              />

              {photos.length === 0 ? (
                <button type="button" style={s.archiveImageBox} onClick={() => fileInputRef.current?.click()}>
                  <div style={s.archiveImageIconCircle}>
                    <i className="ti ti-photo" style={{ fontSize: 20, color: "#8A8A8A" }} />
                  </div>
                  <p style={s.archiveImageBoxTitle}>이미지 업로드</p>
                  <p style={s.archiveImageBoxSub}>인스타그램, 블로그 캡쳐 등</p>
                </button>
              ) : (
                <div style={s.archiveImageBox}>
                  <div style={s.photoGrid}>
                    <button type="button" style={s.cameraCell} onClick={() => fileInputRef.current?.click()} aria-label="사진 추가">
                      <i className="ti ti-plus" style={{ fontSize: 20, color: "#B4B2A9" }} />
                    </button>
                    {photos.map((p) => (
                      <div key={p.id} style={{ ...s.photoCell, borderColor: "#1A1A1A", padding: 0, overflow: "hidden" }}>
                        <img src={p.url} alt="선택한 사진" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        <button type="button" onClick={() => removePhoto(p.id)} style={s.photoRemoveBadge} aria-label="사진 제거">
                          <CloseIcon size={11} color="#FFFFFF" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button type="button" style={s.archiveImageUploadBtn} onClick={handlePhotosUpload}>
                    {photos.length}장 업로드하기
                  </button>
                </div>
              )}

              <div style={s.archiveLinkRow}>
                <i className="ti ti-link" style={{ fontSize: 15, color: "#B0B0B0" }} />
                <input
                  type="text"
                  placeholder="URL 링크 붙여넣기"
                  value={linkValue}
                  onChange={(e) => setLinkValue(e.target.value)}
                  style={s.archiveLinkInput}
                />
                <button type="button" style={s.archiveExtractBtn} onClick={handleLinkExtract}>
                  추출
                </button>
              </div>
            </div>
          </>
        );
      }}
    </UploadShellConsumer>
  );
}

function UploadConfirmScreenWrapper({ items, onBack, onNext }) {
  const firstItem = items?.[0];
  const firstUrl = firstItem?.url || firstItem?.photos?.[0]?.url;
  const photoCount = firstItem?.type === "photos" ? firstItem.photos.length : items?.length || 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div style={s.header}>
        <button type="button" style={s.iconButton} onClick={onBack} aria-label="뒤로가기">
          <ArrowLeftIcon />
        </button>
        <span style={s.headerTitle}>업로드</span>
        <span style={{ width: 28 }} />
      </div>
      <div style={s.uploadBody}>
        <p style={s.confirmTitle}>업로드 하시겠습니까?</p>
        <div style={s.previewImageBox}>
          {firstUrl ? (
            <img src={firstUrl} alt="선택한 사진" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8 }} />
          ) : (
            <i className="ti ti-photo-x" style={{ fontSize: 40, color: "#C4C2B8" }} />
          )}
        </div>
        {photoCount > 1 && <p style={s.photoHint}>같은 식당 사진 {photoCount}장을 함께 분석해요.</p>}
      </div>
      <div style={s.footer}>
        <button type="button" onClick={onNext} style={s.primaryButton}>
          업로드
        </button>
      </div>
    </div>
  );
}

function ReadingScreen({ items, onDone }) {
  const [dot, setDot] = useState(0);
  const firstUrl = items?.[0]?.url || items?.[0]?.photos?.[0]?.url;
  useEffect(() => {
    const interval = setInterval(() => setDot((d) => (d + 1) % 3), 400);
    onDone().finally(() => clearInterval(interval));
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <div style={s.header}>
        <span style={{ width: 28 }} />
        <span style={s.headerTitle}>업로드</span>
        <span style={{ width: 28 }} />
      </div>
      <div style={s.uploadBody}>
        <p style={s.confirmTitle}>이미지 읽는 중...</p>
        <div style={s.previewImageBox}>
          {firstUrl ? (
            <img src={firstUrl} alt="선택한 사진" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8, opacity: 0.7 }} />
          ) : (
            <i className="ti ti-photo-x" style={{ fontSize: 40, color: "#C4C2B8" }} />
          )}
        </div>
        <div style={s.loadingDotsRow}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ ...s.loadingDot, opacity: i === dot ? 1 : 0.3 }} />
          ))}
        </div>
      </div>
    </>
  );
}

function InfoConfirmScreen({ items, onBack, onSave }) {
  const [index, setIndex] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [data, setData] = useState(items);
  const [saving, setSaving] = useState(false);
  const current = data[index];
  const updateField = (field, value) => setData((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await savePlaces(data);
      onSave(result.items);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div style={s.header}>
        <button type="button" style={s.iconButton} onClick={onBack} aria-label="뒤로가기">
          <ArrowLeftIcon />
        </button>
        <span style={s.headerTitle}>업로드</span>
        <span style={{ width: 28 }} />
      </div>
      <div style={s.uploadBody}>
        <div style={s.infoTitleRow}>
          <p style={s.confirmTitle}>정보가 맞는지 확인해주세요!</p>
          <button type="button" style={s.editIconBtn} onClick={() => setEditMode((v) => !v)} aria-label="정보 수정">
            <i className="ti ti-pencil" style={{ fontSize: 16 }} />
          </button>
        </div>
        {current.aiAnalyzed && (
          <div style={s.aiBadgeRow}>
            <i className="ti ti-sparkles" style={{ fontSize: 13, color: "#EF9F27" }} />
            <span>AI가 사진을 분석해서 알아낸 정보예요</span>
          </div>
        )}
        <div style={s.previewImageBox}>
          {current.url ? (
            <img src={current.url} alt="선택한 사진" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8 }} />
          ) : (
            <i className="ti ti-photo-x" style={{ fontSize: 40, color: "#C4C2B8" }} />
          )}
        </div>
        {!editMode ? (
          <>
            <p style={s.placeName}>
              {current.name}
              <span style={s.placePrice}>{current.price}</span>
            </p>
            <p style={s.placeCategory}>{current.category}</p>
            <p style={s.placeMetaRow}>
              <i className="ti ti-map-pin" style={{ fontSize: 13 }} /> {current.address}
            </p>
            <p style={s.placeMetaRow}>
              <i className="ti ti-calendar" style={{ fontSize: 13 }} /> {current.hours}
            </p>
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
            <input value={current.name} onChange={(e) => updateField("name", e.target.value)} style={s.editInput} placeholder="가게 이름" />
            <input value={current.category} onChange={(e) => updateField("category", e.target.value)} style={s.editInput} placeholder="카테고리" />
            <input value={current.price} onChange={(e) => updateField("price", e.target.value)} style={s.editInput} placeholder="가격대" />
            <input value={current.address} onChange={(e) => updateField("address", e.target.value)} style={s.editInput} placeholder="주소" />
            <input value={current.hours} onChange={(e) => updateField("hours", e.target.value)} style={s.editInput} placeholder="영업시간" />
          </div>
        )}
        {data.length > 1 && (
          <div style={s.paginationRow}>
            {data.map((_, i) => (
              <button key={i} type="button" onClick={() => setIndex(i)} style={{ ...s.pageDot, background: i === index ? "#1A1A1A" : "#DADADA" }} />
            ))}
          </div>
        )}
      </div>
      <div style={s.footer}>
        <button type="button" onClick={handleSave} disabled={saving} style={s.primaryButton}>
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </>
  );
}

const PRESET_SAVED = [
  { name: "도담 레스토랑", category: "한식", address: "서울 송파구 올림픽로 99", hours: "주말 휴무, 평일 9:00 ~ 21:00" },
  { name: "SEOUL 피자 & 스파게티", category: "양식", address: "서울 강남구 테헤란로 123", hours: "주말 휴무, 평일 9:00 ~ 21:00" },
  { name: "한강 바베큐", category: "바베큐", address: "서울 영등포구 여의도동 45", hours: "매일 11:00 ~ 22:00" },
];

function SavedDoneScreen({ newItems, onSelectPlace, onAddMore }) {
  const [list, setList] = useLocalStorageState("placepick_uploaded_places", PRESET_SAVED);

  // newItems(방금 업로드 완료한 항목)는 화면 진입 시 한 번만 저장 목록에 합칩니다.
  useEffect(() => {
    if (newItems && newItems.length > 0) {
      setList((prev) => [...prev, ...newItems]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = (i) => setList((prev) => prev.filter((_, idx) => idx !== i));
  const justSaved = newItems && newItems.length > 0 ? newItems[0] : null;

  return (
    <>
      <div style={s.header}>
        <span style={{ width: 28 }} />
        <span style={s.headerTitle}>업로드</span>
        <span style={{ width: 28 }} />
      </div>
      <div style={s.uploadBody}>
        <div style={s.doneIconWrap}>
          <div style={s.doneCircle}>
            <i className="ti ti-check" style={{ fontSize: 28, color: "#FFFFFF" }} />
          </div>
          <p style={s.doneTitle}>저장 완료</p>
          <p style={s.doneSubtitle}>선택한 맛집이 저장되었습니다.</p>
        </div>
        {justSaved && (
          <button type="button" style={s.viewDetailBtn} onClick={() => onSelectPlace(justSaved)}>
            <span>
              <b>{justSaved.name}</b> 상세 페이지 보기
            </span>
            <i className="ti ti-chevron-right" style={{ fontSize: 15 }} />
          </button>
        )}
        <div style={s.listTitleRow}>
          <span style={s.listTitle}>저장 리스트</span>
          <span style={s.listActions}>
            <i className="ti ti-pencil" style={{ fontSize: 14 }} />
            <i className="ti ti-trash" style={{ fontSize: 14 }} />
          </span>
        </div>
        <div style={s.savedList}>
          {list.map((item, i) => (
            <button key={i} type="button" style={{ ...s.savedRow, width: "100%", border: "none", background: "none", cursor: "pointer", textAlign: "left" }} onClick={() => onSelectPlace(item)}>
              <div style={{ flex: 1 }}>
                <p style={s.savedName}>{item.name}</p>
                <p style={s.savedCategory}>{item.category}</p>
                <p style={s.savedMeta}>
                  <i className="ti ti-map-pin" style={{ fontSize: 11 }} /> {item.address}
                </p>
                <p style={s.savedMeta}>
                  <i className="ti ti-calendar" style={{ fontSize: 11 }} /> {item.hours}
                </p>
              </div>
              <button
                type="button"
                style={s.deleteBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(i);
                }}
                aria-label="삭제"
              >
                <CloseIcon size={14} />
              </button>
            </button>
          ))}
        </div>
      </div>
      <div style={s.footer}>
        <button type="button" onClick={onAddMore} style={s.primaryButton}>
          <i className="ti ti-plus" style={{ fontSize: 14 }} /> 추가하기
        </button>
      </div>
    </>
  );
}

function UploadTab({ showToast, showConfirm, onLogout, onFocusModeChange }) {
  const [step, setStep] = useState("init");
  const [selectedItems, setSelectedItems] = useState([]);
  const [extractedItems, setExtractedItems] = useState([]);
  const [savedNewItems, setSavedNewItems] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [subScreen, setSubScreen] = useState(null); // null | "settings" | "contact" | "notice" | "profile"
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [saveSheetOpen, setSaveSheetOpen] = useState(false);

  // "init"(맨 처음 업로드 화면) 말고는 전부 하단 탭바 없이 몰입해서 진행하는 흐름이라,
  // 그동안은 하단 탭바/홈 인디케이터를 숨겨달라고 위(MainShell)에 알림
  useEffect(() => {
    if (onFocusModeChange) onFocusModeChange(step !== "init" || !!selectedPlace);
    return () => {
      if (onFocusModeChange) onFocusModeChange(false);
    };
  }, [step, selectedPlace]);

  if (subScreen) {
    return (
      <>
        {subScreen === "settings" && (
          <SettingsScreen
            onBack={() => {
              setSubScreen(null);
              setMenuOpen(true);
            }}
            showToast={showToast}
            showConfirm={showConfirm}
            onLogout={onLogout}
          />
        )}
        {subScreen === "profile" && <ProfileScreen onBack={() => setSubScreen(null)} showToast={showToast} onLogout={onLogout} />}
        {subScreen === "contact" && (
          <ContactScreen
            onBack={() => {
              setSubScreen(null);
              setMenuOpen(true);
            }}
            showToast={showToast}
          />
        )}
        {subScreen === "notice" && (
          <NoticeScreen
            onBack={() => {
              setSubScreen(null);
              setMenuOpen(true);
            }}
          />
        )}
      </>
    );
  }


  if (selectedPlace) {
    return (
      <>
        <RestaurantDetailScreen
          place={selectedPlace}
          onBack={() => setSelectedPlace(null)}
          onOpenSave={() => setSaveSheetOpen(true)}
          onOpenReserve={() => showToast("저장/예약 탭에서 예약할 수 있어요.")}
          showToast={showToast}
        />
        {saveSheetOpen && (
          <SaveToCollectionSheet
            onClose={() => setSaveSheetOpen(false)}
            showToast={showToast}
            onSaved={(collectionName) => {
              addPlaceToFolderStorage(collectionName, selectedPlace);
              setSaveSheetOpen(false);
              showToast(`"${collectionName}"에 저장했어요.`);
            }}
          />
        )}
      </>
    );
  }

  return (
    <UploadShellContext.Provider value={{ showToast, onOpenMenu: () => setMenuOpen(true) }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {step === "init" && (
          <UploadInitScreen
            onNext={(items) => {
              setSelectedItems(items);
              if (items[0]?.type === "searched") {
                // 식당 검색으로 고른 경우: 이미 이름/주소가 확실하니 사진 확인/읽기 단계 없이 바로 정보확인으로
                const p = items[0].data;
                setExtractedItems([
                  {
                    name: p.name,
                    category: p.category,
                    price: p.price ? `${p.price.toLocaleString()}원 대` : "",
                    address: p.address,
                    hours: "매장 문의 필요 (검색 데이터에는 영업시간 정보가 없어요)",
                    url: null,
                  },
                ]);
                setStep("infoConfirm");
              } else {
                setStep("confirm");
              }
            }}
          />
        )}
        {step === "confirm" && <UploadConfirmScreenWrapper items={selectedItems} onBack={() => setStep("init")} onNext={() => setStep("reading")} />}
        {step === "reading" && (
          <ReadingScreen
            items={selectedItems}
            onDone={async () => {
              const results = await Promise.all(
                selectedItems.map(async (item, i) => {
                  const extracted = await extractPlaceInfo(item, i, showToast);
                  const previewUrl = item.url || item.photos?.[0]?.url || null;
                  return { ...extracted, url: previewUrl };
                })
              );
              setExtractedItems(results);
              setStep("infoConfirm");
            }}
          />
        )}
        {step === "infoConfirm" && (
          <InfoConfirmScreen
            items={extractedItems}
            onBack={() => setStep(selectedItems[0]?.type === "searched" ? "init" : "confirm")}
            onSave={(data) => {
              setSavedNewItems(data);
              setStep("chooseFolder");
            }}
          />
        )}
        {step === "chooseFolder" && (
          <SaveToCollectionSheet
            fullScreen
            onClose={() => setStep("done")}
            showToast={showToast}
            onSaved={(collectionName) => {
              savedNewItems.forEach((item) => addPlaceToFolderStorage(collectionName, item));
              showToast(`"${collectionName}"에 저장했어요.`);
              setStep("done");
            }}
          />
        )}
        {step === "done" && (
          <SavedDoneScreen
            newItems={savedNewItems}
            onSelectPlace={setSelectedPlace}
            onAddMore={() => {
              setSelectedItems([]);
              setExtractedItems([]);
              setSavedNewItems([]);
              setStep("init");
            }}
          />
        )}
      </div>
      <SideMenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onNavigate={(key) => {
          setMenuOpen(false);
          setSubScreen(key);
        }}
        onLogout={() => {
          setMenuOpen(false);
          onLogout();
        }}
      />
    </UploadShellContext.Provider>
  );
}

// ---- 저장/예약 탭 ----
// 저장/예약 탭은 이제 예시(mock) 데이터 없이 빈 상태로 시작합니다.
// 사용자가 실제로 저장하거나 예약해야 목록에 항목이 생겨요.
const INITIAL_FOLDERS = [];
const INITIAL_RESERVATIONS = [];

// ---- 새 폴더 추가 모달 ----
function AddFolderModal({ open, onSave, onCancel }) {
  const [value, setValue] = useState("");
  useEffect(() => {
    if (open) setValue("");
  }, [open]);
  if (!open) return null;
  return (
    <div style={s.sheetOverlay} onClick={onCancel}>
      <div style={s.actionSheet} onClick={(e) => e.stopPropagation()}>
        <div style={s.sheetHandle} />
        <p style={s.sheetTitle}>새 폴더 만들기</p>
        <div style={{ padding: "0 20px" }}>
          <input
            type="text"
            placeholder="폴더 이름을 입력하세요"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            style={s.input}
            autoFocus
          />
        </div>
        <div style={{ display: "flex", gap: 8, padding: "16px 20px 6px" }}>
          <button type="button" style={s.resetButton} onClick={onCancel}>
            취소
          </button>
          <button type="button" style={{ ...s.primaryButton, flex: 1 }} onClick={() => onSave(value)}>
            만들기
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- 나의 폴더 목록 화면 ----
function FoldersListScreen({ folders, viewMode, onToggleViewMode, onOpenFolder, onAddFolder, editMode, onToggleEdit, selectedFolderIds, onToggleSelectFolder, onDeleteSelectedFolders }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <div style={s.scrollBody}>
        <div style={s.folderListHeaderRow}>
          <span style={s.folderListTitle}>나의 폴더</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {!editMode && (
              <div style={{ display: "flex", gap: 4 }}>
                <button type="button" style={s.folderViewToggleBtn} onClick={() => onToggleViewMode("grid")} aria-label="그리드 보기">
                  <i className="ti ti-layout-grid" style={{ fontSize: 15, color: viewMode === "grid" ? "#1A1A1A" : "#C4C2B8" }} />
                </button>
                <button type="button" style={s.folderViewToggleBtn} onClick={() => onToggleViewMode("list")} aria-label="리스트 보기">
                  <i className="ti ti-list" style={{ fontSize: 15, color: viewMode === "list" ? "#1A1A1A" : "#C4C2B8" }} />
                </button>
              </div>
            )}
            <button type="button" style={s.folderEditLink} onClick={onToggleEdit}>
              {editMode ? "완료" : "편집"}
            </button>
          </div>
        </div>

        {viewMode === "grid" ? (
          <div style={s.folderGrid}>
            {folders.map((f) => {
              const selected = selectedFolderIds.includes(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  style={s.folderGridItem}
                  onClick={() => (editMode ? onToggleSelectFolder(f.id) : onOpenFolder(f))}
                >
                  <div style={{ position: "relative" }}>
                    <div style={s.folderGridThumb}>
                      <i className="ti ti-photo-x" style={{ fontSize: 20, color: "#C4C2B8" }} />
                    </div>
                    {editMode && (
                      <span
                        style={{
                          ...(selected ? s.folderSelectCircleActive : s.folderSelectCircle),
                          position: "absolute",
                          top: 6,
                          right: 6,
                        }}
                      >
                        {selected && <i className="ti ti-check" style={{ fontSize: 11, color: "#FFFFFF" }} />}
                      </span>
                    )}
                  </div>
                  <p style={s.folderName}>{f.name}</p>
                  <p style={s.folderCount}>{f.items.length}개 저장됨</p>
                </button>
              );
            })}
            {!editMode && (
              <button type="button" style={s.folderGridAddItem} onClick={onAddFolder}>
                <i className="ti ti-plus" style={{ fontSize: 22, color: "#B0B0B0" }} />
                <p style={s.folderCount}>폴더 추가하기</p>
              </button>
            )}
          </div>
        ) : (
          <div>
            {folders.map((f) => {
              const selected = selectedFolderIds.includes(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  style={s.folderListItem}
                  onClick={() => (editMode ? onToggleSelectFolder(f.id) : onOpenFolder(f))}
                >
                  {editMode && (
                    <span style={selected ? s.folderSelectCircleActive : s.folderSelectCircle}>
                      {selected && <i className="ti ti-check" style={{ fontSize: 11, color: "#FFFFFF" }} />}
                    </span>
                  )}
                  <div style={s.folderListIcon}>
                    <i className="ti ti-folder" style={{ fontSize: 16, color: "#FFFFFF" }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={s.folderName}>{f.name}</p>
                    <p style={s.folderCount}>{f.items.length}곳 저장됨</p>
                  </div>
                  {!editMode && <i className="ti ti-chevron-right" style={{ fontSize: 16, color: "#C4C2B8" }} />}
                </button>
              );
            })}
            {!editMode && (
              <button type="button" style={s.folderListAddItem} onClick={onAddFolder}>
                <i className="ti ti-plus" style={{ fontSize: 16 }} /> 폴더 추가하기
              </button>
            )}
          </div>
        )}
      </div>
      {editMode && folders.length > 0 && (
        <div style={s.folderDeleteFooter}>
          <button
            type="button"
            style={{ ...s.detailReserveBtn, background: selectedFolderIds.length ? "#C0392B" : "#DADADA" }}
            onClick={onDeleteSelectedFolders}
          >
            선택 삭제 {selectedFolderIds.length > 0 ? `(${selectedFolderIds.length})` : ""}
          </button>
        </div>
      )}
    </div>
  );
}

// ---- 폴더 상세(안에 저장된 장소 목록) ----
function FolderDetailScreen({ folder, onBack, editMode, onToggleEdit, onDeleteItems, onSelectItem, showConfirm, showToast }) {
  const [selectedIds, setSelectedIds] = useState([]);

  useEffect(() => {
    if (!editMode) setSelectedIds([]);
  }, [editMode]);

  const toggleSelect = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) {
      showToast("삭제할 항목을 선택해주세요.");
      return;
    }
    showConfirm({
      message: `선택한 ${selectedIds.length}곳을 삭제할까요?`,
      danger: true,
      confirmLabel: "삭제",
      onConfirm: () => {
        onDeleteItems(selectedIds);
        setSelectedIds([]);
        showToast("삭제했어요.");
      },
    });
  };

  return (
    <>
      <div style={s.folderDetailHeaderRow}>
        <button type="button" style={s.folderBackLink} onClick={onBack}>
          <ArrowLeftIcon size={15} /> 뒤로
        </button>
        <span style={s.folderDetailTitle}>{folder.name}</span>
        <button type="button" style={s.folderEditLink} onClick={onToggleEdit}>
          {editMode ? "완료" : "편집"}
        </button>
      </div>
      <p style={s.folderDetailCount}>{folder.items.length}곳 저장됨</p>
      <div style={s.scrollBody}>
        {folder.items.map((item) => {
          const selected = selectedIds.includes(item.id);
          return (
            <button
              key={item.id}
              type="button"
              style={s.folderDetailRow}
              onClick={() => (editMode ? toggleSelect(item.id) : onSelectItem(item))}
            >
              {editMode && (
                <span style={selected ? s.folderSelectCircleActive : s.folderSelectCircle}>
                  {selected && <i className="ti ti-check" style={{ fontSize: 11, color: "#FFFFFF" }} />}
                </span>
              )}
              <div style={s.folderDetailThumb}>
                <i className="ti ti-photo-x" style={{ fontSize: 16, color: "#C4C2B8" }} />
              </div>
              <div style={{ flex: 1, textAlign: "left" }}>
                <p style={s.folderDetailItemName}>{item.name}</p>
                <p style={s.folderDetailItemCategory}>{item.category}</p>
              </div>
              {!editMode && <i className="ti ti-chevron-right" style={{ fontSize: 15, color: "#C4C2B8" }} />}
            </button>
          );
        })}
        {folder.items.length === 0 && <p style={s.emptyText}>이 폴더에 저장된 곳이 없어요.</p>}
      </div>
      {editMode && folder.items.length > 0 && (
        <div style={s.folderDeleteFooter}>
          <button type="button" style={{ ...s.detailReserveBtn, background: selectedIds.length ? "#C0392B" : "#DADADA" }} onClick={handleDeleteSelected}>
            선택 삭제 {selectedIds.length > 0 ? `(${selectedIds.length})` : ""}
          </button>
        </div>
      )}
    </>
  );
}

function SavedTab({ showToast, showConfirm }) {
  const [folders, setFolders] = useLocalStorageState("placepick_folders", INITIAL_FOLDERS);
  const [viewMode, setViewMode] = useState("grid");
  const [openFolderId, setOpenFolderId] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [addFolderOpen, setAddFolderOpen] = useState(false);
  const [folderListEditMode, setFolderListEditMode] = useState(false);
  const [selectedFolderIds, setSelectedFolderIds] = useState([]);
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [saveSheetOpen, setSaveSheetOpen] = useState(false);
  const [reserveSheetOpen, setReserveSheetOpen] = useState(false);
  const [lastReservation, setLastReservation] = useState(null);
  const [showReservationConfirm, setShowReservationConfirm] = useState(false);

  const openFolder = folders.find((f) => f.id === openFolderId) || null;

  const handleAddFolder = (name) => {
    if (!name || !name.trim()) {
      showToast("폴더 이름을 입력해주세요.");
      return;
    }
    setFolders((prev) => [...prev, { id: `f-${Date.now()}`, name: name.trim(), items: [] }]);
    setAddFolderOpen(false);
    showToast(`"${name.trim()}" 폴더를 만들었어요.`);
  };

  const handleDeleteItems = (itemIds) => {
    setFolders((prev) =>
      prev.map((f) => (f.id === openFolderId ? { ...f, items: f.items.filter((it) => !itemIds.includes(it.id)) } : f))
    );
  };

  const toggleSelectFolder = (id) => {
    setSelectedFolderIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleDeleteSelectedFolders = () => {
    if (selectedFolderIds.length === 0) {
      showToast("삭제할 폴더를 선택해주세요.");
      return;
    }
    showConfirm({
      message: `선택한 폴더 ${selectedFolderIds.length}개를 삭제할까요? 폴더 안의 저장 목록도 함께 삭제돼요.`,
      danger: true,
      confirmLabel: "삭제",
      onConfirm: () => {
        setFolders((prev) => prev.filter((f) => !selectedFolderIds.includes(f.id)));
        setSelectedFolderIds([]);
        setFolderListEditMode(false);
        showToast("폴더를 삭제했어요.");
      },
    });
  };

  return (
    <>
      {showReservationConfirm ? (
        <ReservationConfirmScreen
          reservation={lastReservation}
          place={selectedPlace}
          onClose={() => setShowReservationConfirm(false)}
          onGoMap={() => {
            showToast("지도 화면으로 이동합니다.");
            setShowReservationConfirm(false);
            setSelectedPlace(null);
          }}
          onGoReservations={() => {
            setShowReservationConfirm(false);
            setSelectedPlace(null);
          }}
        />
      ) : selectedPlace ? (
        <RestaurantDetailScreen
          place={selectedPlace}
          onBack={() => setSelectedPlace(null)}
          onOpenSave={() => setSaveSheetOpen(true)}
          onOpenReserve={() => setReserveSheetOpen(true)}
          showToast={showToast}
        />
      ) : !openFolder ? (
        <FoldersListScreen
          folders={folders}
          viewMode={viewMode}
          onToggleViewMode={setViewMode}
          onOpenFolder={(f) => {
            setOpenFolderId(f.id);
            setEditMode(false);
          }}
          onAddFolder={() => setAddFolderOpen(true)}
          editMode={folderListEditMode}
          onToggleEdit={() => {
            setFolderListEditMode((v) => !v);
            setSelectedFolderIds([]);
          }}
          selectedFolderIds={selectedFolderIds}
          onToggleSelectFolder={toggleSelectFolder}
          onDeleteSelectedFolders={handleDeleteSelectedFolders}
        />
      ) : (
        <FolderDetailScreen
          folder={openFolder}
          onBack={() => setOpenFolderId(null)}
          editMode={editMode}
          onToggleEdit={() => setEditMode((v) => !v)}
          onDeleteItems={handleDeleteItems}
          onSelectItem={setSelectedPlace}
          showConfirm={showConfirm}
          showToast={showToast}
        />
      )}
      <AddFolderModal open={addFolderOpen} onSave={handleAddFolder} onCancel={() => setAddFolderOpen(false)} />
      {saveSheetOpen && (
        <SaveToCollectionSheet
          onClose={() => setSaveSheetOpen(false)}
          showToast={showToast}
          onSaved={(collectionName) => {
            addPlaceToFolderStorage(collectionName, selectedPlace);
            // 저장/예약 탭 안에서 저장한 경우, 새로고침 없이도 목록에 바로 반영되도록
            setFolders((prev) => {
              const newItem = {
                id: `p-${Date.now()}`,
                name: selectedPlace?.name || selectedPlace?.displayName || "저장한 장소",
                category: selectedPlace?.category || "",
                address: selectedPlace?.address || "",
                hours: selectedPlace?.hours || "",
                rating: selectedPlace?.rating,
                photoUrl: selectedPlace?.photoUrl || selectedPlace?.url || null,
                aiAnalyzed: !!selectedPlace?.aiAnalyzed,
                district: selectedPlace?.district || "",
              };
              const idx = prev.findIndex((f) => f.name === collectionName);
              if (idx >= 0) {
                return prev.map((f, i) => (i === idx ? { ...f, items: [newItem, ...(f.items || [])] } : f));
              }
              return [...prev, { id: `f-${Date.now()}`, name: collectionName, items: [newItem] }];
            });
            setSaveSheetOpen(false);
            showToast(`"${collectionName}"에 저장했어요.`);
          }}
        />
      )}
      {reserveSheetOpen && (
        <ReservationSheet
          onClose={() => setReserveSheetOpen(false)}
          showToast={showToast}
          onComplete={(reservation) => {
            addReservationToStorage({ reservation, placeName: selectedPlace?.name || "플레이스픽 다이닝" });
            setLastReservation(reservation);
            setReserveSheetOpen(false);
            setShowReservationConfirm(true);
          }}
        />
      )}
    </>
  );
}

function PlaceCard({ place, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{ ...s.placeCard, width: "100%", border: "none", cursor: onClick ? "pointer" : "default", textAlign: "left" }}>
      <div style={s.placeThumb}>
        <i className="ti ti-photo-x" style={{ fontSize: 18, color: "#B4B2A9" }} />
      </div>
      <div style={s.placeInfo}>
        <p style={s.placeNameSmall}>{place.name}</p>
        <p style={s.placeStatus}>{place.status}</p>
        <p style={s.placeAddress}>{place.address}</p>
      </div>
      <div style={s.placeRatingCol}>
        {place.code && <span style={s.placeCode}>예약 {place.code}</span>}
        <span style={s.placeRating}>
          <i className="ti ti-star-filled" style={{ fontSize: 11, color: "#F2B84B" }} /> {place.rating}
          {place.reviewCount ? `(${place.reviewCount})` : ""}
        </span>
      </div>
    </button>
  );
}

function ReservationGroup({ group, onCancel, onSelectPlace }) {
  if (group.cancelled) {
    return (
      <div style={s.reservationGroupCancelled}>
        <div style={s.reservationHeaderRow}>
          <span style={s.reservationLabel}>{group.label}</span>
        </div>
        <p style={s.cancelledText}>취소 된 예약 정보입니다.</p>
      </div>
    );
  }
  return (
    <div style={group.isToday ? s.reservationGroupToday : s.reservationGroup}>
      <div style={s.reservationHeaderRow}>
        <span style={s.reservationLabel}>
          {group.label} {group.date}
        </span>
        <button type="button" style={s.cancelLink} onClick={() => onCancel(group)}>
          취소하기
        </button>
      </div>
      {group.items.map((item, i) => (
        <div key={i} style={s.reservationItem}>
          <span style={s.reservationTime}>{item.time}</span>
          <PlaceCard place={item} onClick={() => onSelectPlace(item)} />
        </div>
      ))}
    </div>
  );
}

function ReservationTab({ showToast, showConfirm }) {
  const [groups, setGroups] = useLocalStorageState(
    "placepick_reservations",
    INITIAL_RESERVATIONS.map((g, i) => ({ ...g, isToday: i === 0 }))
  );
  const [sortDesc, setSortDesc] = useState(true);
  const [reserveSheetOpen, setReserveSheetOpen] = useState(false);
  const [confirmScreenData, setConfirmScreenData] = useState(null);
  const [selectedPlace, setSelectedPlace] = useState(null);

  const handleCancel = (target) => {
    showConfirm({
      message: "이 예약을 취소할까요?",
      danger: true,
      confirmLabel: "예약 취소",
      onConfirm: () => {
        setGroups((prev) => prev.map((g) => (g.id === target.id ? { ...g, cancelled: true } : g)));
        showToast("예약이 취소되었어요.");
      },
    });
  };

  const handleReservationComplete = (reservation) => {
    const newGroup = addReservationToStorage({ reservation, placeName: "플레이스픽 다이닝" });
    setGroups((prev) => [newGroup, ...prev]);
    setReserveSheetOpen(false);
    setConfirmScreenData(reservation);
  };

  if (confirmScreenData) {
    return (
      <ReservationConfirmScreen
        reservation={confirmScreenData}
        place={{ displayName: "플레이스픽 다이닝" }}
        onClose={() => setConfirmScreenData(null)}
        onGoMap={() => {
          showToast("지도 화면으로 이동합니다.");
          setConfirmScreenData(null);
        }}
        onGoReservations={() => setConfirmScreenData(null)}
      />
    );
  }

  if (selectedPlace) {
    return (
      <RestaurantDetailScreen
        place={selectedPlace}
        onBack={() => setSelectedPlace(null)}
        onOpenSave={() => showToast("저장 화면은 저장/예약 탭의 저장 쪽에서 이용해주세요.")}
        onOpenReserve={() => setReserveSheetOpen(true)}
        showToast={showToast}
      />
    );
  }

  return (
    <>
      <div style={s.sortRow}>
        <button type="button" style={s.sortDropdown} onClick={() => setSortDesc((v) => !v)}>
          {sortDesc ? "최신순" : "오래된순"} <i className="ti ti-chevron-down" style={{ fontSize: 13 }} />
        </button>
      </div>
      <div style={s.scrollBody}>
        {groups.length === 0 && <p style={s.emptyText}>아직 예약한 곳이 없어요.</p>}
        {groups.map((group) => (
          <ReservationGroup key={group.id} group={group} onCancel={handleCancel} onSelectPlace={setSelectedPlace} />
        ))}
      </div>
      <div style={s.reservationFooter}>
        <button type="button" style={s.reserveButton} onClick={() => setReserveSheetOpen(true)}>
          예약하기
        </button>
        <button type="button" style={s.moreInfoButton} onClick={() => showToast("식당 상세 정보를 불러옵니다.")}>
          식당 정보 더보기
        </button>
      </div>
      {reserveSheetOpen && (
        <ReservationSheet
          onClose={() => setReserveSheetOpen(false)}
          onComplete={handleReservationComplete}
          showToast={showToast}
        />
      )}
    </>
  );
}

function SavedReservationTab({ showToast, showConfirm, initialSubTab, onLogout }) {
  const [tab, setTab] = useState(initialSubTab || "saved");
  const [menuOpen, setMenuOpen] = useState(false);
  const [subScreen, setSubScreen] = useState(null); // null | "settings" | "contact" | "notice" | "profile"

  if (subScreen) {
    return (
      <>
        {subScreen === "settings" && (
          <SettingsScreen
            onBack={() => {
              setSubScreen(null);
              setMenuOpen(true);
            }}
            showToast={showToast}
            showConfirm={showConfirm}
            onLogout={onLogout}
          />
        )}
        {subScreen === "profile" && <ProfileScreen onBack={() => setSubScreen(null)} showToast={showToast} onLogout={onLogout} />}
        {subScreen === "contact" && (
          <ContactScreen
            onBack={() => {
              setSubScreen(null);
              setMenuOpen(true);
            }}
            showToast={showToast}
          />
        )}
        {subScreen === "notice" && (
          <NoticeScreen
            onBack={() => {
              setSubScreen(null);
              setMenuOpen(true);
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div style={s.header}>
        <button type="button" style={s.iconBtnSmall} onClick={() => setMenuOpen(true)} aria-label="메뉴">
          <HamburgerIcon />
        </button>
        <span style={s.headerTitle}>저장/예약</span>
        <button type="button" style={s.iconBtnSmall} aria-label="알림">
          <BellIcon />
        </button>
      </div>
      <div style={s.subTabRow}>
        <button type="button" onClick={() => setTab("saved")} style={tab === "saved" ? s.subTabActive : s.subTab}>
          저장
        </button>
        <button type="button" onClick={() => setTab("reservation")} style={tab === "reservation" ? s.subTabActive : s.subTab}>
          예약
        </button>
      </div>
      {tab === "saved" ? <SavedTab showToast={showToast} showConfirm={showConfirm} /> : <ReservationTab showToast={showToast} showConfirm={showConfirm} />}
      <SideMenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onNavigate={(key) => {
          setMenuOpen(false);
          setSubScreen(key);
        }}
        onLogout={() => {
          setMenuOpen(false);
          onLogout();
        }}
      />
    </>
  );
}

// ============================================================
// 메인 셸 최상위: 탭 전환 관리
// ============================================================
function MainShell({ showToast, showConfirm, onLogout }) {
  const [activeTab, setActiveTab] = useState("home");
  const [homeResetKey, setHomeResetKey] = useState(0);
  const [savedInitialSubTab, setSavedInitialSubTab] = useState("saved");
  const [savedTabKey, setSavedTabKey] = useState(0);
  const [uploadFocusMode, setUploadFocusMode] = useState(false);

  const handleTabChange = (tab) => {
    if (tab === "home" && activeTab === "home") {
      // 이미 홈 탭인 상태에서 "홈"을 다시 누르면 설정 등 하위 화면에서 빠져나와 초기 화면으로
      setHomeResetKey((k) => k + 1);
    }
    if (tab === "saved") {
      setSavedInitialSubTab("saved");
    }
    setActiveTab(tab);
  };

  const goToReservations = () => {
    setSavedInitialSubTab("reservation");
    setSavedTabKey((k) => k + 1); // 이미 저장/예약 탭이어도 예약 서브탭으로 강제 전환되도록 리마운트
    setActiveTab("saved");
  };

  return (
    <>
      {activeTab === "home" && (
        <HomeTab key={homeResetKey} showToast={showToast} showConfirm={showConfirm} onGoToReservations={goToReservations} onLogout={onLogout} />
      )}
      {activeTab === "upload" && (
        <UploadTab showToast={showToast} showConfirm={showConfirm} onLogout={onLogout} onFocusModeChange={setUploadFocusMode} />
      )}
      {activeTab === "saved" && (
        <SavedReservationTab
          key={savedTabKey}
          showToast={showToast}
          showConfirm={showConfirm}
          initialSubTab={savedInitialSubTab}
          onLogout={onLogout}
        />
      )}
      {!uploadFocusMode && <MainBottomTabBar active={activeTab} onChange={handleTabChange} />}
      {!uploadFocusMode && <HomeIndicator />}
    </>
  );
}

// ============================================================
// 앱 최상위: 인증 플로우 ↔ 메인 셸 전환
// ============================================================
export default function PlacePickApp() {
  const [authScreen, setAuthScreen] = useState("splash");
  const [loggedIn, setLoggedIn] = useState(false);
  const [signupData, setSignupData] = useState({ id: "", password: "", name: "", phone: "" });
  const [toast, setToast] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);

  const showToast = (message) => {
    setToast(message);
    window.clearTimeout(showToast._t);
    // 메시지가 길면(에러 메시지 등) 다 읽을 시간을 더 줌
    const duration = message && message.length > 25 ? 6000 : 2000;
    showToast._t = window.setTimeout(() => setToast(null), duration);
  };
  const showConfirm = (dialog) => {
    setConfirmDialog({
      ...dialog,
      onConfirm: () => {
        dialog.onConfirm();
        setConfirmDialog(null);
      },
    });
  };

  let body;
  if (loggedIn) {
    body = (
      <MainShell
        showToast={showToast}
        showConfirm={showConfirm}
        onLogout={() => {
          setLoggedIn(false);
          setAuthScreen("login");
          showToast("로그아웃 되었어요.");
        }}
      />
    );
  } else if (authScreen === "splash") {
    body = <SplashScreen onFinish={() => setAuthScreen("login")} />;
  } else if (authScreen === "login") {
    body = (
      <LoginScreen
        showToast={showToast}
        onGoSignUp={() => setAuthScreen("signupTerms")}
        onGoFindId={() => setAuthScreen("findId")}
        onGoFindPassword={() => setAuthScreen("findPassword")}
        onLoginSuccess={(user) => {
          setSignupData((p) => ({ ...p, id: user.id }));
          setLoggedIn(true);
        }}
      />
    );
  } else if (authScreen === "findId") {
    body = <FindIdScreen onBack={() => setAuthScreen("login")} onGoLogin={() => setAuthScreen("login")} />;
  } else if (authScreen === "findPassword") {
    body = <FindPasswordScreen showToast={showToast} onBack={() => setAuthScreen("login")} onGoLogin={() => setAuthScreen("login")} />;
  } else if (authScreen === "signupTerms") {
    body = <SignUpTermsScreen showToast={showToast} onBack={() => setAuthScreen("login")} onNext={() => setAuthScreen("signupId")} />;
  } else if (authScreen === "signupId") {
    body = (
      <SignUpIdScreen
        onBack={() => setAuthScreen("signupTerms")}
        onNext={(id) => {
          setSignupData((p) => ({ ...p, id }));
          setAuthScreen("signupPassword");
        }}
      />
    );
  } else if (authScreen === "signupPassword") {
    body = (
      <SignUpPasswordScreen
        onBack={() => setAuthScreen("signupId")}
        onNext={(password) => {
          setSignupData((p) => ({ ...p, password }));
          setAuthScreen("signupPhone");
        }}
      />
    );
  } else if (authScreen === "signupPhone") {
    body = (
      <SignUpPhoneScreen
        onBack={() => setAuthScreen("signupPassword")}
        onNext={async ({ name, phone }) => {
          const merged = { ...signupData, name, phone };
          try {
            await completeSignUp(merged);
            setSignupData(merged);
            setAuthScreen("signupDone");
          } catch (err) {
            showToast(err.message || "회원가입 중 오류가 발생했어요.");
          }
        }}
      />
    );
  } else if (authScreen === "signupDone") {
    body = <SignUpDoneScreen nickname={signupData.id} onGoHome={() => setAuthScreen("login")} />;
  }

  return (
    <PhoneFrame>
      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
        {body}
        <ConfirmDialog dialog={confirmDialog} onCancel={() => setConfirmDialog(null)} />
        <Toast message={toast} />
      </div>
    </PhoneFrame>
  );
}

// ============================================================
// 스타일
// ============================================================
const s = {
  hamburgerWrap: {
    display: "inline-flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: 4,
    width: 20,
    height: 20,
  },
  hamburgerBar: {
    display: "block",
    width: "100%",
    height: 2,
    borderRadius: 1,
    background: "#1A1A1A",
  },
  phone: {
    width: 375,
    maxWidth: "100%",
    boxSizing: "border-box",
    minHeight: 780,
    margin: "0 auto",
    background: "#FFFFFF",
    border: "1px solid #E5E5E5",
    borderRadius: 12,
    display: "flex",
    flexDirection: "column",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    color: "#1A1A1A",
    position: "relative",
    overflow: "hidden",
  },
  statusBar: { display: "flex", justifyContent: "space-between", padding: "10px 18px 0", fontSize: 13, fontWeight: 600 },
  statusIcons: { display: "flex", gap: 4, alignItems: "center" },

  logoPlaceholder: { width: 64, height: 64, border: "1px solid #D9D9D9", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  splashBody: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer" },
  splashTitle: { fontWeight: 700, fontSize: 15, margin: 0 },
  bottomTextWrap: { textAlign: "center", paddingBottom: 10 },
  bottomText: { fontSize: 11.5, color: "#B0B0B0", margin: "0 0 8px" },
  dots: { display: "flex", justifyContent: "center", gap: 5 },
  dot: { width: 5, height: 5, borderRadius: "50%", background: "#B0B0B0" },
  homeIndicatorWrap: { display: "flex", justifyContent: "center", padding: "8px 0 14px" },
  homeIndicator: { width: 110, height: 4, borderRadius: 2, background: "#1A1A1A" },

  loginBody: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "56px 24px 0" },
  loginTitle: { fontWeight: 700, fontSize: 18, margin: "4px 0 4px" },
  loginSubtitle: { fontSize: 12.5, color: "#8A8A8A", margin: "0 0 28px" },
  demoHint: {
    fontSize: 11,
    color: "#1D9E75",
    background: "#E1F5EE",
    padding: "6px 10px",
    borderRadius: 6,
    margin: "0 0 14px",
    width: "100%",
    boxSizing: "border-box",
    textAlign: "center",
  },
  input: { width: "100%", height: 42, padding: "0 12px", fontSize: 13, border: "1px solid #DADADA", borderRadius: 6, outline: "none", boxSizing: "border-box", color: "#1A1A1A", background: "#FFFFFF" },
  inputWithIcon: { position: "relative" },
  eyeButton: { position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#B0B0B0", cursor: "pointer", padding: 4 },
  guestLinkCentered: { alignSelf: "center", marginTop: 10, fontSize: 11.5, color: "#8A8A8A", background: "none", border: "none", textDecoration: "underline", cursor: "pointer", padding: 0 },
  loginError: { width: "100%", fontSize: 12, color: "#C0392B", margin: "10px 0 0", textAlign: "left" },
  loginButton: { width: "100%", height: 42, marginTop: 16, borderRadius: 6, border: "1px solid #DADADA", background: "#F2F2F2", color: "#3A3A3A", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  linkRow: { display: "flex", alignItems: "center", gap: 8, marginTop: 24 },
  linkText: { fontSize: 11.5, color: "#8A8A8A", background: "none", border: "none", cursor: "pointer", padding: 0 },
  linkDivider: { fontSize: 11.5, color: "#DADADA" },

  signupHeaderRow: { display: "flex", alignItems: "center", padding: "14px 18px 0" },
  backButton: { background: "none", border: "none", cursor: "pointer", padding: 4, color: "#1A1A1A" },
  progressWrap: { padding: "8px 18px 0" },
  progressBarBg: { width: "100%", height: 3, borderRadius: 2, background: "#EDEDED", overflow: "hidden" },
  progressBarFill: { height: "100%", background: "#1A1A1A", transition: "width 0.2s ease" },
  signupBody: { flex: 1, padding: "20px 22px 0" },
  signupTitle: { fontSize: 15.5, lineHeight: 1.5, margin: "0 0 22px", fontWeight: 400 },
  stepTitle: { fontSize: 17, lineHeight: 1.4, margin: "0 0 22px", fontWeight: 600, color: "#1A1A1A" },
  termsList: { display: "flex", flexDirection: "column" },
  termRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0" },
  termLabelWrap: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" },
  checkbox: { width: 15, height: 15, accentColor: "#3A3A3A", flexShrink: 0 },
  termLabel: { fontSize: 12.5, color: "#3A3A3A" },
  requiredTag: { color: "#3A3A3A", fontWeight: 600 },
  optionalTag: { color: "#8A8A8A", fontWeight: 600 },
  viewLink: { fontSize: 11, color: "#B0B0B0", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", padding: 0 },
  termsDivider: { height: 1, background: "#EDEDED", margin: "14px 0" },
  allAgreeRow: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" },
  allAgreeLabel: { fontSize: 12.5, fontWeight: 600, color: "#1A1A1A" },
  fieldError: { margin: "8px 2px 0", fontSize: 12, color: "#C0392B" },
  editInfoLink: {
    display: "block",
    marginTop: 10,
    fontSize: 11.5,
    color: "#8A8A8A",
    background: "none",
    border: "none",
    textDecoration: "underline",
    cursor: "pointer",
    padding: 0,
  },
  validationRow: { display: "flex", gap: 10, marginTop: 8, marginLeft: 2 },
  validationTag: { fontSize: 11, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 2 },
  inlineRow: { display: "flex", gap: 8 },
  select: { width: 92, height: 42, padding: "0 8px", fontSize: 13, border: "1px solid #DADADA", borderRadius: 6, background: "#FFFFFF", color: "#1A1A1A", flexShrink: 0 },
  timerText: { fontSize: 12, color: "#C0392B", alignSelf: "center", flexShrink: 0 },
  resendButton: { height: 42, padding: "0 12px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: "1px solid #DADADA", background: "#F2F2F2", color: "#3A3A3A", cursor: "pointer", flexShrink: 0 },
  signupFooter: { padding: "16px 22px 6px" },
  primaryButton: { width: "100%", height: 48, borderRadius: 24, border: "none", background: "#1A1A1A", color: "#FFFFFF", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 },
  secondaryButton: { width: "100%", height: 46, borderRadius: 24, border: "1px solid #DADADA", background: "#F2F2F2", color: "#3A3A3A", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  doneBody: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, padding: "0 24px" },
  doneWelcome: { fontSize: 15, color: "#1A1A1A", margin: 0 },
  doneCircle: { width: 84, height: 84, borderRadius: "50%", background: "#1A1A1A", display: "flex", alignItems: "center", justifyContent: "center" },
  doneLabel: { fontSize: 14, color: "#3A3A3A", margin: 0 },

  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px 0" },
  headerTitle: { fontSize: 15, fontWeight: 700 },
  iconButton: { background: "none", border: "none", color: "#1A1A1A", cursor: "pointer", padding: 4 },
  iconBtnSmall: { background: "none", border: "none", color: "#1A1A1A", cursor: "pointer", padding: 4 },

  searchBarRow: { display: "flex", gap: 8, padding: "10px 16px 0" },
  searchBarWrap: { flex: 1, display: "flex", alignItems: "center", gap: 8, height: 36, padding: "0 12px", border: "1px solid #DADADA", borderRadius: 18, background: "#FAFAFA" },
  searchBarInput: { flex: 1, border: "none", outline: "none", background: "none", fontSize: 12, color: "#1A1A1A" },
  locationButton: { width: 36, height: 36, borderRadius: "50%", border: "1px solid #DADADA", background: "#FFFFFF", color: "#3A3A3A", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  mapArea: { position: "relative", margin: "10px 16px 0", height: 150, border: "1px solid #EDEDED", borderRadius: 8, background: "#FAFAF8", display: "flex", alignItems: "center", justifyContent: "center" },
  mapMockupWrap: {
    position: "relative",
    margin: "10px 16px 0",
    height: 200,
    borderRadius: 10,
    overflow: "hidden",
    background: "#E8ECE3",
  },
  mapPin: {
    position: "absolute",
    width: 24,
    height: 24,
    padding: 0,
    border: "none",
    background: "none",
    cursor: "pointer",
    transform: "translate(-50%, -100%)",
  },
  mapPinInner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    borderRadius: "50% 50% 50% 0",
    background: "#1A1A1A",
    transform: "rotate(-45deg)",
  },
  mapMyLocationDot: {
    position: "absolute",
    left: 60,
    top: 170,
    width: 12,
    height: 12,
    borderRadius: "50%",
    background: "#378ADD",
    border: "2px solid #FFFFFF",
    boxShadow: "0 0 0 1px #378ADD",
  },
  mapPlaceCard: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 10,
    padding: 10,
    borderRadius: 8,
    background: "#FFFFFF",
    border: "1px solid #EDEDED",
  },
  mapAreaLabel: { fontSize: 11, color: "#B4B2A9" },
  zoomControl: {
    position: "absolute",
    right: 24,
    top: 10,
    background: "#FFFFFF",
    border: "1px solid #E5E5E5",
    borderRadius: 6,
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
    overflow: "hidden",
  },
  zoomBtn: {
    width: 28,
    height: 28,
    border: "none",
    background: "#FFFFFF",
    color: "#3A3A3A",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  zoomDivider: { height: 1, background: "#EDEDED" },

  collapseHeader: {
    width: "100%",
    boxSizing: "border-box",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    fontSize: 12.5,
    fontWeight: 600,
    color: "#3A3A3A",
    background: "none",
    border: "none",
    borderTop: "1px solid #F0F0F0",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  regionPanel: { borderTop: "1px solid #F0F0F0", width: "100%", boxSizing: "border-box" },
  regionTabRow: { display: "flex", gap: 6, padding: "0 16px 10px", overflowX: "auto", scrollbarWidth: "none", msOverflowStyle: "none" },
  regionTab: {
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 16,
    border: "1px solid #DADADA",
    background: "#FFFFFF",
    color: "#3A3A3A",
    cursor: "pointer",
    flexShrink: 0,
  },
  regionTabActive: {
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 16,
    border: "1px solid #EF9F27",
    background: "#EF9F27",
    color: "#FFFFFF",
    cursor: "pointer",
    flexShrink: 0,
  },
  regionAllText: { fontSize: 12, color: "#8A8A8A", padding: "0 16px 14px" },
  districtGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 6,
    padding: "0 16px 14px",
    maxHeight: 200,
    overflowY: "auto",
  },
  districtBtn: {
    padding: "8px 4px",
    fontSize: 11.5,
    borderRadius: 6,
    border: "1px solid #EDEDED",
    background: "#FAFAF8",
    color: "#3A3A3A",
    cursor: "pointer",
  },
  districtBtnActive: {
    padding: "8px 4px",
    fontSize: 11.5,
    borderRadius: 6,
    border: "1px solid #1A1A1A",
    background: "#1A1A1A",
    color: "#FFFFFF",
    cursor: "pointer",
  },

  filterChipsRow: { display: "flex", gap: 6, padding: "12px 16px 0", overflowX: "auto", scrollbarWidth: "none", msOverflowStyle: "none" },
  chip: { flexShrink: 0, padding: "6px 12px", fontSize: 11.5, fontWeight: 600, borderRadius: 16, border: "1px solid #DADADA", background: "#FFFFFF", color: "#3A3A3A", cursor: "pointer", whiteSpace: "nowrap" },
  chipActive: { flexShrink: 0, padding: "6px 12px", fontSize: 11.5, fontWeight: 600, borderRadius: 16, border: "1px solid #1A1A1A", background: "#1A1A1A", color: "#FFFFFF", cursor: "pointer", whiteSpace: "nowrap" },
  ratingSection: { padding: "16px 16px 0" },
  foodTypeSection: { padding: "16px 16px 0" },
  foodTypeChipRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  ratingHeaderRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  ratingLabel: { fontSize: 12.5, fontWeight: 600, color: "#1A1A1A" },
  ratingValue: { fontSize: 12, color: "#8A8A8A" },
  sliderWrap: { display: "flex", alignItems: "center", gap: 8 },
  customSliderTrack: { position: "relative", flex: 1, height: 24, display: "flex", alignItems: "center", cursor: "pointer", touchAction: "none" },
  customSliderBg: { position: "absolute", left: 0, right: 0, height: 3, borderRadius: 2, background: "#EDEDED", pointerEvents: "none" },
  customSliderActive: { position: "absolute", height: 3, borderRadius: 2, background: "#1A1A1A", pointerEvents: "none" },
  customSliderThumb: { position: "absolute", top: "50%", width: 18, height: 18, borderRadius: "50%", background: "#1A1A1A", border: "2px solid #FFFFFF", boxShadow: "0 0 0 1px #DADADA", transform: "translate(-50%, -50%)", cursor: "grab", touchAction: "none" },
  actionRow: { display: "flex", gap: 8, padding: "18px 16px 0" },
  resetButton: { flexShrink: 0, height: 40, padding: "0 16px", borderRadius: 20, border: "1px solid #DADADA", background: "#FFFFFF", color: "#3A3A3A", fontSize: 12.5, fontWeight: 600, cursor: "pointer" },
  resultButton: { flex: 1, height: 40, borderRadius: 20, border: "none", background: "#1A1A1A", color: "#FFFFFF", fontSize: 12.5, fontWeight: 600, cursor: "pointer" },

  drawerOverlay: { position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 30, transition: "opacity 0.2s ease" },
  drawer: { position: "absolute", top: 0, left: 0, bottom: 0, width: "78%", background: "#FFFFFF", display: "flex", flexDirection: "column", padding: "18px 20px", boxSizing: "border-box", transition: "transform 0.25s ease", boxShadow: "2px 0 12px rgba(0,0,0,0.08)" },
  drawerProfileRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 24 },
  avatarCircle: { width: 40, height: 40, borderRadius: "50%", background: "#F0EFEA", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  drawerUserName: { fontSize: 14.5, fontWeight: 700, margin: 0 },
  drawerList: { display: "flex", flexDirection: "column", flex: 1 },
  drawerListItem: { display: "flex", alignItems: "center", gap: 12, padding: "12px 2px", fontSize: 13.5, color: "#1A1A1A", background: "none", border: "none", cursor: "pointer", textAlign: "left" },
  drawerFooter: { marginTop: "auto" },
  logoutButton: { width: "100%", height: 42, borderRadius: 8, border: "1px solid #DADADA", background: "#FFFFFF", color: "#3A3A3A", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 },
  appVersionText: { textAlign: "center", fontSize: 11, color: "#B0B0B0", marginTop: 12 },

  settingsHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px 0" },
  settingsTitle: { fontSize: 15, fontWeight: 700 },
  settingsBody: { flex: 1, padding: "18px 20px 0", overflowY: "auto" },
  notifIntroText: { fontSize: 14, lineHeight: 1.5, margin: "0 0 14px", color: "#1A1A1A" },
  notifCard: { border: "1px dashed #DADADA", borderRadius: 10, padding: "22px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 22, background: "#FAFAF8" },
  notifCardHint: { fontSize: 11, color: "#8A8A8A", margin: 0 },
  settingsRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 },
  settingsRowTitle: { fontSize: 13, fontWeight: 600, margin: "0 0 2px" },
  settingsRowSub: { fontSize: 11, color: "#8A8A8A", margin: 0 },
  toggleTrack: { width: 40, height: 22, borderRadius: 11, border: "none", position: "relative", cursor: "pointer", flexShrink: 0, padding: 2, boxSizing: "border-box" },
  toggleThumb: { display: "block", width: 18, height: 18, borderRadius: "50%", background: "#FFFFFF", transition: "transform 0.15s ease" },
  settingsSectionLabel: { fontSize: 11, color: "#B0B0B0", margin: "0 0 6px", fontWeight: 600 },
  settingsListItem: { display: "block", width: "100%", textAlign: "left", padding: "11px 0", fontSize: 13, color: "#1A1A1A", background: "none", border: "none", borderBottom: "1px solid #F5F5F5", cursor: "pointer" },

  myReviewEmptyBody: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 },
  myReviewEmptyIcon: { width: 44, height: 44, borderRadius: "50%", border: "1px solid #DADADA", display: "flex", alignItems: "center", justifyContent: "center" },
  myReviewEmptyText: { fontSize: 12.5, color: "#B0B0B0", margin: 0 },
  myReviewCountText: { fontSize: 14, fontWeight: 700, margin: "6px 0 4px" },
  myReviewGuideLink: { fontSize: 11, color: "#8A8A8A", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 16, display: "block" },
  myReviewCard: { paddingBottom: 18, marginBottom: 18, borderBottom: "1px solid #F0F0F0" },
  myReviewTopRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  myReviewPlaceLink: { fontSize: 13.5, fontWeight: 700, color: "#1A1A1A", background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 2 },
  myReviewActionBtn: { fontSize: 10.5, color: "#8A8A8A", background: "#FAFAF8", border: "1px solid #EDEDED", borderRadius: 6, padding: "4px 9px", cursor: "pointer" },
  myReviewMetaRow: { fontSize: 11, color: "#F2B84B", margin: "0 0 6px", letterSpacing: 1 },
  myReviewText: { fontSize: 12, color: "#3A3A3A", lineHeight: 1.5, margin: "0 0 10px" },
  myReviewPhoto: { width: 72, height: 72, borderRadius: 8, background: "#F0EFEA", display: "flex", alignItems: "center", justifyContent: "center" },
  syncPhoneLabel: { fontSize: 12.5, color: "#3A3A3A", margin: "18px 0 24px" },
  syncSectionTitle: { fontSize: 12.5, fontWeight: 700, margin: "0 0 6px" },
  syncSectionText: { fontSize: 11.5, color: "#8A8A8A", lineHeight: 1.6, margin: "0 0 20px" },
  profileEditRow: { width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 0", borderBottom: "1px solid #F5F5F5", background: "none", border: "none", cursor: "pointer", textAlign: "left" },
  profileEditLabel: { fontSize: 13, color: "#1A1A1A" },
  profileEditValueWrap: { display: "flex", alignItems: "center", gap: 6 },
  profileEditBadge: { fontSize: 9.5, fontWeight: 700, color: "#C0392B", background: "#FBEAEA", padding: "2px 6px", borderRadius: 8 },
  profileEditValue: { fontSize: 12.5, color: "#8A8A8A" },
  profileLogoutRow: { width: "100%", textAlign: "left", padding: "13px 0", fontSize: 13, color: "#B0B0B0", background: "none", border: "none", cursor: "pointer" },
  profileWithdrawText: { fontSize: 11, color: "#B0B0B0", textAlign: "center", marginTop: 30 },
  profileWithdrawLink: { fontSize: 11, color: "#8A8A8A", fontWeight: 700, textDecoration: "underline", background: "none", border: "none", cursor: "pointer", padding: 0 },

  // ---- 개선 제안 ----
  suggestBody: { flex: 1, padding: "16px 20px 0", overflowY: "auto" },
  suggestIntroText: { fontSize: 12, color: "#8A8A8A", lineHeight: 1.6, margin: "0 0 18px" },
  suggestTitleInput: { width: "100%", height: 42, padding: "0 12px", fontSize: 13, border: "1px solid #DADADA", borderRadius: 8, outline: "none", boxSizing: "border-box", marginBottom: 10 },
  suggestBodyTextarea: { width: "100%", height: 130, padding: "10px 12px", fontSize: 13, border: "1px solid #DADADA", borderRadius: 8, outline: "none", boxSizing: "border-box", resize: "none", fontFamily: "inherit", marginBottom: 14 },
  suggestDisclaimer: { fontSize: 10.5, color: "#B0B0B0", lineHeight: 1.6, margin: "0 0 16px" },
  suggestDisclaimerLink: { color: "#8A8A8A", textDecoration: "underline" },
  suggestAgreeRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 4 },
  suggestAgreeLabel: { fontSize: 12, color: "#3A3A3A" },
  subSectionLabel: { fontSize: 11, color: "#B0B0B0", fontWeight: 600, margin: "0 0 8px" },
  faqItem: { borderBottom: "1px solid #F5F5F5" },
  faqQuestion: { width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "12px 0", fontSize: 12.5, color: "#1A1A1A", background: "none", border: "none", cursor: "pointer", textAlign: "left" },
  faqAnswer: { fontSize: 12, color: "#8A8A8A", margin: "0 0 12px", lineHeight: 1.5 },
  noticeDate: { color: "#B0B0B0", marginRight: 4 },
  contactTextarea: { width: "100%", height: 90, padding: 12, fontSize: 12.5, border: "1px solid #DADADA", borderRadius: 8, outline: "none", boxSizing: "border-box", resize: "none", fontFamily: "inherit", marginBottom: 10 },
  contactSubmitBtn: { width: "100%", height: 42, borderRadius: 8, border: "none", background: "#1A1A1A", color: "#FFFFFF", fontSize: 13, fontWeight: 600, cursor: "pointer" },

  uploadBody: { flex: 1, padding: "16px 18px 0", overflowY: "auto" },
  uploadIntroText: { fontSize: 15.5, lineHeight: 1.5, margin: "0 0 18px", color: "#1A1A1A" },

  archiveBody: { flex: 1, padding: "16px 20px 24px", overflowY: "auto" },
  archiveTitle: { fontSize: 18, fontWeight: 700, margin: "0 0 4px" },
  archiveSubtitle: { fontSize: 12, color: "#8A8A8A", margin: "0 0 20px" },
  archiveSectionLabel: { fontSize: 11.5, fontWeight: 700, color: "#8A8A8A", margin: "0 0 8px" },
  archiveSearchRow: { display: "flex", gap: 8, marginBottom: 20 },
  archiveSearchInputWrap: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 42,
    padding: "0 12px",
    border: "1px solid #DADADA",
    borderRadius: 8,
    boxSizing: "border-box",
  },
  archiveSearchInput: { flex: 1, border: "none", outline: "none", fontSize: 12.5, background: "transparent" },
  archiveSearchBtn: {
    width: 56,
    height: 42,
    borderRadius: 8,
    border: "none",
    background: "#EF9F27",
    color: "#FFFFFF",
    fontSize: 12.5,
    fontWeight: 700,
    cursor: "pointer",
    flexShrink: 0,
  },
  archiveResultList: { marginBottom: 20, border: "1px solid #EDEDED", borderRadius: 8, overflow: "hidden" },
  archiveResultItem: {
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 12px",
    background: "#FFFFFF",
    border: "none",
    borderBottom: "1px solid #F5F5F5",
    cursor: "pointer",
    textAlign: "left",
  },
  archiveResultName: { fontSize: 12.5, fontWeight: 600, margin: "0 0 2px" },
  archiveResultAddress: { fontSize: 10.5, color: "#8A8A8A", margin: 0 },
  archiveDividerRow: { display: "flex", alignItems: "center", gap: 10, margin: "4px 0 20px" },
  archiveDividerLine: { flex: 1, height: 1, background: "#EDEDED" },
  archiveDividerText: { fontSize: 10.5, color: "#B0B0B0", whiteSpace: "nowrap" },
  archiveImageBox: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    padding: "26px 16px",
    border: "1.5px dashed #DADADA",
    borderRadius: 12,
    background: "#FAFAF8",
    cursor: "pointer",
    marginBottom: 16,
    boxSizing: "border-box",
  },
  archiveImageIconCircle: {
    width: 40,
    height: 40,
    borderRadius: "50%",
    background: "#F0EFEA",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  archiveImageBoxTitle: { fontSize: 13, fontWeight: 700, margin: 0 },
  archiveImageBoxSub: { fontSize: 10.5, color: "#B0B0B0", margin: 0 },
  archiveImageUploadBtn: {
    width: "100%",
    height: 40,
    marginTop: 10,
    borderRadius: 8,
    border: "none",
    background: "#1A1A1A",
    color: "#FFFFFF",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  },
  archiveLinkRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 44,
    padding: "0 12px",
    border: "1px solid #DADADA",
    borderRadius: 8,
    boxSizing: "border-box",
  },
  archiveLinkInput: { flex: 1, border: "none", outline: "none", fontSize: 12.5, background: "transparent" },
  archiveExtractBtn: {
    padding: "7px 12px",
    borderRadius: 6,
    border: "1px solid #DADADA",
    background: "#FFFFFF",
    color: "#3A3A3A",
    fontSize: 11.5,
    fontWeight: 600,
    cursor: "pointer",
    flexShrink: 0,
  },

  methodRow: { display: "flex", gap: 10 },
  methodBtn: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "12px 0", border: "1px solid #E5E5E5", borderRadius: 10, background: "#FAFAF8", color: "#8A8A8A", cursor: "pointer" },
  methodBtnActive: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "12px 0", border: "1px solid #1A1A1A", borderRadius: 10, background: "#1A1A1A", color: "#FFFFFF", cursor: "pointer" },
  methodLabel: { fontSize: 11 },
  linkInput: { width: "100%", height: 42, padding: "0 12px", fontSize: 13, border: "1px solid #DADADA", borderRadius: 8, outline: "none", boxSizing: "border-box" },
  selectRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20 },
  selectLabel: { fontSize: 12.5, color: "#3A3A3A", margin: 0 },
  selectCount: { fontSize: 11, color: "#8A8A8A" },
  filterRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  screenshotDropdown: { fontSize: 11.5, color: "#8A8A8A", display: "flex", alignItems: "center", gap: 2 },
  selectAllBtn: { fontSize: 11, color: "#3A3A3A", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 },
  photoGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: 10 },
  cameraCell: { aspectRatio: "1", border: "1px solid #E5E5E5", borderRadius: 6, background: "#F5F4F0", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
  photoCell: { position: "relative", aspectRatio: "1", border: "1px solid #E5E5E5", borderRadius: 6, background: "#EDECE6", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
  photoCheckBadge: { position: "absolute", top: 4, right: 4, width: 16, height: 16, borderRadius: "50%", background: "#1A1A1A", display: "flex", alignItems: "center", justifyContent: "center" },
  photoRemoveBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: "50%",
    background: "rgba(0,0,0,0.55)",
    border: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    padding: 0,
  },
  photoHint: { fontSize: 10.5, color: "#B0B0B0", margin: "8px 2px 0" },
  confirmTitle: { fontSize: 15.5, fontWeight: 600, margin: "0 0 18px" },
  previewImageBox: { width: "100%", height: 220, border: "1px solid #E5E5E5", borderRadius: 8, background: "#F0EFEA", display: "flex", alignItems: "center", justifyContent: "center" },
  loadingDotsRow: { display: "flex", justifyContent: "center", gap: 8, marginTop: 20 },
  loadingDot: { width: 7, height: 7, borderRadius: "50%", background: "#1A1A1A", transition: "opacity 0.2s" },
  infoTitleRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  editIconBtn: { background: "none", border: "none", color: "#1A1A1A", cursor: "pointer", padding: 4 },
  placeName: { fontSize: 15, fontWeight: 700, margin: "14px 0 2px", display: "flex", justifyContent: "space-between" },
  placePrice: { fontSize: 12.5, fontWeight: 400, color: "#3A3A3A" },
  placeCategory: { fontSize: 12, color: "#8A8A8A", margin: "0 0 10px" },
  placeMetaRow: { fontSize: 12, color: "#3A3A3A", display: "flex", alignItems: "center", gap: 5, margin: "4px 0" },
  editInput: { width: "100%", height: 38, padding: "0 12px", fontSize: 12.5, border: "1px solid #DADADA", borderRadius: 6, outline: "none", boxSizing: "border-box" },
  paginationRow: { display: "flex", justifyContent: "center", gap: 6, marginTop: 16 },
  pageDot: { width: 6, height: 6, borderRadius: "50%", border: "none", cursor: "pointer" },
  doneIconWrap: { display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "10px 0 20px" },
  doneTitle: { fontSize: 15, fontWeight: 700, margin: 0 },
  doneSubtitle: { fontSize: 12, color: "#8A8A8A", margin: 0 },
  viewDetailBtn: {
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "13px 16px",
    marginBottom: 18,
    borderRadius: 10,
    border: "1px solid #1A1A1A",
    background: "#1A1A1A",
    color: "#FFFFFF",
    fontSize: 13,
    cursor: "pointer",
  },
  listTitleRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  listTitle: { fontSize: 13, fontWeight: 700 },
  listActions: { display: "flex", gap: 10, color: "#8A8A8A" },
  savedList: { display: "flex", flexDirection: "column", gap: 10 },
  savedRow: { display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 0", borderBottom: "1px solid #F0F0F0" },
  savedName: { fontSize: 13, fontWeight: 600, margin: "0 0 2px" },
  savedCategory: { fontSize: 11, color: "#8A8A8A", margin: "0 0 4px" },
  savedMeta: { fontSize: 11, color: "#8A8A8A", display: "flex", alignItems: "center", gap: 4, margin: "2px 0" },
  deleteBtn: { background: "none", border: "none", color: "#B0B0B0", cursor: "pointer", padding: 4, flexShrink: 0 },
  footer: { padding: "14px 18px 6px" },
  findIdFooter: { padding: "14px 18px 48px" },

  subTabRow: { display: "flex", gap: 20, padding: "14px 18px 0", borderBottom: "1px solid #F0F0F0" },
  subTab: { fontSize: 13.5, color: "#B0B0B0", background: "none", border: "none", padding: "0 0 10px", cursor: "pointer" },
  subTabActive: { fontSize: 13.5, color: "#1A1A1A", fontWeight: 700, background: "none", border: "none", borderBottom: "2px solid #1A1A1A", padding: "0 0 10px", cursor: "pointer" },
  sortRow: { display: "flex", justifyContent: "flex-end", padding: "10px 18px 0" },
  sortDropdown: { fontSize: 11.5, color: "#8A8A8A", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 2 },
  scrollBody: { flex: 1, padding: "8px 18px 0", overflowY: "auto" },

  // ---- 저장 폴더 목록 ----
  folderListHeaderRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0 12px" },
  folderListTitle: { fontSize: 13.5, fontWeight: 700 },
  folderViewToggleBtn: { background: "none", border: "none", cursor: "pointer", padding: 4 },
  folderGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, paddingBottom: 20 },
  folderGridItem: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 6,
    padding: 0,
    background: "none",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
  },
  folderGridThumb: {
    width: "100%",
    aspectRatio: "1.1",
    borderRadius: 10,
    background: "#EDECE6",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  folderGridAddItem: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    aspectRatio: "0.85",
    borderRadius: 10,
    border: "1px dashed #DADADA",
    background: "none",
    cursor: "pointer",
  },
  folderName: { fontSize: 12, fontWeight: 600, margin: 0 },
  folderCount: { fontSize: 10, color: "#8A8A8A", margin: 0 },

  folderListItem: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    marginBottom: 8,
    borderRadius: 10,
    border: "1px solid #F0EFEA",
    background: "#FFFFFF",
    cursor: "pointer",
    textAlign: "left",
  },
  folderListIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    background: "#EF9F27",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  folderListAddItem: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "12px 0",
    borderRadius: 10,
    border: "1px dashed #DADADA",
    background: "none",
    color: "#8A8A8A",
    fontSize: 12.5,
    cursor: "pointer",
  },

  // ---- 폴더 상세 ----
  folderDetailHeaderRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 18px 0" },
  folderBackLink: { display: "flex", alignItems: "center", gap: 2, fontSize: 12, color: "#3A3A3A", background: "none", border: "none", cursor: "pointer", padding: 0 },
  folderDetailTitle: { fontSize: 14.5, fontWeight: 700 },
  folderEditLink: { fontSize: 12, color: "#8A8A8A", background: "none", border: "none", cursor: "pointer", padding: 0 },
  folderDetailCount: { fontSize: 10.5, color: "#B0B0B0", margin: "8px 18px 4px" },
  folderDetailRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #F5F5F5", width: "100%", background: "none", border: "none", borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: "#F5F5F5", cursor: "pointer" },
  folderSelectCircle: { width: 20, height: 20, borderRadius: "50%", border: "1.5px solid #DADADA", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" },
  folderSelectCircleActive: { width: 20, height: 20, borderRadius: "50%", border: "none", background: "#1A1A1A", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" },
  folderDeleteFooter: { padding: "12px 18px 6px", borderTop: "1px solid #F0F0F0" },
  folderDetailThumb: { width: 42, height: 42, borderRadius: 8, background: "#EDECE6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  folderDetailItemName: { fontSize: 12.5, fontWeight: 600, margin: "0 0 2px" },
  folderDetailItemCategory: { fontSize: 10.5, color: "#8A8A8A", margin: 0 },
  folderDeleteBtn: { background: "none", border: "none", cursor: "pointer", padding: 4, flexShrink: 0 },

  emptyText: { textAlign: "center", color: "#B0B0B0", fontSize: 12.5, marginTop: 40 },
  collectionCard: { marginBottom: 20 },
  collectionHeader: { display: "flex", alignItems: "center", gap: 6, marginBottom: 8 },
  collectionName: { fontSize: 13.5, fontWeight: 700, flex: 1 },
  placeCard: { display: "flex", gap: 8, padding: "8px 0", borderBottom: "1px solid #F5F5F5" },
  placeThumb: { width: 52, height: 52, borderRadius: 8, background: "#2A2A28", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  placeInfo: { flex: 1, minWidth: 0 },
  placeNameSmall: { fontSize: 12.5, fontWeight: 600, margin: "0 0 2px" },
  placeStatus: { fontSize: 10.5, color: "#8A8A8A", margin: "0 0 2px" },
  placeAddress: { fontSize: 10.5, color: "#B0B0B0", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  placeRatingCol: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 },
  placeCode: { fontSize: 9.5, color: "#8A8A8A" },
  placeRating: { fontSize: 11, fontWeight: 600, color: "#1A1A1A", display: "flex", alignItems: "center", gap: 2 },
  moreBtn: { width: "100%", textAlign: "center", fontSize: 11.5, color: "#8A8A8A", background: "#FAFAF8", border: "1px solid #F0F0F0", borderRadius: 6, padding: "6px 0", cursor: "pointer", marginTop: 4 },
  sheetOverlay: { position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "flex-end", borderRadius: 12, zIndex: 20 },
  actionSheet: { width: "100%", background: "#FFFFFF", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: "10px 0 20px" },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, background: "#DADADA", margin: "0 auto 8px" },
  sheetActionBtn: { width: "100%", textAlign: "center", padding: "14px 0", fontSize: 14, fontWeight: 600, color: "#1A1A1A", background: "none", border: "none", borderTop: "1px solid #F0F0F0", cursor: "pointer" },
  confirmBox: { width: "100%", background: "#FFFFFF", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: "24px 20px 20px", boxSizing: "border-box" },
  confirmMessage: { fontSize: 14, fontWeight: 600, textAlign: "center", margin: "0 0 18px", color: "#1A1A1A" },
  confirmBtnRow: { display: "flex", gap: 8 },
  confirmCancelBtn: { flex: 1, height: 44, borderRadius: 10, border: "1px solid #DADADA", background: "#FFFFFF", color: "#3A3A3A", fontSize: 13.5, fontWeight: 600, cursor: "pointer" },
  confirmOkBtn: { flex: 1, height: 44, borderRadius: 10, border: "none", background: "#1A1A1A", color: "#FFFFFF", fontSize: 13.5, fontWeight: 600, cursor: "pointer" },
  editNameInput: { width: "100%", height: 42, padding: "0 12px", fontSize: 13, border: "1px solid #DADADA", borderRadius: 8, outline: "none", boxSizing: "border-box", marginBottom: 16 },
  toast: { position: "absolute", left: "50%", bottom: 90, transform: "translateX(-50%)", background: "rgba(26,26,26,0.92)", color: "#FFFFFF", padding: "10px 18px", borderRadius: 20, fontSize: 12.5, zIndex: 40, maxWidth: "85%", textAlign: "center" },
  reservationGroup: { marginBottom: 20 },
  reservationGroupToday: { marginBottom: 20, background: "#EFEBFB", borderRadius: 12, padding: 10 },
  reservationGroupCancelled: { marginBottom: 20, opacity: 0.5 },
  reservationHeaderRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  reservationLabel: { fontSize: 12.5, fontWeight: 700, color: "#1A1A1A" },
  cancelLink: { fontSize: 11.5, color: "#8A8A8A", textDecoration: "underline", background: "none", border: "none", cursor: "pointer" },
  cancelledText: { fontSize: 12, color: "#8A8A8A", textAlign: "center", padding: "16px 0" },
  reservationItem: { marginBottom: 8 },
  reservationTime: { fontSize: 11.5, fontWeight: 700, color: "#3A3A3A", display: "block", marginBottom: 4 },
  reservationFooter: { display: "flex", flexDirection: "column", gap: 8, padding: "10px 18px" },
  reserveButton: { width: "100%", height: 44, borderRadius: 10, border: "none", background: "#1A1A1A", color: "#FFFFFF", fontSize: 13.5, fontWeight: 600, cursor: "pointer" },
  moreInfoButton: { width: "100%", height: 44, borderRadius: 10, border: "1px solid #DADADA", background: "#FFFFFF", color: "#3A3A3A", fontSize: 13.5, fontWeight: 600, cursor: "pointer" },

  bottomTabBar: { display: "flex", borderTop: "1px solid #EDEDED", padding: "10px 0 6px" },
  bottomTabButton: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, background: "none", border: "none", cursor: "pointer" },
  bottomTabLabel: { fontSize: 10 },

  comingSoonBody: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: "0 30px" },
  comingSoonText: { fontSize: 14, fontWeight: 600, color: "#3A3A3A", margin: 0 },
  comingSoonSub: { fontSize: 12, color: "#B0B0B0", margin: 0, textAlign: "center" },

  // ---- 검색 결과 목록 ----
  activeFilterPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "5px 10px",
    fontSize: 11.5,
    fontWeight: 600,
    borderRadius: 14,
    background: "#1A1A1A",
    color: "#FFFFFF",
  },
  resultsCountText: { fontSize: 12, color: "#8A8A8A", margin: "10px 16px 8px" },
  resultCard: {
    display: "block",
    width: "100%",
    textAlign: "left",
    border: "1px solid #EDEDED",
    borderRadius: 12,
    background: "#FFFFFF",
    padding: 0,
    marginBottom: 14,
    cursor: "pointer",
    overflow: "hidden",
  },
  resultCardImage: {
    position: "relative",
    width: "100%",
    height: 130,
    background: "#F0EFEA",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  resultCardBadgeRow: { position: "absolute", top: 8, left: 8, right: 8, display: "flex", justifyContent: "space-between" },
  resultCardRatingBadge: {
    fontSize: 10,
    fontWeight: 600,
    background: "rgba(255,255,255,0.92)",
    padding: "3px 8px",
    borderRadius: 12,
    color: "#1A1A1A",
  },
  resultCardBookmark: {
    width: 24,
    height: 24,
    borderRadius: "50%",
    background: "rgba(0,0,0,0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  resultCardTag: { fontSize: 10, color: "#3A3A3A", background: "#F5F4F0", padding: "3px 8px", borderRadius: 10 },
  resultCardMenuLabel: { fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, color: "#B0B0B0", margin: "0 0 4px" },
  resultCardMenuRow: { display: "flex", justifyContent: "space-between", padding: "2px 0" },

  // ---- 식당 상세 페이지 ----
  detailImageBox: {
    position: "relative",
    width: "100%",
    height: 200,
    background: "#F0EFEA",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  detailImageCounter: {
    position: "absolute",
    right: 10,
    bottom: 10,
    fontSize: 10.5,
    color: "#FFFFFF",
    background: "rgba(0,0,0,0.5)",
    padding: "2px 8px",
    borderRadius: 10,
  },
  aiAnalyzedBadge: {
    position: "absolute",
    left: 10,
    top: 10,
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: 10.5,
    fontWeight: 700,
    color: "#FFFFFF",
    background: "rgba(239,159,39,0.92)",
    padding: "4px 9px",
    borderRadius: 12,
  },
  aiBadgeRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11.5,
    color: "#B8791A",
    background: "#FFF7EC",
    border: "1px solid #F5DFB8",
    borderRadius: 8,
    padding: "8px 10px",
    marginBottom: 10,
  },
  detailMetaRow: { fontSize: 11.5, color: "#8A8A8A", display: "flex", alignItems: "center", gap: 5, margin: "5px 0" },
  detailActionRow: { display: "flex", gap: 8, marginTop: 14 },
  detailActionBtn: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    padding: "10px 0",
    borderRadius: 8,
    border: "1px solid #EDEDED",
    background: "#FAFAF8",
    color: "#3A3A3A",
    fontSize: 10.5,
    cursor: "pointer",
  },
  detailSectionTitle: { fontSize: 13, fontWeight: 700, margin: "20px 0 10px" },
  detailMenuCard: { display: "flex", gap: 10, marginBottom: 12 },
  detailMenuThumb: {
    width: 56,
    height: 56,
    flexShrink: 0,
    borderRadius: 8,
    background: "#F0EFEA",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  detailMoreReviewBtn: {
    width: "100%",
    textAlign: "center",
    padding: "10px 0",
    fontSize: 12,
    color: "#3A3A3A",
    background: "#FAFAF8",
    border: "1px solid #EDEDED",
    borderRadius: 8,
    cursor: "pointer",
    marginBottom: 20,
  },
  detailFooter: { display: "flex", gap: 8, padding: "12px 20px", borderTop: "1px solid #F0F0F0" },
  detailSaveBtn: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 46,
    borderRadius: 10,
    border: "1px solid #DADADA",
    background: "#FFFFFF",
    color: "#3A3A3A",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  detailReserveBtn: {
    flex: 2,
    height: 46,
    borderRadius: 10,
    border: "none",
    background: "#1A1A1A",
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },

  // ---- 저장하기 / 예약하기 시트 공통 ----
  sheetTitle: { fontSize: 14.5, fontWeight: 700, textAlign: "center", margin: "4px 0 14px" },
  sheetCloseBtn: { background: "none", border: "none", color: "#8A8A8A", cursor: "pointer", padding: 4 },

  collectionRadioRow: {
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "13px 0",
    borderBottom: "1px solid #F5F5F5",
    background: "none",
    border: "none",
    cursor: "pointer",
  },
  radioCircle: { width: 18, height: 18, borderRadius: "50%", border: "1.5px solid #DADADA", display: "inline-block" },
  radioCircleActive: { border: "5px solid #1A1A1A" },
  addCollectionBtn: {
    width: "100%",
    marginTop: 10,
    height: 40,
    borderRadius: 8,
    border: "1px dashed #DADADA",
    background: "none",
    color: "#8A8A8A",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  reservationSheetHeaderRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px" },
  reservationFieldLabel: { fontSize: 12.5, fontWeight: 700, margin: "0 0 8px" },
  guestCountRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    border: "1px solid #EDEDED",
    borderRadius: 8,
    background: "#FAFAF8",
  },
  stepperBtn: {
    width: 22,
    height: 22,
    borderRadius: "50%",
    border: "1px solid #DADADA",
    background: "#FFFFFF",
    color: "#3A3A3A",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  calendarGrid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginTop: 8 },
  calendarDayLabel: { fontSize: 10, color: "#B0B0B0", textAlign: "center", padding: "2px 0" },
  calendarDate: {
    aspectRatio: "1",
    fontSize: 11.5,
    border: "none",
    borderRadius: 6,
    background: "none",
    color: "#3A3A3A",
    cursor: "pointer",
  },
  calendarDateActive: {
    aspectRatio: "1",
    fontSize: 11.5,
    border: "none",
    borderRadius: 6,
    background: "#1A1A1A",
    color: "#FFFFFF",
    cursor: "pointer",
    fontWeight: 700,
  },
  timeSlotGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: 8 },
  timeSlot: {
    padding: "8px 0",
    fontSize: 11.5,
    borderRadius: 6,
    border: "1px solid #EDEDED",
    background: "#FFFFFF",
    color: "#3A3A3A",
    cursor: "pointer",
  },
  timeSlotActive: {
    padding: "8px 0",
    fontSize: 11.5,
    borderRadius: 6,
    border: "1px solid #1A1A1A",
    background: "#1A1A1A",
    color: "#FFFFFF",
    cursor: "pointer",
    fontWeight: 600,
  },
  reservationNoticeBox: {
    display: "flex",
    gap: 8,
    padding: "10px 12px",
    marginTop: 16,
    borderRadius: 8,
    background: "#FAFAF8",
  },
  reservationNoticeText: { fontSize: 10.5, color: "#8A8A8A", lineHeight: 1.5, margin: 0 },
  reservationCompleteBtn: {
    width: "100%",
    height: 48,
    borderRadius: 10,
    border: "none",
    background: "#1A1A1A",
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },

  // ---- 예약 확인 ----
  confirmCheckCircle: {
    width: 76,
    height: 76,
    borderRadius: "50%",
    background: "#1A1A1A",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  confirmTitleText: { fontSize: 17, fontWeight: 700, margin: "0 0 6px" },
  confirmSubtitleText: { fontSize: 12.5, color: "#8A8A8A", margin: "0 0 24px" },
  findResultBody: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 24px 24px",
    textAlign: "center",
    gap: 6,
  },
  findIdResultValue: { fontSize: 20, fontWeight: 700, color: "#1A1A1A", margin: "4px 0 28px" },
  confirmCard: {
    width: "100%",
    border: "1px solid #EDEDED",
    borderRadius: 12,
    padding: 16,
    textAlign: "left",
    marginBottom: 12,
  },
  confirmBadge: { fontSize: 10.5, fontWeight: 700, color: "#1D9E75", background: "#E1F5EE", padding: "3px 9px", borderRadius: 10 },
  confirmInfoRow: { display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12 },
  confirmMapCard: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 8,
    border: "1px solid #EDEDED",
    borderRadius: 12,
    padding: "14px 16px",
  },
  confirmMapBtn: {
    width: "100%",
    height: 46,
    borderRadius: 10,
    border: "none",
    background: "#1A1A1A",
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  confirmListBtn: {
    width: "100%",
    height: 46,
    borderRadius: 10,
    border: "1px solid #DADADA",
    background: "#FFFFFF",
    color: "#3A3A3A",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
};
