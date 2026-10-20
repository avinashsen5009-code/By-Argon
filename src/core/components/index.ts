import { componentRegistry, registerComponent } from '../registry.ts';
import type { ComponentDef, Layer, ThemeTokens } from '../types.ts';

export function registerBuiltInComponents(): void {
  // 1. chip: label, emoji|icon, w=360, tone ("card"|"acc"). A label with a small icon disc.
  registerComponent('chip', (id, args, t, _tokens, W) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.5;
    const w = args.w ?? 360;
    const h = args.h ?? 86;
    const at = typeof args.at === 'number' ? args.at : t[0];
    const tone = args.tone === 'acc' ? 'hero' : 'card';
    const discOffset = -(w * 0.5 - 44) / W;
    const textOffset = 22 / W;

    const layers: Layer[] = [
      {
        id: `${id}_bg`,
        type: 'shape',
        kind: 'pill',
        t: [at, t[1]],
        x,
        y,
        w,
        h,
        style: tone,
        motion: [{ m: 'pop', at, dur: 0.3 }],
      },
      {
        id: `${id}_disc`,
        type: 'shape',
        kind: 'ellipse',
        t: [at + 0.04, t[1]],
        x: x + discOffset,
        y,
        w: 56,
        h: 56,
        style: args.tone === 'acc' ? 'hdisc' : 'disc',
        parent: `${id}_bg`,
        motion: [{ m: 'pop', at: at + 0.04, dur: 0.28 }],
      },
    ];

    if (args.icon) {
      layers.push({
        id: `${id}_ico`,
        type: 'icon',
        name: args.icon,
        t: [at + 0.06, t[1]],
        x: x + discOffset,
        y,
        w: 28,
        color: args.tone === 'acc' ? '@dark' : '@ink',
        parent: `${id}_bg`,
        motion: [{ m: 'pop', at: at + 0.06, dur: 0.25 }],
      });
    } else if (args.emoji) {
      layers.push({
        id: `${id}_emo`,
        type: 'text',
        t: [at + 0.06, t[1]],
        x: x + discOffset,
        y,
        w: 56,
        text: String(args.emoji),
        size: 28,
        color: '@ink',
        parent: `${id}_bg`,
        motion: [{ m: 'pop', at: at + 0.06, dur: 0.25 }],
      });
    }

    layers.push({
      id: `${id}_lbl`,
      type: 'text',
      t: [at + 0.08, t[1]],
      x: x + textOffset,
      y,
      w: Math.max(120, w - 100),
      text: String(args.label ?? 'Chip'),
      size: 32,
      font: 'sans',
      weight: 700,
      color: '@ink',
      fit: 'shrink',
      parent: `${id}_bg`,
      enter: 'fadeUp',
    });

    return layers;
  });

  // 2. disc: emoji|icon|asset, size=170, hero=false, label, labelSide ("bottom"|"top"), labelSize=40
  registerComponent('disc', (id, args, t, _tokens, _W, H) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.5;
    const size = args.size ?? 170;
    const hero = Boolean(args.hero);
    const at = typeof args.at === 'number' ? args.at : t[0];
    const labelSide = args.labelSide === 'top' ? 'top' : 'bottom';
    const labelSize = args.labelSize ?? 34;

    const layers: Layer[] = [
      {
        id: `${id}_circle`,
        type: 'shape',
        kind: 'ellipse',
        t: [at, t[1]],
        x,
        y,
        w: size,
        h: size,
        style: hero ? 'hdisc' : 'disc',
        motion: [{ m: 'pop', at, dur: 0.32 }],
      },
    ];

    if (args.icon) {
      layers.push({
        id: `${id}_ico`,
        type: 'icon',
        name: args.icon,
        t: [at + 0.05, t[1]],
        x,
        y,
        w: Math.round(size * 0.44),
        color: hero ? '@dark' : '@ink',
        parent: `${id}_circle`,
        motion: [{ m: 'pop', at: at + 0.05, dur: 0.28 }],
      });
    } else if (args.emoji) {
      layers.push({
        id: `${id}_emo`,
        type: 'text',
        t: [at + 0.05, t[1]],
        x,
        y,
        w: size,
        text: String(args.emoji),
        size: Math.round(size * 0.42),
        color: '@ink',
        parent: `${id}_circle`,
        motion: [{ m: 'pop', at: at + 0.05, dur: 0.28 }],
      });
    } else if (args.asset) {
      layers.push({
        id: `${id}_img`,
        type: 'image',
        asset: args.asset,
        t: [at + 0.05, t[1]],
        x,
        y,
        w: Math.round(size * 0.65),
        parent: `${id}_circle`,
        motion: [{ m: 'pop', at: at + 0.05, dur: 0.28 }],
      });
    }

    if (args.label) {
      const dy = ((size * 0.5 + labelSize * 0.85) / H) * (labelSide === 'top' ? -1 : 1);
      layers.push({
        id: `${id}_lbl`,
        type: 'text',
        t: [at + 0.09, t[1]],
        x,
        y: y + dy,
        w: Math.max(220, size * 1.6),
        text: String(args.label),
        size: labelSize,
        font: 'sans',
        weight: 800,
        color: hero ? '@acc' : '@ink',
        fit: 'shrink',
        parent: `${id}_circle`,
        enter: 'fadeUp',
      });
    }

    return layers;
  });

  // 3. badge: text (CAPS, <=12 chars), tone ("acc"|"warn"), pulse (period, optional)
  registerComponent('badge', (id, args, t) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.5;
    const at = typeof args.at === 'number' ? args.at : t[0];
    const isWarn = args.tone === 'warn';
    const text = String(args.text ?? 'BADGE').toUpperCase();
    const w = args.w ?? Math.max(180, text.length * 22 + 64);
    const h = args.h ?? 58;
    const motions: any[] = [{ m: 'pop', at, over: 1.16, dur: 0.3 }];
    if (args.pulse) {
      motions.push({
        m: 'pulse',
        at: at + 0.3,
        period: typeof args.pulse === 'number' ? args.pulse : 1.6,
        amt: 1.07,
      });
    }

    return [
      {
        id: `${id}_pill`,
        type: 'shape',
        kind: 'pill',
        t: [at, t[1]],
        x,
        y,
        w,
        h,
        fill: isWarn ? '@warn' : '@acc',
        glow: isWarn ? 1.0 : 0.9,
        motion: motions,
      },
      {
        id: `${id}_txt`,
        type: 'text',
        t: [at + 0.04, t[1]],
        x,
        y,
        w: w - 20,
        text,
        size: 26,
        font: 'sans',
        weight: 800,
        color: isWarn ? '#FFFFFF' : '@dark',
        fit: 'shrink',
        parent: `${id}_pill`,
      },
    ];
  });

  // 4. stamp: text, tone, rot=-5. Slams in with a ring burst.
  registerComponent('stamp', (id, args, t) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.5;
    const at = typeof args.at === 'number' ? args.at : t[0];
    const rot = args.rot ?? -5;
    const isWarn = args.tone === 'warn';
    const text = String(args.text ?? 'APPROVED').toUpperCase();
    const w = args.w ?? Math.max(280, text.length * 34 + 80);
    const h = args.h ?? 96;

    return [
      {
        id: `${id}_box`,
        type: 'shape',
        kind: 'roundRect',
        t: [at, t[1]],
        x,
        y,
        w,
        h,
        rot,
        radius: 18,
        fill: isWarn ? 'grad(@warnpHi,@warnpLo)' : 'grad(@heroHi,@heroLo)',
        stroke: isWarn ? '@warn' : '@acc',
        strokeWidth: 5,
        glow: 1.1,
        motion: [{ m: 'slam', at, from: 1.75, burst: true, color: isWarn ? '@warn' : '@acc' }],
      },
      {
        id: `${id}_txt`,
        type: 'text',
        t: [at + 0.03, t[1]],
        x,
        y,
        w: w - 32,
        rot,
        text,
        size: 46,
        font: 'display',
        weight: 800,
        color: isWarn ? '@warn' : '@acc',
        fit: 'shrink',
        parent: `${id}_box`,
      },
    ];
  });

  // 5. button: label, w=360, pressAt (time of the press)
  registerComponent('button', (id, args, t) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.5;
    const w = args.w ?? 360;
    const h = args.h ?? 88;
    const at = typeof args.at === 'number' ? args.at : t[0];
    const motions: any[] = [{ m: 'pop', at, dur: 0.3 }];
    if (args.pressAt !== undefined) {
      motions.push({ m: 'press', at: args.pressAt, dur: 0.25 });
    }
    return [
      {
        id: `${id}_btn`,
        type: 'shape',
        kind: 'pill',
        t: [at, t[1]],
        x,
        y,
        w,
        h,
        fill: '@acc',
        glow: 0.9,
        motion: motions,
      },
      {
        id: `${id}_lbl`,
        type: 'text',
        t: [at + 0.04, t[1]],
        x,
        y,
        w: w - 40,
        text: String(args.label ?? 'Continue'),
        size: 34,
        font: 'sans',
        weight: 800,
        color: '@dark',
        fit: 'shrink',
        parent: `${id}_btn`,
      },
    ];
  });

  // 6. cursor: from:{x,y}, to:{x,y}, dur=0.55, click:true
  registerComponent('cursor', (id, args, t) => {
    const at = typeof args.at === 'number' ? args.at : t[0];
    const dur = args.dur ?? 0.55;
    const from = args.from ?? { x: 0.7, y: 0.8 };
    const to = args.to ?? { x: 0.5, y: 0.5 };
    const motions: any[] = [
      { m: 'to', at, dur, x: to.x, y: to.y, ease: 'inOutCubic' },
    ];
    if (args.click !== false) {
      motions.push({ m: 'press', at: at + dur, dur: 0.22 });
      motions.push({ m: 'burst', at: at + dur + 0.05, r: 44, to: 1.9, dur: 0.5, color: '@acc' });
    }
    return [
      {
        id: `${id}_cur`,
        type: 'icon',
        name: 'cursor',
        t: [at, t[1]],
        x: from.x,
        y: from.y,
        w: 52,
        color: '@ink',
        z: 50,
        motion: motions,
      },
    ];
  });

  // 7. meter: w=600, from=0, to=1, dur=0.8, tone ("acc"|"warn"), percent:true, label
  registerComponent('meter', (id, args, t, _tokens, W, H) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.5;
    const w = args.w ?? 600;
    const h = args.h ?? 36;
    const at = typeof args.at === 'number' ? args.at : t[0];
    const dur = args.dur ?? 0.8;
    const fromFrac = Math.max(0, Math.min(1, args.from ?? 0));
    const toFrac = Math.max(0.02, Math.min(1, args.to ?? 1));
    const isWarn = args.tone === 'warn';
    const leftEdgeX = x - (w * 0.5) / W;

    const layers: Layer[] = [
      {
        id: `${id}_track`,
        type: 'shape',
        kind: 'pill',
        t: [at, t[1]],
        x,
        y,
        w,
        h,
        fill: '@track',
        stroke: '@cardS',
        strokeWidth: 2,
        motion: [{ m: 'pop', at, dur: 0.28 }],
      },
      {
        id: `${id}_fill`,
        type: 'shape',
        kind: 'pill',
        t: [at + 0.06, t[1]],
        x: leftEdgeX,
        y,
        w: Math.round(w * toFrac),
        h,
        anchor: 'left',
        fill: isWarn ? '@warn' : '@acc',
        glow: 0.8,
        motion: [
          {
            m: 'grow',
            at: at + 0.06,
            axis: 'w',
            from: Math.round(w * fromFrac),
            to: Math.round(w * toFrac),
            dur,
          },
        ],
      },
    ];

    if (args.label) {
      layers.push({
        id: `${id}_lbl`,
        type: 'text',
        t: [at + 0.08, t[1]],
        x: leftEdgeX,
        y: y - (h + 26) / H,
        w: w * 0.7,
        anchor: 'left',
        align: 'left',
        text: String(args.label),
        size: 30,
        font: 'sans',
        weight: 700,
        color: '@ink',
        fit: 'shrink',
      });
    }

    if (args.percent !== false) {
      layers.push({
        id: `${id}_pct`,
        type: 'chart',
        kind: 'counter',
        t: [at + 0.08, t[1]],
        x: x + (w * 0.5 - 48) / W,
        y: y - (h + 26) / H,
        w: 140,
        from: Math.round(fromFrac * 100),
        to: Math.round(toFrac * 100),
        format: '{v}%',
        size: 32,
        color: isWarn ? '@warn' : '@acc',
        count: [at + 0.08, at + 0.08 + dur],
      });
    }

    return layers;
  });

  // 8. bubble: side ("you"|"ai"), text, w
  registerComponent('bubble', (id, args, t) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.5;
    const w = args.w ?? 520;
    const h = args.h ?? 96;
    const at = typeof args.at === 'number' ? args.at : t[0];
    const isYou = args.side === 'you';

    return [
      {
        id: `${id}_bg`,
        type: 'shape',
        kind: 'bubble',
        t: [at, t[1]],
        x,
        y,
        w,
        h,
        style: isYou ? 'hero' : 'card',
        motion: [{ m: 'pop', at, dur: 0.3 }],
      },
      {
        id: `${id}_txt`,
        type: 'text',
        t: [at + 0.05, t[1]],
        x,
        y,
        w: w - 48,
        text: String(args.text ?? '...'),
        size: 28,
        font: 'sans',
        weight: 600,
        color: '@ink',
        fit: 'shrink',
        parent: `${id}_bg`,
      },
    ];
  });

  // 9. chat: w, h, title, messages:[{from:"you"|"ai", text:"...", at:...}]
  registerComponent('chat', (id, args, t, _tokens, W, H) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.5;
    const w = args.w ?? 760;
    const h = args.h ?? 560;
    const at = typeof args.at === 'number' ? args.at : t[0];
    const messages = Array.isArray(args.messages) ? args.messages : [];

    const layers: Layer[] = [
      {
        id: `${id}_panel`,
        type: 'shape',
        kind: 'card',
        style: 'card',
        t: [at, t[1]],
        x,
        y,
        w,
        h,
        motion: [{ m: 'pop', at, dur: 0.35 }],
      },
      {
        id: `${id}_hdr`,
        type: 'text',
        t: [at + 0.06, t[1]],
        x,
        y: y - (h * 0.5 - 46) / H,
        w: w - 80,
        text: String(args.title ?? 'Messages'),
        size: 30,
        font: 'sans',
        weight: 800,
        color: '@muted',
        parent: `${id}_panel`,
      },
    ];

    const startY = y - (h * 0.5 - 135) / H;
    const rowStep = 112 / H;
    messages.forEach((msg: any, idx: number) => {
      const msgAt = msg.at ?? at + 0.2 + idx * 0.45;
      const isYou = msg.from === 'you';
      const bw = Math.min(w * 0.72, 500);
      const bx = x + ((isYou ? 1 : -1) * (w * 0.5 - bw * 0.5 - 36)) / W;
      const by = startY + idx * rowStep;

      layers.push({
        id: `${id}_m${idx}_bg`,
        type: 'shape',
        kind: 'roundRect',
        t: [msgAt, t[1]],
        x: bx,
        y: by,
        w: bw,
        h: 84,
        radius: 28,
        style: isYou ? 'hero' : 'card',
        parent: `${id}_panel`,
        motion: [{ m: 'rise', at: msgAt, from: { x: bx, y: by + 40 / H }, dur: 0.3 }],
      });
      layers.push({
        id: `${id}_m${idx}_txt`,
        type: 'text',
        t: [msgAt, t[1]],
        x: bx,
        y: by,
        w: bw - 44,
        text: String(msg.text ?? ''),
        size: 26,
        font: 'sans',
        weight: 600,
        color: '@ink',
        fit: 'shrink',
        parent: `${id}_m${idx}_bg`,
      });
    });

    return layers;
  });

  // 10. phone: h=420, screen (list of layers in its screen)
  registerComponent('phone', (id, args, t) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.5;
    const h = args.h ?? 520;
    const w = args.w ?? Math.round(h * 0.52);
    const at = typeof args.at === 'number' ? args.at : t[0];
    const screenLayers: Layer[] = Array.isArray(args.screen) ? args.screen : [];

    return [
      {
        id: `${id}_frame`,
        type: 'shape',
        kind: 'card',
        style: 'hero',
        t: [at, t[1]],
        x,
        y,
        w,
        h,
        radius: 44,
        motion: [{ m: 'pop', at, dur: 0.35 }],
      },
      {
        id: `${id}_screen`,
        type: 'group',
        t: [at + 0.06, t[1]],
        x,
        y,
        w: w - 24,
        h: h - 36,
        clip: true,
        parent: `${id}_frame`,
        children: screenLayers,
      },
    ];
  });

  // 11. browser: url (types itself), w=1100
  registerComponent('browser', (id, args, t, _tokens, W, H) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.5;
    const w = args.w ?? 1100;
    const h = args.h ?? 580;
    const at = typeof args.at === 'number' ? args.at : t[0];
    const topY = y - (h * 0.5 - 44) / H;
    const leftX = x - (w * 0.5) / W;

    return [
      {
        id: `${id}_win`,
        type: 'shape',
        kind: 'card',
        style: 'card',
        t: [at, t[1]],
        x,
        y,
        w,
        h,
        radius: 36,
        motion: [{ m: 'pop', at, dur: 0.35 }],
      },
      {
        id: `${id}_dot1`,
        type: 'shape',
        kind: 'ellipse',
        t: [at + 0.05, t[1]],
        x: leftX + 42 / W,
        y: topY,
        w: 18,
        h: 18,
        fill: '#FF5F57',
        parent: `${id}_win`,
      },
      {
        id: `${id}_dot2`,
        type: 'shape',
        kind: 'ellipse',
        t: [at + 0.07, t[1]],
        x: leftX + 70 / W,
        y: topY,
        w: 18,
        h: 18,
        fill: '#FEBC2E',
        parent: `${id}_win`,
      },
      {
        id: `${id}_dot3`,
        type: 'shape',
        kind: 'ellipse',
        t: [at + 0.09, t[1]],
        x: leftX + 98 / W,
        y: topY,
        w: 18,
        h: 18,
        fill: '#28C840',
        parent: `${id}_win`,
      },
      {
        id: `${id}_bar`,
        type: 'shape',
        kind: 'pill',
        t: [at + 0.08, t[1]],
        x: x + 30 / W,
        y: topY,
        w: w - 220,
        h: 48,
        fill: '@surf',
        stroke: '@cardS',
        strokeWidth: 2,
        parent: `${id}_win`,
      },
      {
        id: `${id}_url`,
        type: 'text',
        t: [at + 0.12, t[1]],
        x: x + 30 / W,
        y: topY,
        w: w - 260,
        text: String(args.url ?? 'https://recipestudio.video'),
        size: 24,
        font: 'sans',
        weight: 600,
        color: '@ink',
        enter: { type: 'typeOn', dur: 0.55 },
        parent: `${id}_win`,
      },
    ];
  });

  // 12. toast: text, tone
  registerComponent('toast', (id, args, t) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.86;
    const w = args.w ?? 520;
    const h = args.h ?? 82;
    const at = typeof args.at === 'number' ? args.at : t[0];
    const isWarn = args.tone === 'warn';

    return [
      {
        id: `${id}_bg`,
        type: 'shape',
        kind: 'pill',
        t: [at, t[1]],
        x,
        y,
        w,
        h,
        style: isWarn ? 'warnp' : 'hero',
        motion: [{ m: 'slide', at, from: 'D', dist: 90, dur: 0.35 }],
      },
      {
        id: `${id}_txt`,
        type: 'text',
        t: [at + 0.05, t[1]],
        x,
        y,
        w: w - 56,
        text: String(args.text ?? 'Notification'),
        size: 28,
        font: 'sans',
        weight: 700,
        color: '@ink',
        fit: 'shrink',
        parent: `${id}_bg`,
      },
    ];
  });

  // 13. kpi: value, label, count:[from,to]
  registerComponent('kpi', (id, args, t, _tokens, _W, H) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.5;
    const w = args.w ?? 380;
    const h = args.h ?? 240;
    const at = typeof args.at === 'number' ? args.at : t[0];

    const layers: Layer[] = [
      {
        id: `${id}_card`,
        type: 'shape',
        kind: 'card',
        style: 'card',
        t: [at, t[1]],
        x,
        y,
        w,
        h,
        motion: [{ m: 'pop', at, dur: 0.32 }],
      },
    ];

    if (Array.isArray(args.count) && args.count.length === 2) {
      const rawVal = String(args.value ?? '{v}');
      const fmt = rawVal.includes('{v}') ? rawVal : rawVal.replace(/\d+/, '{v}');
      layers.push({
        id: `${id}_val`,
        type: 'chart',
        kind: 'counter',
        t: [at + 0.06, t[1]],
        x,
        y: y - 24 / H,
        w: w - 40,
        from: Number(args.count[0]) || 0,
        to: Number(args.count[1]) || 100,
        format: fmt,
        size: 76,
        color: '@acc',
        count: [at + 0.06, at + 0.85],
        parent: `${id}_card`,
      });
    } else {
      layers.push({
        id: `${id}_val`,
        type: 'text',
        t: [at + 0.06, t[1]],
        x,
        y: y - 24 / H,
        w: w - 40,
        text: String(args.value ?? '100%'),
        size: 76,
        font: 'display',
        weight: 800,
        color: '@acc',
        fit: 'shrink',
        parent: `${id}_card`,
      });
    }

    layers.push({
      id: `${id}_lbl`,
      type: 'text',
      t: [at + 0.1, t[1]],
      x,
      y: y + 54 / H,
      w: w - 40,
      text: String(args.label ?? 'METRIC'),
      size: 26,
      font: 'sans',
      weight: 700,
      color: '@muted',
      fit: 'shrink',
      parent: `${id}_card`,
    });

    return layers;
  });

  // 14. timeline: w, nodes:[labels], dur, finalTone. Nodes pop as the fill passes them.
  registerComponent('timeline', (id, args, t, _tokens, W, H) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.5;
    const w = args.w ?? 600;
    const at = typeof args.at === 'number' ? args.at : t[0];
    const dur = args.dur ?? 0.8;
    const nodes: string[] = Array.isArray(args.nodes) && args.nodes.length > 0 ? args.nodes : ['1', '2', '3'];
    const leftX = x - (w * 0.5) / W;

    const layers: Layer[] = [
      {
        id: `${id}_track`,
        type: 'shape',
        kind: 'rect',
        t: [at, t[1]],
        x: leftX,
        y,
        w,
        h: 8,
        anchor: 'left',
        fill: '@track',
        radius: 4,
      },
      {
        id: `${id}_fill`,
        type: 'shape',
        kind: 'rect',
        t: [at, t[1]],
        x: leftX,
        y,
        w,
        h: 8,
        anchor: 'left',
        fill: '@acc',
        glow: 0.8,
        radius: 4,
        motion: [{ m: 'grow', at, axis: 'w', from: 0, to: w, dur }],
      },
    ];

    nodes.forEach((label, idx) => {
      const frac = nodes.length === 1 ? 0.5 : idx / (nodes.length - 1);
      const nx = leftX + (w * frac) / W;
      const nodeAt = at + frac * dur;
      const isLast = idx === nodes.length - 1;
      const useAcc = isLast && args.finalTone === 'acc';

      layers.push({
        id: `${id}_n${idx}`,
        type: 'shape',
        kind: 'ellipse',
        t: [nodeAt, t[1]],
        x: nx,
        y,
        w: isLast ? 42 : 32,
        h: isLast ? 42 : 32,
        fill: useAcc ? '@acc' : '@surf',
        stroke: '@acc',
        strokeWidth: 4,
        glow: useAcc ? 1.0 : 0.4,
        motion: [{ m: 'pop', at: nodeAt, over: 1.25, dur: 0.28 }],
      });

      layers.push({
        id: `${id}_lbl${idx}`,
        type: 'text',
        t: [nodeAt + 0.04, t[1]],
        x: nx,
        y: y + 44 / H,
        w: 160,
        text: String(label),
        size: 24,
        font: 'sans',
        weight: 800,
        color: useAcc ? '@acc' : '@ink',
        fit: 'shrink',
        enter: 'fadeUp',
      });
    });

    return layers;
  });

  // 15. logo: asset, size
  registerComponent('logo', (id, args, t) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.5;
    const size = args.size ?? 160;
    const at = typeof args.at === 'number' ? args.at : t[0];

    return [
      {
        id: `${id}_bg`,
        type: 'shape',
        kind: 'roundRect',
        t: [at, t[1]],
        x,
        y,
        w: size,
        h: size,
        radius: Math.round(size * 0.24),
        style: 'hero',
        motion: [{ m: 'pop', at, dur: 0.32 }],
      },
      {
        id: `${id}_img`,
        type: 'image',
        asset: args.asset || 'logo',
        t: [at + 0.05, t[1]],
        x,
        y,
        w: Math.round(size * 0.68),
        parent: `${id}_bg`,
      },
    ];
  });

  // 16. photo: asset, side ("left"|"center"|"right")
  registerComponent('photo', (id, args, t) => {
    const side = args.side ?? 'center';
    const x = args.x ?? (side === 'left' ? 0.28 : side === 'right' ? 0.72 : 0.5);
    const y = args.y ?? 0.54;
    const size = args.size ?? 440;
    const at = typeof args.at === 'number' ? args.at : t[0];

    return [
      {
        id: `${id}_disc`,
        type: 'shape',
        kind: 'ellipse',
        t: [at, t[1]],
        x,
        y,
        w: size,
        h: size,
        style: 'hdisc',
        motion: [{ m: 'pop', at, dur: 0.35 }],
      },
      {
        id: `${id}_img`,
        type: 'image',
        asset: args.asset || 'photo',
        t: [at + 0.06, t[1]],
        x,
        y,
        w: Math.round(size * 0.88),
        parent: `${id}_disc`,
        motion: [{ m: 'rise', at: at + 0.06, dur: 0.35 }],
      },
    ];
  });
}

