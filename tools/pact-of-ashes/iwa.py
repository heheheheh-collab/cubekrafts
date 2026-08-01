import sys, struct, re

def snappy_decompress(data):
    # varint length
    pos = 0
    shift = 0
    ulen = 0
    while True:
        b = data[pos]; pos += 1
        ulen |= (b & 0x7f) << shift
        shift += 7
        if not (b & 0x80): break
    out = bytearray()
    while pos < len(data):
        tag = data[pos]; pos += 1
        t = tag & 0x03
        if t == 0:
            n = tag >> 2
            if n < 60:
                length = n + 1
            else:
                nb = n - 59
                length = int.from_bytes(data[pos:pos+nb], 'little') + 1
                pos += nb
            out += data[pos:pos+length]; pos += length
        else:
            if t == 1:
                length = 4 + ((tag >> 2) & 0x07)
                offset = ((tag >> 5) << 8) | data[pos]; pos += 1
            elif t == 2:
                length = (tag >> 2) + 1
                offset = int.from_bytes(data[pos:pos+2], 'little'); pos += 2
            else:
                length = (tag >> 2) + 1
                offset = int.from_bytes(data[pos:pos+4], 'little'); pos += 4
            start = len(out) - offset
            for i in range(length):
                out.append(out[start + i])
    return bytes(out)

def parse_iwa(path):
    raw = open(path,'rb').read()
    pos = 0
    chunks = []
    while pos < len(raw):
        if pos + 4 > len(raw): break
        hdr = raw[pos:pos+4]
        if hdr[0] != 0x00:
            break
        blen = int.from_bytes(hdr[1:4],'little')
        pos += 4
        block = raw[pos:pos+blen]
        pos += blen
        try:
            chunks.append(snappy_decompress(block))
        except Exception as e:
            pass
    return b''.join(chunks)

if __name__ == '__main__':
    d = parse_iwa(sys.argv[1])
    open(sys.argv[2],'wb').write(d)
    print(len(d))
