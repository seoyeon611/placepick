// Firebase 초기화 설정
//
// 1) https://console.firebase.google.com 에서 프로젝트 생성
// 2) 왼쪽 메뉴 "빌드" > "Firestore Database" > "데이터베이스 만들기" (테스트 모드로 시작해도 됨)
// 3) 프로젝트 설정(톱니바퀴 아이콘) > "일반" 탭 > 아래로 스크롤 > "웹 앱 추가"(</> 아이콘)
// 4) 나오는 firebaseConfig 값을 아래에 그대로 붙여넣기
//
// 자세한 단계별 가이드는 firebase-integration.md 참고

const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

// 설정을 아직 안 채워넣었으면(YOUR_로 시작하면) Firebase를 초기화하지 않고
// null을 내보내서, 앱이 자동으로 mock 데이터로 계속 동작하게 합니다.
const isConfigured = !firebaseConfig.apiKey.startsWith("YOUR_");

let app = null;
let db = null;

if (isConfigured) {
  // 동적 import로 필요할 때만 로드 (설정 안 됐을 때 불필요한 에러 방지)
  const { initializeApp } = await import("firebase/app");
  const { getFirestore } = await import("firebase/firestore");
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
}

export { app, db, isConfigured };
