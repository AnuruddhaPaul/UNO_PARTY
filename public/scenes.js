'use strict';
// Room backdrops, drawn as SVG so there are no image files to download. Each phone renders them itself.
// SCENES[key].svg() returns markup that fills its container (viewBox 390x780, cropped to fit any phone).
const SCENES = (() => {
  const rng = (seed) => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
  const wrap = (k, inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 390 780" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">${inner.replace(/#ID/g, '#' + k).replace(/id="ID/g, 'id="' + k)}</svg>`;

  const living = () => wrap('lv', `
<defs><linearGradient id="IDw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0dfc4"/><stop offset="1" stop-color="#dcc3a0"/></linearGradient>
<linearGradient id="IDg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe5ff"/><stop offset="1" stop-color="#eaf7ff"/></linearGradient>
<radialGradient id="IDl"><stop offset="0" stop-color="#ffd980" stop-opacity=".75"/><stop offset="1" stop-color="#ffd980" stop-opacity="0"/></radialGradient></defs>
<rect width="390" height="780" fill="url(#IDw)"/>
<rect y="552" width="390" height="228" fill="#b98a5a"/><rect y="548" width="390" height="10" fill="#8d6740"/>
${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<path d="M${i * 60 - 40} 558 L${i * 90 - 150} 780" stroke="#a37a50" stroke-width="2" opacity=".6"/>`).join('')}
<ellipse cx="195" cy="690" rx="250" ry="70" fill="#d86f5c" opacity=".55"/><ellipse cx="195" cy="690" rx="190" ry="48" fill="#f2b9a6" opacity=".45"/>
<rect x="95" y="62" width="200" height="236" rx="6" fill="#fff"/><rect x="104" y="72" width="182" height="216" fill="url(#IDg)"/>
<path d="M195 72 V288 M104 180 H286" stroke="#fff" stroke-width="7"/><circle cx="240" cy="116" r="22" fill="#fff6bf" opacity=".9"/>
<rect x="76" y="54" width="238" height="8" rx="4" fill="#6b4a30"/>
<path d="M82 60 H122 V290 Q102 300 82 290Z" fill="#c25a4a"/><path d="M268 60 H308 V290 Q288 300 268 290Z" fill="#c25a4a"/>
<path d="M96 60 V290 M110 60 V288 M282 60 V288 M296 60 V290" stroke="#a84434" stroke-width="3" opacity=".7"/>
<rect x="18" y="320" width="56" height="74" fill="#fff" stroke="#a07a50" stroke-width="5"/><path d="M26 384 L44 352 L56 370 L66 358 L66 384Z" fill="#6aa66a"/><circle cx="56" cy="340" r="6" fill="#f2c94c"/>
<rect x="318" y="330" width="56" height="56" fill="#fff" stroke="#a07a50" stroke-width="5"/><circle cx="346" cy="358" r="14" fill="#e8795a"/>
<rect x="30" y="392" width="330" height="126" rx="28" fill="#4f6fa8"/><rect x="12" y="462" width="366" height="92" rx="26" fill="#5a7fc0"/>
<rect x="40" y="470" width="96" height="62" rx="14" fill="#6a90d2"/><rect x="146" y="470" width="98" height="62" rx="14" fill="#6a90d2"/><rect x="254" y="470" width="96" height="62" rx="14" fill="#6a90d2"/>
<rect x="64" y="440" width="46" height="46" rx="10" fill="#f2c94c" transform="rotate(-12 87 463)"/><rect x="286" y="444" width="46" height="46" rx="10" fill="#e8795a" transform="rotate(10 309 467)"/>
<rect x="30" y="548" width="12" height="16" fill="#6b4a30"/><rect x="348" y="548" width="12" height="16" fill="#6b4a30"/>
<circle cx="356" cy="250" r="90" fill="url(#IDl)"/><path d="M356 292 V540" stroke="#6b4a30" stroke-width="6"/><path d="M330 292 L342 232 H370 L382 292Z" fill="#ffd980"/><ellipse cx="356" cy="542" rx="22" ry="6" fill="#6b4a30"/>
<rect x="14" y="490" width="44" height="52" rx="6" fill="#c76b3c" transform="translate(0 20)"/>
${[[-30, 36], [-8, 48], [14, 40], [-18, 24], [8, 26]].map(([a, h]) => `<ellipse cx="36" cy="${480 - h / 2}" rx="9" ry="${h}" fill="#3f9a58" transform="rotate(${a} 36 500)"/>`).join('')}`);

  const cafe = () => wrap('cf', `
<defs><pattern id="IDb" width="44" height="22" patternUnits="userSpaceOnUse"><rect width="44" height="22" fill="#6b3f31"/><path d="M0 0 H44 M0 11 H44 M0 22 H44 M22 0 V11 M0 11 V22 M44 11 V22" stroke="#4a2a20" stroke-width="2"/></pattern>
<pattern id="IDf" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="#d9c7a5"/><rect width="20" height="20" fill="#7d6a4c"/><rect x="20" y="20" width="20" height="20" fill="#7d6a4c"/></pattern>
<radialGradient id="IDl"><stop offset="0" stop-color="#ffd77a" stop-opacity=".8"/><stop offset="1" stop-color="#ffd77a" stop-opacity="0"/></radialGradient></defs>
<rect width="390" height="780" fill="#3a2a24"/><rect width="390" height="520" fill="url(#IDb)" opacity=".7"/>
<rect y="520" width="390" height="260" fill="url(#IDf)" opacity=".85"/><rect y="520" width="390" height="260" fill="#000" opacity=".25"/>
<rect x="52" y="64" width="286" height="150" rx="6" fill="#22302d" stroke="#8a6240" stroke-width="9"/>
<text x="195" y="116" font-family="Georgia,serif" font-size="40" font-style="italic" fill="#f3f1e6" text-anchor="middle">Café du Jour</text>
<path d="M82 140 H198 M82 164 H178 M82 188 H208 M222 140 H300 M222 164 H292 M222 188 H306" stroke="#f3f1e6" stroke-width="3" stroke-linecap="round" opacity=".65"/>
${[70, 195, 320].map((x, i) => `<path d="M${x} 0 V${210 + i * 20}" stroke="#222" stroke-width="3"/><circle cx="${x}" cy="${236 + i * 20}" r="70" fill="url(#IDl)"/><path d="M${x - 22} ${244 + i * 20} A22 22 0 0 1 ${x + 22} ${244 + i * 20}Z" fill="#2a2a2a"/><circle cx="${x}" cy="${250 + i * 20}" r="9" fill="#ffe9a8"/>`).join('')}
<rect x="22" y="352" width="346" height="9" fill="#7a4f33"/>
${[40, 80, 120, 170, 220, 270, 320].map((x, i) => `<rect x="${x}" y="${326 - (i % 2) * 6}" width="${i % 3 === 0 ? 26 : 22}" height="${26 + (i % 2) * 6}" rx="4" fill="${['#e8795a', '#f2c94c', '#6fb7e8', '#9ad07a', '#f4f1e6', '#d98ad0', '#e8795a'][i]}"/>`).join('')}
<rect y="456" width="390" height="14" fill="#a8744c"/><rect y="470" width="390" height="70" fill="#7a4a30"/><path d="M0 470 H390" stroke="#d9a574" stroke-width="3"/>
<rect x="268" y="392" width="84" height="64" rx="8" fill="#9aa1ab"/><rect x="278" y="402" width="30" height="22" rx="3" fill="#2b2f36"/><circle cx="330" cy="414" r="8" fill="#e8795a"/><rect x="290" y="440" width="34" height="14" rx="3" fill="#6b7078"/>
<rect x="40" y="428" width="28" height="28" rx="5" fill="#f4f1e6"/><path d="M68 436 q12 0 12 10 q0 10 -12 10" stroke="#f4f1e6" stroke-width="4" fill="none"/>`);

  const rooftop = () => {
    const r = rng(7), stars = [], b = [];
    for (let i = 0; i < 46; i++) stars.push(`<circle cx="${(r() * 390) | 0}" cy="${(r() * 330) | 0}" r="${(0.6 + r() * 1.4).toFixed(1)}" fill="#fff" opacity="${(0.4 + r() * 0.6).toFixed(2)}"/>`);
    let x = -10; while (x < 400) {
      const w = 34 + ((r() * 40) | 0), h = 90 + ((r() * 190) | 0), top = 560 - h;
      b.push(`<rect x="${x}" y="${top}" width="${w}" height="${h}" fill="${r() < 0.5 ? '#12132e' : '#191a3c'}"/>`);
      for (let wy = top + 12; wy < 548; wy += 16) for (let wx = x + 7; wx < x + w - 8; wx += 12) if (r() < 0.42) b.push(`<rect x="${wx}" y="${wy}" width="5" height="7" fill="#ffd77a" opacity="${(0.5 + r() * 0.5).toFixed(2)}"/>`);
      x += w + 3 + ((r() * 8) | 0);
    }
    return wrap('rt', `
<defs><linearGradient id="IDs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#060a22"/><stop offset=".6" stop-color="#2a2260"/><stop offset="1" stop-color="#a8527e"/></linearGradient></defs>
<rect width="390" height="780" fill="url(#IDs)"/>${stars.join('')}
<circle cx="300" cy="118" r="36" fill="#fff3c6"/><circle cx="314" cy="108" r="32" fill="#1a1850"/><circle cx="300" cy="118" r="60" fill="#fff3c6" opacity=".08"/>
${b.join('')}
<rect y="560" width="390" height="220" fill="#1b1a30"/><rect y="552" width="390" height="22" fill="#2c2a4e"/>
<path d="M-10 70 Q195 170 400 70" stroke="#33304f" stroke-width="2.5" fill="none"/>
${Array.from({ length: 11 }, (_, i) => { const t = i / 10, px = -10 + t * 410, py = 70 + 4 * 50 * t * (1 - t) * 0.5 * 2; return `<circle cx="${px.toFixed(0)}" cy="${(py + 6).toFixed(0)}" r="6" fill="${['#ffd77a', '#ff8ab5', '#7ad7ff'][i % 3]}"/><circle cx="${px.toFixed(0)}" cy="${(py + 6).toFixed(0)}" r="16" fill="${['#ffd77a', '#ff8ab5', '#7ad7ff'][i % 3]}" opacity=".18"/>`; }).join('')}`);
  };

  const beach = () => wrap('bc', `
<defs><linearGradient id="IDs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fc8f4"/><stop offset="1" stop-color="#fdeccb"/></linearGradient>
<linearGradient id="IDw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#37b8d6"/><stop offset="1" stop-color="#1b86b8"/></linearGradient></defs>
<rect width="390" height="780" fill="url(#IDs)"/><circle cx="300" cy="150" r="90" fill="#fff6bf" opacity=".35"/><circle cx="300" cy="150" r="46" fill="#ffe27a"/>
<ellipse cx="90" cy="120" rx="54" ry="16" fill="#fff" opacity=".9"/><ellipse cx="124" cy="108" rx="36" ry="14" fill="#fff" opacity=".9"/><ellipse cx="210" cy="200" rx="42" ry="11" fill="#fff" opacity=".8"/>
<rect y="300" width="390" height="230" fill="url(#IDw)"/>
${[330, 370, 410, 450, 490].map((y, i) => `<path d="M0 ${y} q24 -9 48 0 t48 0 t48 0 t48 0 t48 0 t48 0 t48 0 t48 0 t48 0" stroke="#fff" stroke-width="2.5" fill="none" opacity="${0.5 - i * 0.07}" transform="translate(${i % 2 ? -20 : 0} 0)"/>`).join('')}
<path d="M0 520 Q100 496 200 516 T390 508 V780 H0Z" fill="#f2d99b"/><path d="M0 520 Q100 496 200 516 T390 508" stroke="#fff" stroke-width="7" fill="none" opacity=".85"/>
<path d="M0 600 Q120 584 260 604 T390 596 V780 H0Z" fill="#e8c981" opacity=".7"/>
<path d="M36 560 Q50 420 78 330" stroke="#8a5a32" stroke-width="13" fill="none" stroke-linecap="round"/>
${[[-70, 70], [-20, 62], [30, 64], [75, 58], [-110, 46]].map(([a, l]) => `<ellipse cx="78" cy="${330 - l / 2}" rx="11" ry="${l}" fill="#2f9a55" transform="rotate(${a} 78 332)"/>`).join('')}
<path d="M356 520 Q340 420 318 350" stroke="#8a5a32" stroke-width="12" fill="none" stroke-linecap="round"/>
${[[-65, 60], [-15, 54], [35, 58], [80, 50], [115, 40]].map(([a, l]) => `<ellipse cx="318" cy="${350 - l / 2}" rx="10" ry="${l}" fill="#3aa860" transform="rotate(${a} 318 352)"/>`).join('')}
<path d="M236 470 V604" stroke="#f4f1e6" stroke-width="5"/><path d="M180 478 Q236 408 292 478Z" fill="#e8564a"/><path d="M180 478 Q208 440 236 438 Q222 456 218 478Z M236 438 Q264 440 292 478 H254 Q250 456 236 438Z" fill="#fff" opacity=".9"/>
<path d="M26 620 L96 574 L166 620Z" fill="#c99a52"/><rect x="42" y="620" width="108" height="64" fill="#b57a45"/><rect x="82" y="640" width="28" height="44" fill="#6b4a30"/>`);

  const hostel = () => wrap('hs', `
<defs><radialGradient id="IDl"><stop offset="0" stop-color="#fff" stop-opacity=".8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect width="390" height="780" fill="#dfe5ea"/><rect y="560" width="390" height="220" fill="#9a8b7a"/><rect y="552" width="390" height="10" fill="#6f6254"/>
${[0, 1, 2, 3, 4, 5].map((i) => `<path d="M${i * 80 - 30} 562 L${i * 120 - 120} 780" stroke="#85775f" stroke-width="2" opacity=".6"/>`).join('')}
<rect x="22" y="130" width="76" height="104" fill="#ff7a59"/><circle cx="60" cy="168" r="18" fill="#ffd23f"/><path d="M22 234 L50 196 L70 220 L84 204 L98 234Z" fill="#2b2d42"/>
<rect x="112" y="150" width="62" height="82" fill="#3ec5c1"/><path d="M122 220 Q143 170 164 220" fill="none" stroke="#fff" stroke-width="6"/><circle cx="143" cy="178" r="9" fill="#fff"/>
<rect x="222" y="112" width="148" height="104" rx="6" fill="#c89a62" stroke="#8a6240" stroke-width="7"/>
${[[236, 124, '#ffe27a'], [290, 128, '#ff9bb8'], [330, 124, '#9fd8ff'], [244, 168, '#9fe3a8'], [296, 170, '#ffe27a'], [336, 166, '#ff9bb8']].map(([x, y, c]) => `<rect x="${x}" y="${y}" width="28" height="28" fill="${c}" transform="rotate(${(x + y) % 9 - 4} ${x + 14} ${y + 14})"/><circle cx="${x + 14}" cy="${y + 3}" r="3" fill="#e0453a"/>`).join('')}
<rect x="20" y="276" width="350" height="8" fill="#7a5a3a"/>
${[28, 46, 62, 84, 102, 124, 150, 172, 196].map((x, i) => `<rect x="${x}" y="${246 - (i % 3) * 6}" width="${12 + (i % 2) * 5}" height="${30 + (i % 3) * 6}" fill="${['#e8564a', '#3ec5c1', '#ffd23f', '#6f7dff', '#ff9bb8', '#4caf6a', '#e8795a', '#2b2d42', '#f4a23a'][i]}"/>`).join('')}
<path d="M-10 36 Q195 112 400 36" stroke="#8a8a8a" stroke-width="2.5" fill="none"/>
${Array.from({ length: 13 }, (_, i) => { const t = i / 12, px = -10 + t * 410, py = 36 + 4 * 38 * t * (1 - t); const c = ['#ffd23f', '#ff7a59', '#3ec5c1', '#ff9bb8'][i % 4]; return `<circle cx="${px.toFixed(0)}" cy="${(py + 6).toFixed(0)}" r="5.5" fill="${c}"/><circle cx="${px.toFixed(0)}" cy="${(py + 6).toFixed(0)}" r="15" fill="${c}" opacity=".22"/>`; }).join('')}
<ellipse cx="62" cy="552" rx="62" ry="42" fill="#e8564a"/><ellipse cx="62" cy="520" rx="42" ry="22" fill="#f0786c" opacity=".7"/>
<ellipse cx="328" cy="556" rx="58" ry="40" fill="#4a8fe8"/><ellipse cx="328" cy="526" rx="38" ry="20" fill="#6fa8f0" opacity=".7"/>
<ellipse cx="195" cy="690" rx="220" ry="60" fill="#6f7dff" opacity=".4"/>`);

  const lounge = () => wrap('lg', `
<defs><linearGradient id="IDb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#150d2e"/><stop offset="1" stop-color="#34196a"/></linearGradient>
<filter id="IDn" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<radialGradient id="IDg"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect width="390" height="780" fill="url(#IDb)"/>
<text x="195" y="128" font-family="Arial Black,Impact,sans-serif" font-size="58" font-weight="900" text-anchor="middle" fill="none" stroke="#ff4fd8" stroke-width="3" filter="url(#IDn)">GAME ON</text>
<rect x="40" y="170" width="310" height="5" rx="2.5" fill="#3ef0ff" filter="url(#IDn)"/><rect x="70" y="186" width="250" height="4" rx="2" fill="#ff4fd8" filter="url(#IDn)" opacity=".8"/>
${[[16, '#3ef0ff'], [140, '#ff7a3e'], [264, '#8aff3e']].map(([x, c]) => `<rect x="${x}" y="300" width="110" height="260" rx="10" fill="#0b0720"/><rect x="${x + 12}" y="316" width="86" height="76" rx="6" fill="${c}" opacity=".85" filter="url(#IDn)"/><path d="M${x + 24} 376 l12 -22 l12 14 l12 -20 l14 28Z" fill="#0b0720" opacity=".45"/><rect x="${x + 12}" y="408" width="86" height="40" rx="5" fill="#1a1238"/><circle cx="${x + 34}" cy="428" r="8" fill="#e8454a"/><circle cx="${x + 62}" cy="428" r="5" fill="${c}"/><circle cx="${x + 80}" cy="428" r="5" fill="#f2c94c"/><rect x="${x + 6}" y="296" width="98" height="6" rx="3" fill="${c}" opacity=".9"/>`).join('')}
<rect y="560" width="390" height="220" fill="#1a1033"/><path d="M0 560 H390" stroke="#3ef0ff" stroke-width="3" filter="url(#IDn)"/>
${[-3, -2, -1, 0, 1, 2, 3].map((i) => `<path d="M${195 + i * 14} 562 L${195 + i * 120} 780" stroke="#ff4fd8" stroke-width="2" opacity=".55"/>`).join('')}
${[600, 640, 700].map((y, i) => `<path d="M0 ${y} H390" stroke="#3ef0ff" stroke-width="2" opacity="${0.45 - i * 0.1}"/>`).join('')}
${[60, 195, 330].map((x) => `<path d="M${x} 0 V240" stroke="#444" stroke-width="2"/><path d="M${x - 22} 246 L${x - 8} 214 H${x + 8} L${x + 22} 246Z" fill="#2a2150"/><circle cx="${x}" cy="252" r="46" fill="url(#IDg)" opacity=".5"/>`).join('')}`);

  const mk = (name, fn) => ({ name, svg: fn });
  return {
    living: mk('Living room', living), cafe: mk('Café', cafe), rooftop: mk('Rooftop night', rooftop),
    beach: mk('Beach hut', beach), hostel: mk('Hostel lounge', hostel), lounge: mk('Game lounge', lounge),
  };
})();
