"""Draws the 12 avatars as SVG (tools/avatars/*.svg) and renders them to 128x128 PNG (public/avatars/*.png).
Needs: pip install playwright + a Chrome. Only for editing the artwork; the game itself just serves the PNGs."""
import os, sys, asyncio
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'avatars'); OUT = os.path.join(HERE, '..', 'public', 'avatars')

def wrap(bg, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128"><circle cx="64" cy="64" r="62" fill="{bg}"/>{body}</svg>'

A = {}
A['fox'] = wrap('#ffe3c2', '''
<path d="M20 48 L34 12 L58 34 Q64 32 70 34 L94 12 L108 48 Q114 84 64 116 Q14 84 20 48Z" fill="#ec7a2b"/>
<path d="M34 24 L48 36 L36 44Z M94 24 L80 36 L92 44Z" fill="#5b2a10"/>
<path d="M64 116 Q28 94 22 66 Q46 86 64 86 Q82 86 106 66 Q100 94 64 116Z" fill="#fff"/>
<circle cx="46" cy="62" r="5.5" fill="#222"/><circle cx="82" cy="62" r="5.5" fill="#222"/>
<circle cx="47.5" cy="60.5" r="1.8" fill="#fff"/><circle cx="83.5" cy="60.5" r="1.8" fill="#fff"/>
<ellipse cx="64" cy="92" rx="7" ry="5" fill="#222"/>''')
A['panda'] = wrap('#d9f2e6', '''
<circle cx="30" cy="34" r="15" fill="#222"/><circle cx="98" cy="34" r="15" fill="#222"/>
<circle cx="64" cy="70" r="42" fill="#fff"/>
<ellipse cx="46" cy="64" rx="10" ry="13" fill="#222" transform="rotate(20 46 64)"/>
<ellipse cx="82" cy="64" rx="10" ry="13" fill="#222" transform="rotate(-20 82 64)"/>
<circle cx="48" cy="63" r="3.5" fill="#fff"/><circle cx="80" cy="63" r="3.5" fill="#fff"/>
<ellipse cx="64" cy="84" rx="8" ry="5.5" fill="#222"/>
<path d="M56 94 Q64 101 72 94" stroke="#222" stroke-width="3" fill="none" stroke-linecap="round"/>''')
A['cat'] = wrap('#e6e0ff', '''
<path d="M22 58 L26 14 L56 36Z M106 58 L102 14 L72 36Z" fill="#8f98ad"/>
<path d="M30 30 L34 24 L46 36Z M98 30 L94 24 L82 36Z" fill="#f4a9c0"/>
<ellipse cx="64" cy="74" rx="42" ry="38" fill="#8f98ad"/>
<ellipse cx="47" cy="68" rx="7" ry="9" fill="#bde86a"/><ellipse cx="81" cy="68" rx="7" ry="9" fill="#bde86a"/>
<ellipse cx="47" cy="68" rx="2.5" ry="7" fill="#222"/><ellipse cx="81" cy="68" rx="2.5" ry="7" fill="#222"/>
<path d="M60 84 L68 84 L64 90Z" fill="#f4a9c0"/>
<path d="M64 90 Q58 98 52 94 M64 90 Q70 98 76 94" stroke="#222" stroke-width="2.5" fill="none" stroke-linecap="round"/>
<path d="M30 84 L10 80 M30 90 L10 94 M98 84 L118 80 M98 90 L118 94" stroke="#fff" stroke-width="2" stroke-linecap="round"/>''')
A['owl'] = wrap('#ffeab8', '''
<path d="M26 30 L40 44 L24 52Z M102 30 L88 44 L104 52Z" fill="#7a4a2a"/>
<ellipse cx="64" cy="72" rx="40" ry="42" fill="#9a6335"/>
<ellipse cx="64" cy="90" rx="24" ry="20" fill="#e8c898"/>
<circle cx="46" cy="62" r="17" fill="#fff"/><circle cx="82" cy="62" r="17" fill="#fff"/>
<circle cx="48" cy="63" r="8" fill="#222"/><circle cx="80" cy="63" r="8" fill="#222"/>
<circle cx="51" cy="60" r="2.8" fill="#fff"/><circle cx="83" cy="60" r="2.8" fill="#fff"/>
<path d="M58 74 L70 74 L64 86Z" fill="#f0a020"/>''')
A['robot'] = wrap('#d8ecff', '''
<line x1="64" y1="12" x2="64" y2="30" stroke="#6b7a90" stroke-width="4"/><circle cx="64" cy="12" r="6" fill="#ff5a5a"/>
<rect x="22" y="30" width="84" height="76" rx="18" fill="#aeb8c8"/>
<rect x="12" y="56" width="10" height="26" rx="4" fill="#7e8ba0"/><rect x="106" y="56" width="10" height="26" rx="4" fill="#7e8ba0"/>
<rect x="34" y="46" width="24" height="22" rx="6" fill="#0d2b3a"/><rect x="70" y="46" width="24" height="22" rx="6" fill="#0d2b3a"/>
<rect x="40" y="52" width="12" height="10" rx="3" fill="#4fe3ff"/><rect x="76" y="52" width="12" height="10" rx="3" fill="#4fe3ff"/>
<rect x="38" y="82" width="52" height="14" rx="5" fill="#0d2b3a"/>
<path d="M48 82 V96 M58 82 V96 M68 82 V96 M78 82 V96" stroke="#aeb8c8" stroke-width="2.5"/>''')
A['astronaut'] = wrap('#1d2a55', '''
<circle cx="20" cy="26" r="1.8" fill="#fff"/><circle cx="104" cy="40" r="1.5" fill="#fff"/><circle cx="26" cy="100" r="1.6" fill="#fff"/><circle cx="108" cy="96" r="2" fill="#fff"/>
<circle cx="64" cy="66" r="42" fill="#f3f4f8"/>
<rect x="26" y="46" width="76" height="46" rx="23" fill="#10183a"/>
<path d="M36 56 Q44 50 58 52" stroke="#6f8cff" stroke-width="5" fill="none" stroke-linecap="round"/>
<circle cx="64" cy="112" r="0" fill="#fff"/>
<rect x="52" y="104" width="24" height="10" rx="4" fill="#e04b4b"/>
<circle cx="96" cy="44" r="6" fill="#ffd23f"/>''')
A['wizard'] = wrap('#f0dcff', '''
<path d="M64 6 L98 62 L30 62Z" fill="#5b3fb5"/>
<ellipse cx="64" cy="64" rx="46" ry="9" fill="#4a3399"/>
<path d="M58 30 l3 7 7 .5 -5.5 4.5 2 7 -6.5 -4 -6.5 4 2 -7 -5.5 -4.5 7 -.5Z" fill="#ffd23f"/>
<circle cx="64" cy="82" r="26" fill="#f4c9a0"/>
<path d="M38 86 Q40 122 64 122 Q88 122 90 86 Q76 100 64 100 Q52 100 38 86Z" fill="#f4f4f8"/>
<circle cx="54" cy="78" r="3.5" fill="#222"/><circle cx="74" cy="78" r="3.5" fill="#222"/>
<path d="M58 92 Q64 96 70 92" stroke="#b5683c" stroke-width="2.5" fill="none" stroke-linecap="round"/>''')
A['pirate'] = wrap('#cfe9ff', '''
<circle cx="64" cy="70" r="40" fill="#f2c18d"/>
<path d="M24 60 Q64 20 104 60 Q104 46 64 34 Q24 46 24 60Z" fill="#d93a3a"/>
<path d="M24 60 H104" stroke="#a82424" stroke-width="5"/>
<circle cx="46" cy="44" r="3" fill="#fff"/><circle cx="64" cy="38" r="3" fill="#fff"/><circle cx="82" cy="44" r="3" fill="#fff"/>
<path d="M104 60 Q116 68 112 88 Q106 74 100 66Z" fill="#d93a3a"/>
<path d="M30 56 L92 90" stroke="#222" stroke-width="3"/>
<ellipse cx="46" cy="78" rx="11" ry="9.5" fill="#222"/>
<circle cx="82" cy="76" r="4.5" fill="#222"/>
<path d="M50 100 Q64 110 78 100" stroke="#8a4a22" stroke-width="3.5" fill="none" stroke-linecap="round"/>
<circle cx="94" cy="94" r="4.5" fill="#ffd23f"/>''')
A['ninja'] = wrap('#e4e4ea', '''
<circle cx="64" cy="66" r="44" fill="#262a36"/>
<rect x="22" y="52" width="84" height="26" rx="13" fill="#f2c9a0"/>
<path d="M20 44 Q64 30 108 44 L108 52 Q64 40 20 52Z" fill="#e04040"/>
<path d="M104 44 L124 36 L116 52Z M104 48 L122 60 L112 54Z" fill="#e04040"/>
<ellipse cx="46" cy="65" rx="7" ry="5.5" fill="#fff"/><ellipse cx="82" cy="65" rx="7" ry="5.5" fill="#fff"/>
<circle cx="47" cy="65" r="3.4" fill="#222"/><circle cx="81" cy="65" r="3.4" fill="#222"/>
<path d="M42 56 L54 60 M86 56 L74 60" stroke="#262a36" stroke-width="3.5" stroke-linecap="round"/>''')
A['alien'] = wrap('#d6f8d0', '''
<path d="M64 10 V30" stroke="#3aa04a" stroke-width="4"/><circle cx="64" cy="10" r="6" fill="#ff7ad9"/>
<path d="M64 24 Q112 24 108 72 Q100 112 64 118 Q28 112 20 72 Q16 24 64 24Z" fill="#59c96a"/>
<path d="M28 60 Q40 50 56 70 Q50 86 36 80 Q26 74 28 60Z" fill="#101a12"/>
<path d="M100 60 Q88 50 72 70 Q78 86 92 80 Q102 74 100 60Z" fill="#101a12"/>
<circle cx="45" cy="66" r="3" fill="#fff"/><circle cx="83" cy="66" r="3" fill="#fff"/>
<path d="M54 98 Q64 104 74 98" stroke="#1d6b2a" stroke-width="3" fill="none" stroke-linecap="round"/>''')
A['ghost'] = wrap('#dfe6f5', '''
<path d="M26 112 V62 Q26 16 64 16 Q102 16 102 62 V112 L90 102 L77 114 L64 102 L51 114 L38 102Z" fill="#fff"/>
<path d="M26 112 V62 Q26 16 64 16 Q102 16 102 62" stroke="#c4cfe6" stroke-width="3" fill="none"/>
<ellipse cx="50" cy="58" rx="7" ry="10" fill="#222"/><ellipse cx="78" cy="58" rx="7" ry="10" fill="#222"/>
<circle cx="52" cy="54" r="2.4" fill="#fff"/><circle cx="80" cy="54" r="2.4" fill="#fff"/>
<ellipse cx="64" cy="80" rx="7" ry="9" fill="#222"/>
<ellipse cx="40" cy="74" rx="6" ry="3.5" fill="#ffb3c4"/><ellipse cx="88" cy="74" rx="6" ry="3.5" fill="#ffb3c4"/>''')
A['dino'] = wrap('#fff0c9', '''
<path d="M34 44 L40 26 L48 40 L58 22 L66 38 L76 22 L82 40Z" fill="#f08a3c"/>
<path d="M18 74 Q16 38 58 36 Q98 34 104 66 Q108 90 98 100 Q88 112 56 112 Q22 110 18 74Z" fill="#5cc26a"/>
<path d="M56 112 Q88 112 98 100 Q106 90 104 80 Q80 96 56 94Z" fill="#c6f0a8"/>
<circle cx="60" cy="62" r="7" fill="#fff"/><circle cx="62" cy="63" r="3.6" fill="#222"/>
<circle cx="90" cy="74" r="2.5" fill="#2f7a3a"/><circle cx="98" cy="76" r="2.5" fill="#2f7a3a"/>
<path d="M60 92 L66 100 L72 92 M76 92 L82 100 L88 92" fill="#fff" stroke="#fff" stroke-width="1"/>
<circle cx="38" cy="82" r="6" fill="#4aa85a"/><circle cx="48" cy="52" r="4" fill="#4aa85a"/>''')

ICON = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="110" fill="#14161f"/>
<g transform="translate(256 262)"><rect x="-170" y="-110" width="100" height="150" rx="16" fill="#e53935" stroke="#fff" stroke-width="8" transform="rotate(-22 -120 -35)"/>
<rect x="-100" y="-130" width="100" height="150" rx="16" fill="#fdd835" stroke="#fff" stroke-width="8" transform="rotate(-7 -50 -55)"/>
<rect x="-10" y="-130" width="100" height="150" rx="16" fill="#2e9e4f" stroke="#fff" stroke-width="8" transform="rotate(8 40 -55)"/>
<rect x="60" y="-110" width="100" height="150" rx="16" fill="#1e78e0" stroke="#fff" stroke-width="8" transform="rotate(22 110 -35)"/>
<text x="0" y="150" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="120" fill="#ffd23f" text-anchor="middle">UNO</text></g></svg>'''

os.makedirs(SRC, exist_ok=True); os.makedirs(OUT, exist_ok=True)
for k, v in A.items(): open(os.path.join(SRC, k + '.svg'), 'w').write(v)
open(os.path.join(SRC, '_icon.svg'), 'w').write(ICON)

async def main():
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME', '/usr/bin/google-chrome'), args=['--no-sandbox'])
        for k, v in A.items():
            pg = await b.new_page(viewport={'width': 128, 'height': 128}, device_scale_factor=1)
            await pg.set_content(f'<body style="margin:0;background:transparent">{v}</body>')
            await pg.screenshot(path=os.path.join(OUT, k + '.png'), omit_background=True)
            await pg.close()
        for size in (192, 512):
            pg = await b.new_page(viewport={'width': size, 'height': size})
            await pg.set_content(f'<body style="margin:0"><div style="width:{size}px;height:{size}px">{ICON.replace("<svg ", f"<svg width=\'{size}\' height=\'{size}\' ")}</div></body>')
            await pg.screenshot(path=os.path.join(OUT, '..', f'icon-{size}.png'), omit_background=True)
            await pg.close()
        await b.close()
asyncio.run(main())
print('done:', len(A), 'avatars')
