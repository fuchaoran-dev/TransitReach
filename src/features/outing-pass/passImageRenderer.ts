import { distanceLabel, legColour, legKind, legTitle, minutesLabel, stopLabel } from './components/legPresentation';
import type { CheckedPassLeg, PersonalPass } from './types';
import type { PassRouteBackdrop } from './passRouteMap';

const WIDTH = 1200;
const PAD = 64;
const INK = '#edf7fb';
const MUTED = '#adc5d4';
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

export function drawPassCanvas(pass: PersonalPass, qr: HTMLImageElement, backdrop?: PassRouteBackdrop | null): HTMLCanvasElement {
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
  const box = (x: number, y: number, w: number, h: number, colour: string | CanvasGradient, radius = 22) => {
    c.fillStyle = colour;
    c.beginPath();
    c.roundRect(x, y, w, h, radius);
    c.fill();
  };
  // Draw material depth independently of layout so the exported text and QR stay crisp.
  const surface = (x: number, y: number, w: number, h: number, accent = TEAL, recessed = false, radius = 28) => {
    c.save();
    c.shadowColor = '#000c';
    c.shadowBlur = recessed ? 12 : 24;
    c.shadowOffsetY = recessed ? 3 : 12;
    box(x, y + 5, w, h, '#020b14', radius);
    c.shadowOffsetY = 0;
    c.shadowColor = accent;
    c.shadowBlur = recessed ? 0 : 10;
    const fill = c.createLinearGradient(x, y, x + w, y + h);
    fill.addColorStop(0, recessed ? '#051521' : '#0c4e5b');
    fill.addColorStop(0.25, recessed ? '#0b2232' : '#0b2232');
    fill.addColorStop(0.65, '#091d2c');
    fill.addColorStop(0.85, recessed ? '#102538' : '#123b57');
    fill.addColorStop(1, recessed ? '#102d40' : '#1c597d');
    box(x, y, w, h, fill, radius);
    c.shadowBlur = 0;
    const edge = c.createLinearGradient(x, y, x + w, y + h);
    edge.addColorStop(0, '#54fff2');
    edge.addColorStop(0.2, accent);
    edge.addColorStop(0.45, '#19465f');
    edge.addColorStop(0.75, '#369ee6');
    edge.addColorStop(1, '#a4e9ff');
    c.strokeStyle = edge;
    c.lineWidth = recessed ? 1.5 : 2.5;
    c.stroke();
    if (!recessed) {
      // Edge light fades into the glass, rather than outlining a uniformly flat card.
      c.save();
      c.beginPath(); c.roundRect(x, y, w, h, radius); c.clip();
      const rim = c.createLinearGradient(x, y, x, y + h);
      rim.addColorStop(0, 'rgba(100, 223, 255, 0.24)');
      rim.addColorStop(0.06, 'rgba(26, 133, 188, 0.06)');
      rim.addColorStop(0.5, 'rgba(0, 30, 49, 0)');
      rim.addColorStop(0.94, 'rgba(0, 209, 220, 0.06)');
      rim.addColorStop(1, 'rgba(49, 237, 234, 0.18)');
      c.fillStyle = rim; c.fillRect(x, y, w, h);
      const side = c.createLinearGradient(x, y, x + w, y);
      side.addColorStop(0, 'rgba(0, 242, 226, 0.15)');
      side.addColorStop(0.04, 'rgba(0, 242, 226, 0)');
      side.addColorStop(0.94, 'rgba(85, 174, 255, 0)');
      side.addColorStop(1, 'rgba(85, 174, 255, 0.22)');
      c.fillStyle = side; c.fillRect(x, y, w, h);
      c.restore();
    }
    c.strokeStyle = 'rgba(203, 243, 255, 0.13)';
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect(x + 4, y + 4, w - 8, h - 8, Math.max(4, radius - 4));
    c.stroke();
    c.restore();
  };
  const dot = (x: number, y: number, radius: number, colour: string) => {
    c.fillStyle = colour;
    c.beginPath();
    c.arc(x, y, radius, 0, Math.PI * 2);
    c.fill();
  };
  const node = (x: number, y: number, radius: number, colour: string) => {
    c.save();
    c.shadowColor = '#000';
    c.shadowBlur = 8;
    c.shadowOffsetY = 5;
    dot(x, y + 4, radius + 2, '#06121e');
    c.shadowColor = colour;
    c.shadowBlur = 18;
    c.shadowOffsetY = 0;
    dot(x, y, radius + 2, colour);
    c.shadowBlur = 0;
    dot(x, y, radius, '#e5fbff');
    const gloss = c.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
    gloss.addColorStop(0, '#e0ffff');
    gloss.addColorStop(0.4, colour);
    gloss.addColorStop(1, colour);
    c.fillStyle = gloss;
    c.beginPath(); c.arc(x, y, Math.max(3, radius - 4), 0, Math.PI * 2); c.fill();
    c.restore();
  };
  const chip = (value: string, x: number, y: number) => {
    c.font = '700 17px Manrope, sans-serif';
    const width = Math.max(62, c.measureText(value).width + 22);
    surface(x, y - 22, width, 30, '#477a99', false, 8);
    text(value, x + 11, y, '700 17px Manrope, sans-serif', '#c8d8e2');
    return width;
  };
  const drawStop = (label: StopLayout, x: number, y: number, lineHeight = 31) => {
    let nameX = x;
    if (label.code) nameX += chip(label.code, x, y) + 12;
    label.lines.forEach((line, index) => text(line, index === 0 ? nameX : x, y + index * lineHeight, '600 25px Manrope, sans-serif'));
  };

  c.fillStyle = '#040e19';
  c.fillRect(0, 0, WIDTH, height);
  const glow = c.createLinearGradient(0, 0, WIDTH, height);
  glow.addColorStop(0, '#07313d');
  glow.addColorStop(0.3, '#061320');
  glow.addColorStop(1, '#03111c');
  c.fillStyle = glow;
  c.fillRect(0, 0, WIDTH, height);
  surface(PAD - 28, 24, WIDTH - PAD * 2 + 56, headerHeight - 24);
  text('TRANSITREACH', PAD, 66, '800 28px "Plus Jakarta Sans", sans-serif', TEAL);
  text('PERSONAL TRAVEL PASS', WIDTH - PAD - 292, 64, '700 20px Manrope, sans-serif', '#cbdce5');
  title.forEach((line, index) => text(line, PAD, 137 + index * 58, '800 52px "Plus Jakarta Sans", sans-serif'));
  text(day(pass.meeting.arrivalTime), PAD, headerHeight - 32, '24px Manrope, sans-serif', '#bed0da');
  surface(WIDTH - PAD - 172, headerHeight - 65, 172, 38, '#2686a4', false, 19);
  text(`ROOM ${pass.roomCode}`, WIDTH - PAD - 153, headerHeight - 39, '700 17px Manrope, sans-serif', TEAL);

  let y = headerHeight + 30;
  surface(PAD - 28, y, WIDTH - PAD * 2 + 56, 224);
  text(pass.zeroTravel ? 'YOU ARE ALREADY THERE' : 'LEAVE AROUND', PAD + 30, y + 42, '700 19px Manrope, sans-serif', MUTED);
  const departure = pass.zeroTravel ? 'No travel needed' : clock(pass.leaveTime);
  const departureFont = pass.zeroTravel ? '800 48px "Plus Jakarta Sans", sans-serif' : '800 68px "Plus Jakarta Sans", sans-serif';
  text(departure, PAD + 30, y + 117, departureFont, '#023e4c');
  c.save();
  c.shadowColor = '#2bded0';
  c.shadowBlur = 15;
  text(departure, PAD + 30, y + 111, departureFont, '#72fff0');
  c.restore();
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

  // Public building tiles and the route share a camera; offline export is explicitly labelled.
  surface(PAD - 28, y, WIDTH - PAD * 2 + 56, 374);
  text('YOUR ROUTE', PAD + 28, y + 42, '800 22px "Plus Jakarta Sans", sans-serif', TEAL);
  const mapLabel = backdrop ? 'Recorded route geometry · 3D map'
    : backdrop === null && !pass.zeroTravel ? '3D map unavailable · schematic only' : 'Recorded route geometry · schematic only';
  text(mapLabel, WIDTH - PAD - 390, y + 41, '19px Manrope, sans-serif', MUTED);
  const paths = pass.legs.map(leg => ({ leg, points: leg.geometry.filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lon)) }));
  const points = paths.flatMap(path => path.points);
  const plotLeft = PAD + 30;
  const plotTop = y + 68;
  const plotWidth = WIDTH - PAD * 2 - 60;
  const plotHeight = 268;
  surface(plotLeft, plotTop, plotWidth, plotHeight, '#25576d', true, 18);
  c.save();
  c.beginPath();
  c.roundRect(plotLeft + 2, plotTop + 2, plotWidth - 4, plotHeight - 4, 16);
  c.clip();
  if (backdrop) c.drawImage(backdrop.canvas, plotLeft, plotTop, plotWidth, plotHeight);
  c.strokeStyle = '#1b4054';
  c.globalAlpha = backdrop ? 0.28 : 1;
  c.lineWidth = 1;
  c.setLineDash([]);
  for (let gx = plotLeft + 30; gx < plotLeft + plotWidth; gx += 40) {
    c.beginPath(); c.moveTo(gx, plotTop); c.lineTo(gx, plotTop + plotHeight); c.stroke();
  }
  for (let gy = plotTop + 30; gy < plotTop + plotHeight; gy += 35) {
    c.beginPath(); c.moveTo(plotLeft, gy); c.lineTo(plotLeft + plotWidth, gy); c.stroke();
  }
  c.setLineDash([]);
  c.globalAlpha = 1;
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
    for (const [pathIndex, path] of paths.entries()) {
      if (path.points.length < 2) continue;
      const kind = legKind(path.leg);
      c.save();
      c.strokeStyle = legColour(path.leg);
      c.lineWidth = kind === 'walk' ? 6 : 12;
      c.shadowColor = legColour(path.leg);
      c.shadowBlur = kind === 'walk' ? 10 : 20;
      c.shadowOffsetY = kind === 'walk' ? 0 : 4;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.setLineDash(kind === 'walk' ? [6, 12] : []);
      c.beginPath();
      path.points.forEach((point, index) => {
        const mapped = backdrop?.paths[pathIndex]?.[index];
        const [x, py] = mapped ? [plotLeft + mapped[0], plotTop + mapped[1]] : project(point);
        if (index === 0) c.moveTo(x, py); else c.lineTo(x, py);
      });
      c.stroke();
      if (kind !== 'walk') {
        c.shadowBlur = 0;
        c.shadowOffsetY = 0;
        c.lineWidth = 3;
        c.strokeStyle = '#b4eaff';
        c.globalAlpha = 0.65;
        c.stroke();
      }
      c.restore();
    }
    c.setLineDash([]);
    const projectedPoints = backdrop?.paths.flat();
    const startPixel = projectedPoints?.[0];
    const endPixel = projectedPoints?.[projectedPoints.length - 1];
    const first = startPixel ? [plotLeft + startPixel[0], plotTop + startPixel[1]] : project(points[0]);
    const last = endPixel ? [plotLeft + endPixel[0], plotTop + endPixel[1]] : project(points[points.length - 1]);
    node(first[0], first[1], 13, TEAL);
    node(last[0], last[1], 13, AMBER);
  } else {
    text(pass.zeroTravel ? 'Your starting point is the meeting point.' : 'Route geometry unavailable · Use the itinerary below.', plotLeft + 30, plotTop + 142, '25px Manrope, sans-serif', MUTED);
  }
  if (backdrop) {
    box(plotLeft, plotTop + plotHeight - 25, plotWidth, 25, 'rgba(3, 15, 25, 0.85)', 0);
    text('OpenFreeMap · OpenMapTiles · © OpenStreetMap contributors', plotLeft + 12, plotTop + plotHeight - 8, '14px Manrope, sans-serif', MUTED);
  }
  c.restore();
  y += 428;

  surface(PAD - 28, y - 30, WIDTH - PAD * 2 + 56, timelineHeight + walkingHeight + 6);
  text('JOURNEY TIMELINE', PAD, y, '800 27px "Plus Jakarta Sans", sans-serif');
  text('Times shown in MYT', WIDTH - PAD - 205, y, '20px Manrope, sans-serif', MUTED);
  y += 48;
  timeline.forEach(item => {
    const start = legStart(item.leg);
    const nodeY = y + 20;
    text(start ? clock(start) : '—', timeX, nodeY + 8, '700 21px Manrope, sans-serif', item.kind === 'walk' ? MUTED : item.colour);
    c.strokeStyle = item.colour;
    c.lineWidth = item.kind === 'walk' ? 3 : 7;
    c.save();
    c.shadowColor = item.colour;
    c.shadowBlur = item.kind === 'walk' ? 8 : 16;
    c.lineCap = 'round';
    c.setLineDash(item.kind === 'walk' ? [7, 9] : []);
    c.beginPath();
    c.moveTo(railX, nodeY + 10);
    c.lineTo(railX, y + item.height + 10);
    c.stroke();
    c.restore();
    c.setLineDash([]);
    node(railX, nodeY + 8, item.kind === 'walk' ? 9 : 12, item.colour);

    if (item.kind === 'walk') {
      text(`Walk · ${minutesLabel(item.leg.durationSeconds)} · ${distanceLabel(item.leg.distanceMeters)}`, contentX, y + 32, '700 23px Manrope, sans-serif', '#c2d1da');
      text('TO', contentX, y + 69, '700 16px Manrope, sans-serif', MUTED);
      drawStop(item.to, walkStopX, y + 70, 30);
    } else {
      surface(cardX, y, cardWidth, item.height - 18, item.colour, false, 20);
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
  node(railX, y + 20, 12, AMBER);
  arrivalLines.forEach((line, index) => {
    text(line, contentX, y + 28 + index * 31, '700 24px Manrope, sans-serif');
  });
  y += arrivalHeight;

  if (directions.length) {
    surface(PAD - 10, y - 24, WIDTH - PAD * 2 + 20, walkingHeight - 6, '#28596f', true, 20);
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
  surface(PAD - 28, y - 14, WIDTH - PAD * 2 + 56, footerHeight - 44);
  c.save();
  c.shadowColor = '#000';
  c.shadowBlur = 18;
  c.shadowOffsetY = 8;
  box(PAD, y + 4, 240, 240, '#577b98', 22);
  const tile = c.createLinearGradient(PAD, y, PAD + 240, y + 240);
  tile.addColorStop(0, '#ffffff');
  tile.addColorStop(0.6, '#ffffff');
  tile.addColorStop(1, '#cfe5f3');
  box(PAD, y, 240, 240, tile, 22);
  c.restore();
  // Preserve the generated QR pixels and their white quiet zone; effects stay on the tile.
  c.imageSmoothingEnabled = false;
  c.drawImage(qr, PAD + 10, y + 10, 220, 220);
  c.imageSmoothingEnabled = true;
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
