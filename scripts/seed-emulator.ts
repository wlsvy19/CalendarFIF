// Auth 에뮬레이터에 시험 계정을 만든다. 에뮬레이터 CLI가 환경 변수로 알려 주는 주소에 접속하고,
// 없으면 127.0.0.1의 표준 포트(Auth 9095, Firestore 8085)를 쓴다. 실제 프로젝트에는 접속하지 않는다.
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9095'}`;
const FIRESTORE = `http://${process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085'}`;
const account = { localId: 'owner-test-uid', email: 'test@example.com', password: 'test-password' };
const userAccount = { localId: 'user-test-uid', email: 'user@example.com', password: 'user-password' };

// 관리자용 경로(Bearer owner)만 uid를 정해서 계정을 만들 수 있다.
async function createAccount(acc: typeof account, label: string): Promise<void> {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/demo-calfif/accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify(acc),
  });
  if (res.ok) {
    console.log(`${label}을 만들었다: ${acc.email} (${acc.localId})`);
    return;
  }
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  const message = body.error?.message ?? String(res.status);
  if (/EMAIL_EXISTS|DUPLICATE_LOCAL_ID/.test(message)) {
    console.log(`${label}이 이미 있다. 넘어간다.`);
  } else {
    console.error(`${label}을 만들지 못했다: ${message}`);
    process.exit(1);
  }
}
await createAccount(account, '시험 계정');
await createAccount(userAccount, '두 번째 시험 계정');

// 화면 확인용으로 이번 달에 지어낸 메모를 Firestore 에뮬레이터에 쓴다. 같은 문서를 매번 덮어쓴다.
const now = new Date();
const monthId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const sampleDays: Record<string, { text: string; color: string }> = {
  '02': { text: '치과 예약 10:30\n[+]약국 들르기', color: '' },
  '05': { text: '독서 모임\n책 반납\n[+]장보기', color: 'B5CEF6' },
  '09': { text: '운동 7시', color: 'CBFB91' },
  '13': { text: '10:00 디자인 리뷰\n택배 받기\n[+]운동', color: 'F9BC0B' },
  '14': { text: '친구 결혼식 13:00', color: 'F12424' },
  '18': { text: '건강검진 08:30\n전날 저녁 금식', color: '' },
  '22': { text: '월간 보고 마감\n[+]자료 정리\n회의록 공유\n세탁소\n화분 물주기\n영수증 정리\n도서관\n청소', color: 'D7B1F9' },
  '27': { text: '자동차 보험 갱신\n회식 19:00', color: '282828' },
};
const sampleFields = Object.fromEntries(
  Object.entries(sampleDays).map(([day, v]) => [
    day,
    {
      mapValue: {
        fields: {
          text: { stringValue: v.text },
          color: { stringValue: v.color },
          editedAt: { integerValue: String(Date.now()) },
          editedBy: { stringValue: 'import' },
        },
      },
    },
  ]),
);
const docsRoot = `${FIRESTORE}/v1/projects/demo-calfif/databases/(default)/documents`;
const put = await fetch(`${docsRoot}/users/${account.localId}/months/${monthId}`, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
  body: JSON.stringify({ fields: { days: { mapValue: { fields: sampleFields } } } }),
});
if (put.ok) {
  console.log(`예시 메모 ${Object.keys(sampleDays).length}일을 썼다: users/${account.localId}/months/${monthId}`);
} else {
  console.error(`예시 메모를 쓰지 못했다: ${put.status}`);
  process.exit(1);
}

// 사용 허가 문서. 같은 문서를 매번 덮어쓴다.
const createdAt = Date.now();
for (const g of [{ acc: account, role: 'admin' }, { acc: userAccount, role: 'user' }]) {
  const res = await fetch(`${docsRoot}/access/${g.acc.localId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({
      fields: {
        email: { stringValue: g.acc.email },
        role: { stringValue: g.role },
        disabled: { booleanValue: false },
        createdAt: { integerValue: String(createdAt) },
      },
    }),
  });
  if (res.ok) {
    console.log(`사용 허가를 썼다: access/${g.acc.localId} (${g.role})`);
  } else {
    console.error(`사용 허가를 쓰지 못했다: access/${g.acc.localId} ${res.status}`);
    process.exit(1);
  }
}

export {};
