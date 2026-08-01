import re, json

lines = open('raw_text.txt', encoding='utf-8').read().split('\n')
lines = [l for l in lines if l.strip() != '=====CHUNK=====']

head_re = re.compile(r'^(Preface|Acknowledgment|Prolouge|Prologue|Epilouge|Epilogue|Chapter[\s\-]*\d+)\s*$', re.I)

secs = []
cur = None
for l in lines:
    s = l.strip()
    if not s: continue
    if head_re.match(s):
        cur = {'title': re.sub(r'\s+',' ',s), 'paras': []}
        secs.append(cur)
    elif cur:
        cur['paras'].append(s)

for s in secs:
    s['words'] = sum(len(p.split()) for p in s['paras'])
print(len(secs), sum(s['words'] for s in secs))
json.dump(secs, open('sections.json','w'), ensure_ascii=False)
for s in secs[:6]:
    print(s['title'], s['words'], len(s['paras']))
print('---last---')
for s in secs[-4:]:
    print(s['title'], s['words'], len(s['paras']))
