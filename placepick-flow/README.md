# 플레이스픽 (PlacePick)

맛집 추천/저장/예약 웹앱.

## 실행 방법

```bash
npm install
npm run dev
```

터미널에 뜨는 주소(예: `http://localhost:5173`)를 브라우저로 열면 됩니다.

## 폴더 구조

```
src/
  PlacePickApp.jsx   ← 앱 전체 (스플래시/로그인/회원가입/홈/업로드/저장·예약/설정 등 전부 이 파일 안에 있음)
  firebase.js        ← Firestore 초기화 설정 (실제 프로젝트 키 입력 필요)
  placesService.js   ← 실제 DB(Firestore) + 카카오 로컬 API 연동
  main.jsx           ← 진입점

api/
  analyze-place-image.js  ← 업로드 사진 AI 분석 (OpenAI Vision, 서버 함수)
  search-places.js        ← 실제 식당 검색 (카카오 로컬 API, 서버 함수)

index.html            ← 카카오맵 SDK 스크립트 포함
```

## 주요 기능

- **인증**: 스플래시 → 로그인 → 회원가입(약관/아이디/비밀번호/휴대폰 인증) → 아이디·비밀번호 찾기
- **홈**: 카카오맵 지도 + 지역 선택(서울/경기/인천) + 필터(평점/음식종류/가격/리뷰/분위기/더보기) → 검색 결과 → 식당 상세 → 저장/예약
- **업로드**: 사진 선택 → AI 분석(OpenAI Vision) → 정보 확인 → 저장(DB 반영)
- **저장/예약**: 폴더별 저장 목록(그리드/리스트, 편집·다중삭제) ↔ 예약 목록(취소, 새 예약)
- **설정**: 내 정보 수정, 예약 연동, 내 리뷰, 개선 제안, 문의하기, 공지사항

## 실제로 동작시키려면 (배포 전 체크리스트)

지금 코드는 아래 세 가지 키 없이도 mock 데이터로 정상 동작합니다. 실제 서비스로 켜려면:

1. **카카오맵** — `index.html`의 SDK 스크립트에 JavaScript 키 입력 + 카카오 디벨로퍼스에 배포 도메인 등록 (`kakao-map-integration.md`)
2. **카카오 로컬 API(실제 식당 검색)** — `KAKAO_REST_API_KEY` 환경변수 등록 (`firebase-integration.md`)
3. **업로드 사진 AI 분석** — `OPENAI_API_KEY` 환경변수 등록 (`ai-ocr-integration.md`)
4. **Firestore(DB)** — `src/firebase.js`에 실제 프로젝트 설정값 입력 (`firebase-integration.md`)

## 배포

```bash
npx vercel --prod
```

Vercel 대시보드 → Settings → Environment Variables에 `OPENAI_API_KEY`, `KAKAO_REST_API_KEY` 등록 후 Redeploy.

## 참고 문서

- `firebase-integration.md` — Firestore + 카카오 로컬 API로 실제 식당 데이터 연동
- `kakao-map-integration.md` — 카카오맵 지도 연동
- `ai-ocr-integration.md` — 업로드 사진 AI 분석 연동
