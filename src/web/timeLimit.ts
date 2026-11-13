/** 제한 시간 안에 끝나지 않으면 { code: 'unavailable' }로 거부한다. 연결이 없을 때 기다리기만 하지 않으려는 것이다. */
export function withTimeLimit<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject({ code: 'unavailable' }), ms);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}
