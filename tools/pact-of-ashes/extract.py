import re
d = open('doc.bin','rb').read()
# find long runs of printable text
runs = re.findall(rb'[\x09\x0a\x0d\x20-\x7e\xc2-\xf4][\x09\x0a\x0d\x20-\x7e\x80-\xbf\xc2-\xf4]{80,}', d)
out=[]
for r in runs:
    try:
        s = r.decode('utf-8')
    except:
        s = r.decode('utf-8','ignore')
    out.append(s)
txt = '\n\n=====CHUNK=====\n\n'.join(out)
open('raw_text.txt','w').write(txt)
print(len(out), sum(len(x) for x in out))
