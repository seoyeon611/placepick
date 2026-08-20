// 실제 DB(Firestore) + 실제 장소 데이터(카카오 로컬 API) 연동 지점.
//
// 흐름:
//   1) fetchAllPlaces() 호출
//   2) Firestore에 이미 저장된 데이터가 있으면 그걸 반환 (빠름, 우리가 관리하는 데이터)
//   3) 없으면 카카오 로컬 API(api/search-places.js 서버 함수)로 실제 식당을 검색해서 반환
//   4) seedPlacesFromKakao()를 실행하면, 여러 지역/카테고리로 실제 데이터를 모아서
//      Firestore에 저장 — 이후부터는 2번 경로(Firestore)로 빠르게 응답

import { getDb, isConfigured } from "./firebase.js";

const SEOUL_DISTRICTS = [
  "강남구", "강동구", "강북구", "강서구", "관악구", "광진구", "구로구", "금천구", "노원구", "도봉구",
  "동대문구", "동작구", "마포구", "서대문구", "서초구", "성동구", "성북구", "송파구", "양천구", "영등포구",
  "용산구", "은평구", "종로구", "중구", "중랑구",
];
const CATEGORY_KEYWORDS = ["한식", "중식", "일식", "양식", "카페", "술집", "베이커리", "멕시칸", "태국음식", "분식"];

// 실 서비스에 없는 값(평점/가격/리뷰수/태그/분위기 등)은 카카오 로컬 API가 주지 않으므로,
// 임의로 생성해서 채워넣습니다. 실제로는 자체 리뷰/평점 시스템에서 채워야 하는 값이에요.
const TAG_POOL_SETS = [
  ["혼밥 가능", "와이파이", "주차 가능"],
  ["단체석", "와이파이", "콘센트"],
  ["혼밥 가능", "24시간 운영", "주차 가능"],
  ["반려동물 동반", "와이파이"],
  ["비건", "혼밥 가능", "콘센트"],
  ["단체석", "주차 가능", "오늘 휴무 제외"],
  ["혼밥 가능", "24시간 운영"],
  ["와이파이", "콘센트", "비건"],
];
const MOOD_CYCLE = ["로컬", "캐주얼", "모던", "감성", "럭셔리"];

function enrichPlace(place, idx) {
  const rating = Math.round((3.0 + ((idx * 37) % 20) / 10) * 10) / 10;
  const price = 8000 + ((idx * 5300) % 55000);
  return {
    ...place,
    rating: place.rating ?? rating,
    openNow: idx % 4 !== 3, // 카카오 로컬 API는 실시간 영업 여부를 안 줘서 데모용으로 다양하게 섞음 (4곳 중 3곳은 영업중)
    priceLevel: price < 15000 ? "$" : price < 35000 ? "$$" : "$$$",
    price,
    reviewCount: (idx * 47) % 500,
    mood: MOOD_CYCLE[idx % MOOD_CYCLE.length],
    saves: `${(0.3 + (idx % 6) * 0.4).toFixed(1)}k`,
    tags: TAG_POOL_SETS[idx % TAG_POOL_SETS.length],
    signatureMenu: [
      { name: "대표 메뉴 1", price: `${(price + 3000).toLocaleString()}원` },
      { name: "대표 메뉴 2", price: `${Math.max(price - 5000, 5000).toLocaleString()}원` },
    ],
  };
}

