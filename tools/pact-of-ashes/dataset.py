import json, re

secs = json.load(open('sections.json'))

def clean(p):
    p = p.replace('’',"'").replace('‘',"'")
    p = p.replace('“','"').replace('”','"')
    p = re.sub(r'\s+', ' ', p).strip()
    return p

out = []
for s in secs:
    t = s['title']
    m = re.match(r'Chapter[\s\-]*(\d+)', t, re.I)
    if m:
        kind, num, title = 'chapter', int(m.group(1)), f'Chapter {m.group(1)}'
    else:
        low = t.lower()
        kind = {'preface':'preface','acknowledgment':'acknowledgment',
                'prolouge':'prologue','prologue':'prologue',
                'epilouge':'epilogue','epilogue':'epilogue'}[low]
        num = None
        title = {'preface':'Preface','acknowledgment':'Acknowledgments',
                 'prologue':'Prologue','epilogue':'Epilogue'}[kind]
    paras = [clean(p) for p in s['paras'] if clean(p)]
    out.append({'kind':kind,'number':num,'title':title,'paragraphs':paras,
                'words': sum(len(p.split()) for p in paras)})

json.dump(out, open('novel.json','w'), ensure_ascii=False, indent=None)
tot = sum(s['words'] for s in out)
chars = sum(len(json.dumps(s, ensure_ascii=False)) for s in out)
print('sections', len(out), 'words', tot, 'json chars', chars)

# batching plan: chapters only, ~40k chars per batch
batch, cur, curlen = [], [], 0
for s in out:
    l = len(json.dumps(s, ensure_ascii=False))
    if curlen + l > 40000 and cur:
        batch.append(cur); cur, curlen = [], 0
    cur.append(s); curlen += l
if cur: batch.append(cur)
print('batches', len(batch), [ (b[0]['title'], b[-1]['title'], sum(len(json.dumps(x,ensure_ascii=False)) for x in b)) for b in batch ])
for i,b in enumerate(batch,1):
    json.dump(b, open(f'batch{i}.json','w'), ensure_ascii=False)
