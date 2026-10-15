import { distanceLabel, legColour, legKind, legTitle, minutesLabel, stopLabel } from './components/legPresentation';
import type { CheckedPassLeg, PersonalPass } from './types';

const WIDTH = 1200;
const PAD = 64;
const INK = '#edf7fb';
const MUTED = '#9bb2c1';
const TEAL = '#55e3d3';
const AMBER = '#fbbf24';
const GREEN = '#6ee7a8';

/** Wrap at word boundaries when possible, with a character fallback for long IDs and CJK. */
export function imageTextLines(context: CanvasRenderingContext2D, value: string, width: number): string[] {
  const lines: string[] = [];
  const pushLongToken = (token: string) => {
    let part = '';
    for (const character of Array.from(token)) {
      if (part && context.measureText(part + character).width > width) {
        lines.push(part);
        part = '';
      }
      part += character;
    }
    return part;
  };

  for (const paragraph of value.split(/\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= width) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        line = context.measureText(word).width <= width ? word : pushLongToken(word);
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
}

const clock = (value: string) => new Intl.DateTimeFormat('en-MY', {
  timeZone: 'Asia/Kuala_Lumpur', hour: 'numeric', minute: '2-digit',
}).format(new Date(value));

const day = (value: string) => new Intl.DateTimeFormat('en-MY', {
  timeZone: 'Asia/Kuala_Lumpur', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
}).format(new Date(value));

function legStart(leg: CheckedPassLeg): string | null {
  return leg.estimatedStartTime ?? (leg.startTimeMs === null ? null : new Date(leg.startTimeMs).toISOString());
}

function arrivalRelation(pass: PersonalPass): { text: string; colour: string } {
  const seconds = Math.round((Date.parse(pass.meeting.arrivalTime) - Date.parse(pass.estimatedArrivalTime)) / 1000);
  if (!Number.isFinite(seconds)) return { text: 'Meeting margin unavailable', colour: MUTED };
  if (seconds >= 0 && seconds < 60) return { text: 'Arrive on time for the meeting', colour: GREEN };
  if (seconds > 0) return { text: `Arrive ${minutesLabel(seconds)} before the meeting`, colour: GREEN };
  return { text: `Arrive ${minutesLabel(-seconds)} after the meeting`, colour: AMBER };
}

interface StopLayout {
  code: string | null;
  lines: string[];
}

interface TimelineLayout {
  leg: CheckedPassLeg;
  kind: ReturnType<typeof legKind>;
  colour: string;
  height: number;
  titleLines: string[];
  subtitleLines: string[];
  from: StopLayout;
  to: StopLayout;
}

export function drawPassCanvas(pass: PersonalPass, qr: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const c = canvas.getContext('2d');
  if (!c) throw new Error('Image export is unavailable in this browser.');

  canvas.width = WIDTH;
  c.font = '800 52px "Plus Jakarta Sans", sans-serif';
  const title = imageTextLines(c, pass.meeting.venue.name, WIDTH - PAD * 2 - 230);
  const headerHeight = 210 + Math.max(0, title.length - 1) * 58;
  const timeX = PAD;
  const railX = PAD + 132;
  const contentX = railX + 42;
  const cardX = contentX - 14;
  const cardWidth = WIDTH - PAD - cardX;
  const walkStopX = contentX + 42;
  const transitStopX = cardX + 108;
  const textRight = WIDTH - PAD;

  const codeChipWidth = (code: string | null) => {
    if (!code) return 0;
    c.font = '700 17px Manrope, sans-serif';
    return Math.max(62, c.measureText(code).width + 22) + 12;
  };
  const stopLayout = (raw: string, x: number): StopLayout => {
    const label = stopLabel(raw);
    const availableWidth = Math.max(120, textRight - x - codeChipWidth(label.code));
    c.font = '600 25px Manrope, sans-serif';
    return { code: label.code, lines: imageTextLines(c, label.name, availableWidth) };
  };

  const timeline: TimelineLayout[] = pass.legs.map(leg => {
    const kind = legKind(leg);
    const heading = legTitle(leg);
    // Keep the title column clear of the duration at the card's right edge.
    const cardTextWidth = cardWidth - 44 - 120;
    c.font = '800 29px "Plus Jakarta Sans", sans-serif';
    const titleLines = imageTextLines(c, heading.title, cardTextWidth);
    c.font = '22px Manrope, sans-serif';
    const subtitleLines = heading.subtitle ? imageTextLines(c, heading.subtitle, cardTextWidth) : [];
    const from = stopLayout(leg.from.name, transitStopX);
    const to = stopLayout(leg.to.name, kind === 'walk' ? walkStopX : transitStopX);
    if (kind === 'walk') {
      return { leg, kind, colour: legColour(leg), height: 112 + to.lines.length * 30, titleLines, subtitleLines, from, to };
    }
    const height = 144 + titleLines.length * 36 + subtitleLines.length * 28 + (from.lines.length + to.lines.length) * 31;
    return { leg, kind, colour: legColour(leg), height, titleLines, subtitleLines, from, to };
  });

  c.font = '22px Manrope, sans-serif';
  const directions = pass.walking.directions.map(step => imageTextLines(c,
    `${step.relativeDirection.replace(/_/g, ' ').toLowerCase()}${step.streetName ? ` · ${step.streetName}` : ''} · ${distanceLabel(step.distanceMeters)}`,
    WIDTH - PAD * 2 - 62,
  ));
  const walkingHeight = directions.length
    ? 78 + directions.reduce((sum, lines) => sum + Math.max(38, lines.length * 30 + 12), 0)
    : 0;
  const evidence = pass.evidenceMode === 'route-only'
    ? 'Planning estimate based on OSM / GTFS. Live delays, weather and venue hours were not checked.'
    : `Plan check: ${pass.status} · ${pass.weakPoint.label}`;
  const evidenceLines = imageTextLines(c, evidence, WIDTH - PAD * 2);
  c.font = '700 24px Manrope, sans-serif';
  const arrivalLines = imageTextLines(c, `Arrive at ${pass.meeting.venue.name}`, WIDTH - PAD * 2 - 174);
  const arrivalHeight = Math.max(72, 42 + arrivalLines.length * 31);
  const timelineHeight = 76 + timeline.reduce((sum, item) => sum + item.height, 0) + arrivalHeight;
  const footerHeight = 350 + evidenceLines.length * 30;
  const height = headerHeight + 30 + 224 + 36 + 374 + 54 + timelineHeight + walkingHeight + footerHeight;
  canvas.height = height;

  const text = (value: string, x: number, y: number, font = '26px Manrope, sans-serif', colour = INK) => {
    c.font = font;
    c.fillStyle = colour;
    c.fillText(value, x, y);
  };
  const box = (x: number, y: number, w: number, h: number, colour: string, radius = 22) => {
    c.fillStyle = colour;
    c.beginPath();
    c.roundRect(x, y, w, h, radius);
    c.fill();
  };
  const dot = (x: number, y: number, radius: number, colour: string) => {
    c.fillStyle = colour;
    c.beginPath();
    c.arc(x, y, radius, 0, Math.PI * 2);
    c.fill();
  };
  const chip = (value: string, x: number, y: number) => {
    c.font = '700 17px Manrope, sans-serif';
    const width = Math.max(62, c.measureText(value).width + 22);
    box(x, y - 22, width, 30, '#284052', 8);
    text(value, x + 11, y, '700 17px Manrope, sans-serif', '#c8d8e2');
    return width;
  };
  const drawStop = (label: StopLayout, x: number, y: number, lineHeight = 31) => {
    let nameX = x;
    if (label.code) nameX += chip(label.code, x, y) + 12;
    label.lines.forEach((line, index) => text(line, index === 0 ? nameX : x, y + index * lineHeight, '600 25px Manrope, sans-serif'));
  };

  c.fillStyle = '#07131f';
  c.fillRect(0, 0, WIDTH, height);
  const glow = c.createLinearGradient(0, 0, WIDTH, headerHeight);
  glow.addColorStop(0, '#153f48');
  glow.addColorStop(0.65, '#102b39');
  glow.addColorStop(1, '#0c2130');
  c.fillStyle = glow;
  c.fillRect(0, 0, WIDTH, headerHeight);
  text('TRANSITREACH', PAD, 66, '800 28px "Plus Jakarta Sans", sans-serif', TEAL);
  text('PERSONAL TRAVEL PASS', WIDTH - PAD - 292, 64, '700 20px Manrope, sans-serif', '#cbdce5');
  title.forEach((line, index) => text(line, PAD, 137 + index * 58, '800 52px "Plus Jakarta Sans", sans-serif'));
  text(day(pass.meeting.arrivalTime), PAD, headerHeight - 32, '24px Manrope, sans-serif', '#bed0da');
  box(WIDTH - PAD - 172, headerHeight - 65, 172, 38, 'rgba(7, 19, 31, 0.38)', 19);
  text(`ROOM ${pass.roomCode}`, WIDTH - PAD - 153, headerHeight - 39, '700 17px Manrope, sans-serif', TEAL);

  let y = headerHeight + 30;
  box(PAD, y, WIDTH - PAD * 2, 224, '#112838', 26);
  text(pass.zeroTravel ? 'YOU ARE ALREADY THERE' : 'LEAVE AROUND', PAD + 30, y + 42, '700 19px Manrope, sans-serif', MUTED);
  text(pass.zeroTravel ? 'No travel needed' : clock(pass.leaveTime), PAD + 30, y + 111,
    pass.zeroTravel ? '800 48px "Plus Jakarta Sans", sans-serif' : '800 58px "Plus Jakarta Sans", sans-serif', TEAL);
  const heroDivider = PAD + 475;
  c.strokeStyle = '#294657';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(heroDivider, y + 28);
  c.lineTo(heroDivider, y + 138);
  c.stroke();
  text('EXPECTED ARRIVAL', heroDivider + 30, y + 42, '700 19px Manrope, sans-serif', MUTED);
  text(clock(pass.estimatedArrivalTime), heroDivider + 30, y + 88, '800 35px "Plus Jakarta Sans", sans-serif');
  const relation = arrivalRelation(pass);
  text(relation.text, heroDivider + 30, y + 126, '700 22px Manrope, sans-serif', relation.colour);
  c.strokeStyle = '#294657';
  c.beginPath();
  c.moveTo(PAD + 28, y + 154);
  c.lineTo(WIDTH - PAD - 28, y + 154);
  c.stroke();
  const duration = Math.max(0, Math.round((Date.parse(pass.estimatedArrivalTime) - Date.parse(pass.leaveTime)) / 60000));
  const transfers = Math.max(0, pass.legs.filter(leg => leg.transitLeg).length - 1);
  const summaries = [
    `${duration} min journey`,
    `${minutesLabel(pass.walking.totalSeconds)} walking`,
    transfers === 1 ? '1 transfer' : `${transfers} transfers`,
    `Meeting ${clock(pass.meeting.arrivalTime)} MYT`,
  ];
  summaries.forEach((summary, index) => {
    const x = PAD + 30 + index * 265;
    if (index) dot(x - 22, y + 190, 3, '#456273');
    text(summary, x, y + 197, '600 20px Manrope, sans-serif', '#c3d3dc');
  });
  y += 260;

  // This is a schematic of recorded leg geometry. It never fetches or invents a basemap.
  box(PAD, y, WIDTH - PAD * 2, 374, '#0e2433', 24);
  text('YOUR ROUTE', PAD + 28, y + 42, '800 22px "Plus Jakarta Sans", sans-serif', TEAL);
  text('Recorded route geometry · schematic only', WIDTH - PAD - 390, y + 41, '19px Manrope, sans-serif', MUTED);
  const paths = pass.legs.map(leg => ({ leg, points: leg.geometry.filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lon)) }));
  const points = paths.flatMap(path => path.points);
  const plotLeft = PAD + 30;
  const plotTop = y + 68;
  const plotWidth = WIDTH - PAD * 2 - 60;
  const plotHeight = 268;
  c.save();
  c.beginPath();
  c.rect(plotLeft, plotTop, plotWidth, plotHeight);
  c.clip();
  c.fillStyle = '#112a3a';
  c.fillRect(plotLeft, plotTop, plotWidth, plotHeight);
  c.strokeStyle = '#1b394a';
  c.lineWidth = 1;
  c.setLineDash([3, 13]);
  for (let gx = plotLeft + 30; gx < plotLeft + plotWidth; gx += 80) {
    c.beginPath(); c.moveTo(gx, plotTop); c.lineTo(gx, plotTop + plotHeight); c.stroke();
  }
  for (let gy = plotTop + 30; gy < plotTop + plotHeight; gy += 70) {
    c.beginPath(); c.moveTo(plotLeft, gy); c.lineTo(plotLeft + plotWidth, gy); c.stroke();
  }
  c.setLineDash([]);
  if (points.length >= 2 && !pass.zeroTravel) {
    const west = Math.min(...points.map(point => point.lon));
    const east = Math.max(...points.map(point => point.lon));
    const south = Math.min(...points.map(point => point.lat));
    const north = Math.max(...points.map(point => point.lat));
    const lonScale = Math.max(0.1, Math.cos((south + north) * Math.PI / 360));
    const spanX = Math.max((east - west) * lonScale, 0.00001);
    const spanY = Math.max(north - south, 0.00001);
    const scale = Math.min((plotWidth - 80) / spanX, (plotHeight - 60) / spanY);
    const drawnWidth = spanX * scale;
    const drawnHeight = spanY * scale;
    const project = (point: { lat: number; lon: number }): [number, number] => [
      plotLeft + (plotWidth - drawnWidth) / 2 + (point.lon - west) * lonScale * scale,
      plotTop + (plotHeight - drawnHeight) / 2 + (north - point.lat) * scale,
    ];
    for (const path of paths) {
      if (path.points.length < 2) continue;
      const kind = legKind(path.leg);
      c.strokeStyle = legColour(path.leg);
      c.lineWidth = kind === 'walk' ? 6 : 11;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.setLineDash(kind === 'walk' ? [6, 12] : []);
      c.beginPath();
      path.points.forEach((point, index) => {
        const [x, py] = project(point);
        if (index === 0) c.moveTo(x, py); else c.lineTo(x, py);
      });
      c.stroke();
    }
    c.setLineDash([]);
    const first = project(points[0]);
    const last = project(points[points.length - 1]);
    dot(first[0], first[1], 13, '#ffffff'); dot(first[0], first[1], 8, TEAL);
    dot(last[0], last[1], 13, '#ffffff'); dot(last[0], last[1], 8, AMBER);
  } else {
    text(pass.zeroTravel ? 'Your starting point is the meeting point.' : 'Route geometry unavailable · Use the itinerary below.', plotLeft + 30, plotTop + 142, '25px Manrope, sans-serif', MUTED);
  }
  c.restore();
  y += 428;

  text('JOURNEY TIMELINE', PAD, y, '800 27px "Plus Jakarta Sans", sans-serif');
  text('Times shown in MYT', WIDTH - PAD - 205, y, '20px Manrope, sans-serif', MUTED);
  y += 48;
  timeline.forEach(item => {
    const start = legStart(item.leg);
    const nodeY = y + 20;
    text(start ? clock(start) : '—', timeX, nodeY + 8, '700 21px Manrope, sans-serif', item.kind === 'walk' ? MUTED : item.colour);
    c.strokeStyle = item.colour;
    c.lineWidth = item.kind === 'walk' ? 3 : 7;
    c.setLineDash(item.kind === 'walk' ? [7, 9] : []);
    c.beginPath();
    c.moveTo(railX, nodeY + 10);
    c.lineTo(railX, y + item.height + 10);
    c.stroke();
    c.setLineDash([]);
    dot(railX, nodeY + 8, item.kind === 'walk' ? 8 : 11, '#07131f');
    c.strokeStyle = item.colour;
    c.lineWidth = 4;
    c.beginPath(); c.arc(railX, nodeY + 8, item.kind === 'walk' ? 8 : 11, 0, Math.PI * 2); c.stroke();

    if (item.kind === 'walk') {
      text(`Walk · ${minutesLabel(item.leg.durationSeconds)} · ${distanceLabel(item.leg.distanceMeters)}`, contentX, y + 32, '700 23px Manrope, sans-serif', '#c2d1da');
      text('TO', contentX, y + 69, '700 16px Manrope, sans-serif', MUTED);
      drawStop(item.to, walkStopX, y + 70, 30);
    } else {
      box(cardX, y, cardWidth, item.height - 18, '#132c3d', 20);
      box(cardX, y, 8, item.height - 18, item.colour, 4);
      const badge = item.kind === 'bus'
        ? 'BUS'
        : item.kind === 'rail'
          ? 'RAIL'
          : item.leg.mode === 'UNKNOWN' ? 'TRANSIT' : item.leg.mode;
      c.font = '800 17px Manrope, sans-serif';
      const badgeWidth = Math.max(68, c.measureText(badge).width + 28);
      box(cardX + 22, y + 20, badgeWidth, 32, item.colour, 9);
      text(badge, cardX + 36, y + 43, '800 17px Manrope, sans-serif', '#07131f');
      text(minutesLabel(item.leg.durationSeconds), cardX + cardWidth - 105, y + 43, '700 19px Manrope, sans-serif', MUTED);
      if (item.leg.stopCount !== null && item.leg.stopCount !== undefined) {
        text(item.leg.stopCount === 1 ? '1 stop' : `${item.leg.stopCount} stops`, cardX + cardWidth - 105, y + 68, '600 16px Manrope, sans-serif', MUTED);
      }
      let cardY = y + 82;
      item.titleLines.forEach(line => {
        text(line, cardX + 22, cardY, '800 29px "Plus Jakarta Sans", sans-serif');
        cardY += 36;
      });
      item.subtitleLines.forEach(line => {
        text(line, cardX + 22, cardY, '21px Manrope, sans-serif', MUTED);
        cardY += 28;
      });
      cardY += 12;
      text('BOARD', cardX + 22, cardY, '700 16px Manrope, sans-serif', item.colour);
      drawStop(item.from, transitStopX, cardY, 31);
      cardY += Math.max(38, item.from.lines.length * 31) + 13;
      text('ALIGHT', cardX + 22, cardY, '700 16px Manrope, sans-serif', item.colour);
      drawStop(item.to, transitStopX, cardY, 31);
    }
    y += item.height;
  });
  text(clock(pass.estimatedArrivalTime), timeX, y + 27, '700 21px Manrope, sans-serif', AMBER);
  dot(railX, y + 20, 12, '#ffffff');
  dot(railX, y + 20, 7, AMBER);
  arrivalLines.forEach((line, index) => {
    text(line, contentX, y + 28 + index * 31, '700 24px Manrope, sans-serif');
  });
  y += arrivalHeight;

  if (directions.length) {
    text('WALKING NOTES', PAD, y, '800 23px "Plus Jakarta Sans", sans-serif', '#cbd9e1');
    y += 40;
    directions.forEach((lines, index) => {
      text(String(index + 1).padStart(2, '0'), PAD, y, '700 19px Manrope, sans-serif', TEAL);
      lines.forEach(line => {
        text(line, PAD + 54, y, '21px Manrope, sans-serif', MUTED);
        y += 30;
      });
      y += 12;
    });
    y += 18;
  }

  c.strokeStyle = '#31566b';
  c.lineWidth = 2;
  c.setLineDash([10, 10]);
  c.beginPath(); c.moveTo(PAD, y); c.lineTo(WIDTH - PAD, y); c.stroke();
  c.setLineDash([]);
  y += 30;
  box(PAD, y, 240, 240, '#ffffff', 18);
  c.drawImage(qr, PAD + 10, y + 10, 220, 220);
  const footerX = PAD + 286;
  text('REOPEN YOUR GROUP', footerX, y + 35, '800 23px "Plus Jakarta Sans", sans-serif', TEAL);
  text('ROOM CODE', footerX, y + 79, '700 17px Manrope, sans-serif', MUTED);
  text(pass.roomCode, footerX, y + 126, '700 38px ui-monospace, SFMono-Regular, Menlo, monospace');
  text('Scan the QR to open the room invitation.', footerX, y + 170, '23px Manrope, sans-serif', '#cbd9e1');
  text('The QR contains no personal route or location.', footerX, y + 205, '20px Manrope, sans-serif', MUTED);
  text(`Saved ${clock(pass.checkedAt)} MYT · Reopen before travelling for the latest plan`, footerX, y + 239, '19px Manrope, sans-serif', MUTED);
  y += 282;
  evidenceLines.forEach(line => {
    text(line, PAD, y, '21px Manrope, sans-serif', MUTED);
    y += 30;
  });
  return canvas;
}
