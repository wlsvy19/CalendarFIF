// 시험용 가짜 Scriptable. 묶음(번들)에는 들어가지 않는다.
import type { DrawContextLike, Host, ListWidgetLike, TextFieldLike, WidgetStackLike, WidgetTextLike } from './host';

/** 묶음 파일에 이 파일의 코드가 섞여 들어가지 않았는지 찾아볼 표지. */
export const FAKE_HOST_MARKER = 'calfif-fake-host-marker';

export type FakeRequest = { url: string; method: string; headers: Record<string, string>; body: string; timeoutInterval: number };
export type FakeAnswer = { status?: number; body?: unknown };
export type FakeAlertRecord = { title: string; message: string; fields: { kind: 'text' | 'secure'; placeholder: string; text: string; keyboard?: 'email' }[]; actions: string[]; cancel: string | null };
export type FakeContextRecord = { size: unknown; opaque: boolean; respectScreenScale: boolean; calls: [string, ...unknown[]][] };
/** 위젯 안에 놓인 것의 기록. 나무와 같은 모양으로 겹쳐 있어 시험이 나무와 견줄 수 있다. */
export type FakeNode =
  | { kind: 'text'; text: string; font?: unknown; textColor?: unknown; textOpacity?: number; lineLimit?: number; minimumScaleFactor?: number }
  | { kind: 'spacer'; length: number | null }
  | { kind: 'stack'; layout: 'h' | 'v' | null; spacing?: number; padding?: number[]; backgroundColor?: unknown; cornerRadius?: number; align?: 'top' | 'center' | 'bottom'; children: FakeNode[] };
export type FakeWidgetRecord = { props: Record<string, unknown>; padding: number[] | null; presented: 'small' | 'medium' | 'large' | null; children: FakeNode[] };

export type FakeOptions = {
  /** 없으면 전역 fetch로 보낸다. 던지면 연결 오류로 본다. */
  handler?: (req: FakeRequest) => FakeAnswer | Promise<FakeAnswer>;
  alerts?: { button: number; fields?: string[] }[];
  runsInApp?: boolean;
  widgetFamily?: string | null;
  widgetParameter?: unknown;
  screen?: { width: number; height: number };
  dark?: boolean;
  keychain?: Record<string, string>;
  files?: Record<string, string>;
  /** 처음 이만큼의 DrawContext는 만들 때 오류를 낸다. */
  failDrawing?: number;
  /** 처음 이만큼의 ListWidget은 만들 때 오류를 낸다. */
  failWidgets?: number;
  /** 처음 이만큼의 addText(위젯과 상자 모두)는 오류를 낸다. 기본 부품 그리기가 깨진 경우다. */
  failTexts?: number;
};

export type FakeState = {
  keychain: Map<string, string>;
  files: Map<string, string>;
  requests: FakeRequest[];
  alerts: FakeAlertRecord[];
  contexts: FakeContextRecord[];
  widgets: FakeWidgetRecord[];
  setWidgets: unknown[];
  completed: number;
};
export type FakeHost = Host & { state: FakeState };

const DOCS = '/docs';