registerBuiltInComponents();

function substituteParams(obj: any, params: Record<string, any>): any {
  if (typeof obj === 'string') {
    if (obj.startsWith('$') && obj.slice(1) in params) {
      return params[obj.slice(1)];
    }
    return obj.replace(/\$([a-zA-Z0-9_]+)/g, (_, key) =>
      key in params ? String(params[key]) : `$${key}`
    );
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => substituteParams(item, params));
  }
  if (obj && typeof obj === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = substituteParams(v, params);
    }
    return out;
  }
  return obj;
}

export function expandUseLayer(
  layer: Layer,
  sceneT: [number, number],
  defs: Record<string, ComponentDef> | undefined,
  tokens: ThemeTokens,
  canvasW: number,
  canvasH: number
): Layer[] {
  const defName = layer.def || '';
  const args = { ...(layer.args || {}) };
  if (layer.x !== undefined && args.x === undefined) args.x = layer.x;
  if (layer.y !== undefined && args.y === undefined) args.y = layer.y;
  const layerT: [number, number] = layer.t
    ? [Number(layer.t[0]) || sceneT[0], Number(layer.t[1]) || sceneT[1]]
    : sceneT;

  const builtIn = componentRegistry.get(defName);
  if (builtIn) {
    const expanded = builtIn(layer.id, args, layerT, tokens, canvasW, canvasH);
    return expanded.map((child) => ({
      ...child,
      exit: layer.exit ?? child.exit,
      z: layer.z ?? child.z,
      parent: child.parent ?? layer.parent,
    }));
  }

  const userDef = defs?.[defName];
  if (userDef && Array.isArray(userDef.layers)) {
    const mergedParams = { ...(userDef.params || {}), ...args };
    const subLayers: Layer[] = substituteParams(userDef.layers, mergedParams);
    const groupX = args.x ?? layer.x ?? 0.5;
    const groupY = args.y ?? layer.y ?? 0.5;
    const groupW = args.w ?? layer.w ?? 420;
    const groupH = args.h ?? layer.h ?? 160;
    const at = args.at ?? layerT[0];

    return [
      {
        id: layer.id,
        type: 'group',
        t: [at, layerT[1]],
        x: groupX,
        y: groupY,
        w: groupW,
        h: groupH,
        exit: layer.exit,
        motion: layer.motion ?? [{ m: 'pop', at, dur: 0.3 }],
        children: subLayers.map((c, idx) => ({
          ...c,
          id: `${layer.id}_${c.id || idx}`,
          t: c.t ?? [at, layerT[1]],
        })),
      },
    ];
  }

  return [];
}
