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

// 설정을 아직 안 채워넣었으면(YOUR_로 시작하면) Firebase를 초기화하지 않고,
// 앱이 자동으로 mock/카카오 데이터로 계속 동작하게 합니다.
export const isConfigured = !firebaseConfig.apiKey.startsWith("YOUR_");

// 최상위(top-level) await는 일부 빌드 환경에서 문제가 될 수 있어서,
// 필요할 때 호출해서 쓰는 함수 형태로 만들었습니다.
let dbPromise = null;

export function getDb() {
  if (!isConfigured) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = Promise.all([import("firebase/app"), import("firebase/firestore")]).then(
      ([{ initializeApp }, { getFirestore }]) => {
        const app = initializeApp(firebaseConfig);
        return getFirestore(app);
      }
    );
  }
  return dbPromise;
}
