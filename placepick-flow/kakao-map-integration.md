# 플레이스픽 — 지도(카카오맵) + 데이터베이스 연동 가이드

지금 앱 안의 `MapPlaceholder`, "지도 영역 (Map Area)" 부분을 실제 지도로 바꾸는 방법입니다.
지도에 찍을 맛집 데이터는 `firebase-integration.md`에서 다룬 Firestore의 `places` 컬렉션을 그대로 씁니다.

왜 카카오맵이냐면: 한국 주소/건물 검색 정확도가 제일 좋고, 무료 티어로 웹 서비스에 바로 쓸 수 있어서예요.
네이버맵이나 구글맵을 쓰고 싶으면 2번 단계의 스크립트 태그와 API 호출부만 해당 SDK 문법으로 바꾸면 됩니다.

---

## 1. 카카오 API 키 발급

1. [Kakao Developers](https://developers.kakao.com) 가입 → 애플리케이션 추가
2. "플랫폼" 설정에서 웹 플랫폼 등록 (사이트 도메인 입력, 로컬 테스트는 `http://localhost:5173`)
3. "앱 키" 탭에서 **JavaScript 키** 복사 (REST API 키가 아니라 JavaScript 키입니다)

---

## 2. SDK 로드

`index.html`의 `<head>`에 추가합니다.

```html
<script src="//dapi.kakao.com/v2/maps/sdk.js?appkey=발급받은_JS_키&libraries=services"></script>
```

`libraries=services`는 주소 검색, 좌표 변환 등에 필요합니다.

---

## 3. MapPlaceholder를 실제 지도 컴포넌트로 교체

`MapPlaceSearchFlow.jsx`의 `MapPlaceholder` 함수를 아래로 교체합니다.

```jsx
import React, { useEffect, useRef } from "react";

function KakaoMap({ places, onMarkerClick, center }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);

  useEffect(() => {
    if (!window.kakao || !window.kakao.maps) return;

    window.kakao.maps.load(() => {
      const map = new window.kakao.maps.Map(mapRef.current, {
        center: new window.kakao.maps.LatLng(center?.lat || 37.5665, center?.lng || 126.978),
        level: 4,
      });
      mapInstance.current = map;

      places.forEach((place) => {
        const marker = new window.kakao.maps.Marker({
          position: new window.kakao.maps.LatLng(place.lat, place.lng),
          map,
        });
        window.kakao.maps.event.addListener(marker, "click", () => onMarkerClick(place));
      });
    });
  }, [places, center]);

  return <div ref={mapRef} style={{ width: "100%", height: "100%" }} />;
}
```

기존 호출부(`<MapPlaceholder />`)를 `<KakaoMap places={places} onMarkerClick={handleSelectPlace} center={myLocation} />`로 바꾸면 됩니다.

---

## 4. Firestore에서 가져온 장소를 지도에 뿌리기

`firebase-integration.md`의 `useCollectionsFromFirestore` 패턴과 동일합니다.

```js
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";

function usePlacesFromFirestore() {
  const [places, setPlaces] = useState([]);
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "places"), (snapshot) => {
      setPlaces(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsubscribe;
  }, []);
  return places;
}
```

`places` 문서에는 반드시 `lat`, `lng` (숫자, 위도/경도)가 있어야 지도에 마커를 찍을 수 있습니다.
place 등록/업로드 화면(`UploadFlow.jsx`)에서 저장할 때 좌표도 같이 저장해야 하는데,
사용자가 직접 좌표를 입력하진 않으니 보통 주소 → 좌표 변환(지오코딩)을 씁니다:

```js
function addressToCoords(address) {
  return new Promise((resolve, reject) => {
    const geocoder = new window.kakao.maps.services.Geocoder();
    geocoder.addressSearch(address, (result, status) => {
      if (status === window.kakao.maps.services.Status.OK) {
        resolve({ lat: parseFloat(result[0].y), lng: parseFloat(result[0].x) });
      } else {
        reject(new Error("주소를 좌표로 변환하지 못했어요."));
      }
    });
  });
}
```

업로드 완료 시(`savePlaces`) 주소 입력값으로 이 함수를 호출해서 좌표를 같이 저장하면 됩니다.

---

## 5. 내 위치(현재 위치) 가져오기

검색 화면의 "내 위치" 버튼(`ti-current-location`)에 연결합니다.

```js
function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("이 브라우저는 위치 정보를 지원하지 않아요."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error("위치 권한을 허용해주세요."))
    );
  });
}
```

---

## 6. 체크리스트

- [ ] 카카오 디벨로퍼스에서 JS 키 발급, 웹 플랫폼 도메인 등록
- [ ] `index.html`에 SDK 스크립트 태그 추가
- [ ] `MapPlaceholder` → `KakaoMap` 컴포넌트로 교체
- [ ] Firestore `places` 컬렉션에 `lat`/`lng` 필드 포함해서 저장
- [ ] 업로드 화면에서 주소 입력 시 지오코딩으로 좌표 자동 저장
- [ ] "내 위치" 버튼에 `getCurrentLocation()` 연결

카카오맵은 도메인 등록이 안 되어 있으면 지도가 안 뜨고 콘솔에 에러만 찍혀요.
로컬 개발 중이면 `http://localhost:5173`을, 배포 후에는 실제 배포 도메인을 카카오 디벨로퍼스에 꼭 추가하세요.
