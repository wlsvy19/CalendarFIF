import type { Host, ListWidgetLike, WidgetContainerLike } from './host';
import { refreshAt } from './refresh';
import type { Theme } from './theme';
import type { Dyn, Node, Tree } from './tree';

/** 색 한 쌍을 Scriptable의 색으로. 밝기를 정해 주면 그쪽 색, 아니면 화면 밝기를 스스로 따르는 색. */
const colorOf = (host: Host, d: Dyn, force: Theme | undefined): unknown =>
  force ? new host.Color(d[force]) : host.Color.dynamic(new host.Color(d.light), new host.Color(d.dark));

// Scriptable의 전역 SFSymbol. 붙여 넣은 스크립트가 넘기는 이름에 없어서(0.9.0에서 굳었다) 전역에서 직접 가져온다. Scriptable 밖에는 없다.
declare const SFSymbol: unknown;
type SymbolLike = { image: unknown; applyFont?(font: unknown): void };

/** SF Symbols의 그림을 찾는다. 없으면(오래된 Scriptable, 모르는 이름) null. 던지지 않는다. */
function symbolImage(host: Host, name: string, size: number): unknown {
  const named = (found: unknown): SymbolLike | null => {
    const api = found as { named?: (n: string) => SymbolLike | null } | null | undefined;
    return api && typeof api.named === 'function' ? api.named(name) : null;
  };
  try {
    let symbol: SymbolLike | null = null;
    try {
      if (typeof SFSymbol !== 'undefined') symbol = named(SFSymbol);
    } catch {
      symbol = null;
    }
    if (!symbol) symbol = named((globalThis as { SFSymbol?: unknown }).SFSymbol);
    if (!symbol) return null;
    // 놓는 크기보다 크게 그려 두어야 또렷하다(줄여서 놓는다).
    try {
      symbol.applyFont?.(host.Font.mediumSystemFont(size * 3));
    } catch {
      // 크기를 정하지 못해도 그림은 쓴다.
    }
    return symbol.image ?? null;
  } catch {
    return null;
  }
}

function addNodes(host: Host, parent: WidgetContainerLike, nodes: Node[], force: Theme | undefined): void {
  const dyn = (d: Dyn): unknown => colorOf(host, d, force);
  for (const node of nodes) {
    if (node.kind === 'spacer') {
      parent.addSpacer(node.length);
    } else if (node.kind === 'icon') {
      // 그림을 놓는다. 그림을 쓸 수 없으면 그림 글자를 글자로 놓는다(줄은 그대로 보인다).
      const image = typeof parent.addImage === 'function' ? symbolImage(host, node.symbol, node.size) : null;
      if (image) {
        const placed = parent.addImage!(image);
        placed.imageSize = new host.Size(node.size, node.size);
        placed.tintColor = dyn(node.color);
        if (node.opacity !== undefined) placed.imageOpacity = node.opacity;
      } else {
        const t = parent.addText(node.fallback);
        t.font = host.Font.systemFont(node.size);
        t.textColor = dyn(node.color);
        if (node.opacity !== undefined) t.textOpacity = node.opacity;
        t.lineLimit = 1;
      }
    } else if (node.kind === 'text') {
      const t = parent.addText(node.text);
      t.font = node.weight === 'bold' ? host.Font.boldSystemFont(node.size)
        : node.weight === 'semibold' ? host.Font.semiboldSystemFont(node.size)
          : node.weight === 'medium' ? host.Font.mediumSystemFont(node.size)
            : host.Font.systemFont(node.size);
      t.textColor = dyn(node.color);
      if (node.opacity !== undefined) t.textOpacity = node.opacity;
      t.lineLimit = node.lines;
      if (node.minScale !== undefined) t.minimumScaleFactor = node.minScale;
    } else {
      const s = parent.addStack();
      if (node.dir === 'v') s.layoutVertically();
      else s.layoutHorizontally();
      if (node.spacing !== undefined) s.spacing = node.spacing;
      if (node.padding) s.setPadding(...node.padding);
      if (node.background) s.backgroundColor = dyn(node.background);
      if (node.radius !== undefined) s.cornerRadius = node.radius;
      if (node.size) s.size = new host.Size(node.size[0], node.size[1]);
      if (node.align === 'top') s.topAlignContent();
      else if (node.align === 'center') s.centerAlignContent();
      else if (node.align === 'bottom') s.bottomAlignContent();
      addNodes(host, s, node.children, force);
    }
  }
}

/** 나무를 Scriptable의 위젯으로 만든다. force를 주면 색을 그 밝기로 고정한다. */
export function renderTree(host: Host, tree: Tree, appUrl: string, now: Date, force?: Theme): ListWidgetLike {
  const w = new host.ListWidget();
  w.setPadding(...tree.padding);
  w.spacing = tree.spacing;
  w.backgroundColor = colorOf(host, tree.background, force);
  addNodes(host, w, tree.children, force);
  w.url = appUrl;
  w.refreshAfterDate = refreshAt(now);
  return w;
}