export function makeFakeHost(opts: FakeOptions = {}): FakeHost {
  const state: FakeState = {
    keychain: new Map(Object.entries(opts.keychain ?? {})),
    files: new Map(Object.entries(opts.files ?? {})),
    requests: [], alerts: [], contexts: [], widgets: [], setWidgets: [], completed: 0,
  };
  const answers = [...(opts.alerts ?? [])];
  let failures = opts.failDrawing ?? 0;
  let widgetFailures = opts.failWidgets ?? 0;
  let textFailures = opts.failTexts ?? 0;

  class Size { constructor(public width: number, public height: number) {} }
  class Rect { constructor(public x: number, public y: number, public width: number, public height: number) {} }
  class Point { constructor(public x: number, public y: number) {} }
  class Color {
    constructor(public hex: string, public alpha: number = 1) {}
    static dynamic(light: unknown, dark: unknown): unknown { return { dynamic: { light, dark } }; }
  }
  class Path {
    ops: unknown[][] = [];
    move(p: unknown): void { this.ops.push(['move', p]); }
    addLine(p: unknown): void { this.ops.push(['addLine', p]); }
    addRoundedRect(rect: unknown, cw: number, ch: number): void { this.ops.push(['addRoundedRect', rect, cw, ch]); }
  }
  const font = (kind: string) => (size: number) => ({ font: kind, size });

  class Request {
    method = 'GET';
    headers: Record<string, string> = {};
    body = '';
    timeoutInterval = 60;
    response: { statusCode?: number } | null = null;
    constructor(public url: string) {}
    async loadJSON(): Promise<unknown> {
      const req: FakeRequest = { url: this.url, method: this.method, headers: { ...this.headers }, body: this.body, timeoutInterval: this.timeoutInterval };
      state.requests.push(req);
      let status: number | undefined;
      let text: string;
      if (opts.handler) {
        const a = await opts.handler(req);
        status = a.status ?? 200;
        text = typeof a.body === 'string' ? a.body : JSON.stringify(a.body ?? {});
      } else {
        const res = await fetch(req.url, { method: req.method, headers: req.headers, ...(req.method === 'GET' ? {} : { body: req.body }) });
        status = res.status;
        text = await res.text();
      }
      this.response = { statusCode: status };
      return JSON.parse(text) as unknown;
    }
  }

  class Alert {
    title = '';
    message = '';
    private record: FakeAlertRecord = { title: '', message: '', fields: [], actions: [], cancel: null };
    private answer: { button: number; fields?: string[] } = { button: -1 };
    addTextField(placeholder: string, text = ''): TextFieldLike | undefined {
      const field: FakeAlertRecord['fields'][number] = { kind: 'text', placeholder, text };
      this.record.fields.push(field);
      return { setEmailAddressKeyboard: () => { field.keyboard = 'email'; } };
    }
    addSecureTextField(placeholder: string, text = ''): void { this.record.fields.push({ kind: 'secure', placeholder, text }); }
    addAction(title: string): void { this.record.actions.push(title); }
    addCancelAction(title: string): void { this.record.cancel = title; }
    async presentAlert(): Promise<number> {
      const next = answers.shift();
      if (!next) throw new Error('시험에 준비한 알림 답이 없다');
      this.answer = next;
      state.alerts.push({ ...this.record, title: this.title, message: this.message });
      return next.button;
    }
    textFieldValue(index: number): string { return this.answer.fields?.[index] ?? ''; }
  }

  class DrawContext implements DrawContextLike {
    private rec: FakeContextRecord;
    constructor() {
      if (failures > 0) {
        failures -= 1;
        throw new Error('그리기 시험 오류');
      }
      this.rec = { size: null, opaque: true, respectScreenScale: false, calls: [] };
      state.contexts.push(this.rec);
    }
    get size(): unknown { return this.rec.size; }
    set size(v: unknown) { this.rec.size = v; }
    get opaque(): boolean { return this.rec.opaque; }
    set opaque(v: boolean) { this.rec.opaque = v; }
    get respectScreenScale(): boolean { return this.rec.respectScreenScale; }
    set respectScreenScale(v: boolean) { this.rec.respectScreenScale = v; }
    private log(name: string, ...args: unknown[]): void { this.rec.calls.push([name, ...args]); }
    setFillColor(c: unknown): void { this.log('setFillColor', c); }
    fillRect(r: unknown): void { this.log('fillRect', r); }
    addPath(p: unknown): void { this.log('addPath', p); }
    fillPath(): void { this.log('fillPath'); }
    setStrokeColor(c: unknown): void { this.log('setStrokeColor', c); }
    setLineWidth(w: number): void { this.log('setLineWidth', w); }
    strokePath(): void { this.log('strokePath'); }
    setFont(f: unknown): void { this.log('setFont', f); }
    setTextColor(c: unknown): void { this.log('setTextColor', c); }
    setTextAlignedLeft(): void { this.log('setTextAlignedLeft'); }
    setTextAlignedCenter(): void { this.log('setTextAlignedCenter'); }
    setTextAlignedRight(): void { this.log('setTextAlignedRight'); }
    drawTextInRect(t: string, r: unknown): void { this.log('drawTextInRect', t, r); }
    getImage(): unknown { return { image: state.contexts.indexOf(this.rec) }; }
  }

  /** 위젯과 상자가 같이 쓰는 "안에 넣기": 기록의 children에 쌓는다. */
  const adders = (children: FakeNode[]) => ({
    addText(text: string): WidgetTextLike {
      if (textFailures > 0) {
        textFailures -= 1;
        throw new Error('글자 시험 오류');
      }
      const node: Extract<FakeNode, { kind: 'text' }> = { kind: 'text', text };
      children.push(node);
      return node as unknown as WidgetTextLike;
    },
    addStack(): WidgetStackLike {
      const node: Extract<FakeNode, { kind: 'stack' }> = { kind: 'stack', layout: null, children: [] };
      children.push(node);
      return new FakeStack(node);
    },
    addSpacer(length: number | null): unknown {
      const node: FakeNode = { kind: 'spacer', length };
      children.push(node);
      return node;
    },
  });

  class FakeStack implements WidgetStackLike {
    constructor(private rec: Extract<FakeNode, { kind: 'stack' }>) {
      Object.assign(this, adders(rec.children));
    }
    declare addText: WidgetStackLike['addText'];
    declare addStack: WidgetStackLike['addStack'];
    declare addSpacer: WidgetStackLike['addSpacer'];
    get spacing(): number { return this.rec.spacing ?? 0; }
    set spacing(v: number) { this.rec.spacing = v; }
    get backgroundColor(): unknown { return this.rec.backgroundColor; }
    set backgroundColor(v: unknown) { this.rec.backgroundColor = v; }
    get cornerRadius(): number { return this.rec.cornerRadius ?? 0; }
    set cornerRadius(v: number) { this.rec.cornerRadius = v; }
    setPadding(t: number, l: number, b: number, r: number): void { this.rec.padding = [t, l, b, r]; }
    layoutVertically(): void { this.rec.layout = 'v'; }
    layoutHorizontally(): void { this.rec.layout = 'h'; }
    topAlignContent(): void { this.rec.align = 'top'; }
    centerAlignContent(): void { this.rec.align = 'center'; }
    bottomAlignContent(): void { this.rec.align = 'bottom'; }
  }

  class ListWidget implements ListWidgetLike {
    backgroundColor: unknown = null;
    spacing = 0;
    backgroundImage: unknown = null;
    url = '';
    refreshAfterDate: Date = new Date(0);
    private rec: FakeWidgetRecord = { props: {}, padding: null, presented: null, children: [] };
    constructor() {
      if (widgetFailures > 0) {
        widgetFailures -= 1;
        throw new Error('위젯 시험 오류');
      }
      state.widgets.push(this.rec);
      Object.assign(this, adders(this.rec.children));
    }
    declare addText: ListWidgetLike['addText'];
    declare addStack: ListWidgetLike['addStack'];
    declare addSpacer: ListWidgetLike['addSpacer'];
    get record(): FakeWidgetRecord {
      this.rec.props = { backgroundColor: this.backgroundColor, spacing: this.spacing, backgroundImage: this.backgroundImage, url: this.url, refreshAfterDate: this.refreshAfterDate };
      return this.rec;
    }
    setPadding(t: number, l: number, b: number, r: number): void { this.rec.padding = [t, l, b, r]; }
    async presentSmall(): Promise<void> { this.sync('small'); }
    async presentMedium(): Promise<void> { this.sync('medium'); }
    async presentLarge(): Promise<void> { this.sync('large'); }
    private sync(kind: 'small' | 'medium' | 'large'): void { this.record.presented = kind; }
  }

  const local = {
    documentsDirectory: () => DOCS,
    joinPath: (a: string, b: string) => `${a}/${b}`,
    fileExists: (p: string) => state.files.has(p),
    readString: (p: string) => {
      const v = state.files.get(p);
      if (v === undefined) throw new Error('파일이 없다');
      return v;
    },
    writeString: (p: string, t: string) => { state.files.set(p, t); },
    remove: (p: string) => { state.files.delete(p); },
  };

  return {
    state,
    Keychain: {
      contains: (k) => state.keychain.has(k),
      get: (k) => {
        const v = state.keychain.get(k);
        if (v === undefined) throw new Error('키가 없다');
        return v;
      },
      set: (k, v) => { state.keychain.set(k, v); },
      remove: (k) => { state.keychain.delete(k); },
    },
    Request, Alert, DrawContext, ListWidget,
    FileManager: { local: () => local },
    Script: { setWidget: (w) => { state.setWidgets.push(w); }, complete: () => { state.completed += 1; } },
    config: { runsInWidget: !opts.runsInApp, runsInApp: opts.runsInApp ?? false, widgetFamily: opts.widgetFamily ?? null },
    args: { widgetParameter: opts.widgetParameter ?? null },
    Device: { screenSize: () => opts.screen ?? { width: 390, height: 844 }, isUsingDarkAppearance: () => opts.dark ?? false },
    Color, Size, Rect, Point, Path,
    Font: { systemFont: font('system'), mediumSystemFont: font('medium'), semiboldSystemFont: font('semibold'), boldSystemFont: font('bold') },
  };
}

/** 지금까지 그려진 모든 글자(그린 차례대로). */
export function drawnTexts(host: FakeHost): string[] {
  return host.state.contexts.flatMap((c) => c.calls.filter((call) => call[0] === 'drawTextInRect').map((call) => call[1] as string));
}

/** 위젯의 기록. 속성은 마지막으로 넣은 값이다. */
export function widgetRecord(widget: unknown): FakeWidgetRecord {
  return (widget as { record: FakeWidgetRecord }).record;
}

/** 위젯 안에 놓인 모든 글자(놓은 차례대로, 상자 안까지). */
export function nativeTexts(host: FakeHost): string[] {
  const out: string[] = [];
  const walk = (nodes: FakeNode[]): void => {
    for (const n of nodes) {
      if (n.kind === 'text') out.push(n.text);
      else if (n.kind === 'stack') walk(n.children);
    }
  };
  for (const w of host.state.widgets) walk(w.children);
  return out;
}
