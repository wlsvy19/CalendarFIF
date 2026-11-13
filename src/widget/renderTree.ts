import type { Host, ListWidgetLike, WidgetContainerLike } from './host';
import type { Dyn, Node, Tree } from './tree';

const REFRESH_MS = 15 * 60 * 1000;

const dynamic = (host: Host, d: Dyn): unknown => host.Color.dynamic(new host.Color(d.light), new host.Color(d.dark));

function addNodes(host: Host, parent: WidgetContainerLike, nodes: Node[]): void {
  const dyn = (d: Dyn): unknown => dynamic(host, d);
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
      addNodes(host, s, node.children);
    }
  }
}

/** 나무를 Scriptable의 위젯으로 만든다. */
export function renderTree(host: Host, tree: Tree, appUrl: string, now: Date): ListWidgetLike {
  const w = new host.ListWidget();
  w.setPadding(...tree.padding);
  w.spacing = tree.spacing;
  w.backgroundColor = dynamic(host, tree.background);
  addNodes(host, w, tree.children);
  w.url = appUrl;
  w.refreshAfterDate = new Date(now.getTime() + REFRESH_MS);
  return w;
}