// 카카오 로컬 API로 실제 장소를 검색 (서버 함수 경유)
async function searchPlacesFromKakao(query, size = 15) {
  const res = await fetch(`/api/search-places?query=${encodeURIComponent(query)}&size=${size}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "장소 검색에 실패했어요.");
  }
  const data = await res.json();
  return data.places;
}

// ---- 실제 데이터 가져오기 ----
export async function fetchAllPlaces() {
  // 1) Firestore에 이미 데이터가 있으면 그걸 사용 (빠르고, 우리가 관리하는 데이터)
  if (isConfigured) {
    const db = await getDb();
    if (db) {
      const { collection, getDocs } = await import("firebase/firestore");
      const snapshot = await getDocs(collection(db, "places"));
      if (!snapshot.empty) {
        return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      }
    }
  }

  // 2) Firestore가 비어있거나 미설정 상태면, 카카오 로컬 API로 실제 데이터를 바로 가져와서 보여줌
  try {
    const raw = await searchPlacesFromKakao("서울 맛집", 15);
    return raw.map((p, i) => enrichPlace(p, i));
  } catch (err) {
    console.error("카카오 로컬 API 호출 실패:", err);
    return [];
  }
}

// ---- 여러 지역/카테고리로 실제 데이터를 모아서 Firestore에 저장 ----
// 브라우저 콘솔에서: seedPlacesFromKakao()
export async function seedPlacesFromKakao() {
  if (!isConfigured) {
    console.warn("Firebase가 설정되어 있지 않아요. src/firebase.js에 먼저 실제 설정값을 넣어주세요.");
    return;
  }
  const db = await getDb();
  if (!db) {
    console.warn("Firebase가 설정되어 있지 않아요. src/firebase.js에 먼저 실제 설정값을 넣어주세요.");
    return;
  }

  const { collection, doc, setDoc } = await import("firebase/firestore");

  let idx = 0;
  let savedCount = 0;
  // 대표 지역 8곳 x 카테고리 5개 정도로 순회하며 실제 데이터를 모음 (쿼터 아끼려고 전체 25구 x 10종은 안 돌림)
  const sampleDistricts = SEOUL_DISTRICTS.slice(0, 8);
  const sampleCategories = CATEGORY_KEYWORDS.slice(0, 5);

  for (const district of sampleDistricts) {
    for (const category of sampleCategories) {
      try {
        const results = await searchPlacesFromKakao(`서울 ${district} ${category}`, 3);
        for (const place of results) {
          const enriched = enrichPlace({ ...place, category }, idx);
          const { id, ...data } = enriched;
          await setDoc(doc(collection(db, "places"), id), data);
          savedCount += 1;
          idx += 1;
        }
      } catch (err) {
        console.warn(`"${district} ${category}" 검색 실패:`, err.message);
      }
    }
  }
  console.log(`카카오 로컬 API로 실제 장소 ${savedCount}곳을 Firestore에 저장했어요.`);
}

// ---- 식당 이름으로 직접 검색 (업로드 화면의 "식당 검색") ----
export async function searchPlacesByName(query) {
  const raw = await searchPlacesFromKakao(query, 10);
  return raw.map((p, i) => enrichPlace(p, i));
}

if (typeof window !== "undefined") {
  window.seedPlacesFromKakao = seedPlacesFromKakao;
}

// ---- 사용자가 업로드해서 등록한 장소를 실제 DB에 저장 ----
// (업로드 화면 → AI 분석 → "저장" 눌렀을 때 호출됨)
export async function addUserPlace(extractedData) {
  const idx = Math.floor(Math.random() * 1000);
  const place = enrichPlace(
    {
      id: `user-${Date.now()}-${idx}`,
      name: extractedData.name,
      displayName: extractedData.name,
      category: extractedData.category,
      address: extractedData.address,
      hours: extractedData.hours,
      district: extractDistrictFromAddress(extractedData.address),
      priceRaw: extractedData.price,
      addedByUser: true,
    },
    idx
  );

  if (!isConfigured) {
    console.warn("Firebase가 설정되어 있지 않아서, 이 장소는 실제 DB에는 저장되지 않고 화면에만 반영돼요.");
    return place;
  }
  const db = await getDb();
  if (!db) {
    console.warn("Firebase가 설정되어 있지 않아서, 이 장소는 실제 DB에는 저장되지 않고 화면에만 반영돼요.");
    return place;
  }

  const { collection, doc, setDoc } = await import("firebase/firestore");
  const { id, ...data } = place;
  await setDoc(doc(collection(db, "places"), id), data);
  return place;
}

function extractDistrictFromAddress(address) {
  if (!address) return "";
  const parts = address.trim().split(/\s+/);
  return parts[1] || "";
}
