// api/search-places.js
//
// 카카오 로컬 API(키워드 장소 검색)를 대신 호출해주는 서버 함수입니다.
// 카카오 REST API 키는 브라우저에서 직접 쓰면 CORS에 막히기도 하고, 키가
// 노출되기도 해서 반드시 이 서버 함수를 거쳐야 합니다.
//
// 중요: KAKAO_REST_API_KEY는 여기(서버)에서만 씁니다. 절대 프론트엔드 코드에 넣지 마세요.
// (카카오맵 지도를 띄우는 JavaScript 키와는 다른 키입니다 — REST API 키를 쓰세요.)
// Vercel 배포 시 Project Settings > Environment Variables 에 KAKAO_REST_API_KEY를 등록하세요.

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "GET 요청만 지원해요." });
  }

  if (!process.env.KAKAO_REST_API_KEY) {
    return res.status(500).json({ error: "서버에 KAKAO_REST_API_KEY가 설정되어 있지 않아요." });
  }

  const { query, page = "1", size = "15" } = req.query;
  if (!query) {
    return res.status(400).json({ error: "query 파라미터가 필요해요. 예: ?query=강남구 맛집" });
  }

  try {
    const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
    url.searchParams.set("query", query);
    url.searchParams.set("page", page);
    url.searchParams.set("size", size);
    url.searchParams.set("category_group_code", "FD6"); // 음식점 카테고리로 한정 (CE7=카페도 원하면 별도 호출)

    const response = await fetch(url, {
      headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("카카오 로컬 API 에러:", errText);
      return res.status(502).json({ error: "카카오 로컬 API 호출에 실패했어요." });
    }

    const data = await response.json();

    // 우리 앱 데이터 형식(place 스키마)에 맞게 변환
    const places = data.documents.map((doc, i) => ({
      id: doc.id,
      name: doc.place_name,
      displayName: doc.place_name,
      category: guessCategory(doc.category_name),
      rating: null, // 카카오 로컬 API는 평점을 안 줌 (카카오맵 자체 크롤링/제휴 없이는 못 가져옴)
      address: doc.road_address_name || doc.address_name,
      district: extractDistrict(doc.address_name),
      lat: parseFloat(doc.y),
      lng: parseFloat(doc.x),
      phone: doc.phone || "",
      placeUrl: doc.place_url,
      distance: doc.distance ? `${(doc.distance / 1000).toFixed(1)}km` : "",
    }));

    return res.status(200).json({ places, total: data.meta.total_count });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "장소 검색 중 오류가 발생했어요." });
  }
}

function guessCategory(categoryName) {
  if (!categoryName) return "기타";
  if (categoryName.includes("한식")) return "한식";
  if (categoryName.includes("중식") || categoryName.includes("중국")) return "중식";
  if (categoryName.includes("일식") || categoryName.includes("돈까스") || categoryName.includes("초밥")) return "일식";
  if (categoryName.includes("양식") || categoryName.includes("이탈리") || categoryName.includes("스테이크")) return "양식";
  if (categoryName.includes("카페") || categoryName.includes("커피") || categoryName.includes("디저트")) return "카페";
  if (categoryName.includes("술집") || categoryName.includes("호프") || categoryName.includes("포차")) return "술집";
  if (categoryName.includes("베이커리") || categoryName.includes("빵")) return "베이커리";
  if (categoryName.includes("멕시") || categoryName.includes("타코")) return "멕시칸";
  if (categoryName.includes("태국") || categoryName.includes("팟타이")) return "태국음식";
  if (categoryName.includes("분식") || categoryName.includes("떡볶이")) return "분식";
  return "기타";
}

function extractDistrict(addressName) {
  // "서울 강남구 역삼동 ..." 같은 주소에서 "구" 단위만 뽑아냄
  const match = addressName?.match(/([가-힣]+구)/);
  return match ? match[1] : "";
}
