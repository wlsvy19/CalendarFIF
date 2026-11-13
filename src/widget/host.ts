/** Scriptable의 DrawContext 중 위젯이 쓰는 부분. 이름은 모두 Scriptable의 것이다. */
export type DrawContextLike = {
  size: unknown;
  opaque: boolean;
  respectScreenScale: boolean;
  setFillColor(color: unknown): void;
  fillRect(rect: unknown): void;
  addPath(path: unknown): void;
  fillPath(): void;
  setStrokeColor(color: unknown): void;
  setLineWidth(width: number): void;
  strokePath(): void;
  setFont(font: unknown): void;
  setTextColor(color: unknown): void;
  setTextAlignedLeft(): void;
  setTextAlignedCenter(): void;
  setTextAlignedRight(): void;
  drawTextInRect(text: string, rect: unknown): void;
  getImage(): unknown;
};

/** Scriptable의 WidgetText 중 위젯이 쓰는 부분. */
export type WidgetTextLike = { font: unknown; textColor: unknown; textOpacity: number; lineLimit: number; minimumScaleFactor: number };

/** 위젯과 상자가 같이 가진, 안에 넣는 방법. addSpacer에 null을 주면 남는 곳을 채운다. */
export type WidgetContainerLike = {
  addText(text: string): WidgetTextLike;
  addStack(): WidgetStackLike;
  addSpacer(length: number | null): unknown;
};

/** Scriptable의 WidgetStack 중 위젯이 쓰는 부분. */
export type WidgetStackLike = WidgetContainerLike & {
  spacing: number;
  backgroundColor: unknown;
  cornerRadius: number;
  setPadding(top: number, leading: number, bottom: number, trailing: number): void;
  layoutVertically(): void;
  layoutHorizontally(): void;
  topAlignContent(): void;
  centerAlignContent(): void;
  bottomAlignContent(): void;
};

/** Scriptable의 ListWidget 중 위젯이 쓰는 부분. */
export type ListWidgetLike = WidgetContainerLike & {
  spacing: number;
  backgroundColor: unknown;
  backgroundImage: unknown;
  url: string;
  refreshAfterDate: Date;
  setPadding(top: number, leading: number, bottom: number, trailing: number): void;
  presentSmall(): Promise<void>;
  presentMedium(): Promise<void>;
  presentLarge(): Promise<void>;
};

/** Scriptable이 주는 것 중 위젯이 쓰는 부분. 실제 실행에서는 전역을 모아 넘기고, 시험에서는 가짜를 넘긴다. */
export type Host = {
  Keychain: { contains(key: string): boolean; get(key: string): string; set(key: string, value: string): void; remove(key: string): void };
  Request: new (url: string) => {
    method: string; headers: Record<string, string>; body: string; timeoutInterval: number;
    loadJSON(): Promise<unknown>;
    response: { statusCode?: number } | null;
  };
  Alert: new () => {
    title: string; message: string;
    addTextField(placeholder: string, text?: string): void;
    addSecureTextField(placeholder: string, text?: string): void;
    addAction(title: string): void;
    addCancelAction(title: string): void;
    presentAlert(): Promise<number>; // 고른 단추의 순서(취소는 -1)
    textFieldValue(index: number): string;
  };
  DrawContext: new () => DrawContextLike;
  ListWidget: new () => ListWidgetLike;
  FileManager: { local(): { documentsDirectory(): string; joinPath(a: string, b: string): string; fileExists(path: string): boolean; readString(path: string): string; writeString(path: string, text: string): void; remove(path: string): void } };
  Script: { setWidget(widget: unknown): void; complete(): void };
  config: { runsInWidget: boolean; runsInApp: boolean; widgetFamily: string | null };
  args: { widgetParameter: unknown };
  Device: { screenSize(): { width: number; height: number }; isUsingDarkAppearance(): boolean };
  Color: { new (hex: string, alpha?: number): unknown; dynamic(light: unknown, dark: unknown): unknown };
  Font: { systemFont(size: number): unknown; mediumSystemFont(size: number): unknown; semiboldSystemFont(size: number): unknown; boldSystemFont(size: number): unknown };
  Size: new (width: number, height: number) => unknown;
  Rect: new (x: number, y: number, width: number, height: number) => unknown;
  Point: new (x: number, y: number) => unknown;
  Path: new () => { move(p: unknown): void; addLine(p: unknown): void; addRoundedRect(rect: unknown, cornerWidth: number, cornerHeight: number): void };
};
