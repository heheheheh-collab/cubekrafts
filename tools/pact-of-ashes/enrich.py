import json, re
secs = json.load(open('novel.json'))

DARK = re.compile(r'\b(blood|ash|ashes|devil|silence|kill|killed|kills|killing|knife|blade|dead|death|corpse|scream|shadow|smoke|rot|grief|hollow|cold|burn|burned|burning|whisper|whispered)\b', re.I)
LIGHT = re.compile(r'\b(laugh|laughed|laughter|warm|warmth|sun|sunlight|light|smile|smiled|hope|home|gentle|kind|kindness|love|loved|breath|alive|morning|golden)\b', re.I)

def epigraph(paras):
    for p in paras:
        s = re.split(r'(?<=[.!?])\s+', p)[0].strip()
        if 20 <= len(s) <= 110:
            return s
    return paras[0][:110].strip() + '...' if paras else ''

for s in secs:
    txt = ' '.join(s['paragraphs'])
    d, l = len(DARK.findall(txt)), len(LIGHT.findall(txt))
    per1k = (d - l) / max(s['words'], 1) * 1000
    s['epigraph'] = epigraph(s['paragraphs'])
    s['darkIndex'] = round(per1k, 2)
    s['id'] = (f"chapter-{s['number']}" if s['kind'] == 'chapter' else s['kind'])

vals = [s['darkIndex'] for s in secs]
lo, hi = min(vals), max(vals)
for s in secs:
    s['descent'] = round((s['darkIndex'] - lo) / (hi - lo) * 100)
    del s['darkIndex']

json.dump(secs, open('novel.json','w'), ensure_ascii=False)
print(json.dumps([{'id':s['id'],'d':s['descent'],'w':s['words'],'e':s['epigraph'][:70]} for s in secs[:14]], indent=1))
print('total chars', len(open('novel.json').read()))
