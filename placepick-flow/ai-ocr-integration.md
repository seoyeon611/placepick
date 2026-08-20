# 플레이스픽 — 업로드 사진 AI 분석 연동 가이드 (OpenAI 기준)

업로드 화면에서 고른 식당 캡처 사진을 AI가 읽어서 이름/카테고리/가격대/주소/영업시간을
자동으로 채워주는 기능입니다. **이미 코드로 다 만들어져 있고, 아래 2단계만 하면 실제로 동작해요.**

## 지금 상태

- `src/PlacePickApp.jsx`의 `extractPlaceInfo()` — 실제 API를 호출하도록 이미 구현됨
- `api/analyze-place-image.js` — OpenAI Vision(gpt-4o-mini)을 호출하는 서버 함수, 이미 작성됨
- 로컬에서 `npm run dev`로만 돌리면 이 서버 함수가 안 떠서 자동으로 mock 데이터로 대체됩니다
  (화면 흐름 테스트는 계속 가능). **진짜로 AI가 분석하게 하려면 Vercel에 배포해야 해요.**

## 왜 서버를 거쳐야 하나요

OpenAI API 키를 프론트엔드 코드에 그대로 넣으면 사이트 방문자 누구나 개발자도구로
키를 볼 수 있고, 그 키로 무제한 호출해서 요금이 청구될 수 있어요. 그래서 브라우저는
우리 서버(`api/analyze-place-image.js`)에만 사진을 보내고, 그 서버가 OpenAI에
키를 붙여서 대신 요청합니다.

```
[브라우저] --사진--> [api/analyze-place-image.js] --사진+키--> [OpenAI]
[브라우저] <--결과--- [api/analyze-place-image.js] <--결과----- [OpenAI]
```

## 실제로 동작하게 만드는 방법 (2단계)

### 1) OpenAI API 키 준비
[platform.openai.com/api-keys](https://platform.openai.com/api-keys)에서 키 발급.
(이미 발급받으신 키가 있다면, 혹시 어딘가에 노출된 적 있으면 재발급 받아서 쓰세요.)

### 2) Vercel에 배포하면서 환경변수 등록
```bash
cd placepick-flow
npx vercel --prod
```
배포 과정 중, 또는 배포 후 Vercel 대시보드에서:
1. 프로젝트 선택 → **Settings** → **Environment Variables**
2. Key: `OPENAI_API_KEY`, Value: 방금 발급받은 키 → **Save**
3. 변경사항을 반영하려면 **Deployments** 탭에서 최신 배포를 다시 "Redeploy"

이게 끝이에요. 배포된 주소로 접속해서 업로드 → 사진 선택 → 업로드하면
`api/analyze-place-image.js`가 실제로 OpenAI에 사진을 보내서 이름/카테고리/주소 등을
분석해 옵니다.

## 로컬에서도 진짜 테스트하고 싶다면

Vite의 `npm run dev`는 `api/` 폴더의 서버 함수를 실행하지 못해요. 로컬에서도 실제
AI 분석을 테스트하려면 Vercel CLI로 로컬 서버를 띄우세요.

```bash
npm install -g vercel   # 처음 한 번만
vercel dev
```
그리고 로컬에도 `.env.local` 파일을 만들어 키를 넣으세요 (이 파일은 `.gitignore`에 이미 포함되어 있어 깃허브에는 안 올라갑니다).
```
OPENAI_API_KEY=발급받은_키
```

## 확인 방법

- 정상 동작: 업로드 후 "정보가 맞는지 확인해주세요!" 화면에 실제 사진 내용과 맞는 이름/주소가 채워짐
- 실패 시: 브라우저 콘솔(F12)에 `이미지 분석 API 호출 실패` 로그가 뜨고, 화면에는 mock 데이터(도담 레스토랑 등)가 대신 표시됨 — 이 경우 Vercel 환경변수 등록/배포가 제대로 됐는지 확인

## 비용 관련 참고

- `gpt-4o-mini`는 이미지 분석 중 비교적 저렴한 모델이에요. 사진 여러 장을 동시에 업로드하면
  그만큼 호출이 여러 번 일어나니, 실제 서비스에서는 한 번에 올릴 수 있는 사진 개수를
  제한하는 걸 추천해요 (`UploadInitScreen`에서 `photos.length` 체크 추가하면 됩니다).
