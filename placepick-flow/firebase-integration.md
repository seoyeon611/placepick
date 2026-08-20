# 플레이스픽 — 실제 데이터(카카오 로컬 API) + DB(Firestore) 연동 가이드

이제 mock 데이터는 다 지웠고, **카카오 로컬 API로 실제 존재하는 식당**을 가져와서
필터링하도록 바뀌었습니다. 평점/필터 계산 로직은 그대로고, 걸러내는 대상만
진짜 데이터로 바뀐 거예요.

## 지금 상태

- `src/placesService.js` — mock 배열 삭제됨. 대신:
  - Firestore에 데이터가 있으면 그걸 사용
  - 없으면 그 자리에서 카카오 로컬 API로 실제 검색해서 보여줌
- `api/search-places.js` — 카카오 로컬 API(키워드 장소 검색)를 대신 호출해주는 서버 함수
- `seedPlacesFromKakao()` — 여러 지역×카테고리로 실제 식당을 모아서 Firestore에 저장해두는 함수 (한 번 실행해두면 이후엔 빠르게 불러옴)

## ⚠️ 먼저 아셔야 할 것: 로컬(`npm run dev`)에서는 안 보일 수 있어요

`api/` 폴더의 서버 함수는 일반 `npm run dev`(Vite)로는 실행되지 않아요. 실제로
카카오 검색 결과가 뜨는지 테스트하려면 아래 둘 중 하나가 필요해요.

- **배포해서 확인** (제일 확실함): `npx vercel --prod`
- **로컬에서 서버 함수까지 같이 테스트**: `vercel dev` (아래 3번 참고)

`npm run dev`만 켜둔 상태에서는 카카오 검색이 실패해서 결과가 0개로 보일 수 있는데,
이건 정상이에요 — 배포하거나 `vercel dev`로 켜면 됩니다.

## 1) 카카오 REST API 키 준비

**주의**: 지도에 쓰는 **JavaScript 키**랑 다른 키예요. 이번엔 **REST API 키**가 필요해요.

1. [카카오 디벨로퍼스](https://developers.kakao.com) → 내 애플리케이션 → 만드신 앱
2. 왼쪽 메뉴 "플랫폼 키" → **"REST API 키"** 복사 (JavaScript 키 말고!)
3. 왼쪽 메뉴에서 카카오맵 관련 제품이 켜져 있는지 확인 (지도 연동 때 이미 켜두셨을 거예요)

## 2) Vercel에 환경변수 등록

```bash
cd placepick-flow
npx vercel --prod
```

배포 후 Vercel 대시보드 → 프로젝트 → **Settings** → **Environment Variables**:

| Key | Value |
|---|---|
| `KAKAO_REST_API_KEY` | 방금 복사한 REST API 키 |
| `OPENAI_API_KEY` | (AI 사진분석 기능용, 이미 등록하셨다면 그대로) |

등록 후 **Deployments** 탭에서 최신 배포 "Redeploy".

## 3) 로컬에서도 테스트하고 싶으면 (선택)

```bash
npm install -g vercel   # 처음 한 번만
vercel dev
```

`.env.local` 파일 만들어서:
```
KAKAO_REST_API_KEY=발급받은_REST_API_키
OPENAI_API_KEY=발급받은_OPENAI_키
```
(`.gitignore`에 이미 포함되어 있어 깃허브에는 안 올라가요.)

## 4) 실제 데이터 미리 모아두기 (한 번 실행하면 이후 빨라짐)

배포된 사이트(또는 `vercel dev`)에 접속 → 개발자도구(F12) → Console 탭에서:

```js
seedPlacesFromKakao()
```

서울 8개 구 × 5개 카테고리로 실제 식당을 검색해서 Firestore에 저장해요 (완료까지
몇 초~수십 초 걸릴 수 있어요, 콘솔에 진행 로그가 찍혀요). 끝나면:

```
카카오 로컬 API로 실제 장소 OO곳을 Firestore에 저장했어요.
```

이후부터는 앱이 Firestore에 저장된 이 데이터를 빠르게 불러와서 씁니다.

## 카카오 로컬 API가 주지 않는 정보

카카오 로컬 API는 이름/주소/좌표/전화번호/카테고리만 줘요. **평점, 가격, 리뷰 수,
분위기, 태그, 실시간 영업 여부** 같은 값은 카카오가 안 주기 때문에, 지금은
`placesService.js`에서 임의로 채워넣고 있어요 (`enrichPlace` 함수). 실제 서비스라면:
- 평점/리뷰: 우리 앱 자체 리뷰 기능에서 쌓인 데이터로 대체
- 영업 여부: 사장님이 직접 등록하거나, 별도 영업시간 정보 연동
- 태그/분위기: 사장님 등록 또는 사용자 리뷰 기반 태깅

## 체크리스트

- [ ] 카카오 REST API 키 발급 (JavaScript 키와 다른 키!)
- [ ] Vercel 환경변수에 `KAKAO_REST_API_KEY` 등록 + Redeploy
- [ ] 배포된 사이트에서 `seedPlacesFromKakao()` 한 번 실행
- [ ] 홈 화면 필터가 실제 식당 이름/주소로 나오는지 확인
- [ ] (선택) 평점/리뷰/태그 등은 나중에 실제 리뷰 시스템과 연결하기
