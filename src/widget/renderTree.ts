import type { Host, ListWidgetLike, WidgetContainerLike } from './host';
import type { Theme } from './theme';
import type { Dyn, Node, Tree } from './tree';

const REFRESH_MS = 15 * 60 * 1000;

/** 색 한 쌍을 Scriptable의 색으로. 밝기를 정해 주면 그쪽 색, 아니면 화면 밝기를 스스로 따르는 색. */
const colorOf = (host: Host, d: Dyn, force: Theme | undefined): unknown =>
  force ? new host.Color(d[force]) : host.Color.dynamic(new host.Color(d.light), new host.Color(d.dark));

function addNodes(host: Host, parent: WidgetContainerLike, nodes: Node[], force: Theme | undefined): void {
  const dyn = (d: Dyn): unknown => colorOf(host, d, force);
  for (const node of nodes) {
    if (node.kind === 'spacer') {
      parent.addSpacer(node.length);
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
  w.refreshAfterDate = new Date(now.getTime() + REFRESH_MS);
  return w;
}
