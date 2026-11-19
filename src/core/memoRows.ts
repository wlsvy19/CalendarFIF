/**
 * 칸에 메모 줄을 접어 넣을 때 어느 줄을 몇 행까지 보일지 정한다. 웹앱의 칸(calendar.ts)과 위젯의 칸(widget/tree.ts)이 같이 쓴다.
 *
 * 2026-11-20 사용자(위젯에서 연 달력의 사진): "모바일에서볼때 글이길면 위젯에서 안보여 자동으로 줄바꿈되서 최대한 보이게 해줘".
 * 그 전에는 메모 한 줄이 칸에서 한 행만 쓰고 넘치는 글은 잘렸다.
 *
 * 보이는 줄은 전과 같다: 다 들어가면 모두, 넘치면 앞의 capacity-1줄과 "+N"(N은 보이지 않는 줄 수). 줄마다 먼저 한 행을 주고,
 * 남는 행을 앞줄부터 접힌 줄에 더 준다. 그래서 긴 줄이 다른 줄을 밀어내지 않는다(위젯의 칸은 3행쯤이라 알림 한 줄이
 * 두 행을 쓰면 메모가 "+1"로 가려질 수 있었다). 받은 행보다 긴 줄은 그 행까지만 보이고 끝에 "…"가 붙는다.
 *
 * rows: 줄마다 접었을 때의 행 수(1 이상). capacity: 칸에 들어가는 행 수(Infinity면 제한 없음).
 * counts: 보일 줄마다 보일 행 수(앞에서부터). more: 보이지 않는 줄 수.
 */
export function fitRows(rows: readonly number[], capacity: number): { counts: number[]; more: number } {
  const cap = capacity === Infinity ? Infinity : Math.max(0, Math.floor(capacity));
  const shown = rows.length <= cap ? rows.length : Math.max(0, cap - 1);
  let spare = cap === Infinity ? Infinity : cap - shown - (shown < rows.length ? 1 : 0);
  const counts = rows.slice(0, shown).map((r) => {
    const extra = Math.min(Math.max(1, r) - 1, spare);
    spare -= extra;
    return 1 + extra;
  });
  return { counts, more: rows.length - shown };
}
