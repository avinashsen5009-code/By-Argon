import { componentRegistry, registerComponent } from '../registry.ts';
import type { ComponentDef, Layer, ThemeTokens } from '../types.ts';

export function registerBuiltInComponents(): void {
  // 1. chip: roundRect h=86 (radius 35) style card, w by arg (default 360);
  // a 60 px disc at the left (x = left + 45 px) with a 30 px glyph;
  // label sans 800 size 30 @ink, left aligned, starting 30 px right of the disc.
  // tone:"acc" fills with @acc and uses @dark text.
  registerComponent('chip', (id, args, t, _tokens, W, H) => {
    const scale = W / 1920;
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.5;
    const w = args.w ?? Math.round(360 * scale);
    const h = args.h ?? Math.round(86 * scale);
    const radius = Math.round(35 * scale);
    const at = typeof args.at === 'number' ? args.at : t[0];
    const isAcc = args.tone === 'acc';
    const leftEdgeX = x - (w * 0.5) / W;
    const discX = leftEdgeX + (45 * scale) / W;
    const labelLeftX = leftEdgeX + (105 * scale) / W;
    const discSize = Math.round(60 * scale);
    const glyphSize = Math.round(30 * scale);
    void H;

    const layers: Layer[] = [
      {
        id: `${id}_bg`,
        type: 'shape',
        kind: 'roundRect',
        t: [at, t[1]],
        x,
        y,
        w,
        h,
        radius,
        style: isAcc ? undefined : 'card',
        fill: isAcc ? '@acc' : undefined,
        motion: [{ m: 'pop', at, dur: 0.3 }],
      },
      {
        id: `${id}_disc`,
        type: 'shape',
        kind: 'ellipse',
        t: [at + 0.03, t[1]],
        x: discX,
        y,
        w: discSize,
        h: discSize,
        style: isAcc ? 'hdisc' : 'disc',
        parent: `${id}_bg`,
        motion: [{ m: 'pop', at: at + 0.03, dur: 0.28 }],
      },
    ];

    if (args.icon) {
      layers.push({
        id: `${id}_ico`,
        type: 'icon',
        name: args.icon,
        t: [at + 0.05, t[1]],
        x: discX,
        y,
        w: glyphSize,
        color: isAcc ? '@dark' : '@ink',
        parent: `${id}_bg`,
        motion: [{ m: 'pop', at: at + 0.05, dur: 0.25 }],
      });
    } else if (args.emoji) {
      layers.push({
        id: `${id}_emo`,
        type: 'text',
        t: [at + 0.05, t[1]],
        x: discX,
        y,
        w: discSize,
        text: String(args.emoji),
        size: glyphSize,
        color: isAcc ? '@dark' : '@ink',
        parent: `${id}_bg`,
        motion: [{ m: 'pop', at: at + 0.05, dur: 0.25 }],
      });
    }

    layers.push({
      id: `${id}_lbl`,
      type: 'text',
      t: [at + 0.08, t[1]],
      x: labelLeftX,
      y,
      w: Math.max(80, w - Math.round(120 * scale)),
      anchor: 'left',
      align: 'left',
      text: String(args.label ?? 'Chip'),
      size: Math.round(30 * scale),
      font: 'sans',
      weight: 800,
      color: isAcc ? '@dark' : '@ink',
      fit: 'shrink',
      parent: `${id}_bg`,
      enter: 'fadeUp',
    });

    return layers;
  });

  // 2. disc: ellipse w=size (default 170) style disc (hdisc if hero);
  // emoji text size 0.5w, or an icon at 0.5w, or an image;
  // optional label text under (or above) the disc, display 800, size 40, @ink.
  // Parts: disc, glyph (+0.03 s), label (+0.12 s).
  registerComponent('disc', (id, args, t, _tokens, _W, H) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.5;
    const size = args.size ?? 170;
    const hero = Boolean(args.hero);
    const at = typeof args.at === 'number' ? args.at : t[0];
    const labelSide = args.labelSide === 'top' ? 'top' : 'bottom';
    const labelSize = args.labelSize ?? 40;
    const glyphSize = Math.round(size * 0.5);

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
        t: [at + 0.03, t[1]],
        x,
        y,
        w: glyphSize,
        color: hero ? '@dark' : '@ink',
        parent: `${id}_circle`,
        motion: [{ m: 'pop', at: at + 0.03, dur: 0.28 }],
      });
    } else if (args.emoji) {
      layers.push({
        id: `${id}_emo`,
        type: 'text',
        t: [at + 0.03, t[1]],
        x,
        y,
        w: size,
        text: String(args.emoji),
        size: glyphSize,
        color: '@ink',
        parent: `${id}_circle`,
        motion: [{ m: 'pop', at: at + 0.03, dur: 0.28 }],
      });
    } else if (args.asset) {
      layers.push({
        id: `${id}_img`,
        type: 'image',
        asset: args.asset,
        t: [at + 0.03, t[1]],
        x,
        y,
        w: glyphSize,
        parent: `${id}_circle`,
        motion: [{ m: 'pop', at: at + 0.03, dur: 0.28 }],
      });
    }

    if (args.label) {
      const dy = ((size * 0.5 + labelSize * 0.85) / H) * (labelSide === 'top' ? -1 : 1);
      layers.push({
        id: `${id}_lbl`,
        type: 'text',
        t: [at + 0.12, t[1]],
        x,
        y: y + dy,
        w: Math.max(220, size * 1.6),
        text: String(args.label),
        size: labelSize,
        font: 'display',
        weight: 800,
        color: '@ink',
        fit: 'shrink',
        parent: `${id}_circle`,
        enter: 'fadeUp',
      });
    }

    return layers;
  });

  // 3. badge: pill h 52-74 filled @acc or @warn, glow 1, text sans 800 size 24-36 (@dark on acc, #FFFFFF on warn), CAPS; optional pulse loop.
  registerComponent('badge', (id, args, t) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.5;
    const at = typeof args.at === 'number' ? args.at : t[0];
    const isWarn = args.tone === 'warn';
    const text = String(args.text ?? 'BADGE').toUpperCase();
    const w = args.w ?? Math.max(180, text.length * 22 + 64);
    const h = args.h ?? 60;
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
        glow: 1,
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
        size: 28,
        font: 'sans',
        weight: 800,
        color: isWarn ? '#FFFFFF' : '@dark',
        fit: 'shrink',
        parent: `${id}_pill`,
      },
    ];
  });

  // 4. stamp: outline rect (stroke 6, @acc or @warn, glow 1, rot -5, radius 20) + display 800 text with the same rot; slam with ring burst.
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
        radius: 20,
        fill: 'none',
        stroke: isWarn ? '@warn' : '@acc',
        strokeWidth: 6,
        glow: 1,
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

  // 5. button: pill filled with the hdisc gradient, label @dark sans 800; press at pressAt (scale 1 -> 0.9 -> 1, 0.25 s); a ring burst opens under it.
  registerComponent('button', (id, args, t) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.5;
    const w = args.w ?? 360;
    const h = args.h ?? 88;
    const at = typeof args.at === 'number' ? args.at : t[0];
    const pressAt = typeof args.pressAt === 'number' ? args.pressAt : at + 0.4;
    const motions: any[] = [
      { m: 'pop', at, dur: 0.3 },
      { m: 'press', at: pressAt, dur: 0.25 },
      { m: 'burst', at: pressAt, r: Math.round(w * 0.5), to: 1.5, dur: 0.55, color: '@acc' },
    ];
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
        fill: 'gradr(@hdiscHi,@hdiscLo)',
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

  // 6. cursor: ellipse w=40 @ink, 3 px @dark stroke, shadow 0.6, z above everything; travels from -> to in 0.55 s (outCubic), then clicks (scale 1 -> 0.7 -> 1).
  registerComponent('cursor', (id, args, t) => {
    const at = typeof args.at === 'number' ? args.at : t[0];
    const dur = args.dur ?? 0.55;
    const from = args.from ?? { x: 0.7, y: 0.8 };
    const to = args.to ?? { x: 0.5, y: 0.5 };
    const motions: any[] = [
      { m: 'to', at, dur, x: to.x, y: to.y, ease: 'outCubic' },
    ];
    if (args.click !== false) {
      motions.push({ m: 'burst', at: at + dur + 0.05, r: 40, to: 1.9, dur: 0.5, color: '@acc' });
    }
    return [
      {
        id: `${id}_cur`,
        type: 'shape',
        kind: 'ellipse',
        t: [at, t[1]],
        x: from.x,
        y: from.y,
        w: 40,
        h: 40,
        fill: '@ink',
        stroke: '@dark',
        strokeWidth: 3,
        shadow: 0.6,
        z: 99,
        anim:
          args.click !== false
            ? {
                scale: [
                  { t: dur, v: 1 },
                  { t: dur + 0.1, v: 0.7, e: 'outQuad' },
                  { t: dur + 0.22, v: 1, e: 'outBack' },
                ],
              }
            : undefined,
        motion: motions,
      },
    ];
  });

  // 7. meter: track pill h 12-26 @track, fill pill @acc (or @warn) with grow from the left (anchor left);
  // optional counter text and % as a separate text; to with tone:"warn" overlays a warn fill growing later.
  registerComponent('meter', (id, args, t, _tokens, W, H) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.5;
    const w = args.w ?? 600;
    const h = args.h ?? 22;
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
        fill: isWarn && fromFrac === 0 ? '@warn' : '@acc',
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

    // If `tone:"warn"` with `from > 0` or `warnTo` is provided, overlay a warn fill growing later
    if ((isWarn && fromFrac > 0) || typeof args.warnTo === 'number') {
      const warnTarget = typeof args.warnTo === 'number' ? args.warnTo : toFrac;
      const warnAt = at + 0.06 + dur * 0.45;
      layers.push({
        id: `${id}_warn_fill`,
        type: 'shape',
        kind: 'pill',
        t: [warnAt, t[1]],
        x: leftEdgeX,
        y,
        w: Math.round(w * warnTarget),
        h,
        anchor: 'left',
        fill: '@warn',
        glow: 1,
        motion: [
          {
            m: 'grow',
            at: warnAt,
            axis: 'w',
            from: Math.round(w * fromFrac),
            to: Math.round(w * warnTarget),
            dur: dur * 0.65,
          },
        ],
      });
    }

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
        size: 28,
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
        x: x + (w * 0.5 - 56) / W,
        y: y - (h + 26) / H,
        w: 120,
        from: Math.round(fromFrac * 100),
        to: Math.round(toFrac * 100),
        format: '{v}',
        size: 30,
        color: isWarn ? '@warn' : '@acc',
        count: [at + 0.08, at + 0.08 + dur],
      });
      layers.push({
        id: `${id}_pct_sym`,
        type: 'text',
        t: [at + 0.08, t[1]],
        x: x + (w * 0.5 - 14) / W,
        y: y - (h + 26) / H,
        w: 44,
        text: '%',
        size: 26,
        font: 'sans',
        weight: 800,
        color: isWarn ? '@warn' : '@acc',
      });
    }

    return layers;
  });

  // 8. bubble: you: roundRect radius 30, h 78, @acc, @dark text, right aligned;
  // ai: roundRect style card, @ink text, left aligned; width fits the text (measure).
  registerComponent('bubble', (id, args, t) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.5;
    const text = String(args.text ?? '...');
    const measuredW = Math.max(200, Math.min(720, text.length * 16 + 76));
    const w = args.w ?? measuredW;
    const h = args.h ?? 78;
    const at = typeof args.at === 'number' ? args.at : t[0];
    const isYou = args.side === 'you';

    return [
      {
        id: `${id}_bg`,
        type: 'shape',
        kind: 'roundRect',
        t: [at, t[1]],
        x,
        y,
        w,
        h,
        radius: 30,
        style: isYou ? undefined : 'card',
        fill: isYou ? '@acc' : undefined,
        motion: [{ m: 'pop', at, dur: 0.3 }],
      },
      {
        id: `${id}_txt`,
        type: 'text',
        t: [at + 0.04, t[1]],
        x,
        y,
        w: w - 48,
        text,
        size: 28,
        font: 'sans',
        weight: 700,
        align: isYou ? 'right' : 'left',
        color: isYou ? '@dark' : '@ink',
        fit: 'shrink',
        parent: `${id}_bg`,
      },
    ];
  });

  // 9. chat: chat window card with a header (logo/title, blinking online dot), an input pill, and a message stack.
  // Each message: you messages type into the input first (typeOn 0.5-0.9 s, press send), then rise from the input;
  // ai messages show typing dots (3 ellipses w=14 @muted, bounce -9 px, period 0.5 s, phase 0.12 s)
  // then the reply bubble grows from 140 px to its width (left-pinned) with its text fading in over 0.22 s.
  // Older messages scroll up by (h+22 px) in 0.3 s and fade out past the top; at most 5 visible.
  registerComponent('chat', (id, args, t, _tokens, W, H) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.5;
    const w = args.w ?? 760;
    const h = args.h ?? 560;
    const at = typeof args.at === 'number' ? args.at : t[0];
    const messages = Array.isArray(args.messages) ? args.messages : [];
    const headerY = y - (h * 0.5 - 46) / H;
    const inputY = y + (h * 0.5 - 48) / H;
    const sendBtnX = x + (w * 0.5 - 52) / W;

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
        id: `${id}_dot`,
        type: 'shape',
        kind: 'ellipse',
        t: [at + 0.06, t[1]],
        x: x - (w * 0.5 - 44) / W,
        y: headerY,
        w: 14,
        h: 14,
        fill: '#28C840',
        parent: `${id}_panel`,
        motion: [{ m: 'blink', at: at + 0.06, period: 1.2 }],
      },
      {
        id: `${id}_hdr`,
        type: 'text',
        t: [at + 0.06, t[1]],
        x: x - (w * 0.5 - 68) / W,
        y: headerY,
        w: w - 120,
        anchor: 'left',
        align: 'left',
        text: String(args.title ?? 'Messages'),
        size: 28,
        font: 'sans',
        weight: 800,
        color: '@ink',
        parent: `${id}_panel`,
      },
      {
        id: `${id}_input`,
        type: 'shape',
        kind: 'pill',
        t: [at + 0.08, t[1]],
        x: x - 24 / W,
        y: inputY,
        w: w - 110,
        h: 54,
        fill: '@surf',
        stroke: '@cardS',
        strokeWidth: 2,
        parent: `${id}_panel`,
      },
      {
        id: `${id}_send`,
        type: 'shape',
        kind: 'ellipse',
        t: [at + 0.08, t[1]],
        x: sendBtnX,
        y: inputY,
        w: 48,
        h: 48,
        fill: '@acc',
        parent: `${id}_panel`,
      },
    ];

    const startY = y - (h * 0.5 - 125) / H;
    const bubbleH = 78;
    const rowStepPx = bubbleH + 22;
    const rowStep = rowStepPx / H;

    messages.forEach((msg: any, idx: number) => {
      const msgAt = typeof msg.at === 'number' ? msg.at : at + 0.3 + idx * 0.6;
      const isYou = msg.from === 'you';
      const msgText = String(msg.text ?? '');
      const bw = Math.min(w * 0.74, Math.max(200, msgText.length * 15 + 72));
      const bx = x + ((isYou ? 1 : -1) * (w * 0.5 - bw * 0.5 - 34)) / W;
      const visibleSlot = Math.min(idx, 4);
      const by = startY + visibleSlot * rowStep;

      // Scroll up and fade out if more than 5 messages arrive later
      const scrollMotions: any[] = [];
      let endT = t[1];
      if (messages.length > 5 && idx < messages.length - 5) {
        const scrollTriggerMsg = messages[idx + 5];
        const scrollAt =
          typeof scrollTriggerMsg?.at === 'number'
            ? scrollTriggerMsg.at
            : at + 0.3 + (idx + 5) * 0.6;
        scrollMotions.push({
          m: 'to',
          at: scrollAt,
          dur: 0.3,
          y: by - rowStep,
          opacity: 0,
        });
        endT = Math.min(t[1], scrollAt + 0.32);
      }

      if (isYou) {
        const typeStart = Math.max(at + 0.1, msgAt - 0.52);
        if (msgAt - typeStart > 0.15) {
          layers.push({
            id: `${id}_m${idx}_typing`,
            type: 'text',
            t: [typeStart, msgAt],
            x: x - 24 / W,
            y: inputY,
            w: w - 150,
            align: 'left',
            text: msgText,
            size: 22,
            font: 'sans',
            weight: 600,
            color: '@muted',
            enter: { type: 'typeOn', dur: Math.min(0.6, msgAt - typeStart) },
            parent: `${id}_panel`,
          });
        }
        layers.push({
          id: `${id}_m${idx}_bg`,
          type: 'shape',
          kind: 'roundRect',
          t: [msgAt, endT],
          x: bx,
          y: by,
          w: bw,
          h: bubbleH,
          radius: 30,
          fill: '@acc',
          parent: `${id}_panel`,
          motion: [
            { m: 'rise', at: msgAt, from: { x: bx, y: inputY }, dur: 0.3 },
            ...scrollMotions,
          ],
        });
        layers.push({
          id: `${id}_m${idx}_txt`,
          type: 'text',
          t: [msgAt, endT],
          x: bx,
          y: by,
          w: bw - 44,
          text: msgText,
          size: 26,
          font: 'sans',
          weight: 700,
          align: 'right',
          color: '@dark',
          fit: 'shrink',
          parent: `${id}_m${idx}_bg`,
        });
      } else {
        // AI typing dots before reply bubble grows from 140px
        const dotsStart = Math.max(at + 0.12, msgAt - 0.45);
        if (msgAt - dotsStart > 0.12) {
          const leftPinX = x - (w * 0.5 - 34) / W;
          for (let dIdx = 0; dIdx < 3; dIdx++) {
            layers.push({
              id: `${id}_m${idx}_dot${dIdx}`,
              type: 'shape',
              kind: 'ellipse',
              t: [dotsStart + dIdx * 0.06, msgAt],
              x: leftPinX + (26 + dIdx * 22) / W,
              y: by,
              w: 14,
              h: 14,
              fill: '@muted',
              parent: `${id}_panel`,
              motion: [{ m: 'float', at: dotsStart + dIdx * 0.12, amp: 9, period: 0.5 }],
            });
          }
        }
        const leftPinX = x - (w * 0.5 - 34) / W;
        layers.push({
          id: `${id}_m${idx}_bg`,
          type: 'shape',
          kind: 'roundRect',
          t: [msgAt, endT],
          x: leftPinX,
          y: by,
          w: bw,
          h: bubbleH,
          anchor: 'left',
          radius: 30,
          style: 'card',
          parent: `${id}_panel`,
          motion: [
            { m: 'grow', at: msgAt, axis: 'w', from: 140, to: bw, dur: 0.28 },
            ...scrollMotions,
          ],
        });
        layers.push({
          id: `${id}_m${idx}_txt`,
          type: 'text',
          t: [msgAt + 0.04, endT],
          x: leftPinX + (bw * 0.5) / W,
          y: by,
          w: bw - 44,
          text: msgText,
          size: 26,
          font: 'sans',
          weight: 600,
          align: 'left',
          color: '@ink',
          fit: 'shrink',
          enter: { type: 'fadeIn', dur: 0.22 },
          parent: `${id}_m${idx}_bg`,
        });
      }
    });

    return layers;
  });

  // 10. phone: roundRect w=250 h=420 radius 40 style hero, screen roundRect radius 24 @surf, notch pill w=70 h=12 @track; screen layers are clipped to the screen.
  registerComponent('phone', (id, args, t, _tokens, _W, H) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.5;
    const w = args.w ?? 250;
    const h = args.h ?? 420;
    const at = typeof args.at === 'number' ? args.at : t[0];
    const screenLayers: Layer[] = Array.isArray(args.screen) ? args.screen : [];
    const notchY = y - (h * 0.5 - 24) / H;

    return [
      {
        id: `${id}_frame`,
        type: 'shape',
        kind: 'roundRect',
        style: 'hero',
        t: [at, t[1]],
        x,
        y,
        w,
        h,
        radius: 40,
        motion: [{ m: 'pop', at, dur: 0.35 }],
      },
      {
        id: `${id}_screen_bg`,
        type: 'shape',
        kind: 'roundRect',
        t: [at + 0.03, t[1]],
        x,
        y,
        w: w - 24,
        h: h - 28,
        radius: 24,
        fill: '@surf',
        parent: `${id}_frame`,
      },
      {
        id: `${id}_notch`,
        type: 'shape',
        kind: 'pill',
        t: [at + 0.05, t[1]],
        x,
        y: notchY,
        w: 70,
        h: 12,
        fill: '@track',
        parent: `${id}_frame`,
      },
      {
        id: `${id}_screen`,
        type: 'group',
        t: [at + 0.06, t[1]],
        x,
        y,
        w: w - 24,
        h: h - 28,
        clip: true,
        parent: `${id}_frame`,
        children: screenLayers,
      },
    ];
  });

  // 11. browser: pill w=1100 h=120 @surf 3 px @acc stroke; three dots w=18 (#FF5F57, #FEBC2E, #28C840); lock icon; URL text typeOn.
  registerComponent('browser', (id, args, t, _tokens, W) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.5;
    const w = args.w ?? 1100;
    const h = args.h ?? 120;
    const at = typeof args.at === 'number' ? args.at : t[0];
    const leftX = x - (w * 0.5) / W;

    return [
      {
        id: `${id}_win`,
        type: 'shape',
        kind: 'pill',
        t: [at, t[1]],
        x,
        y,
        w,
        h,
        fill: '@surf',
        stroke: '@acc',
        strokeWidth: 3,
        motion: [{ m: 'pop', at, dur: 0.35 }],
      },
      {
        id: `${id}_dot1`,
        type: 'shape',
        kind: 'ellipse',
        t: [at + 0.05, t[1]],
        x: leftX + 54 / W,
        y,
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
        x: leftX + 84 / W,
        y,
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
        x: leftX + 114 / W,
        y,
        w: 18,
        h: 18,
        fill: '#28C840',
        parent: `${id}_win`,
      },
      {
        id: `${id}_lock`,
        type: 'icon',
        name: 'lock',
        t: [at + 0.1, t[1]],
        x: leftX + 168 / W,
        y,
        w: 28,
        color: '@acc',
        parent: `${id}_win`,
      },
      {
        id: `${id}_url`,
        type: 'text',
        t: [at + 0.12, t[1]],
        x: leftX + 206 / W,
        y,
        w: w - 260,
        anchor: 'left',
        align: 'left',
        text: String(args.url ?? 'https://recipestudio.video'),
        size: 32,
        font: 'sans',
        weight: 700,
        color: '@ink',
        enter: { type: 'typeOn', dur: 0.55 },
        parent: `${id}_win`,
      },
    ];
  });

  // 12. toast: roundRect style card (or warnp for warn) sliding in from the side, icon + text.
  registerComponent('toast', (id, args, t, _tokens, W) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.86;
    const w = args.w ?? 520;
    const h = args.h ?? 86;
    const at = typeof args.at === 'number' ? args.at : t[0];
    const isWarn = args.tone === 'warn';
    const leftX = x - (w * 0.5) / W;

    return [
      {
        id: `${id}_bg`,
        type: 'shape',
        kind: 'roundRect',
        t: [at, t[1]],
        x,
        y,
        w,
        h,
        radius: 28,
        style: isWarn ? 'warnp' : 'card',
        motion: [{ m: 'slide', at, from: args.from ?? 'R', dist: 120, dur: 0.35 }],
      },
      {
        id: `${id}_ico`,
        type: 'icon',
        name: args.icon || (isWarn ? 'warning' : 'bell'),
        t: [at + 0.04, t[1]],
        x: leftX + 44 / W,
        y,
        w: 32,
        color: isWarn ? '@warn' : '@acc',
        parent: `${id}_bg`,
      },
      {
        id: `${id}_txt`,
        type: 'text',
        t: [at + 0.05, t[1]],
        x: leftX + 86 / W,
        y,
        w: w - 110,
        anchor: 'left',
        align: 'left',
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

  // 13. kpi: card with a big counter (display 800, 120-180) and a label (sans 700 @muted).
  registerComponent('kpi', (id, args, t, _tokens, _W, H) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.5;
    const w = args.w ?? 420;
    const h = args.h ?? 260;
    const at = typeof args.at === 'number' ? args.at : t[0];
    const valSize = args.size ?? 124;

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
        y: y - 22 / H,
        w: w - 36,
        from: Number(args.count[0]) || 0,
        to: Number(args.count[1]) || 100,
        format: fmt,
        size: valSize,
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
        y: y - 22 / H,
        w: w - 36,
        text: String(args.value ?? '100%'),
        size: valSize,
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
      y: y + 64 / H,
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

  // 14. timeline: track pill (@track) + fill (@acc, left-pinned grow) over dur;
  // one node per label: ellipse w=50 style disc that pops as the fill passes it, label under it (sans 800 size 28);
  // the last node is @acc w=64 with a check icon and a ring burst when finalTone:"acc".
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
        kind: 'pill',
        t: [at, t[1]],
        x: leftX,
        y,
        w,
        h: 12,
        anchor: 'left',
        fill: '@track',
      },
      {
        id: `${id}_fill`,
        type: 'shape',
        kind: 'pill',
        t: [at, t[1]],
        x: leftX,
        y,
        w,
        h: 12,
        anchor: 'left',
        fill: '@acc',
        glow: 0.8,
        motion: [{ m: 'grow', at, axis: 'w', from: 0, to: w, dur }],
      },
    ];

    nodes.forEach((label, idx) => {
      const frac = nodes.length === 1 ? 0.5 : idx / (nodes.length - 1);
      const nx = leftX + (w * frac) / W;
      const nodeAt = at + frac * dur;
      const isLast = idx === nodes.length - 1;
      const useAcc = isLast && args.finalTone === 'acc';
      const nodeSize = useAcc ? 64 : 50;

      const nodeMotions: any[] = [{ m: 'pop', at: nodeAt, over: 1.25, dur: 0.28 }];
      if (useAcc) {
        nodeMotions.push({ m: 'burst', at: nodeAt, r: 64, to: 1.8, dur: 0.6, color: '@acc' });
      }

      layers.push({
        id: `${id}_n${idx}`,
        type: 'shape',
        kind: 'ellipse',
        t: [nodeAt, t[1]],
        x: nx,
        y,
        w: nodeSize,
        h: nodeSize,
        style: useAcc ? undefined : 'disc',
        fill: useAcc ? '@acc' : undefined,
        glow: useAcc ? 1.0 : 0.4,
        motion: nodeMotions,
      });

      if (useAcc) {
        layers.push({
          id: `${id}_chk${idx}`,
          type: 'icon',
          name: 'check',
          t: [nodeAt + 0.03, t[1]],
          x: nx,
          y,
          w: 32,
          color: '@dark',
          parent: `${id}_n${idx}`,
          motion: [{ m: 'pop', at: nodeAt + 0.03, dur: 0.24 }],
        });
      }

      layers.push({
        id: `${id}_lbl${idx}`,
        type: 'text',
        t: [nodeAt + 0.04, t[1]],
        x: nx,
        y: y + 48 / H,
        w: 160,
        text: String(label),
        size: 28,
        font: 'sans',
        weight: 800,
        color: useAcc ? '@acc' : '@ink',
        fit: 'shrink',
        enter: 'fadeUp',
      });
    });

    return layers;
  });

  // 15. logo: image on an hdisc disc 15-20% larger than the image.
  registerComponent('logo', (id, args, t) => {
    const x = args.x ?? 0.5;
    const y = args.y ?? 0.5;
    const imgSize = args.size ?? 160;
    const discSize = Math.round(imgSize * 1.18);
    const at = typeof args.at === 'number' ? args.at : t[0];

    return [
      {
        id: `${id}_bg`,
        type: 'shape',
        kind: 'ellipse',
        t: [at, t[1]],
        x,
        y,
        w: discSize,
        h: discSize,
        style: 'hdisc',
        motion: [{ m: 'pop', at, dur: 0.32 }],
      },
      {
        id: `${id}_img`,
        type: 'image',
        asset: args.asset || 'logo',
        t: [at + 0.04, t[1]],
        x,
        y,
        w: imgSize,
        h: imgSize,
        parent: `${id}_bg`,
      },
    ];
  });

  // 16. photo: image anchored at bottom (anchor:"bottom", w 0.42 of canvas width, breathe) with a light disc (w=640, gradr disc colors, z below).
  registerComponent('photo', (id, args, t, _tokens, W) => {
    const side = args.side ?? 'center';
    const x = args.x ?? (side === 'left' ? 0.28 : side === 'right' ? 0.72 : 0.5);
    const y = args.y ?? 0.92;
    const discY = args.discY ?? 0.56;
    const imgW = args.size ?? Math.round(W * 0.42);
    const at = typeof args.at === 'number' ? args.at : t[0];
    const baseZ = typeof args.z === 'number' ? args.z : 0;

    return [
      {
        id: `${id}_disc`,
        type: 'shape',
        kind: 'ellipse',
        t: [at, t[1]],
        x,
        y: discY,
        w: 640,
        h: 640,
        fill: 'gradr(@discHi,@discLo)',
        z: baseZ - 1,
        motion: [{ m: 'pop', at, dur: 0.35 }],
      },
      {
        id: `${id}_img`,
        type: 'image',
        asset: args.asset || 'photo',
        t: [at + 0.05, t[1]],
        x,
        y,
        w: imgW,
        anchor: 'bottom',
        z: baseZ,
        motion: [
          { m: 'rise', at: at + 0.05, dur: 0.35 },
          { m: 'breathe', at: at + 0.4, period: 2.4, amt: 1.035 },
        ],
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
  canvasH: number,
  depth = 0
): Layer[] {
  if (depth > 8) return [];
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

    // Recursively expand any nested `use` layers inside user defs
    const expandedChildren: Layer[] = [];
    subLayers.forEach((c, idx) => {
      const childWithId: Layer = {
        ...c,
        id: `${layer.id}_${c.id || idx}`,
        t: c.t ?? [at, layerT[1]],
      };
      if (childWithId.type === 'use') {
        expandedChildren.push(
          ...expandUseLayer(childWithId, [at, layerT[1]], defs, tokens, groupW, groupH, depth + 1)
        );
      } else {
        expandedChildren.push(childWithId);
      }
    });

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
        children: expandedChildren,
      },
    ];
  }

  return [];
}
