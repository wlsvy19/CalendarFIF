// Auth 에뮬레이터에 시험 계정을 만든다. 127.0.0.1의 에뮬레이터에만 접속한다.
const AUTH = 'http://127.0.0.1:9095';
const account = { localId: 'owner-test-uid', email: 'test@example.com', password: 'test-password' };

// 관리자용 경로(Bearer owner)만 uid를 정해서 계정을 만들 수 있다.
const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/demo-calfif/accounts`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
  body: JSON.stringify(account),
});
if (res.ok) {
  console.log(`시험 계정을 만들었다: ${account.email} (${account.localId})`);
} else {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  const message = body.error?.message ?? String(res.status);
  if (/EMAIL_EXISTS|DUPLICATE_LOCAL_ID/.test(message)) {
    console.log('시험 계정이 이미 있다. 넘어간다.');
  } else {
    console.error(`시험 계정을 만들지 못했다: ${message}`);
    process.exit(1);
  }
}

export {};
