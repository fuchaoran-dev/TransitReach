import type { PersonalPass } from './types';

const WIDTH = 1200;
const PAD = 64;
const INK = '#e5eff7';
const MUTED = '#a5bbc9';
const TEAL = '#55e3d3';

/** Preserve long place names, including text without spaces, without shrinking to unreadable type. */
export function imageTextLines(context: CanvasRenderingContext2D, value: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const character of Array.from(value)) {
    if (line && context.measureText(line + character).width > width) {
      lines.push(line.trim());
      line = '';
    }
    line += character;
  }
  if (line.trim()) lines.push(line.trim());
  return lines.length ? lines : [''];
}

const clock = (value: string) => new Intl.DateTimeFormat('en-MY', {
  timeZone: 'Asia/Kuala_Lumpur', hour: 'numeric', minute: '2-digit',
}).format(new Date(value));
const day = (value: string) => new Intl.DateTimeFormat('en-MY', {
  timeZone: 'Asia/Kuala_Lumpur', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
}).format(new Date(value));
const modeColour = (mode: string) => mode === 'WALK' ? TEAL : mode === 'BUS' ? '#93b5ff' : '#fbbf24';

export function drawPassCanvas(pass: PersonalPass, qr: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const c = canvas.getContext('2d');
  if (!c) throw new Error('Image export is unavailable in this browser.');
  c.font = '800 48px "Plus Jakarta Sans", sans-serif';
  const title = imageTextLines(c, pass.meeting.venue.name, WIDTH - PAD * 2);
  const headerHeight = 185 + title.length * 62;
  c.font = '600 28px Manrope, sans-serif';
  const legLines = pass.legs.map(leg => imageTextLines(c, `${leg.from.name} → ${leg.to.name}`, WIDTH - PAD * 2 - 190));
  const legHeights = legLines.map(lines => Math.max(125, 65 + lines.length * 38));
  c.font = '24px Manrope, sans-serif';
  const directions = pass.walking.directions.map(step => imageTextLines(c,
    `${step.relativeDirection.replace(/_/g, ' ').toLowerCase()}${step.streetName ? ` · ${step.streetName}` : ''} · ${Math.round(step.distanceMeters)} m`, WIDTH - PAD * 2 - 48));
  const walkingHeight = directions.length ? 90 + directions.reduce((sum, lines) => sum + lines.length * 34 + 18, 0) : 0;
  const evidence = pass.evidenceMode === 'route-only' ? 'OSM / GTFS estimate · Live delays, weather and hours not checked.' : `Plan check: ${pass.status} · ${pass.weakPoint.label}`;
  const evidenceLines = imageTextLines(c, evidence, WIDTH - PAD * 2);
  const height = headerHeight + 230 + 420 + 115 + legHeights.reduce((sum, h) => sum + h, 0) + walkingHeight + 340 + 80 + evidenceLines.length * 34;
  canvas.width = WIDTH;
  canvas.height = height;

  const text = (value: string, x: number, y: number, font = '26px Manrope, sans-serif', colour = INK) => {
    c.font = font; c.fillStyle = colour; c.fillText(value, x, y);
  };
  const box = (x: number, y: number, w: number, h: number, colour: string, radius = 22) => {
    c.fillStyle = colour; c.beginPath(); c.roundRect(x, y, w, h, radius); c.fill();
  };
  const dot = (x: number, y: number, radius: number, colour: string) => {
    c.fillStyle = colour; c.beginPath(); c.arc(x, y, radius, 0, Math.PI * 2); c.fill();
  };
  c.fillStyle = '#08121d'; c.fillRect(0, 0, WIDTH, height);
  const glow = c.createLinearGradient(0, 0, WIDTH, headerHeight);
  glow.addColorStop(0, '#153d47'); glow.addColorStop(1, '#102331');
  c.fillStyle = glow; c.fillRect(0, 0, WIDTH, headerHeight);
  text('TRANSITREACH', PAD, 73, '800 30px "Plus Jakarta Sans", sans-serif', TEAL);
  text('PERSONAL TRAVEL PASS', WIDTH - 428, 73, '600 24px Manrope, sans-serif');
  title.forEach((line, i) => text(line, PAD, 142 + i * 62, '800 48px "Plus Jakarta Sans", sans-serif'));
  text(day(pass.meeting.arrivalTime), PAD, headerHeight - 36, '26px Manrope, sans-serif', MUTED);

  let y = headerHeight + 30;
  const metricWidth = (WIDTH - PAD * 2 - 32) / 3;
  [
    { label: pass.zeroTravel ? 'ALREADY AT VENUE' : 'LEAVE AROUND', value: pass.zeroTravel ? 'No travel' : clock(pass.leaveTime), colour: TEAL },
    { label: 'ESTIMATED ARRIVAL', value: clock(pass.estimatedArrivalTime), colour: INK },
    { label: 'MEETING TIME · MYT', value: clock(pass.meeting.arrivalTime), colour: '#fbbf24' },
  ].forEach((metric, index) => {
    const x = PAD + index * (metricWidth + 16);
    box(x, y, metricWidth, 130, '#152939');
    text(metric.label, x + 20, y + 37, '600 19px Manrope, sans-serif', MUTED);
    text(metric.value, x + 20, y + 92, '800 34px "Plus Jakarta Sans", sans-serif', metric.colour);
  });
  y += 174;
  const duration = Math.max(0, Math.round((Date.parse(pass.estimatedArrivalTime) - Date.parse(pass.leaveTime)) / 60000));
  const transfers = Math.max(0, pass.legs.filter(leg => leg.transitLeg).length - 1);
  text(`${duration} min journey    ·    ${Math.ceil(pass.walking.totalSeconds / 60)} min walk    ·    ${transfers} transfers`, PAD, y, '600 24px Manrope, sans-serif', MUTED);
  y += 42;

  // A route sketch made ONLY from recorded geometry, not invented links or external tiles.
  box(PAD, y, WIDTH - PAD * 2, 400, '#102434');
  text('YOUR ROUTE', PAD + 24, y + 39, '700 22px Manrope, sans-serif', TEAL);
  const paths = pass.legs.map(leg => ({ mode: leg.mode, points: leg.geometry.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)) }));
  const points = paths.flatMap(path => path.points);
  if (points.length >= 2 && !pass.zeroTravel) {
    const west = Math.min(...points.map(p => p.lon));
    const east = Math.max(...points.map(p => p.lon));
    const south = Math.min(...points.map(p => p.lat));
    const north = Math.max(...points.map(p => p.lat));
    const lonScale = Math.cos((south + north) * Math.PI / 360);
    const spanX = Math.max((east - west) * lonScale, 0.00001);
    const spanY = Math.max(north - south, 0.00001);
    const scale = Math.min((WIDTH - PAD * 2 - 110) / spanX, 255 / spanY);
    const x0 = WIDTH / 2 - spanX * scale / 2;
    const y0 = y + 95 + spanY * scale / 2;
    const project = (p: { lat: number; lon: number }) => [x0 + (p.lon - west) * lonScale * scale, y0 + ((north + south) / 2 - p.lat) * scale];
    c.save(); c.beginPath(); c.rect(PAD + 20, y + 60, WIDTH - PAD * 2 - 40, 305); c.clip();
    c.strokeStyle = '#244052'; c.lineWidth = 1;
    for (let gx = PAD + 20; gx < WIDTH - PAD; gx += 60) { c.beginPath(); c.moveTo(gx, y + 60); c.lineTo(gx, y + 365); c.stroke(); }
    for (let gy = y + 60; gy < y + 365; gy += 60) { c.beginPath(); c.moveTo(PAD + 20, gy); c.lineTo(WIDTH - PAD - 20, gy); c.stroke(); }
    for (const path of paths) {
      if (path.points.length < 2) continue;
      c.strokeStyle = modeColour(path.mode); c.lineWidth = 7; c.lineCap = 'round'; c.lineJoin = 'round';
      c.setLineDash(path.mode === 'WALK' ? [10, 9] : []);
      c.beginPath(); path.points.forEach((p, i) => { const [x, py] = project(p); if (i === 0) c.moveTo(x, py); else c.lineTo(x, py); }); c.stroke();
    }
    c.setLineDash([]);
    const first = project(points[0]); const last = project(points[points.length - 1]);
    dot(first[0], first[1], 13, '#ffffff'); dot(first[0], first[1], 8, TEAL);
    dot(last[0], last[1], 13, '#ffffff'); dot(last[0], last[1], 8, '#fbbf24');
    c.restore();
    text(paths.some(path => path.points.length < 2) ? 'Route sketch · Some leg geometry unavailable' : 'Recorded route geometry · Schematic, no basemap', PAD + 24, y + 380, '20px Manrope, sans-serif', MUTED);
  } else {
    text(pass.zeroTravel ? 'Your starting point is the meeting point.' : 'Route geometry unavailable · See the itinerary below.', PAD + 30, y + 215, '26px Manrope, sans-serif', MUTED);
  }
  y += 448;
  text('JOURNEY TIMELINE', PAD, y, '800 26px "Plus Jakarta Sans", sans-serif');
  y += 36;
  pass.legs.forEach((leg, index) => {
    const rowHeight = legHeights[index];
    box(PAD, y, WIDTH - PAD * 2, rowHeight - 12, '#122535', 18);
    const colour = modeColour(leg.mode);
    box(PAD + 18, y + 20, 108, 44, colour, 12);
    text(leg.mode === 'WALK' ? 'WALK' : leg.mode === 'BUS' ? 'BUS' : 'RAIL', PAD + 30, y + 50, '800 21px Manrope, sans-serif', '#08121d');
    text(`${Math.ceil(leg.durationSeconds / 60)} min`, PAD + 26, y + 95, '22px Manrope, sans-serif', MUTED);
    const route = leg.routeShortName ?? leg.routeLongName;
    const start = leg.estimatedStartTime ?? (leg.startTimeMs === null ? null : new Date(leg.startTimeMs).toISOString());
    text(`${start ? clock(start) : 'Time unavailable'}${route ? `  ·  ${route}` : ''}`, PAD + 150, y + 35, '600 22px Manrope, sans-serif', colour);
    legLines[index].forEach((line, i) => text(line, PAD + 150, y + 73 + i * 38, '600 28px Manrope, sans-serif'));
    y += rowHeight;
  });
  if (directions.length) {
    y += 38; text('WALKING DIRECTIONS', PAD, y, '800 25px "Plus Jakarta Sans", sans-serif'); y += 42;
    directions.forEach((lines, i) => {
      text(String(i + 1).padStart(2, '0'), PAD, y, '700 22px Manrope, sans-serif', TEAL);
      lines.forEach(line => { text(line, PAD + 48, y, '24px Manrope, sans-serif', MUTED); y += 34; });
      y += 18;
    });
  }
  y += 30;
  c.strokeStyle = '#31566b'; c.lineWidth = 2; c.setLineDash([10, 10]);
  c.beginPath(); c.moveTo(PAD, y); c.lineTo(WIDTH - PAD, y); c.stroke(); c.setLineDash([]);
  y += 30;
  box(PAD, y, 268, 268, '#ffffff', 16); c.drawImage(qr, PAD + 10, y + 10, 248, 248);
  text('MEET WITH YOUR GROUP', PAD + 310, y + 50, '800 27px "Plus Jakarta Sans", sans-serif', TEAL);
  text(`Room ${pass.roomCode}   ·   Plan v${pass.planVersion}`, PAD + 310, y + 98, '600 26px Manrope, sans-serif');
  text('Scan to open the room invitation.', PAD + 310, y + 150, '24px Manrope, sans-serif', MUTED);
  text('QR contains no personal route or location.', PAD + 310, y + 187, '22px Manrope, sans-serif', MUTED);
  text(`Generated ${clock(pass.checkedAt)} MYT · Refresh before travel`, PAD + 310, y + 236, '21px Manrope, sans-serif', MUTED);
  y += 310;
  evidenceLines.forEach(line => { text(line, PAD, y, '24px Manrope, sans-serif', MUTED); y += 34; });
  return canvas;
}
