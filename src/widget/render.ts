import type { Host, ListWidgetLike } from './host';
import type { Scene } from './scene';
import { refreshAt } from './refresh';

/** 장면을 Scriptable의 그림으로 그린다. */
export function renderScene(host: Host, scene: Scene): unknown {
  const ctx = new host.DrawContext();
  ctx.size = new host.Size(scene.width, scene.height);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  ctx.setFillColor(new host.Color(scene.background));
  ctx.fillRect(new host.Rect(0, 0, scene.width, scene.height));
  for (const d of scene.draws) {
    if (d.kind === 'rect') {
      ctx.setFillColor(new host.Color(d.color, d.alpha ?? 1));
      const rect = new host.Rect(d.x, d.y, d.w, d.h);
      if (d.radius !== undefined) {
        const path = new host.Path();
        path.addRoundedRect(rect, d.radius, d.radius);
        ctx.addPath(path);
        ctx.fillPath();
      } else {
        ctx.fillRect(rect);
      }
    } else if (d.kind === 'text') {
      ctx.setFont(d.weight === 'bold' ? host.Font.boldSystemFont(d.size) : d.weight === 'semibold' ? host.Font.semiboldSystemFont(d.size) : host.Font.systemFont(d.size));
      ctx.setTextColor(new host.Color(d.color, d.alpha ?? 1));
      if (d.align === 'center') ctx.setTextAlignedCenter();
      else if (d.align === 'right') ctx.setTextAlignedRight();
      else ctx.setTextAlignedLeft();
      ctx.drawTextInRect(d.text, new host.Rect(d.x, d.y, d.w, d.h));
    } else {
      const path = new host.Path();
      path.move(new host.Point(d.x1, d.y1));
      path.addLine(new host.Point(d.x2, d.y2));
      ctx.addPath(path);
      ctx.setStrokeColor(new host.Color(d.color, d.alpha ?? 1));
      ctx.setLineWidth(d.width);
      ctx.strokePath();
    }
  }
  return ctx.getImage();
}

/** 그림을 넣은 위젯을 만든다. */
export function makeWidget(host: Host, scene: Scene, appUrl: string, now: Date): ListWidgetLike {
  const image = renderScene(host, scene);
  const widget = new host.ListWidget();
  widget.setPadding(0, 0, 0, 0);
  widget.backgroundColor = new host.Color(scene.background);
  widget.backgroundImage = image;
  widget.url = appUrl;
  widget.refreshAfterDate = refreshAt(now);
  return widget;
}
